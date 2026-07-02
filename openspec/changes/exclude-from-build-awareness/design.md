## Context

The volt-lsp-codesys coverage harness treats the materialized pro2193 corpus as ground truth: it
compiles clean, so every diagnostic is a false-positive suspect, ratcheted toward zero. That is false
for **exclude-from-build** objects — CODESYS never compiles them, so their unresolved references are
never checked and cannot be false positives. CODESYS exposes the state on the ScriptObject
(`effectively_excluded_from_build`, inheritance-aware), and the in-proc bridge already reads such
members by reflection (`IsFolder` → `is_folder`).

Separately, the toolchain still carries a **read-only-language** model: CFC/SFC POU bodies materialize
a `READONLY <LANG>` marker the LSP detects, plus a per-extension access map. But ST/FBD/LD are all
read-write, and CFC/SFC are not "read-only" — they have no text form. And because methods/actions are
**inlined child bodies** (one wire item = POU + its children) and a child can be graphical while its
parent is ST, read-only-ness was never expressible per-item. The concept adds machinery for a
distinction that no longer exists; the only real need is a human-visible hint that a body is graphical.

## Goals / Non-Goals

**Goals:**
- Stop diagnosing objects CODESYS doesn't compile; make the coverage/ratchet number honest (built only).
- Replace the read-only-language model with a single informational marker on graphical bodies.
- Keep the data-loss safety net (push-refusal) exactly as-is.
- Reuse every seam; additive/optional wire field; no new dependencies.

**Non-Goals:**
- Any read-only *access* concept for POU languages, or a `readOnly` wire flag.
- Changing push-refusal enforcement (stays keyed on live `BodyLanguage`).
- The opaque config-kind read-only handling (item-kind-based, extension access) — unchanged.
- Suppressing parsing/materialization of excluded items — only diagnostics gate.

## Decisions

### 1. `excludeFromBuild` is a per-item wire boolean on `/refs` and `/fetch`
`FetchedItem` gains `excludeFromBuild`; `/refs` carries a parallel per-item map. Additive/optional —
absent ⇒ `false`. The bridge reads `effectively_excluded_from_build` (inheritance resolved at source),
falling back to `build_properties.exclude_from_build` then `false` (fail-open: an item we can't classify
is treated as built and still checked — never a silent gap).

### 2. Graphical bodies get an informational marker, not a read-only marker
The materializer emits `(* Graphical <LANG> — edit in the IDE; Volt does not represent it as text *)`
for CFC/SFC bodies. It is ordinary comment content: the LSP parses it as a comment (no diagnostics), no
code keys on it as a control signal. `VgBody.IsReadOnly`/`ReadOnlyLanguageOf` and the LSP
`isReadOnlyBody` path are removed. The body discriminator collapses to: `NETWORK` → editable VG
(FBD/LD); everything else → text (ST, or the comment-only graphical marker).

### 3. Push-refusal is unchanged — live IDE state
`PushService` already refuses a `set` on an existing CFC/SFC body via `BodyLanguage` (lines ~272-285);
that is the enforcement and stays. The now-dead marker-based refusal is removed. Removing the marker
cannot cause data loss — the marker was never the enforcement.

### 4. LSP gate + honest ground truth
The workspace tags each parsed unit with its item's `excludeFromBuild`; `computeSemanticDiagnostics`
skips excluded units. The coverage harness partitions the corpus built vs excluded (from a committed
excluded-paths manifest) and ratchets on built-only precision; excluded count is reported separately.

### 5. Editor decorations
`decorations.ts` adds an `EX` badge (`disabledForeground`) from `volt-control.readExcludedFromBuild`.
The `RO` badge is retained but now only reflects read-only **config kinds** (via the existing extension
access map) — graphical POUs are no longer read-only, so they are not badged `RO`.

## Risks / Trade-offs

- **Scripting member availability.** `effectively_excluded_from_build` must exist on the live
  ScriptObject. Mitigation: verify via `/debug` (`IDebugIntrospect`) before wiring; fallback to
  `build_properties.exclude_from_build` then `false`.
- **Informational marker is non-semantic.** An AI could still author text into a CFC method body; the
  marker only *informs*. The push-refusal (live state) catches it — no data loss, just a late refusal.
  Accepted: the marker's job is a hint, enforcement is live state.
- **Marker retirement is a materialization change.** Graphical bodies re-materialize with the new
  marker; a re-pull regenerates them and any fixture asserting `READONLY <LANG>` is updated. One-time.
- **Fail-open under-suppresses.** A failed exclusion read ⇒ item treated as built (still diagnosed) —
  the safe direction.
- **Beckhoff/TwinCAT parity.** `excludeFromBuild` returns `false` initially if not trivially mappable
  (documented gap), keeping the wire contract identical in shape.
- **Corpus provenance.** The committed corpus carries no exclusion metadata, so the harness needs an
  excluded-paths manifest recorded alongside it (produced from a bridge `/refs` against the real
  project) to compute built-only precision offline.
