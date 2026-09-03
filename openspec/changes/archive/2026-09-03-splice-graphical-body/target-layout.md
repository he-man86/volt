# The target layout — structured so the edge cases cannot exist

This is the folder and file plan for `src/Volt.Engine`, decided **before** the featureset in `tasks.md` §3 is
built, so the splice lands into the shape it belongs in rather than being retrofitted afterwards.

## The brief

Not "tidier folders". The measured problem is that the same job is done by several code paths that **disagree**,
and every disagreement is an edge case that has to be discovered — in a test if someone thinks to write it, in
production if not.

> **Every divergence between two paths that do the same job is an edge case someone has to find.**
> The layout's job is to make there be one path, and then to make a second one fail the build.

Collapsing the duplicates (`tasks.md` §7) removes today's divergences. The layout is what stops them coming back.
So each item below names the **edge-case class it deletes**, and §4 adds a guard per collapsed rule — because a
rule that is merely "collapsed once" re-diverges the next time someone adds a member kind.

## 1. What is measured to be wrong, counted as edge-case classes

| # | Class | Today | Combinations a tester must cover |
|---|---|---|---|
| E1 | Declaration written N ways | W1/W2 all-copies + throw; W3 constructs; W4 **first-only + silently creates** | 4 writers × {1 copy, 2 copies} × {present, absent} |
| E2 | "Is this element the item's own?" asked N ways | `OwnDescendants` case-sensitive over 9 names; `ChildDeclContainers` `OrdinalIgnoreCase` over 11 (adds `<get>`/`<set>`); `DeclFromExport` **no filter at all** | 3 predicates × every element name × case |
| E3 | Body guarded N ways | `SetBody` 5 checks; `SetAccessor` 2; `SetChildText` 2 **and opposite marker answer**; `AddChild` **none** | 4 sites × 5 checks |
| E4 | Two "find the stored FBD/LD element" scans | `BodyCodec` nested-aware; `GraphSplice` direct-children-only | 2 scans × {nested, direct} shapes |
| E5 | Two serializers | `PlcOpenDocument.Serialize` vs `TcItemArchive.cs:183` open-coded copy | 2 × {declaration present, absent} |
| E6 | Namespace literals respelled | xhtml ×4, 3S root ×4 | 8 sites that can drift independently |
| E7 | XML parsed by regex | `BeckhoffDriver.Code.cs:105-110` beside an `XDocument` parse of the same document at `:84-103` | every body whose text contains the tag pattern |
| E8 | Test-only code in `src/` | `Sync/NetworkCodeIo.cs` (66 lines, **zero production callers** — only a `<see cref>` at `BodyCodec.cs:72`) and its sole callee `PlcOpenDocument.DeclFromExport` | a whole second read path nobody ships |

E1–E3 are the expensive ones: they are not hypothetical, they are the shapes that produced the accessor bug that
touched no body codec in either direction, and the child write that refused any non-ST body.

## 2. The principles the layout follows

**P1 — Read and write of one construct live in one owner.** This is the repo's own hardest-won lesson, twice:
`BodyCodec` holds `Decode` and `Encode` per language and is the best-factored pair in the layer; `BodyElement.cs:10-16`
records that splitting the body-element *scan* into a read copy and a write copy silently destroyed diagrams. A
construct with two owners has two rules, and two rules is E1/E2/E4.

**P2 — A file is named for the construct it owns, not the direction data moves.** "Reader"/"Writer"/"Splice" name a
direction, which is why the declaration rule could end up in four of them without anyone noticing. "Declaration",
"Body", "Members" name a thing that can have exactly one owner.

**P3 — Layer by dependency, group by construct.** The declared stack — `Vocabulary`+`Model` (L0) → `Text` → `Graph`
→ `Document` → `Ide` → `Library` → `Sync` — is sound, enforced, and stays. The changes are all *within* a layer.

**P4 — Policy is not transport.** `PouDocument.cs` holds no XML at all (verified: no `using System.Xml.Linq`); it
maps wire kinds to document members and is the only thing in `Document/` that needs `ItemKind`. That is Sync policy
that ended up in the transport folder during the unrecorded second rename.

**P5 — Nothing moves that a tool has hardcoded.** `scripts/check-wiring.ts:263` hardcodes
`src/Volt.Engine/Document/DIALECT.md`, so `Document/` keeps its name and `DIALECT.md` keeps its place.

