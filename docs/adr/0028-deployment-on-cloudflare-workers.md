# Accent CRM runs on Cloudflare Workers through the OpenNext adapter

The fork was built for Vercel: a Next.js 16 App Router front end that talks to a self-hosted MySQL server over `mysql2`, rasterizes uploads with `sharp`, hashes passwords with `bcrypt`, and renders PDFs with `puppeteer` + `@sparticuz/chromium`. Hosting the same tree on Cloudflare Workers required four code changes, because the Workers runtime is not Node.

The decision: **port the app to Workers rather than move it to Cloudflare Containers.** Containers would keep every dependency untouched, but they put the app behind a Durable Object cold-start and a per-instance container, and the user asked for Workers. Containers remain the fallback if any of the four ports below proves unacceptable.

## The four ports

| Concern             | Was                                                                | Is                                                                                   | Why                                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MySQL               | `mysql2` pool in `src/utils/database.js` + `src/utils/proxy-db.ts` | same driver, per-request connection from the **Hyperdrive** binding                  | Hyperdrive owns the pool upstream, so a Worker-side pool would leak one connection per isolate. Needs `mysql2 >= 3.13` and `disableEval: true` (mysql2 builds its SQL parser with `eval()`, which workerd forbids). |
| Image rasterization | `sharp` (native)                                                   | `@cf-wasm/photon` in `src/lib/image-rasterize.ts`                                    | No native binaries on Workers. Photon is Cloudflare's own WASM port.                                                                                                                                                |
| Password hashing    | `bcrypt` (native)                                                  | PBKDF2-SHA256 via `crypto.subtle`                                                    | WebCrypto is native to workerd. Legacy bcrypt hashes still verify through `bcryptjs` and are upgraded on the next login (`shouldUpgradeHash`).                                                                      |
| PDF rendering       | `puppeteer` + `@sparticuz/chromium`                                | `@cloudflare/puppeteer` against the **BROWSER** binding, in `src/lib/pdf-browser.ts` | Cloudflare maintains a Puppeteer fork for its browser endpoint. The Puppeteer API the routes already use is unchanged.                                                                                              |

## What did not change

Every route handler, status code, RBAC guard, response shape and SQL statement is byte-identical. `src/utils/database.js` keeps the same `query()` / `withDb()` / `withTransaction()` contract; only the connection factory branches on the runtime. Plain Node (`npm run dev`, `npm test`, `npm run migrate`) keeps the original pool path, so the local workflow and the 927-test suite are unaffected.

## Consequences the reader must know

1. **The database must be reachable through Hyperdrive.** Create the config with
   `npx wrangler hyperdrive create accent-mysql --connection-string="mysql://USER:PASS@HOST:PORT/DB"`,
   then add `{ "binding": "HYPERDRIVE", "id": "<id>" }` to `wrangler.jsonc`. The
   code is already written; only the binding id is missing.
2. **Uploaded image formats are narrower.** Photon decodes PNG, JPEG, WebP and
   GIF. SVG, HEIC/HEIF, AVIF, BMP and TIFF decode no more and are rejected with
   the existing 400 "not a supported image" — the safe direction, because an
   upload that cannot be rasterized is never stored. The two file pickers that
   advertised them (`src/components/employees/EmployeeFields.tsx`,
   `src/app/projects/[id]/edit/tabs/DocumentationTab.jsx`) still need their
   `accept` attributes trimmed to the supported set.
3. **The decompression-bomb guard moved after decode.** `sharp` could reject a
   bomb with `limitInputPixels` _before_ allocating; a WASM decoder cannot. The
   decoded dimensions are checked in `rasterizeToPng` and the image is freed
   immediately. Worst case the isolate's memory runs out, the request fails, and
   Cloudflare recycles the isolate — the bytes are never written.
4. **`worker-configuration.d.ts` is deliberately not committed.** Running
   `npx wrangler types` regenerates it, and the generated file re-declares
   workerd's DOM-like types. With `lib: ["dom"]` in `tsconfig.json` that produces
   31 `void is not assignable to Element` errors in files that have nothing to do
   with Workers. The bindings are typed structurally in
   `src/utils/cloudflare-runtime.js` instead, so `tsc --noEmit` stays at zero.
5. **Uploaded files live in KV, not on disk.** Workers has no writable
   filesystem, so `src/lib/file-store.ts` writes to the `UPLOADS` KV namespace
   and `src/app/uploads/[...path]/route.ts` serves them back (a route does not
   inherit Next's static `headers()`, so the SEC-02 `nosniff` +
   `Content-Disposition: attachment` pair is set on the response itself).
6. **`public/` assets are read through the ASSETS binding** by
   `src/lib/asset-reader.ts`. `process.cwd()` points into the Workers virtual
   filesystem, which only exposes the Worker bundle's own modules.
7. **`puppeteer`, `@sparticuz/chromium`, `sharp` and `bcrypt` are gone from
   `package.json`.** They were native modules that cannot bundle into a Worker.
   `sharp` still appears transitively under miniflare (wrangler's local dev) and
   is not part of the deployed bundle.

## One runtime bug the smoke test caught

Importing `@cf-wasm/photon` at module scope compiles its WebAssembly module
during **isolate startup**, which workerd rejects:
`CompileError: WebAssembly.Module(): Wasm code generation disallowed by embedder`.
Every `/uploads/*` request returned 500. The fix is in
`src/lib/image-rasterize.ts`: the package is loaded on first use, so the compile
happens inside a request where it is allowed. This is the one place the project
uses a runtime `import()` — the exception being a module whose WASM must not be
compiled at module-evaluation time.

Local proof after the fix (`npx wrangler dev`): `/api/health` →
`200 {"status":"ok"}`, `/uploads/<absent>.png` → `404 text/plain` from the
route, `/accent-logo.png` → `200 image/png` through the ASSETS binding,
`/api/uploads` → `401`. Deployed verification still needs a
`CLOUDFLARE_API_TOKEN`.

## Build and deploy

```
npm run build:workers      # patch + OpenNext build → .open-next/
npm run deploy:workers     # build + wrangler deploy
```

`scripts/patch-opennext-windows.mjs` makes `@opennextjs/aws`'s
`copyTracedFiles.js` create **junctions** instead of untyped symlinks. On
Windows an unelevated account holds no `SeCreateSymbolicLinkPrivilege`, so the
unpatched build dies with `EPERM: operation not permitted, symlink`. Junctions
need no privilege. The script is idempotent, only touches that one file in
`node_modules`, and is a no-op on macOS and Linux.

Deploy needs a `CLOUDFLARE_API_TOKEN` with Workers edit rights; the MCP OAuth
session used during this port is not a wrangler credential.

Considered: (a) Cloudflare Containers — keeps every dependency, but the user
asked for Workers; (b) `vinext`, the newer Vite-based adapter — rejected for
this tree: it reimplements the Next API surface, and 240 route handlers plus a
proxy that runs on the Node runtime are exactly the surface that would move;
(c) static export — impossible, every page is authenticated and DB-backed;
(d) D1 — rejected, it would mean rewriting 30 migrations and every query, and
loses the existing MySQL schema.
