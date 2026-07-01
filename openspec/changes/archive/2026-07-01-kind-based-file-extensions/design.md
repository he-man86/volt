## Context

This reverses `unify-item-file-extensions` (which collapsed writable source to `.st`) and goes further:
the original scheme named POUs by **body language** (`.st`/`.fbd`/`.ld`/`.cfc`/`.sfc`), so you could see
the language but not the kind; unify made everything `.st`, so you could see neither. Kind-in-the-extension
(`.fb`/`.prg`/`.fun` + the existing `.itf`/`.struct`/`.enum`/`.union`/`.alias`/`.gvl`) makes a file
self-describing.

The single production point for a source item's extension is `Materializer.Materialize`
(`Volt.Bridge.Core/Workspace/Materializer.cs`): today `SourceExt(lang)` returns `st` for textual +
editable-graphical and the body language for CFC/SFC. Access today is read straight off the extension
(`volt-git/src/registry/extensions.ts` `defaultAccess`). Kind is already recovered from content on push
(`CodeHelper.ParseCodeHeader`), and graphical routing is already content-based (`VgBody.Is`) — so the
extension is a pure label and can carry the kind instead of the language, losslessly.

The load-bearing wrinkle: the user's decision that **CFC/SFC POUs are also kind-named** (`.fb`/`.prg`/`.fun`)
means the extension can no longer say "read-only." So read-only moves **into the file content** — the
bridge emits a read-only graphical body as a `READONLY <LANG>` marker (parallel to the `NETWORK` VG
marker), making read-only self-describing in the committed file with no wire field and no sidecar.

## Goals / Non-Goals

**Goals:**
- Kind-based extensions for every writable source item; the file reveals what it is.
- Read-only preserved via a per-item `readOnly` wire flag (bridge is still the hard enforcement).
- Lossless round-trip (kind from content, unchanged), `structureVersion` unaffected.
- Both bridges byte-identical (change lives in shared Core).

**Non-Goals:**
- Encoding body language in the extension (FBD/LD vs ST is content-detected; CFC/SFC readness is the flag).
- Changing opaque reference kinds (they keep their extensions + read-only).
- Any custom migration (native git handles the one-time rename).

## Decisions

**1. Extension comes from KIND, in `ItemKind.ExtFor`.**
Re-add the source kinds to `ItemKind.ExtFor`: `function_block→fb`, `program→prg`, `function→fun`,
`interface→itf`, `structure→struct`, `enumeration→enum`, `union→union`, `alias→alias`, `gvl→gvl`
(reference kinds stay). Delete `Materializer.SourceExt`; `Materialize` uses `ExtFor(kind)` for **all**
source items, so a POU's extension is its kind regardless of body language. `.cfc`/`.sfc` disappear as
extensions entirely (those POUs become `.fb`/`.prg`/`.fun`). *Alternative rejected:* keep `.cfc`/`.sfc`
for read-only POUs — the user explicitly chose full kind-naming.

**2. Read-only is an in-content marker, not a wire field.**
When `Materializer` reads a read-only graphical POU (`ide.BodyLanguage(item)` ∈ {`CFC`,`SFC`}), it
emits the body as a leading `READONLY <LANG>` line (e.g. `READONLY CFC`) instead of today's empty
declaration-only body. A `VgBody.IsReadOnly(impl)`/`ReadOnlyLanguageOf(impl)` helper mirrors
`VgBody.Is`. This adds **no** wire field and **no** sidecar — the committed file self-describes
read-only, so git, the agent, the CLI, and the editor all see it by reading the file. The push guard is
unchanged: `PushService` already refuses by live `BodyLanguage` (`PushService.cs:267`), so the marker is
a *prediction* of that refusal, never the enforcement. *Alternative rejected:* a per-item `readOnly`
wire flag — it works, but it isn't in the committed file (needs a sidecar to persist) and grows the
protocol; the marker is self-contained. *Alternative rejected:* a comment-form marker — a bare leading
token is a cleaner discriminator (parallel to `NETWORK`) for the LSP/editor/CLI.

**3. CLI: access is read from content for POUs; extension for reference kinds.**
`registry/extensions.ts` returns to a per-kind table with `defaultAccess`: the kind extensions
(`fb/prg/fun/itf/struct/enum/union/alias/gvl`) default `rw`, reference extensions `r`. Because a `.fb`
can be a read-only CFC POU, `isPushable(path)` = extension is `rw` **and** the file's body does not
begin with `READONLY`. Reference kinds stay read-only by extension. No sidecar — read-only is read from
the file the CLI already loads for diffing.

**4. Editor + LSP re-expand to the kind extension set.**
`volt-vscode`: re-add `.fb/.prg/.fun/.itf/.struct/.enum/.union/.alias/.gvl` (all → the `structured-text`
language; drop `.cfc`/`.sfc`), with per-kind file icons if desired, and update the activation/watcher
globs. LSP: `dispatch.ts` `walkForStFiles` and `scripts/run-diagnostics.ts` scan the set; the LSP
registration `extensions` list in `.opencode/opencode.json` + `volt-config/opencode.json` lists them.
`.gitattributes` is already `* text=auto eol=lf` (blanket) — no change.

**5. This supersedes `unify-item-file-extensions`.** The code moves `.st` → kind-based in one step; the
first pull re-materializes. The in-flight `harden-lsp-real-project` corpus is regenerated under the kind
extensions and its `language-server` delta/tasks lose their `.st` wording.

## Risks / Trade-offs

- **Read-only signal is off the filename for POUs** → a `.fb` could be a read-only CFC. Mitigation: the
  in-content `READONLY` marker is right there in the file the agent/CLI/editor reads, and the bridge
  refuses regardless (no data loss). Self-describing, so no out-of-band state to go stale.
- **A `READONLY`-marked body must never be mistaken for pushable ST** → the CLI/LSP discriminator treats
  a `READONLY`-led body as read-only (like a `NETWORK`-led body is VG); a push of such a body is refused
  client-side and by the bridge. Lock the marker token so it can't collide with real ST.
- **Re-expands the editor/LSP surface** that unify shrank → accepted; the kind information is the point.
  All kind extensions map to one `structured-text` language, so it's many extensions, one grammar.
- **One-time churn** → every workspace re-materializes `*.st` → kind files on next pull (native git
  delete+add). Call it out in the change notes.
- **Reverses just-shipped work** → `unify-item-file-extensions` (archived this session) is superseded;
  the git history keeps both, and the spec is the accumulated truth.

## Migration Plan

No migration code. Land bridge + CLI + vscode + LSP together (they must agree on the wire + the flag).
On deploy, the next `volt pull` re-materializes. Rollback = revert the packages together; the next pull
restores `.st`.

## Open Questions

- **Abbreviations** — `.fun` for function (vs `.fn`/`.func`), `.prg` for program, `.fb` for function block:
  confirmed by the requester; lock them in `ITEM_KINDS.md`/`item-kinds.json`.
- **Read-only marker spelling** — `READONLY <LANG>` (bare leading token, parallel to `NETWORK`) vs. a
  comment form; and whether to carry a trailing human note (`READONLY CFC  (* edit in the IDE *)`).
  Lock it in `packages/volt-bridge/docs/vg-language.md` + `ITEM_KINDS.md` so the LSP/editor/CLI agree.
