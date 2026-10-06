<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Secrets

Default local dev uses the pinned Infisical `moviegen`, Development `/`, project through the human CLI login. `build:secrets` and `start` use `moviegen-production`, Production `/`, for a persistent self-hosted runtime. Both Atlas aliases are explicitly set from the application allowlist, including empty values when absent, so stale dotenv credentials cannot return. Never print credentials or create plaintext exports. Preserve project folders/media and never run paid generation or rendering merely to test secret delivery. Vercel's filesystem is not a replacement for Moviegen's persistent local project folders and ffmpeg runtime. Run `test:secrets`, normal app tests, lint, typecheck and build before pushing.
