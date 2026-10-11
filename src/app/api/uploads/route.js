import {
	MAX_FILE_SIZE,
	MAX_REQUEST_BYTES,
	estimateBase64DecodedBytes,
} from '@/lib/upload-validation';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import {
	fileExists,
	KV_MAX_VALUE_BYTES,
	readFileBytes,
	storeFile,
} from '@/lib/file-store';
import {
	MAX_THUMB_EDGE,
	MAX_UPLOAD_EDGE,
	rasterizeToPng,
} from '@/lib/image-rasterize';

export async function POST(request) {
	// RBAC check - require at least projects:update for uploading files
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROJECTS,
		PERMISSIONS.UPDATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	// C2: reject oversized requests on the declared length — before the JSON
	// body is parsed, let alone decoded. A 20MB file is ~27MB of base64, so
	// anything above that ceiling cannot decode to an accepted file.
	const declaredLength = Number(request.headers.get('content-length'));
	if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
		return Response.json(
			{ success: false, error: 'File size exceeds 20MB limit' },
			{ status: 413 }
		);
	}

	try {
		const data = await request.json();
		const { filename, b64 } = data;
		if (!filename || !b64) {
			return Response.json(
				{ success: false, error: 'filename and b64 data required' },
				{ status: 400 }
			);
		}

		// sanitize filename (allow only alphanum, dot, underscore, hyphen)
		const safeName = filename
			.split(/[\\/]/)
			.pop()
			.replace(/[^a-zA-Z0-9._-]/g, '_');

		const timestamp = Date.now();

		// decode base64 (strip data: prefix if present)
		const cleaned = b64.replace(/^data:.*;base64,/, '');

		// C2: cap the decoded size from the string length before the decode
		// allocates the buffer (incl. chunked bodies without Content-Length).
		if (estimateBase64DecodedBytes(cleaned) > MAX_FILE_SIZE) {
			return Response.json(
				{ success: false, error: 'File size exceeds 20MB limit' },
				{ status: 413 }
			);
		}

		const buf = Buffer.from(cleaned, 'base64');

		const base = safeName.replace(/\.[^.]+$/, '');
		const finalName = `${timestamp}_${base}.png`;
		const thumbName = `${timestamp}_${base}-thumb.png`;
		const fileKey = `uploads/${finalName}`;
		const thumbKey = `uploads/${thumbName}`;

		// SEC-02: never persist raw upload bytes. Every upload is rasterized to
		// a fresh PNG, so no scriptable content (SVG, HTML, JS, polyglots) is
		// ever stored. Anything that is not a decodable raster image is
		// rejected (400).
		let pngBuffer;
		try {
			pngBuffer = await rasterizeToPng(new Uint8Array(buf), MAX_UPLOAD_EDGE);
		} catch {
			return Response.json(
				{
					success: false,
					error:
						'Uploaded data is not a supported image (unrecognized format, corrupt data, or image too large)',
				},
				{ status: 400 }
			);
		}

		if (pngBuffer.length > KV_MAX_VALUE_BYTES) {
			return Response.json(
				{ success: false, error: 'File size exceeds 20MB limit' },
				{ status: 413 }
			);
		}

		await storeFile(fileKey, pngBuffer);

		// Create a thumbnail. A failure here is not fatal — the main upload is
		// already stored and clients render it without a thumbnail.
		try {
			const thumbPng = await rasterizeToPng(pngBuffer, MAX_THUMB_EDGE);
			await storeFile(thumbKey, thumbPng);
		} catch {}

		const baseForUrl = finalName.replace(/\.[^.]+$/, '');
		const fileUrl = `/uploads/${finalName}`;
		const thumbUrl = `/uploads/${baseForUrl}-thumb.png`;
		return Response.json({
			success: true,
			data: { fileUrl, filename: finalName, thumbUrl },
		});
	} catch (error) {
		console.error('Upload error:', error);
		return Response.json(
			{ success: false, error: 'Failed to upload' },
			{ status: 500 }
		);
	}
}

/** Whether a stored upload exists, used by the /uploads read route. */
export async function hasUpload(name) {
	return (
		/^[a-zA-Z0-9._-]+$/.test(name) && (await fileExists(`uploads/${name}`))
	);
}

/** Read a stored upload by name, or null when it is absent. */
export async function readUpload(name) {
	if (!/^[a-zA-Z0-9._-]+$/.test(name)) return null;
	const key = `uploads/${name}`;
	if (!(await fileExists(key))) return null;
	return readFileBytes(key);
}
