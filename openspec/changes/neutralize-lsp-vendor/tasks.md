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
- [ ] 3.2 For each, establish ground truth (TwinCAT/Beckhoff InfoSys + CODESYS Help; a live TwinCAT
  conformance recording via `http-recorder` where doc behavior is ambiguous). Record the source per item.
- [ ] 3.3 Retag anything both vendors accept as `shared` (add a per-vendor `name` alias if the spelling
  differs); keep only genuinely dialect-specific items vendor-tagged.
- [ ] 3.4 Re-verify the `__`-operator rejection list against a TwinCAT build — drop any that are actually
  TC-supported (as `__ISVALIDREF` already was).
- [ ] 3.5 Confirm no `wrong-vendor` / vendor-only-operator false-positives remain on shared IEC code; expect
  the tagged set to shrink. Update the `language-server` spec's vendor-divergence requirement.
