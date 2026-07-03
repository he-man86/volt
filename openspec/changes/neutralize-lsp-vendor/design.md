# Design — neutralize the LSP's vendor coupling

## Context: what's actually vendor-specific today

The LSP is one binary (`bin: { "volt-lsp-codesys": "./dist/bin.js" }`); vendor is a runtime config, not a
build. The ONLY vendor-gated behavior:

- `src/semantic/checks/check-pragmas.ts` — `wrong-vendor-pragma`: a pragma that resolves in the *other*
  vendor's catalog → warn + suggest the equivalent.
- `src/semantic/checks/check-vendor-only-operator.ts` — flags CODESYS `__`-operators (`__NEW`, `__TRY`,
  `__VECTOR`, `__QUERYINTERFACE`, …) when vendor is TwinCAT (TC rejects them). `__ISVALIDREF` already
  whitelisted as TC-compatible.
- `src/reference/*.ts` entries tagged `shared | codesys | twincat` (81 / 13 / 1); completion, hover, and
  the two checks filter to `shared + activeVendor`.

Everything else — parser, resolver/scoping, symbol table, unresolved-identifier, type resolution, the
`.library`/`.device` reference catalogs — is vendor-neutral IEC. So the divergence to audit is a small,
enumerable surface.

## A. Rename `volt-lsp-codesys` → vendor-neutral

**Name:** `volt-lsp-iec` (implements IEC 61131-3, the shared standard) is the recommendation; `volt-lsp-st`
is the readable alternative. Final call is the user's — pick one before executing.

**Blast radius** (78 `volt-lsp-codesys` hits; the code/config subset, NOT the archived changes):
- `packages/volt-lsp-codesys/` folder → `packages/volt-lsp-<new>/`.
- its `package.json` `name` + `bin` key + any self-refs; `dist/bin.js` path stays.
- `.opencode/opencode.json` — the LSP `command`/path registration (repo-root-relative).
- cross-package deps: `packages/volt-git/package.json`, and the desktop/opencode **seams**
  (`packages/desktop/src/main/index.ts`, `packages/opencode/src/cli/cmd/tui.ts`) — mind that these are
  counted upstream seams; the rename edits the Volt string only.
- docs: `CLAUDE.md` (the package map + commands), the package `README.md`, `.opencode/agent/volt.md`.
- **Leave** `openspec/changes/archive/**` untouched (historical); active changes referencing the old name
  can be updated opportunistically.
- `check-divergence.ts` / `check-volt-integration.ts` may hardcode the package name — update + re-run.

The binary name change is user-visible (the `bin`), so bump/keep the version note in the same commit.

## B. Audit + collapse the vendor divergence

For each vendor-tagged item, establish ground truth and retag if both vendors accept it:

1. **Reference entries** (the 13 `codesys` + 1 `twincat`): for each, check the TwinCAT/Beckhoff InfoSys and
   CODESYS Help. If both support it (possibly under the same or an aliased name) → retag `shared` (add the
   per-vendor `name` alias if the spelling differs). If only one → keep tagged.
2. **`__`-operators** (`check-vendor-only-operator`): re-verify the rejection list against a TwinCAT build —
   some `__`-ops beyond `__ISVALIDREF` may be TC-supported. Any that are → drop from the CODESYS-only list.
3. **Pragmas** (`check-pragmas`): confirm the `wrong-vendor` set — a pragma both accept (or that TC ignores
   silently rather than rejects) should not warn.

**Evidence, not guesses:** prefer a live TwinCAT conformance recording (the `http-recorder`, or a real TC
project through the Beckhoff bridge once it exists) over doc-reading where a behavior is ambiguous. Record
the source for each decision in the retag so it's auditable — matching how `__ISVALIDREF` was resolved
"verified live via conformance recording."

**Success measure:** run the (future) TwinCAT corpus — or re-derive from the CODESYS corpus which entries
would flip — and confirm the `wrong-vendor` / vendor-only-operator diagnostics only fire on genuinely
dialect-specific code. Expect the tagged set to shrink.

## Why one change, not two

The rename and the audit are the same realization from two angles — *this is one IEC engine, not a
CODESYS tool with a TwinCAT bolt-on*. Doing them together keeps the story (and the `vendor`-layer surface
they both touch) coherent. Neither adds capability; both reduce accidental vendor coupling.
