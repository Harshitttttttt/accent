import { readUpload } from '@/app/api/uploads/route';

/**
 * Serve rasterized uploads that were written at runtime.
 *
 * `public/uploads/*` still comes from the static ASSETS bundle; anything
 * uploaded since deploy lives in the store and is served here. The response
 * mirrors the `/uploads/:path*` headers in next.config.ts, because responses
 * produced by a route do not inherit Next's static `headers()` config.
 *
 * SEC-02: the bytes are always a server-rasterized PNG, so it is safe to
 * forbid sniffing and force download on direct navigation.
 */
export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ path: string[] }> }
) {
	const { path } = await params;
	const name = path?.[path.length - 1];
	if (!name) {
		return new Response('Not found', { status: 404 });
	}

	const bytes = await readUpload(name);
	if (!bytes) {
		return new Response('Not found', { status: 404 });
	}

	return new Response(bytes, {
		status: 200,
		headers: {
			'Content-Type': 'image/png',
			'Cache-Control': 'private, max-age=31536000, immutable',
			'X-Content-Type-Options': 'nosniff',
			'Content-Disposition': 'attachment',
		},
	});
}
