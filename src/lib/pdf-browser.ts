/**
 * Headless Chromium for the PDF routes.
 *
 * Cloudflare's `BROWSER` binding replaces the local Chrome and its spawn
 * flags: the executable path, the sandbox flags and /dev/shm limits are the
 * platform's concern. Plain Node keeps the existing local launch in each
 * calling route.
 *
 * `@cloudflare/puppeteer` is imported lazily because it can only connect to the
 * Cloudflare browser endpoint — importing it on plain Node or in the vitest
 * jsdom environment has no purpose and pulls the whole driver into those
 * graphs.
 */
import type { Browser } from '@cloudflare/puppeteer';
import { getCloudflareBindings } from '@/utils/cloudflare-runtime';

/** Headless browser used by the four PDF routes. */
export type PdfBrowser = Browser;

let browserPromise: Promise<PdfBrowser> | undefined;

/**
 * Launch a Cloudflare browser. The promise is shared so concurrent PDF
 * requests in one isolate reuse a single session.
 */
export async function launchPdfBrowser(): Promise<PdfBrowser> {
	const browser = (await getCloudflareBindings())?.BROWSER;
	if (!browser) {
		throw new Error(
			'PDF rendering on Cloudflare Workers needs the BROWSER binding in wrangler.jsonc'
		);
	}
	browserPromise ??= (async () => {
		const { default: puppeteer } = await import('@cloudflare/puppeteer');
		return puppeteer.launch(browser);
	})();
	return browserPromise;
}

/**
 * Close the shared browser so a new request starts from a clean session.
 * Safe to call when no browser has been launched.
 */
export async function closePdfBrowser(): Promise<void> {
	const pending = browserPromise;
	browserPromise = undefined;
	try {
		await (await pending)?.close();
	} catch {
		/* an already-closed browser is not an error */
	}
}