## 3. The target

### `Document/` — the PLCopen document, one owner per construct

| File | Owns | Change |
|---|---|---|
| `PlcOpenDocument.cs` | parse, `Serialize`, element ownership | **loses `DeclFromExport`** (E8); keeps the one ownership predicate, now shared with the reader (E2) |
| `Declaration.cs` | **NEW.** The declaration, both directions: the ownership predicate, `Read`, and `Write` (all copies, throw on absent) | absorbs W1, W2, W4 and the read rules (E1, E2) |
| `BodyCodec.cs` | the body, both directions, dispatched by language | unchanged in shape — it is the model the rest copies |
| `BodyElement.cs` | the one body-element locator | unchanged; `GraphSplice`'s rival scan is deleted (E4) |
| `Members.cs` | **NEW.** Children — enumerate, add, remove, update — both directions | absorbs the member halves of `PouReader` and `PouSplice` |
| `BodySpliceGuard.cs` | **RENAMED** from `GraphSplice.cs`: what survives after §7.1 deletes its ~97 dead lines — `RequireReplaceable`, `ValidateExisting`, `SafeToDrop`, `HasPinMod` | the name finally describes it, and its false doc-comment ("belongs with the graph, not with the document") goes with it |
| `PouReader.cs` | the read entry point | thins to composition over `Declaration` / `BodyCodec` / `Members` |
| `PouSplice.cs` | the write entry point | thins the same way; partials by construct if it stays large |
| `ProjectStructure.cs` | the vendor `<ProjectStructure>` object list and its ids | unchanged |
| `DIALECT.md` | the vendor-fact record | **must not move** (P5) |
| ~~`PouDocument.cs`~~ | | **moves to `Sync/`** (P4) |

Renaming `GraphSplice.cs` is free: it is **not** in `WireVocabularyGuardTests`' exemption set. The four names that
are — `PlcOpenDocument.cs`, `PouReader.cs`, `PouSplice.cs`, `ProjectStructure.cs` — all keep their names, and the
guard strips partial-class suffixes, so `PouSplice.Members.cs` is exempt automatically.

A side effect worth taking: as `PouReader` and `PouSplice` thin, the schema element names they spell move into
`Declaration.cs` / `Members.cs`, which then need the exemption instead. **The exemption list should shrink, not
just shift** — if a thinned `PouReader.cs` no longer spells any schema name, remove it from the list rather than
leaving a stale exemption standing. An unused exemption is a guard that has quietly stopped guarding something.

### `Graph/` — the graph model and its two projections, deliberately FLAT

```
GraphReader.cs  GraphWriter.cs            model <-> PLCopen XML
NetworkTextReader.cs  NetworkTextWriter.cs  NetworkText.cs  FbdOperators.cs   model <-> VG text
NetworkCode.cs        the entry point + validation
GraphRoundTrip.cs     the convergence helper
InstanceTypes.cs      FB instance-type resolution
```

**No `Xml/` and `Vg/` subfolders, and no FBD/LD subfolder — deliberately.** Nine files and 2088 lines would justify
subfoldering on size alone, and it is rejected on purpose: putting the graphical projection in its own location is
the silo this change exists to remove. FBD and LD are already one writer (`GraphWriter.cs:29` switches on
`body.Language` into `WriteFbdBody`/`WriteLadderBody` sharing everything below), and graphical and textual are
already one dispatch (`BodyCodec.For`). Flat keeps that visible.

`InstanceTypes.cs` **stays in `Graph/`**, correcting an earlier instinct to move it to `Text/` on the grounds that
it is "a regex over ST". It has two halves — `FromBody(XElement)` reads the authoritative types off the stored XML
(`:29`) and `Of(string decl)` parses the declaration (`:58`) — so it belongs to neither `Text/` nor `Document/`. It
is a graph concern that draws on both.

### `Vocabulary/` — L0, and the home for anything respelled

| File | Change |
|---|---|
| `Namespaces.cs` | **NEW.** The xhtml namespace (4 declarations today) and the 3S root (4 spellings). Kills E6. `Languages.cs:6-10` already records this exact fix being made for the language predicates — same folder, same reason. |

### `Sync/`

