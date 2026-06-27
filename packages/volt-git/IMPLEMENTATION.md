# volt-git — implementation tracker

Git-native single-repo Volt CLI (option ② in `../volt-cli/SYNC-OPTIONS.md`), built from the ground up.
`packages/volt-cli` is **not touched** — zero edits. On branch `feat/git-native-sync`.

## Phase 0 — scaffold
- [x] 0.1 package.json · tsconfig · turbo · README · this tracker

## Phase 1 — lower layers (self-contained copies of the stable contracts)
- [x] 1.1 `src/registry/extensions.ts` — extension table + helpers (verbatim contract)
- [x] 1.2 `src/bridge/{types,client}.ts` — wire schemas + HTTP client (verbatim contract)
- [x] 1.3 `src/config/workspace.ts` — `.volt/config.json` binding + binding check
- [x] 1.4 `src/translate/materialize.ts` — IDE item ⇄ `src/` file
- [x] 1.5 `bun typecheck` green

## Phase 2 — git layer
- [x] 2.1 `src/git/plumbing.ts` — writeBlob/buildTree/listTree/resolveRef/updateRef/commitTree (deterministic)
- [x] 2.2 git wrappers — resolveGitDir, currentBranch, headCommit, isMerging, dirtySrc, unmergedPaths, diffNameStatus, gitMerge, gitInit, readTreeToIndex

## Phase 3 — git-native sync
- [x] 3.1 `src/sync/refs.ts` — `refs/volt/ide` machinery + `.volt/ide-refs.json` sidecar
- [x] 3.2 `src/sync/pull.ts` — fetch → commit volt/ide → git merge (raw commit-before-pull guard; bootstrap)
- [x] 3.3 `src/sync/push.ts` — workspace → bridge (guardrails + drift + `--force`) → ff volt/ide
- [x] 3.4 `src/sync/status.ts` — incoming/outgoing/merging

## Phase 4 — CLI
- [x] 4.1 `src/init.ts` — bind + git init + gitignore + first pull
- [x] 4.2 `src/bin.ts` — arg parse + dispatch (`volt-git init|pull|push|status|log`)

## Phase 5 — tests + verify
- [x] 5.1 mock bridge + `src/tests/sync.test.ts` — 9 scenarios (bootstrap · ff · merge-commit · conflict · guard · push · read-only · drift/force · status)
- [x] 5.2 `bun typecheck` + `bun test` green (9 pass) + CLI e2e smoke against the mock
- [ ] 5.3 **live TC bridge walkthrough** ← your turn (init → pull → edit → commit → push → IDE-edit → pull ff → overlap conflict)

## Phase 6 — graduate (separate go-ahead, after 5.3)
- [ ] 6.1 Point `.opencode/tool/volt.ts` / desktop at volt-git; retire volt-cli; rename bin to `volt`

## Known spike gaps (documented, deliberate)
- **Commit-before-pull is raw** — pull refuses on a dirty `src/`. Auto-stash (the "combine script") is the planned fast-follow.
- **Conflicts** finish via native `git merge --continue` / `--abort` (no `volt merge` wrapper).
- **Conflict → resolve → re-pull**: on conflict the sidecar baseline isn't advanced; resolve in git, then `volt-git pull` again to finalize (may leave one empty merge commit — cosmetic).
- **No scaffold/corpus** generated at init yet (just `.gitignore`/`.gitattributes`); volt-cli still owns rich scaffolding until graduation.
- **Rename/move** use the bridge's `renameItem`/`moveItem` ops (git `-M`): a clean one-axis R100 move
  or rename preserves IDE references. Renamed-AND-edited / renamed-AND-moved is **refused loudly** (no
  silent delete+add that would drop references) — do one change at a time. **No fallbacks.**
- **Graphical** bodies stay pull-only (read-only ST views; can't round-trip back to PlcOpenXML).
