## 1. Decide the name — TODO

- [ ] 1.1 Pick the vendor-neutral package name (recommend `volt-lsp-iec`; alt `volt-lsp-st`). One decision,
  then the rest of §2 is mechanical.

## 2. Rename `volt-lsp-codesys` → the neutral name — TODO

- [ ] 2.1 Rename the package folder `packages/volt-lsp-codesys/` → `packages/volt-lsp-<new>/`.
- [ ] 2.2 `package.json`: `name` + the `bin` key (`volt-lsp-<new>`) + any self-references.
- [ ] 2.3 `.opencode/opencode.json`: the LSP `command` / repo-root-relative path registration.
- [ ] 2.4 Cross-package deps: `packages/volt-git/package.json`; the Volt string in the desktop/opencode
  seams (`packages/desktop/src/main/index.ts`, `packages/opencode/src/cli/cmd/tui.ts`) — edit only the
  Volt reference, these files are counted upstream seams.
- [ ] 2.5 Docs: `CLAUDE.md` (package map + `bun` commands), the package `README.md`, `.opencode/agent/volt.md`.
- [ ] 2.6 `volt-scripts/check-divergence.ts` + `check-volt-integration.ts`: update any hardcoded package
  name; re-run both (they must stay green). Leave `openspec/changes/archive/**` untouched (historical).
- [ ] 2.7 Full verify: `bun typecheck`, LSP `bun test`, `bun run dev` / the LSP launch, and the pre-push
  hook (divergence + integration).

## 3. Audit + collapse the vendor divergence — TODO

- [ ] 3.1 Enumerate every vendor-tagged reference entry (the 13 `codesys` + 1 `twincat` in `src/reference/*`)
  and the two vendor-gated checks (`check-pragmas` wrong-vendor set, `check-vendor-only-operator` list).
- [x] 3.2 **Operators DONE** — probed InfoSys (lists them) vs the live TwinCAT conformance recording
  (`recordings/expected-tc.json`, real TC builds). The recording wins: TC rejects the CODESYS usage of
  `__QUERYINTERFACE`/`__TRY`/`__VARINFO`/… (`buildSuccess:false`), so the tags are evidence-based. A
  docs-only retag was attempted and REVERTED (broke the conformance suite). See design.md "Findings".
- [x] 3.3 Operators: no retag — the diff is real and recording-verified (not over-modeled).
- [x] 3.4 **Message precision DONE (operators)** — added `equivalentIn.twincat.differentSignature` and split
  the `vendor-only-operator` message: the 9 TC-documented ops (`__QUERYINTERFACE`/`__QUERYPOINTER`/the __TRY
  block/`__VARINFO`/`__POSITION`/`__POUNAME`) now say *"exists in TwinCAT but with a different signature — the
  CODESYS form here won't compile"*; the 4 genuinely-absent ones (`__CURRENTTASK`/`__COMPARE_AND_SWAP`/
  `__XADD`/`__POOL`) keep *"CODESYS-only and not supported"*. Conformance snapshots updated. Still TODO:
  soften the `__NEW`/`__DELETE` hover notes (TC compiles them per the `op_sys_new_delete` recording; the real
  caveat is dynamic-memory config, not "TC doesn't support").
- [x] 3.5 **Pragmas DONE** — 20 TwinCAT-only pragmas, all `Tc`-prefixed Beckhoff attributes (correctly
  tagged, each with a CODESYS-equivalent note); 0 CODESYS-only (right — TC3 is CODESYS-derived, accepts the
  CODESYS attribute set; `call_after_init`/`hide`/`pack_mode`/`monitoring` verified TC-supported via InfoSys).
  No over-modeling, no retag. See design.md "Findings → Pragmas".
- [ ] 3.6 (opt) Capture pragma-acceptance conformance recordings via the Beckhoff bridge to make the pragma
  tags recording-verified like the operators (currently doc+structure verified only). Then update the
  `language-server` spec.
