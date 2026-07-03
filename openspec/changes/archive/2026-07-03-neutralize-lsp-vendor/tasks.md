## 1. Decide the name — DONE

- [x] 1.1 Picked `volt-lsp-iec` (implements IEC 61131-3, the standard both vendors share).

## 2. Rename `volt-lsp-codesys` → `volt-lsp-iec` — DONE

- [x] 2.1 Renamed the package folder `packages/volt-lsp-codesys/` → `packages/volt-lsp-iec/`.
- [x] 2.2 `package.json`: `name` + the `bin` key (`volt-lsp-iec`) + self-references; diagnostic `source`,
  `serverInfo`, and the CLI banner all now read `volt-lsp-iec` (conformance `.snap` files updated to match).
- [x] 2.3 `.opencode/opencode.json`: LSP registration key + `command` path now `volt-lsp-iec`.
- [x] 2.4 Cross-package deps: `packages/volt-git/package.json` dep; the Volt string in the desktop/opencode
  seams (`packages/desktop/src/main/index.ts`, `packages/opencode/src/cli/cmd/tui.ts`) — Volt reference only.
- [x] 2.5 Docs: `CLAUDE.md` (package map + `bun` commands), the package `README.md`, `.opencode/agent/volt.md`,
  plus `volt-scripts/{dev,dist,harvest-lsp-corpus,verify-lsp}.ts` + `tsconfig.json`.
- [x] 2.6 `volt-scripts/check-divergence.ts` + `check-volt-integration.ts`: updated hardcoded name; both
  re-run green. `openspec/changes/archive/**` left untouched (historical).
- [x] 2.7 Full verify: `bun typecheck` (6/6), LSP `bun test` (5268 pass), divergence + integration green.

## 3. Audit + collapse the vendor divergence — TODO

- [x] 3.1 Enumerated: the **13 `codesys`** tags are all `__`-operators in `operators.ts` (`__QUERYINTERFACE`,
  `__QUERYPOINTER`, `__TRY`/`__CATCH`/`__FINALLY`/`__ENDTRY`, `__VARINFO`, `__POSITION`, `__POUNAME`,
  `__CURRENTTASK`, `__COMPARE_AND_SWAP`, `__XADD`, `__POOL`) → audited in 3.2–3.4. The **1 `twincat`** tag is
  the `Tc`-pragma factory in `pragmas.ts` (all 20 `Tc*` attributes) → audited in 3.5. The two vendor-gated
  checks — `check-vendor-only-operator` (the operator list) and `check-pragmas` (wrong-vendor set) — both audited.
- [x] 3.2 **Operators DONE** — probed InfoSys (lists them) vs the live TwinCAT conformance recording
  (`recordings/expected-tc.json`, real TC builds). The recording wins: TC rejects the CODESYS usage of
  `__QUERYINTERFACE`/`__TRY`/`__VARINFO`/… (`buildSuccess:false`), so the tags are evidence-based. A
  docs-only retag was attempted and REVERTED (broke the conformance suite). See design.md "Findings".
- [x] 3.3 Operators: no retag — the diff is real and recording-verified (not over-modeled).
- [x] 3.4 **Message precision DONE (operators)** — added `equivalentIn.twincat.differentSignature` and split
  the `vendor-only-operator` message: the 9 TC-documented ops (`__QUERYINTERFACE`/`__QUERYPOINTER`/the __TRY
  block/`__VARINFO`/`__POSITION`/`__POUNAME`) now say *"exists in TwinCAT but with a different signature — the
  CODESYS form here won't compile"*; the 4 genuinely-absent ones (`__CURRENTTASK`/`__COMPARE_AND_SWAP`/
  `__XADD`/`__POOL`) keep *"CODESYS-only and not supported"*. Conformance snapshots updated. Also fixed the
  `__NEW`/`__DELETE` hover notes: they're SHARED (TC compiles them — `op_sys_new_delete` recording + InfoSys:
  TC allocates from router memory), so dropped the wrong "TC doesn't support / no runtime" notes and made the
  gotchas apply to both vendors (enable_dynamic_creation + router-memory/0-on-failure).
- [x] 3.5 **Pragmas DONE** — 20 TwinCAT-only pragmas, all `Tc`-prefixed Beckhoff attributes (correctly
  tagged, each with a CODESYS-equivalent note); 0 CODESYS-only (right — TC3 is CODESYS-derived, accepts the
  CODESYS attribute set; `call_after_init`/`hide`/`pack_mode`/`monitoring` verified TC-supported via InfoSys).
  No over-modeling, no retag. See design.md "Findings → Pragmas".
- [x] 3.6 **DONE** — captured pragma-acceptance recordings via the live Beckhoff bridge. Added the
  `pragma-tc` fixture category (`fixtures/pragma-tc.ts`, all 20 `Tc*` attributes) + a targeted isolated
  recorder (`volt-scripts/record-tc-pragmas.ts`, since the batch `record:language` was removed with
  volt-agent). Real TwinCAT (TcXaeShell 15.0) accepts all 20 (`buildSuccess: true` = `expectTcAccepts`),
  and the replay cross-check confirms the LSP raises no false `wrong-vendor` flag on them (20 snapshots
  added; `language.test.ts` 1392 pass). The `Tc*` pragma tags are now recording-verified like the operators.
  (Inverse direction — CODESYS *compiler* reaction to a `Tc*` attribute — left for when the 8556 bridge is
  up; the LSP `wrong-vendor-pragma` warning itself is already unit-covered and vendor-tag driven.)
