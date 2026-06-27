# volt-git — graduation tracker (replace volt-cli everywhere)

Goal: make volt-git a **drop-in replacement** for volt-cli's CLI contract, repoint every consumer, then
delete volt-cli. Drop-in = same verbs + flags + `--json` shapes, so `volt-control` / `VoltPanel` /
`volt-vscode` are **untouched** (they just spawn the same surface). volt-cli stays as the fallback
until you've tested; **deletion is the last commit.**

## Phase A — volt-git CLI parity (drop-in surface)
- [x] A1 `--json` for `pull` / `push` — `JSON.stringify(result)`, exit 0 ok / 2 otherwise (verified live)
- [x] A2 `build` command — `bridge.build({buildType})` + diagnostics (verified live; also accepts the bridge's `column` field)
- [x] A3 `status --json` — emits volt-control's **lean** `StatusJson` (initialized, merging, incoming,
      outgoing, pathByName, projectMismatch, summary), not volt-cli's ignored superset. Verified live.
- [x] A4 `log --json` — **JSON array** of `{sha,date,summary,paths}` + `--limit`. NB: fixes a latent bug —
      volt-cli emits NDJSON `{subject,…}` which volt-control's array parser silently drops (empty history).
- [ ] A5 `show <ref> <path>` — HEAD / arbitrary ref via `git show ref:path`; MERGE_BASE/OURS/THEIRS via
      merge-base / HEAD / MERGE_HEAD; BRIDGE via live `fetchChanges`
- [ ] A6 `init` scaffold + corpus — `writeWorkspaceScaffold` equivalent (.vscode/package.json/tsconfig/
      bunfig/README/tests) + `installCorpus` from `@opencode-ai/volt-lsp` + vendor detect
- [ ] A7 `push --force-with-lease=<version>` (atomic force)
- [ ] A8 `merge` shim — map `--continue`/`--abort` to native `git merge` (keep the verb so gates/docs work)
- [ ] A9 typecheck + tests green

## Phase B — rewire consumers (point at volt-git; volt-cli still present)
- [ ] B1 `.opencode/tool/volt.ts:18` VOLT_BIN → `packages/volt-git/dist/bin.js`
- [ ] B2 `.opencode/agent/volt.md` — note conflicts use `git merge --continue/--abort` (merge shim covers the verb)
- [ ] B3 `packages/desktop/package.json` dep + `electron.vite.config.ts:43` input + `src/main/index.ts:278` (keep `volt-cli.js` output name → no path change)
- [ ] B4 `packages/volt-vscode/package.json` build → bundle `../volt-git/src/bin.ts`
- [ ] B5 `volt-scripts/volt.cmd:12`, `verify-volt-tool.ts:21`, `check-volt-integration.ts:74` → volt-git path
- [ ] B6 `bun run build` volt-git → dist; verify-volt-tool + check-volt-integration + verify-lsp green

## Phase C — YOU test the fully-integrated product (desktop + agent + terminal)
- [ ] C1 sign-off

## Phase D — delete volt-cli (final, irreversible-without-revert)
- [ ] D1 remove `packages/volt-cli`; drop any lingering refs; divergence + sync.ts green

## Notes
- Rewire keeps the bundled output name `volt-cli.js` so desktop line 278 + vscode `dist/cli.js` don't change.
- Staged: A+B make your surfaces git-native (volt-cli still the fallback). C = your test. D = deletion.
