## Context

Today the workspace extension for an item is produced in exactly one place on the bridge —
`Materializer.Materialize` (`Volt.Bridge.Core/Workspace/Materializer.cs:25`):

```csharp
var lang = build.TryGetValue("language", out var l) ? l as string : null;   // "ST"/"FBD"/"LD"/"CFC"/"SFC" for POUs, null otherwise
var ext = lang?.ToLowerInvariant() ?? ItemKind.ExtFor(kind);                 // ExtFor: interface→itf, enumeration→enum, …
```

The wire name is `<bare>.<ext>` (`FullWireName`). The CLI (`volt-git`) never maps kind→ext; its
`registry/extensions.ts` is a flat `ext → {defaultAccess}` table used only to decide read/write
access and whether a path is tracked. Push-back is already extension-agnostic: `PushService`
routes graphical vs. textual purely by content (`VgBody.Is(impl)`, `VgBody.LanguageOf`), and
`CodeHelper.ParseCodeHeader` recovers every writable kind from the ST header
(`FUNCTION_BLOCK`/`PROGRAM`/`FUNCTION`/`INTERFACE`/`VAR_GLOBAL`/`TYPE…`). So the per-kind extension
is a *materialization label*, not load-bearing for the round-trip.

Scope (confirmed with the requester): collapse the **writable** source extensions
(`st, fbd, ld, itf, gvl, struct, union, enum, alias`) to `.st`; keep read-only `.cfc`/`.sfc` and
every opaque reference extension.

## Goals / Non-Goals

**Goals:**
- One `.st` extension for all writable source items (textual + editable FBD/LD).
- No loss of kind/access information; no new frontmatter or header — kind stays content-derived.
- Both bridges stay byte-identical (change lives in shared Core).
- Shrink the editor/LSP surface (one language, one icon, one glob).

**Non-Goals:**
- Touching read-only graphical (`.cfc`/`.sfc`) or reference extensions — they stay.
- Any custom migration tooling — native git handles the delete+add churn.
- Changing the "name is identity" protocol invariant (the name still carries an extension).

## Decisions

**1. Normalize the extension in `Materializer`, keyed on writability + body language.**
Replace the `ext` computation so a writable source item resolves to `st` unless it is a read-only
graphical POU. Concretely: for source POUs, `ext = VgBody.IsEditable(lang) || lang == "ST" ? "st" :
lang.ToLower()` (leaving `cfc`/`sfc`); for the other source kinds (interface/gvl/DUTs) `ext = "st"`.
`ItemKind.ExtFor` loses its collapsed textual entries and is used only for reference kinds.
*Alternative rejected:* mapping in the CLI instead — the bridge owns the wire name (parity boundary
is the wire), so the extension must be decided there or the two bridges could diverge.

**2. Reduce the CLI table to `st (rw)` + the read-only extensions.**
Drop `fbd, ld, itf, gvl, struct, union, enum, alias` from `EXTENSIONS`. Access stays a pure
extension lookup — no behavioral change to `isPushable`/`isReadOnly`, just fewer rows.
`sourceExtensions()`/`gitattributesContent()` then emit a single `*.st text eol=lf`.
*Why this is safe:* all eight dropped extensions were already `rw`, so folding them into the
existing `st (rw)` row introduces zero access ambiguity.

**3. Detection order on push is unchanged.** `VgBody.Is` (content) already precedes any
extension check, and `ParseCodeHeader` already recognizes all collapsed kinds — so no push-path
code changes are required for correctness. (Add a round-trip test to lock this in.)

**4. Editor surface follows the wire.** `volt-vscode` collapses `structured-text` to own only `.st`
(plus the retained `.cfc`/`.sfc`), removes the now-unreachable `plc-interface`/`plc-gvl`/`plc-dut`
language ids and their per-kind icons, and simplifies the activation + watcher globs. The LSP
document-selector reduces to the `.st` language. VG highlighting is untouched (already a
NETWORK-token content injection). The LSP registration Volt writes
(`.opencode/opencode.json` + shipped `volt-config` + `volt init` emitter) attaches to `.st`.

## Risks / Trade-offs

- **One-time re-materialization churn** → On the first pull after the change every collapsed item
  is deleted at its old path and recreated as `.st`. This is ordinary git delete+add; no data loss
  (content is byte-identical, kind is recovered on push). Call it out in the change notes.
- **Loss of per-kind editor icons** (DUT/GVL/interface files now show the ST icon) → Accepted; it
  is the point of the change. Reference kinds keep their icons.
- **`item-kinds.json` invariant wording** ("each file-producing kind MUST have a matching
  extensions.ts entry") is now many-kinds→one-ext → Update the `$comment`; the vocabulary test
  cross-checks `Map` (kinds) not `ExtFor`, so it does not break, but any test asserting a per-kind
  writable extension must be updated.
- **A stale mixed workspace** (old `.itf` file lingering beside a new `.st`) → Cannot happen through
  the sync path (the fetch reconciles names), and `isTrackedPath` no longer recognizes the dropped
  extensions, so a leftover file is simply untracked, not double-materialized.

## Migration Plan

No migration code. Land bridge + CLI + vscode together (they must agree on the wire). On deploy,
the next `volt pull` in any bound workspace performs the delete+add automatically. Rollback =
revert the three packages together; the next pull re-materializes the old extensions.

## Open Questions

None blocking. (If a future vendor adds a content-indistinguishable writable graphical language, it
would need its own extension like `cfc`/`sfc` — the normalization rule already handles that by
falling through to `lang.ToLower()`.)
