/**
 * Cloudflare Workers runtime access.
 *
 * On plain Node (`npm run dev`, `npm test`, `npm run migrate`, `next build`)
 * `getCloudflareBindings()` resolves to `null`, so callers keep their existing
 * Node code path and the local workflow is unchanged.
 *
 * This module is plain ESM JavaScript on purpose: `knexfile.js` loads
 * `src/utils/database.js` under Node's native module loader (not through the
 * bundler), so every relative import reachable from there must be resolvable
 * without a bundler — including the `.js` extension.
 *
 * The binding shapes below are deliberately minimal and structural. The
 * generated `worker-configuration.d.ts` (`npx wrangler types`) is NOT used:
 * it re-declares workerd's DOM-like types, which collide with this project's
 * `lib: ["dom"]` and produce `void is not assignable to Element` errors across
 * unrelated files.
 *
 * Callers pick a binding off the result, e.g.:
 *   const store = (await getCloudflareBindings())?.UPLOADS;
 *
 * @typedef {object} KVNamespaceLike
 * @property {{
 *   (key: string, type?: 'text'): Promise<string | null>;
 *   (key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>;
 * }} get
 * @property {(key: string, value: unknown) => Promise<void>} put
 * @property {(key: string) => Promise<void>} delete
 *
 * @typedef {object} FetcherLike
 * @property {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} fetch
 *
 * @typedef {object} HyperdriveConfig
 * @property {string} host Cloudflare-side tunnel host.
 * @property {number} port Tunnel port.
 * @property {string} user Database user.
 * @property {string} password Database password.
 * @property {string} database Database name.
 *
 * @typedef {object} CloudflareBindings
 * @property {KVNamespaceLike} [UPLOADS] Uploaded images, keyed by their /uploads name.
 * @property {HyperdriveConfig} [HYPERDRIVE] MySQL connection config pooled by Cloudflare.
 * @property {FetcherLike} [BROWSER] Headless Chromium for PDF rendering.
 * @property {FetcherLike} [ASSETS] Static files from public/, served from the bundle.
 */

// Static import: `@opennextjs/cloudflare` is a runtime dependency present in
// every environment, so there is no runtime-selected specifier to hide. Only
// the call below is conditional, which is why the Node fallback wraps it.
import { getCloudflareContext } from '@opennextjs/cloudflare';

/** @type {CloudflareBindings | null | undefined} */
let cached;

/**
 * Resolve the Cloudflare bindings, or `null` when not running on Workers.
 * Cached per isolate: the binding set never changes during a request.
 *
 * @returns {Promise<CloudflareBindings | null>}
 */
export async function getCloudflareBindings() {
	if (cached !== undefined) return cached;
	try {
		const { env } = await getCloudflareContext({ async: true });
		cached = /** @type {CloudflareBindings} */ (env ?? {});
	} catch {
		// Outside a request scope, or on plain Node: callers use the Node path.
		cached = null;
	}
	return cached;
}