| File | Change |
|---|---|
| `PouDocument.cs` | **moves in** from `Document/` (P4) |
| ~~`NetworkCodeIo.cs`~~ | **moves out to the test project** — 66 lines with zero production callers (E8) |

## 4. The guards — so a second path fails the build, not a production incident

Collapsing a duplicate once is worth little if the next member kind re-forks it. Each collapsed rule gets a
source-scanning guard, extending the pattern `WireVocabularyGuardTests` and `VendorParityGuardTests` already
establish (both of which have caught real leaks).

- [ ] **G1 — one declaration owner.** `"InterfaceAsPlainText"` is spelled in exactly one file under
      `src/Volt.Engine`. Fails E1 and E2 the moment a fifth writer appears.
- [ ] **G2 — one namespace spelling.** The xhtml and 3S namespace URIs appear in exactly one file. Fails E6.
- [ ] **G3 — one body dispatch on the write path.** `BodyCodec.For` is the only thing that selects a body encoder;
      no other file in `Document/` branches on a language name to choose how to write. Fails E3's regrowth.
- [ ] **G4 — one XML parser per document kind.** No `Regex` is applied to a string that a sibling method in the
      same file parses with `XDocument`. Narrow and mechanical, but it is exactly E7, and
      `TcItemArchive.cs:133-134` already states the rule in prose: *"a regex over that works until a body happens
      to contain the pattern."*
- [ ] **G5 — no test-only code in `src/`.** Every `public` type under `src/Volt.Engine` has at least one
      non-test caller. This is the guard that would have caught E8 (`NetworkCodeIo`, `DeclFromExport`) and
      `GraphSplice.SpliceFbdLdBody`'s ~97 lines — **three separate instances of the same thing, none of which any
      existing gate noticed.** Highest value of the five; also the one most likely to need an allowlist, so it
      carries the same reason-per-entry discipline as the vocabulary guard.

G5 is the general form of the pattern this whole change is about. The write path was unified three times and each
time the predecessor stayed, undetected, because nothing checks whether shipped code is reachable.

## 5. Sequencing

The layout is **not** a separate commit at the end. Interleaved with `tasks.md` §7, because a duplicate is
collapsed *by* giving it one owner — the move and the collapse are the same edit:

1. §7.1–7.4 delete dead code (`GraphSplice`'s ~97 lines, `RemoveOrphanChildren`, `DeclFromExport` + `NetworkCodeIo`,
   the `WritesPouAsOneDocument` remnants). Nothing can break; no file is created.
2. `Declaration.cs` is created **as** §7.5/7.6 collapse the four writers and three predicates onto one rule. G1
   lands with it.
3. `Members.cs` is created as `PouReader`/`PouSplice` thin; the exemption list is re-derived, not just edited.
4. `Vocabulary/Namespaces.cs` + G2 (§7.8). `BodySpliceGuard.cs` renamed as §4 re-scopes the gate.
5. `PouDocument.cs` → `Sync/`, `NetworkCodeIo.cs` → test project. Pure moves, last, when nothing else is in flight.
6. G3, G4, G5 land after the code they guard, each proven to FAIL against the pre-collapse state — a guard that
   was never red is a guard nobody has checked.

Each numbered step keeps all four offline suites green and `bun run check` green. No step renames a guarded file,
moves `Document/`, or creates an assembly.

## 6. Explicitly not done

- **The twelve-plus "is this graphical?" decision sites** (`write-path-census.md` §3.4) are not centralized. They
  span guard, push and read concerns that ask genuinely different questions of the same fact, and the *predicates*
  were already centralized in `Languages.cs` — that was the duplicated part. Merging the decision sites is a
  separate change with its own blast radius, and G3 stops the write-path half of it regrowing meanwhile.
- **`GraphReader`/`GraphWriter` are not merged into one file** despite P1. They are a 381/506-line pair that six
  suites assert in a single round-trip expression, and P1's purpose — one rule per construct — is already met:
  there is exactly one XML reader and one XML writer, and neither has a rival. P1 exists to kill *duplicates*, not
  to force file merges.
- **`TcItemArchive` does not move up** into `Volt.Engine`. It needs `System.IO.Compression` and `Volt.Engine` is
  `netstandard2.0` so it can load in CODESYS's net48 IronPython host. Only its open-coded `Serialize` is replaced
  by a call (E5).
- **No new assembly.** Same constraint, same reason.
