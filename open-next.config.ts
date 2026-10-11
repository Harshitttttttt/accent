import type { OpenNextConfig } from '@opennextjs/cloudflare';

const config: OpenNextConfig = {
	default: {
		override: {
			wrapper: 'cloudflare-node',
			converter: 'edge',
			proxyExternalRequest: 'fetch',
			// Static / incremental caching is unused by this app: every page is
			// authenticated and DB-backed, so the default ISR/KV cache paths are
			// dead weight on Workers.
			incrementalCache: 'dummy',
			tagCache: 'dummy',
			queue: 'dummy',
		},
	},
	// Next 16 runs proxy.ts on the Node.js runtime, so it must be kept external
	// rather than converted to the edge bundle (ADR-0011: separate MySQL pool).
	// workerd provides node:crypto natively; keeping it external avoids a
	// duplicated polyfill in the edge bundle.
	edgeExternals: ['node:crypto'],
	middleware: {
		external: true,
		override: {
			wrapper: 'cloudflare-edge',
			converter: 'edge',
			proxyExternalRequest: 'fetch',
			incrementalCache: 'dummy',
			tagCache: 'dummy',
			queue: 'dummy',
		},
	},
};

export default config;
