# Design: how the rework is done (decision 1.2, 2026-10-20)

The owner delegated the decision ("review all options in detail and decide"). Inputs: `input/map-and-rating.md`,
`input/vendor-neutrality.md`, `input/foreign-client-review.md`, `input/loc-baseline.md`.

## What the research established

- The defect that blocks the goal (a new vendor is one host) is concentrated in ONE place: the shape of the `Ide/`
  contract and of the Engine code that consumes it. Numeric TwinCAT `TREEITEMTYPE` kind codes branch the Engine in 26
  places; `ICodeStore` carries the NWL network body; kinds, languages, `%`-keys and vendors are closed tables.
  Vendor-neutrality of the Engine scores 3/10.
- The hosts are not a tangle (6.5 and 5.5 overall). They hold the measured vendor knowledge: 45+ DIALECT rows, many of
  them workarounds that exist only in code beside a comment (modal-dialog avoidance, save-free move, rename via a
  temporary name, SP18 constructor gaps). Duplication between them is ~150–200 lines of pure network rules.
- Behind the wire there are ~19k lines of product code and ~34k of tests. Most unit tests test internal structure; the
  oracles that survive any restructuring are the e2e suite on every IDE cell, the wire transcript and the contract
  suite of 1.3 (not built yet), and DIALECT.md as the specification of vendor behaviour.

## Options

| | A. Full rewrite of the four projects | B. Staged refactor (new seam beside the old, move, delete) | C. Rewrite the seam + Sync, refactor the hosts | D. Cleanups only |
|---|---|---|---|---|
| End state | clean | clean | clean | the seam stays CODESYS-shaped; goal not met |
| New-vendor goal | met | met | met | not met |
| Loss of measured vendor knowledge | high: workarounds not under an e2e are rediscovered in the field | low | low: the hosts keep their code and tests | none |
| Oracle during the work | e2e + transcript only; unit tests rewritten | all suites keep their meaning | e2e + transcript + host suites; Engine unit tests rewritten with the Engine | all suites |
| Working state between steps | none until the end | after every step | after every step | after every step |
| Releases for PLC Assist meanwhile | stopped or on old code | continue | continue | continue |
| Effort (estimate) | 6–9 weeks | 3–5 weeks | 4–6 weeks | 1–2 weeks |
| Engine code quality afterwards | designed | inherited structure, moved | designed | inherited |

## Decision: C

- **Why not A:** its only gain over C is a fresh host codebase, and the hosts are where the measured knowledge lives and
  where the score is already acceptable. It costs the most, has no working state midway, and loses behaviour that no
  e2e pins.
- **Why not B:** it keeps the Engine's inherited structure (PushService ~2.3k lines, 1k of them comments; the walks with
  their own loops) and only moves it. The Engine is the part that scores lowest, and a moved tangle is still one.
- **Why not D:** it does not meet the goal.
- **Why C:** the part that scores 3 is redesigned; the parts that score 6–7 and hold the vendor knowledge are kept and
  refactored; every step leaves a working, releasable state.

## How C runs (each step green on every suite and every e2e cell; the wire transcript byte-identical)

1. **Bugs first**, as small separate changes (found by the research, risks for a second client today):
   a push without `expectedProjectName`/`expectedPlatform` writes into whatever project is served; a pipe frame is read
   with no size limit (inside the IDE process on CODESYS); the applications longest-prefix match is not per segment
   (to confirm); the `bun run check` reference-extension check checks nothing; a push op's discriminator must come
   first in the JSON (undocumented order rule).
2. **Safety net (1.3)**: the OpenRPC-driven contract suite that records a wire transcript per vendor fixture; one
   implementation + gate per wire rule; the mixed-version cell against 0.1.17884; the new-vendor gate with BOTH
   assertions (no vendor/NWL names above `Ide/`, and no `ItemKind.Plc*` code or NWL type in `Ide/I*.cs` or `Sync/`).
3. **The new contract, written cleanly beside the old**: kinds as strings stated by the host through one registry (which
   also feeds the extension set `bun run check` gates); bodies keyed by language with readers/writers plugged in per
   `IMPLEMENTATION <LANG>`; the `%`-key set and vendors as registries; no NWL type and no numeric code in it.
4. **A third test vendor outside the CODESYS family** implements only the new contract and passes the transport suite —
   the design is proven before a real host moves.
5. **The Engine above the contract is rewritten against it** (Sync: push, fetch, refs, build; Item; the vendor-neutral
   part of Format), with its unit tests rewritten alongside; both hosts keep running through a thin adapter from the old
   contract. The NWL-specific part of `Format/Network` moves below the contract; `NetworkModel` and network text stay
   the Engine's vendor-neutral graphical form.
6. **The hosts move onto the new contract, one at a time** (CODESYS first, then TwinCAT), refactored in place: the
   adapter goes, the vendor-neutral helpers (`MemberDeclaration`, `Clean`/`Trimmed`) go up into the Engine, the
   host-only helpers leave `Ide/`. No shared CODESYS-family layer (owner caution; the measured overlap is too small).
7. **The old contract is deleted**; then the 2.x finds (legacy, the five open silent fallbacks, the hidden features)
   and the inputs since 2026-10-18.
8. **The contract documents are regenerated** from the schema (closed vocabularies as data, the create/update rule, the
   push baseline, the frame rules, no history) — together with the wire changes the audit implies (`networkText` →
   `languages`, the vendor enum from the vendor table): one change, wire protocol 2, coordinated with PLC Assist.

**Runner-ready (owner, 2026-10-20: a self-hosted live-IDE runner comes later).** The safety net of step 2 and every
live check after it are built so a self-hosted Windows runner can run them unchanged, while they run on the dev machine
until then:
- one entry point per live check (`bun run release:matrix`, extended with the contract suite and the transcript
  comparison), no interactive step, no dependency on the engineer's own open IDEs or desktop state;
- each run serves its own fixture copies through `ide.ps1` and closes them, so a run leaves the machine as it found it;
- every result is a file (`release-matrix.json`, the transcript diff, per-cell logs) that a workflow can attach and that
  `promote` already reads;
- a prepared workflow for the runner (`schedule` + `workflow_dispatch` + push to `dev`, never `pull_request` — the repo
  is public), disabled until the machine exists: openspec `ci-live-ide-runner`.
When the runner exists it moves before step 5, so the Engine rewrite runs under continuous live checking.

Guardrails: a measured vendor workaround is never dropped without its DIALECT row and a test that pins it; a step that
cannot keep the transcript byte-identical stops and is reported.

## Expected rating after (1.2 potential, same criteria as 1.0a)

Engine 5 → ~8 (vendor-neutrality 3 → 8), Ide.Codesys 6.5 → ~8, Ide.Twincat 5.5 → ~7.5, Contracts + Wire 6 → ~8.
`input/map-and-rating.md` lists what moves each score.
