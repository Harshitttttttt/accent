import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted so the mock factories below can reference them (vitest requires
// mock*-prefixed names inside vi.mock factories).
const mocks = vi.hoisted(() => ({
	ensurePermission: vi
		.fn()
		.mockResolvedValue({ authorized: true, user: { id: 1 } }),
	storeFile: vi.fn().mockResolvedValue(undefined),
	fileExists: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: mocks.ensurePermission,
	RESOURCES: { PROJECTS: 'projects' },
	PERMISSIONS: { UPDATE: 'update' },
}));

// Storage is the only thing faked: the rasterizer below is the real one, so the
// assertions are about the bytes the route actually persists.
vi.mock('@/lib/file-store', () => ({
	KV_MAX_VALUE_BYTES: 25 * 1024 * 1024,
	storeFile: (...args) => mocks.storeFile(...args),
	readFileBytes: vi.fn(),
	deleteFileBytes: vi.fn(),
	fileExists: (...args) => mocks.fileExists(...args),
}));

// Route handler must load after vi.mock registration (repo test convention —
// module-loading boundary, not a runtime-selected specifier).
const { POST } = await import('@/app/api/uploads/route');

/** A real 64×48 PNG produced by sharp. */
const RASTER_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAdElEQVR4nO3PAQ0AMBDCQORMDrIrazIIeZIKuIrn6hQXsAFXp7iADbg6xQVswNUpLmADrk5xARtwdYoL2ICrU1zABlyd4gI24OoUF7ABV6e4gA24OsUFbMDVKS5gA65OcQEbcHWKC9iAq1NcwAZcneICjg98rIMA4rYeOLEAAAAASUVORK5CYII=',
	'base64'
);

const EVIL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" onload="fetch('/api/users/reset-password',{method:'POST'})"><script>alert(1)</script></svg>`;
const HTML_PAGE = '<html><body><h1>not an image</h1></body></html>';

function upload(filename: string, bytes: Buffer, declaredLength?: number) {
	return {
		url: 'http://localhost/api/uploads',
		method: 'POST',
		headers: new Headers({
			'Content-Type': 'application/json',
			...(declaredLength === undefined
				? {}
				: { 'Content-Length': String(declaredLength) }),
		}),
		json: () =>
			Promise.resolve({ filename, b64: bytes.toString('base64') }),
	};
}

/** The stored bytes for the key containing `fragment`. */
function storedBytes(fragment: string): Uint8Array | undefined {
	const call = mocks.storeFile.mock.calls.find(
		(candidate) => typeof candidate[0] === 'string' && candidate[0].includes(fragment)
	);
	const bytes = call?.[1];
	return bytes instanceof Uint8Array ? bytes : undefined;
}

describe('POST /api/uploads — SEC-02: uploads are rasterized, never persisted verbatim', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.ensurePermission.mockResolvedValue({
			authorized: true,
			user: { id: 1 },
		});
	});

	it('rejects callers without projects:update and stores nothing', async () => {
		mocks.ensurePermission.mockResolvedValueOnce({
			authorized: false,
			response: new Response('denied', { status: 403 }),
		});
		const res = await POST(upload('evil.svg', Buffer.from(EVIL_SVG)));
		expect(res.status).toBe(403);
		expect(mocks.storeFile).not.toHaveBeenCalled();
	});

	it('stores a PNG for a raster upload and never the raw bytes', async () => {
		const res = await POST(upload('photo.jpg', RASTER_PNG));
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.data.fileUrl).toMatch(/^\/uploads\/\d+_photo\.png$/);
		expect(body.data.thumbUrl).toMatch(/^\/uploads\/\d+_photo-thumb\.png$/);

		// Main image plus thumbnail, both PNG.
		expect(mocks.storeFile).toHaveBeenCalledTimes(2);
		for (const call of mocks.storeFile.mock.calls) {
			expect(String(call[0]).endsWith('.png')).toBe(true);
		}

		// The stored payload is decoded raster, not the uploaded bytes.
		const bytes = storedBytes('_photo.png');
		expect(bytes).toBeDefined();
		expect(Array.from(bytes!.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
	});

	it('rejects script-bearing SVG with 400 and writes nothing', async () => {
		const res = await POST(upload('evil.svg', Buffer.from(EVIL_SVG)));
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(mocks.storeFile).not.toHaveBeenCalled();
	});

	it('rejects HTML dressed up as an image with 400 and writes nothing', async () => {
		const res = await POST(upload('page.png', Buffer.from(HTML_PAGE)));
		expect(res.status).toBe(400);
		expect(mocks.storeFile).not.toHaveBeenCalled();
	});

	it('rejects a declared body above the envelope cap with 413', async () => {
		const res = await POST(upload('huge.png', RASTER_PNG, 30 * 1024 * 1024));
		expect(res.status).toBe(413);
		expect(mocks.storeFile).not.toHaveBeenCalled();
	});

	it('rejects a base64 payload that decodes above the size limit with 413', async () => {
		const oversized = Buffer.alloc(20 * 1024 * 1024 + 1024);
		const res = await POST(upload('huge.png', oversized));
		expect(res.status).toBe(413);
		expect(mocks.storeFile).not.toHaveBeenCalled();
	});
});
