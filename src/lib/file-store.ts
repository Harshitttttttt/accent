/**
 * Byte store for user-supplied files: uploaded images under /uploads, message
 * attachments, and issued documents.
 *
 * Workers has no writable filesystem, so on that runtime every byte goes to the
 * KV namespace bound as `UPLOADS` (wrangler.jsonc). Plain Node keeps the
 * previous behaviour — files on disk — so `npm run dev`, `npm test` and the
 * existing route tests are unaffected.
 */
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getCloudflareBindings } from '@/utils/cloudflare-runtime';

/** Where Node-mode files live, relative to the project root. */
const LOCAL_ROOT = 'uploads';

/** Longest value a KV namespace accepts (25 MiB) — the hard upload ceiling. */
export const KV_MAX_VALUE_BYTES = 25 * 1024 * 1024;

function localPath(key: string): string {
	return join(process.cwd(), LOCAL_ROOT, ...key.split('/'));
}

/**
 * Write `bytes` under `key`. Creates parent directories in Node mode.
 * Rejects keys that escape the store root.
 */
export async function storeFile(key: string, bytes: Uint8Array): Promise<void> {
	const store = (await getCloudflareBindings())?.UPLOADS;
	if (store) {
		await store.put(key, bytes);
		return;
	}
	const target = localPath(key);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, bytes);
}

/** Read the bytes stored under `key`, or `null` when it is absent. */
export async function readFileBytes(key: string): Promise<ArrayBuffer | null> {
	const store = (await getCloudflareBindings())?.UPLOADS;
	if (store) return store.get(key, 'arrayBuffer');
	const target = localPath(key);
	try {
		const buf = await readFile(target);
		return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw err;
	}
}

/** Delete `key`. Silent when it does not exist. */
export async function deleteFileBytes(key: string): Promise<void> {
	const store = (await getCloudflareBindings())?.UPLOADS;
	if (store) {
		await store.delete(key);
		return;
	}
	const target = localPath(key);
	try {
		await unlink(target);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
	}
}

/** Whether `key` exists in the store. */
export async function fileExists(key: string): Promise<boolean> {
	const store = (await getCloudflareBindings())?.UPLOADS;
	if (store) return (await store.get(key)) !== null;
	try {
		await readFile(localPath(key));
		return true;
	} catch {
		return false;
	}
}
