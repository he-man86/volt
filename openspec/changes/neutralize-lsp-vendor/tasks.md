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
- [ ] 3.4 Message precision (worth doing): for operators TC has with a *different signature*
  (`__QUERYINTERFACE`, `__QUERYPOINTER`), change the `wrong-vendor` text from "not supported by TwinCAT" to
  "different signature in TwinCAT". Fix the over-strong `__NEW`/`__DELETE` hover notes (TC parses them; the
  caveat is dynamic-memory runtime backing, not "unsupported").
- [ ] 3.5 Audit the PRAGMA side (1 `twincat`-tagged entry + any `wrong-vendor` pragma cases) — the remaining
  unaudited surface — same recording-first method. Then update the `language-server` spec.
