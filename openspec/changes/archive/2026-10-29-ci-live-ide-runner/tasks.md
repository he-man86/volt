- [ ] 1.1 Owner: a Windows machine with the matrix's IDE variants, auto-logon, the GitHub runner in the user session.
- [ ] 1.2 The workflow (schedule, workflow_dispatch, push to dev; no pull_request), attaching release-matrix.json.
- [ ] 1.3 Repository setting: approval required for outside-contributor workflows; document it in scripts/README.md.
- [ ] 1.4 A run leaves no IDE process and no fixture copy behind (ide.ps1 down per cell; a cleanup step on failure).

## Close-out (2026-10-29, owner: "close these for now") — closed unfinished

Nothing built. Parked on the owner's own steps (a runner machine with the IDE variants; TwinCAT 4026 / 32-bit SP installs
behind a myBeckhoff login and VM cells). Reopen as a new change when those exist; this file is the plan to start from.
