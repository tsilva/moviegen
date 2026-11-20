# Moviegen development and local production

Set `MOVIEGEN_PROJECT_PATH` to an absolute project path outside the repository
to open an existing project when the server starts.

## Commands

```bash
pnpm dev --port auto
pnpm build           # build the production app
pnpm production:check # require clean, current main with successful exact-commit CI
pnpm build:production # exact-commit CI gate, then build using configured environment
pnpm start --port auto # run the built app locally
pnpm start:production # CI gate, then run the matching approved Production build
pnpm lint            # run ESLint
pnpm test            # run Vitest tests
pnpm check:no-media  # check git history for committed media files
```

## Notes

Dependency security pins `minimatch` 11.0.1 and its nonrecursive matcher 1.0.1. Small pnpm patches retain legacy CommonJS/ESM matcher imports and migrate the import lint rule to `Minimatch.match`; the removed regex engine is not restored. The seven-day package hold and existing exception are retained; the new exceptions cover only these exact user-approved versions.

- Production remains local, with persistent project folders and ffmpeg. GitHub CI gates secret scanning, dependency audit, tests, lint, type checking and a credential-free build. Zod 4.6.7 addresses the collection-validation advisory while preserving the seven-day package-age rule. The explicit Production commands check the exact current GitHub `main` commit and successful CI; starting Production also requires the matching approved build artifact. Push reviewed changes and wait for CI, then run the commands above locally. Direct Vercel Git builds are disabled; no Vercel Production workflow or deployment token is installed.
- Local Production checks require Git, Python 3 and access to GitHub's public API. Configure Atlas credentials separately in the server environment.

- Use `pnpm`; this repo includes `pnpm-lock.yaml` and `pnpm-workspace.yaml`.
- `ATLAS_BASE_URL`, model IDs, Seedance defaults, `FFMPEG_PATH`, and `FFPROBE_PATH` can be overridden with environment variables.
- `NEXT_PUBLIC_GA_MEASUREMENT_ID` enables GA4 page-view tracking when configured.
- Project paths must be absolute and outside the app workspace.
- Project folders contain `manifest.json`, `frames/`, `transitions/`, `deleted/`, and final renders under `final/`.
- Final video rendering uses `ffmpeg`; media probing uses `ffprobe`.
- Generated media should not be committed. `architecture.png` is the only tracked PNG allowed by the media guard.

## Architecture

![moviegen architecture diagram](../architecture.png)
