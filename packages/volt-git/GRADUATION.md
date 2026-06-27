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
- [x] A5 `show <ref> <path>` — HEAD/any ref via `git show`; MERGE_OURS/THEIRS/BASE via HEAD/MERGE_HEAD/merge-base; BRIDGE via live `fetchChanges`. Verified live.
- [x] A6 `init` scaffold (6 files; git-native README, .volt excludes) + `installCorpus` from
      `@opencode-ai/volt-lsp` (st-reference skill) + vendor-from-platform. Verified live: scaffolded 6 + 32 ref files.
- [x] A7 `push --force-with-lease=<version>` (atomic force; stale-lease refusal)
- [x] A8 `merge` shim — `--continue`/`--abort`/`--resolve <p> --use-ours|--use-theirs` over native git (verb kept for gates/docs)
- [x] A9 typecheck + 9 tests green ✅ **Phase A complete — volt-git is a drop-in for volt-cli's CLI contract**

## Phase B — rewire consumers (point at volt-git; volt-cli still present) ✅
- [x] B1 `.opencode/tool/volt.ts` VOLT_BIN → volt-git + git-native verb docs (verify-volt-tool ✓)
- [x] B2 `.opencode/agent/volt.md` — six verbs incl. merge, commit-before-pull note, snapshot→workspace
- [x] B3 desktop seams: package.json dep + electron.vite input → volt-git (output name kept `volt-cli.js`)
- [x] B4 `volt-vscode/package.json` build → `../volt-git/src/bin.ts`
- [x] B5 `volt-scripts/volt`+`volt.cmd`, `verify-volt-tool.ts`, `check-volt-integration.ts` → volt-git
- [x] B6 status `--porcelain` + `help` added; build → dist; **sync.ts all green** (install/divergence/integration/lsp/tool)

## Phase C — YOU test the fully-integrated product (desktop + agent + terminal)
- [ ] C1 sign-off

## Phase D — delete volt-cli (final, irreversible-without-revert)
- [ ] D1 remove `packages/volt-cli`; drop any lingering refs; divergence + sync.ts green

## Notes
- Rewire keeps the bundled output name `volt-cli.js` so desktop line 278 + vscode `dist/cli.js` don't change.
- Staged: A+B make your surfaces git-native (volt-cli still the fallback). C = your test. D = deletion.
