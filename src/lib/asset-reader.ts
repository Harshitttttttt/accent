/**
 * Read static build assets that ship in `public/` at runtime.
 *
 * On Workers those files are served by the ASSETS binding, not by a real
 * filesystem: `process.cwd()` resolves into the read-only Workers VFS, which
 * only exposes the modules in the Worker bundle. Plain Node keeps the previous
 * `readFileSync` behaviour so dev, tests and `next build` are unaffected.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getCloudflareBindings } from '@/utils/cloudflare-runtime';

/**
 * Read a file from `public/`, e.g. `readPublicAsset('accent-logo.png')`.
 *
 * @param {string[]} segments path segments under `public/`, never user-supplied
 * @returns {Promise<Buffer>} the raw bytes
 */
export async function readPublicAsset(...segments: string[]): Promise<Buffer> {
	const assets = (await getCloudflareBindings())?.ASSETS;
	if (assets) {
		const url = `https://assets.invalid/${segments.map(encodeURIComponent).join('/')}`;
		const response = await assets.fetch(new Request(url));
		if (!response.ok) {
			throw new Error(
				`Static asset ${segments.join('/')} is not in the Worker asset bundle`
			);
		}
		return Buffer.from(await response.arrayBuffer());
	}
	return readFile(join(process.cwd(), 'public', ...segments));
}
