/**
 * Windows workaround for the OpenNext Cloudflare build.
 *
 * `@opennextjs/aws` recreates the junctions that Next's standalone output
 * writes into `.open-next/…/node_modules` by calling
 * `fs.symlinkSync(target, path)` with no type. On Windows an untyped symlink
 * for a directory is created as a *file* symlink, which needs the
 * `SeCreateSymbolicLinkPrivilege` an unelevated account does not hold, so the
 * build dies with `EPERM: operation not permitted, symlink`.
 *
 * A **junction** (`mklink /J`) has no such requirement. Node lets us ask for
 * one directly via `symlinkSync(target, path, 'junction')`, so this script
 * makes the call directory-aware. It is idempotent and only touches
 * `copyTracedFiles.js` inside node_modules.
 *
 * Nothing else in the build changes, and the patch is a no-op on macOS and
 * Linux where untyped symlinks work.
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const MARKER = 'copyTracedFiles directory-aware junction (Windows)';

/** @returns {string} absolute path of the patched build helper */
function targetPath() {
	const here = dirname(fileURLToPath(import.meta.url));
	return join(
		here,
		'..',
		'node_modules',
		'@opennextjs',
		'aws',
		'dist',
		'build',
		'copyTracedFiles.js'
	);
}

const file = targetPath();
let source;
try {
	source = readFileSync(file, 'utf8');
} catch {
	console.warn(
		'[patch-opennext-windows] @opennextjs/aws not installed — nothing to patch.'
	);
	process.exit(0);
}

if (source.includes(MARKER)) {
	console.log('[patch-opennext-windows] already patched.');
	process.exit(0);
}

const original = `                symlinkSync(symlink, to);`;
const patched = `                // ${MARKER}: junctions need no elevated symlink privilege.
                const __linkType = statSync(symlink).isDirectory()
                    ? "junction"
                    : undefined;
                symlinkSync(symlink, to, __linkType);`;

if (!source.includes(original)) {
	console.error(
		'[patch-opennext-windows] expected symlinkSync call not found — ' +
			'@opennextjs/aws changed its build helper. Update this script.'
	);
	process.exit(1);
}

writeFileSync(file, source.replace(original, patched), 'utf8');
console.log('[patch-opennext-windows] patched @opennextjs/aws copyTracedFiles.js');
