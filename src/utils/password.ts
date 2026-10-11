/**
 * Password hashing.
 *
 * bcrypt is a native module and cannot run on Cloudflare Workers. New hashes
 * therefore use PBKDF2-SHA256 through WebCrypto, which workerd implements
 * natively. Hashes written by the old bcrypt code are still verifiable —
 * `bcryptjs` is a pure-JavaScript bcrypt — and every successful legacy login
 * re-hashes the password to the PBKDF2 scheme, so bcrypt disappears over time.
 *
 * Stored formats:
 *   `pbkdf2$<iterations>$<saltB64>$<hashB64>`  (new)
 *   `$2<cost>$<salt><hash>`                    (legacy bcrypt, read-only)
 */
import bcryptjs from 'bcryptjs';

/** PBKDF2 work factor. 210k is the OWASP floor for PBKDF2-SHA256. */
const PBKDF2_ITERATIONS = 210_000;

/** Derived key length, in bytes. */
const KEY_BYTES = 32;

/** Random salt length, in bytes. */
const SALT_BYTES = 16;

function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function importPasswordKey(plaintext: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(plaintext),
		'PBKDF2',
		false,
		['deriveBits']
	);
}

/**
 * Hash a plaintext password with PBKDF2-SHA256.
 * Returns the self-describing `pbkdf2$…` string.
 */
export async function hashPassword(plaintext: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	const key = await importPasswordKey(plaintext);
	const bits = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			hash: 'SHA-256',
			salt: salt as unknown as BufferSource,
			iterations: PBKDF2_ITERATIONS,
		},
		key,
		KEY_BYTES * 8
	);
	return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(new Uint8Array(bits))}`;
}

function isPbkdf2Hash(hash: string): boolean {
	return hash.startsWith('pbkdf2$');
}

/** Length in bytes of the derived key a stored PBKDF2 hash carries. */
function pbkdf2KeyLength(hashB64: string): number {
	// base64 pads to a multiple of 4, so the byte length is (3/4) of length,
	// minus 0-2 padding characters.
	const padding = hashB64.endsWith('==') ? 2 : hashB64.endsWith('=') ? 1 : 0;
	return Math.floor((hashB64.length * 3) / 4) - padding;
}

/**
 * Verify a plaintext password against a stored hash.
 * Handles bcrypt hashes and legacy plaintext too, matching the old contract.
 */
export async function verifyPassword(
	plaintext: string,
	hash: string
): Promise<boolean> {
	if (needsRehash(hash)) {
		// Legacy plaintext — direct comparison
		return plaintext === hash;
	}
	if (isPbkdf2Hash(hash)) {
		const [, iterationsB64, saltB64, hashB64] = hash.split('$');
		const key = await importPasswordKey(plaintext);
		const bits = await crypto.subtle.deriveBits(
			{
				name: 'PBKDF2',
				hash: 'SHA-256',
				salt: fromBase64(saltB64) as unknown as BufferSource,
				iterations: Number(iterationsB64),
			},
			key,
			pbkdf2KeyLength(hashB64) * 8
		);
		const expected = fromBase64(hashB64);
		const actual = new Uint8Array(bits);
		if (actual.length !== expected.length) return false;
		// Constant-time comparison
		let diff = 0;
		for (let i = 0; i < expected.length; i += 1) {
			diff |= actual[i] ^ expected[i];
		}
		return diff === 0;
	}
	// bcrypt (native bcrypt could not run on Workers; bcryptjs covers the rest)
	return bcryptjs.compareSync(plaintext, hash);
}

/**
 * Whether the stored hash is a legacy plaintext password that must be upgraded
 * to a real hash. Kept name-compatible with the pre-Cloudflare module.
 */
export function needsRehash(hash: string): boolean {
	return !hash.startsWith('$2');
}

/**
 * Whether a successful login should re-hash the password into the current
 * scheme: true for legacy plaintext, legacy bcrypt, and any PBKDF2 hash below
 * the current work factor.
 */
export function shouldUpgradeHash(hash: string): boolean {
	if (!hash.startsWith('$2')) return true; // legacy plaintext
	if (isPbkdf2Hash(hash)) {
		return Number(hash.split('$')[1]) !== PBKDF2_ITERATIONS;
	}
	return true; // bcrypt
}
