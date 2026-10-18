## Why

Owner 2026-10-16: once LD/FBD is fully implemented in the app (`ld-fbd-coverage` archived), rework every project in
`packages/volt-cli`. The toolchain grew through many changes — PLCopen transport removed, HTTP wire replaced by pipes,
volt-bridge + volt-git merged, network text rewritten twice — and the owner expects legacy code, hidden bugs and hidden
(undocumented) features to have accumulated, and code to sit in the wrong project.

**The goal (owner, 2026-10-18): a new vendor can be added after this.** Everything below the wire is reworked so that
adding a vendor outside the CODESYS family (Siemens, Rockwell) means writing one IDE host against the `Ide/` contract,
with nothing above the seam to learn its name. The two vendors Volt has today are both CODESYS-family; what they share
as a family (NWL, DIALECT N1) is a family layer, never the Engine core's assumption.

## What Changes

A multi-agent workflow (owner opted in) over every volt-cli project — `Volt.Engine`, `Volt.Cli`, `Volt.Ide.Codesys`,
`Volt.Ide.Twincat`, the connector, `Volt.Contracts`, `scripts/`, and the test projects:

- **Placement.** Every piece of code lives in the project that owns its concern, not scattered: logic that names no
  vendor and no CODESYS-family fact moves to `Volt.Engine`; what the two hosts share as a CODESYS family moves to
  `Volt.Ide.CodesysFamily`; only irreducible vendor glue stays in a host (ARCHITECTURE.md). The asymmetries
  recorded in `Ide/DIALECT.md` are load-bearing and stay where they are.
- **Legacy.** Code, comments and docs serving removed designs or old formats are deleted (no users, no backward compat).
- **Hidden bugs.** Fallbacks that mask a broken state, silent defaults, untested branches — each found bug gets a
  failing test first, then the fix.
- **Hidden features.** Behaviour no doc or test states is either documented + tested, or deleted (owner decides).
- **Refactor or reimplement.** A project is refactored in place; one found to be a tangle is reimplemented — only with
  the owner's OK, behind the same tests.

Scope of the goal: BELOW the wire a new vendor is one host. ABOVE it a vendor still needs one registration point each in
the connector (launch), the installer (payload) and the LSP (dialect) — named in `ARCHITECTURE.md` by this change, built
in the front-of-wire phase. Budget: 1.x (map, audits, safety net) is moderate; 2–3 (find, rework) is large and starts
after the owner's 1.2 review.

## Impact

All of `packages/volt-cli` (src, test, scripts, docs). The pipe wire stays byte-identical on both vendors (parity
boundary); a wire change is a separate owner decision. Starting input: the 2026-10-16 read-only simplify reviews
(`input/engine.md`, `input/cli-bridges.md`) minus what was already applied that day. `cli-bridges.md` section B (silent
fallbacks made loud, ~105 lines) and the "used to…" history-comment sweep need the owner's OK.
