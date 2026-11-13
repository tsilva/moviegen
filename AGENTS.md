<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Runtime and release boundaries

Normal development and builds use the configured process environment. Keep Atlas
credentials server-only and never log them or commit plaintext exports. Preserve
project folders and media; do not perform paid generation or rendering as a test.

Production is a persistent local runtime with ffmpeg. `pnpm build:production`
and `pnpm start:production` retain the clean-current-main and exact-commit CI
gates; the approved build marker must match before starting. Credentials are
configured separately from these release checks. Keep Vercel Git builds disabled.

The optional balance check is read-only and returns success/failure only. It does
not enable generation, media transfer, production access or permission changes.
A failed route must not trigger raw-key fallback or broader service permissions.
