> Owner, 2026-10-20: the live IDE check belongs in CI, on a self-hosted runner, set up later. Not started.

## Why

CI runs on GitHub's hosted runners, which have no CODESYS and no TwinCAT, so the live e2e — the real oracle — runs only
by hand on the dev machine (`bun run release:matrix`), where it collides with the engineer's own IDEs and with
PLC Assist's runs. Test strength stays capped while the live check is manual.

## What Changes

- A dedicated Windows machine (not the dev laptop) with every IDE variant the release matrix covers, auto-logged-in: the
  GitHub runner runs in that user session, never as a service (an IDE needs a desktop; session 0 has none).
- A workflow on the self-hosted runner: nightly on `dev`, on `workflow_dispatch`, and on push to `dev`; NEVER on
  `pull_request` (the repo is public: a fork's code must not reach the machine). Outside-contributor workflows require
  approval. The job runs `bun run release:matrix` and the contract suite, and attaches `release-matrix.json` so
  `promote` uses it.
- The machine holds no secret beyond the job's, and is isolated from the owner's machines.

## Impact

`.github/workflows/` (one new workflow, disabled until the runner exists), `scripts/release-matrix.ts` (already the entry
point), `scripts/README.md`. Prerequisite: the runner-ready safety net of `volt-cli-rework` step 2.
