/**
 * Rasterize and resize uploaded images to PNG on Cloudflare Workers.
 *
 * `sharp` is a native module and cannot be bundled into a Worker, so this uses
 * `@cf-wasm/photon` — Cloudflare's own WebAssembly port of Photon.
 *
 * Formats that decode on Workers: PNG, JPEG, WebP, GIF. Everything else
 * (SVG, HEIC/HEIF, AVIF, BMP, TIFF) is rejected, which is the safe direction:
 * an upload that cannot be rasterized is never stored.
 *
 * Security note: `sharp` could reject a decompression bomb *before* decoding
 * (`limitInputPixels`). A WASM decoder cannot, so the decoded dimensions are
 * checked here and the image is released immediately. Worst case a bomb
 * exhausts the isolate's memory, the request fails, and Cloudflare recycles
 * the isolate — the bytes are never written anywhere.
 */
// The workerd build has no default export; the named `PhotonImage`,
// `SamplingFilter` and `resize` are the whole surface this module needs.
//
// The import is deliberately request-scoped rather than top-level: importing
// `@cf-wasm/photon` compiles its WebAssembly module, and workerd rejects that
// with "Wasm code generation disallowed by embedder" during module evaluation
// (isolate startup). Holding the import until a request actually needs to
// rasterize an image keeps the compile inside the request, which is allowed.
// This is the platform-specific-module exception to a static import.
type PhotonModule = typeof import('@cf-wasm/photon');

let photonModule: Promise<PhotonModule> | undefined;

function loadPhoton(): Promise<PhotonModule> {
	photonModule ??= import('@cf-wasm/photon');
	return photonModule;
}

/** Reject decoded images larger than this (SEC-02, parity with the old cap). */
export const MAX_DECODED_PIXELS = 40_000_000;

/** Largest edge, in pixels, of the stored upload. */
export const MAX_UPLOAD_EDGE = 1200;

/** Largest edge, in pixels, of the thumbnail. */
export const MAX_THUMB_EDGE = 256;

/** Phosphor/photon errors are `unreachable` / raw strings, not Error objects. */
function toError(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value));
}

/**
 * Scale `w × h` to fit inside `max × max`, never enlarging, and never
 * collapsing a dimension to zero.
 */
function fitInside(width: number, height: number, max: number) {
	const scale = Math.min(max / width, max / height, 1);
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

/**
 * Decode, auto-orient is not available on Workers (no EXIF path), resize to
 * `max`, and re-encode as PNG.
 *
 * @param {Uint8Array} input raw uploaded bytes
 * @param {number} max largest edge of the result
 * @returns {Promise<Uint8Array>} PNG bytes
 * @throws when the input is not a decodable raster image or exceeds the cap
 */
export async function rasterizeToPng(
	input: Uint8Array,
	max: number
): Promise<Uint8Array> {
	const { PhotonImage, SamplingFilter, resize } = await loadPhoton();
	let image;
	try {
		image = await PhotonImage.new_from_byteslice(input);
	} catch (err) {
		throw toError(err);
	}

	const width = image.get_width();
	const height = image.get_height();
	try {
		if (!Number.isFinite(width) || !Number.isFinite(height)) {
			throw new Error('image has no readable dimensions');
		}
		if (width * height > MAX_DECODED_PIXELS) {
			throw new Error(
				`image decodes to ${width * height} pixels, above the ${MAX_DECODED_PIXELS} cap`
			);
		}
		const target = fitInside(width, height, max);
		const resized = resize(
			image,
			target.width,
			target.height,
			SamplingFilter.Lanczos3
		);
		return await resized.get_bytes();
	} catch (err) {
		throw toError(err);
	} finally {
		image.free();
	}
}
