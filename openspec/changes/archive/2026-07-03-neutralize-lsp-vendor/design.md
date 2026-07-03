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

## Findings (2026-07 — operator probe DONE)

Probed the CODESYS-tagged `__`-operators against **both** sources and they disagreed, which is the whole
lesson:

- **Beckhoff InfoSys "Further operators"** *lists* `__QUERYINTERFACE`, `__QUERYPOINTER`, `__TRY`/`__CATCH`/
  `__FINALLY`/`__ENDTRY`, `__VARINFO`, `__POUNAME`, `__POSITION` — suggesting they're shared.
- **The live TwinCAT conformance recording** (`recordings/expected-tc.json`) shows real TC **fails to
  build** the CODESYS usage of them (`op_sys_queryinterface`: *"Cannot convert 'Unknown type:
  __QUERYINTERFACE(THIS^, ITF)' to BOOL"* — TC's `__QUERYINTERFACE` has a different signature;
  `op_sys_varinfo`: syntax error; `op_sys_try_catch`: codegen error; all `buildSuccess:false`).

**The recording wins** (real compiler behavior > doc listing). So the existing CODESYS operator tags are
**evidence-based, not over-modeled** — a docs-only retag (which was attempted and reverted) breaks the
conformance suite and would silence a warning real TwinCAT users need. For the operator surface, the
suspicion "the diff is smaller than modeled" does **not** hold: the diff is real and recording-verified.

### Pragmas (DONE — no over-modeling)

The vendor-differentiated pragmas are **20 TwinCAT-only entries, all `Tc`-prefixed Beckhoff attributes**
(`TcRetain`, `TcPersistent`, `TcRpcEnable`, `TcSwapWord`, `TcLinkTo`, `TcNcAxis`, …), each already noting its
CODESYS equivalent (`PERSISTENT`/`RETAIN`/`hide` appear only *inside* those `equivalentIn` notes, not as
mis-tagged pragmas). **0 CODESYS-only** pragmas — correct, because TwinCAT 3 *is* a CODESYS-3-derived
compiler, so it accepts the CODESYS attribute set. Spot-verified against Beckhoff InfoSys "Attribute
pragmas": `call_after_init`, `hide`, `pack_mode`, `monitoring` (our `shared` tags) are all TC-supported.
So the pragma differentiation is real and correctly tagged — the `wrong-vendor-pragma` check only fires
(rightly) when a CODESYS user pastes a `Tc`-attribute.

**Caveat vs operators — CLOSED (2026-07), BOTH vendors:** the pragma tags are now recording-verified on
both sides. The `pragma-tc` fixture category (all 20 `Tc*` attributes) was captured via
`volt-scripts/record-vendor-pragmas.ts` against **both** a live TwinCAT build (TcXaeShell 15.0) and a live
CODESYS build (V3.5 SP21, headless):
- **TwinCAT** accepts all 20 (`buildSuccess: true`) — its own attributes.
- **CODESYS** *silently* accepts all 20 too (`buildSuccess: true`, zero diagnostics) — it ignores unknown
  attributes rather than rejecting them. This is the key finding that VALIDATES the design: the
  `wrong-vendor-pragma` check is a **warning, not an error**, precisely because neither compiler errors on a
  cross-vendor attribute — the LSP is the only layer that flags the portability risk. (Opt-in, default off;
  fires under codesys with an equivalent suggestion — unit-tested `TcRpcEnable`/`TcPersistent`.)
The replay cross-check passes for both vendors (both compiler + LSP silent by default → no divergence). The
vendor-differentiated pragma set is now fully evidence-backed, matching the operators.

Net: **operators + pragmas — no retag.** The user's "diff smaller than modeled" does not hold for either;
the vendor layer is real and (for operators) recording-verified. Remaining scope narrows to:
- **Message precision (worth doing):** for operators that exist in TC with a *different signature*
  (`__QUERYINTERFACE`, `__QUERYPOINTER`), the `wrong-vendor` text "CODESYS-only and not supported by
  TwinCAT" is imprecise — better: "different signature in TwinCAT (see …)". The tag/behavior stays; only
  the message improves.
- **The pragma side** (1 `twincat`-tagged entry + any `wrong-vendor` pragma cases) is still unaudited —
  smaller surface, same recording-first method.
- **`__NEW`/`__DELETE`** carry hover notes ("TC doesn't support") that are too strong (TC parses them; the
  real caveat is "no dynamic-memory runtime backing unless configured") — a hover-text fix, not a tag.

## Why one change, not two

The rename and the audit are the same realization from two angles — *this is one IEC engine, not a
CODESYS tool with a TwinCAT bolt-on*. Doing them together keeps the story (and the `vendor`-layer surface
they both touch) coherent. Neither adds capability; both reduce accidental vendor coupling.
