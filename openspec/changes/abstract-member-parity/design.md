## Design (step 2): one rule, read from the declaration

**Target.** The Volt text of a member depends only on its declaration and its code. The IDE object's class and slot
do not affect it. Today one `ABSTRACT` declaration pulls three ways (1.3); after this change it pulls one way on both
vendors, whoever made the object. The same holds for push outcomes: the same text gets the same answer on both
vendors.

**Reach (counted 2026-10-11 in the six corpora, `packages/volt-lsp-iec/test-corpus`).** There are 12 `ABSTRACT`
member texts (11 METHOD, 1 PROPERTY) in 7 owner files, all of them in pro2193. 11 pull `IMPLEMENTATION NONE` and one,
`ModuleWithStateFB.Cyclic`, pulls `IMPLEMENTATION ST` with an empty body. The other five corpora have none
(twincat-project14 included). No abstract member holds code, a comment-only body, or a graphical or hidden body: all
12 bodies are empty or missing.

### The rule

At a **member body site**, `IMPLEMENTATION NONE` ⇔ no slot, OR (ABSTRACT declaration AND no code). A member body site
is a METHOD's body, or a PROPERTY's GET/SET, where the PROPERTY's own declaration decides ABSTRACT.
- **No code** means a body that is null or whitespace only, with no stated language or an ST one. Both drivers
  already read that as null: CODESYS `BodyText`, TwinCAT stores an empty ST body as no text.
- **Not folded:**
  - a comment-only body. Its text is kept, because folding would delete it. **Measured (gate 2, `vendor-facts`
    `abstract-member-code` `comment-*`): a comment is not a statement.** A comment-only body under the abstract method
    (`// to be overridden`) and the abstract GET (`(* to be overridden *)`) builds clean on both (CODESYS `[]`,
    TwinCAT `success: true`), and both fetch it as `IMPLEMENTATION ST` with the comment, byte-identical member text.
    So a comment-only abstract body stays `IMPLEMENTATION ST` with its comment on both vendors: not folded, not
    refused.
  - a graphical or hidden body. Its line names a language.
  - a POU's own body, and an action's. `FUNCTION_BLOCK ABSTRACT` with an empty body stays `IMPLEMENTATION ST`,
    because the FB body is not a member site. `StReader.MemberHeaderIsAbstract` answers true for an FB header too, so
    the fold must pick the site by `ItemKind.ShapeOf` before it asks.
- A body WITH code (**statements**: any text left after whitespace and comments are taken away) stays
  `IMPLEMENTATION ST` and keeps its code, so nothing is hidden. 1.1 measured that both compilers refuse it the same way
  (C0433, "must not contain any statements"), so neither vendor reads it differently. A pragma-only body counts as
  statements; that is unmeasured, and recorded as **niche: accepted loss (0 occurrences in the corpora)** — all 12
  abstract member bodies in the corpora are empty or missing.
- A non-abstract empty body stays `IMPLEMENTATION ST`, as it is today.

**Choice: one function in `Volt.Engine` (the fold), applied where content enters the engine, never in a driver and
never in `StReader`.** It folds (ABSTRACT member site, no code) into `IMPLEMENTATION NONE` / the NONE stated
language, and it is called at three places:
- the two engine reads of driver content: `Materializer.BuildSource` (fetch, the refs walk, `Versioning.SafeVersion`)
  and `PushService.ReadLive` (the version gate `RequireUnchanged`, the format guard, `OnlyChanged`). These are the only
  callers of `ICodeStore.ReadContent`, so every hash, every guard verdict and every fetched text sees the folded
  content.
- the pushed source right after `StReader.Read` in `PushService`, so a pushed `IMPLEMENTATION ST` with an empty body
  under ABSTRACT (a file pulled before this change) is the same content as NONE.
- **a fourth reader, added on gate-2 review: the CLI's post-push check `PushedText.SameExceptLayout`**
  (`Commands.Rematerialized`). It reads the pushed text and the IDE's text with `StReader.Read` and compares them. A
  push of `IMPLEMENTATION ST` with an empty body under ABSTRACT (an old file, or a new abstract method written so) is
  accepted, written as `""`, and comes back `IMPLEMENTATION NONE`, so the receipt version differs from the pushed
  text's hash. Without the fold here the two texts compare unequal and the item ends "held otherwise" — honest, but it
  is the same content spelled two ways. With the fold applied to both reads, the IDE's text is the pushed text laid out
  otherwise and is adopted as `volt/ide`, exactly like a network-text layout; the next pull shows no change. A test
  pins it (3.1).

Both drivers keep their storage fact: CODESYS's declared-and-null `Implementation` stays NONE in `ReadBody`. Neither
driver reads the declaration.

`StReader` keeps reading what is written. The LSP parses text, and a reader that rewrote `ST` into `NONE` would make
the file and its parse disagree.

`StatedLanguage.NoSlot` is renamed to `IsNone`, because after the fold it no longer means "no slot". It means "the
NONE line: no code". (`None` is taken: `StatedLanguage.None` is the static value, `ItemContent.cs`.) `StReader`'s refusal of code under a NONE line keeps its code (`INVALID_ST`), but
its wording changes from "the IDE holds no body slot" to "an abstract member holds no code".

Rejected:
- The rule in each driver: two copies of a text rule is how this divergence began.
- TwinCAT-only NONE: a CODESYS `POUMethodObject` (pro2193's `Cyclic`) would still pull `ST`.
- Recreating CODESYS slotted members as `AbstractPOUMethodObject`: nothing creates that class (C2n), and the wire does
  not see the class anyway.
- The fold in `StReader`: see above.

### Push of NONE, per slot

The slot stays below the seam, and the engine makes sure a NONE body only reaches a driver at a slot.
- **`PushService.OnlyChanged` drops an unchanged body at every site**, the members' and the accessors' too. Today it
  drops only the item's own body. A member whose declaration changed is currently sent with its unchanged body as
  well. After this change, NONE over a live NONE never reaches the driver, whatever the slot. That is the only state a
  slotless object can be in, because a live slotless member always reads NONE.
- NONE therefore reaches a driver only in two places, and both have a slot:
  - over a live body with code: CODESYS `POUMethodObject` / `PropertyAccessorObject`, TwinCAT 609/613/614.
  - on a create: `create_method` / `create_property` and TwinCAT 609/613/614 all make a slotted member (1.2/1.3).
- `ImplementationMarker.Written` answers `""` for NONE instead of "skip". 1.2/1.3 measured that an empty body written
  at the slot persists across save/reopen and pulls back unchanged, now as NONE by the fold. Both drivers call
  `Written` for the item's own body too; NONE never reaches it there, because the guard refuses NONE at an item or
  action site before any write (below).
- **The language a NONE body is written in is ST**: `BodyFormatGuard.PushedLanguage` answers `StatedLanguage.St` for a
  NONE body (gate-2 review). The guard already treats NONE as an empty ST body (the language rules, N24), and the
  CODESYS write picks its aspect from `PushedLanguage` — so NONE over a live LD/FBD member swaps the aspect to ST and
  writes `""` there, as any ST push over a network body does, instead of writing `""` into the live NWL
  implementation (`NewBodyAspect` answered null for `StatedLanguage.None`). TwinCAT already passes `St`
  (`RefuseLanguageChange(kind, live, St)`). One rule, in the function introduced so the guard and the write cannot
  disagree. 0 such members in the corpora; a CODESYS driver test pins it (3.1).
- `RequireSlot` (D26) stays the drivers' backstop. A body that reaches a missing slot is a Volt bug and is refused by
  name.

Neither driver gains a slot check of its own.

Rejected: each driver testing its own slot before writing `""`. That is two copies again, and it hides the one place
that decides whether a body is sent.

### Guard (`BodyFormatGuard`), after the fold

D is "the pushed declaration is ABSTRACT" and L is "the live declaration is ABSTRACT". For an accessor, both read the
property's declaration. Every refusal names the member and comes before any write.

| Pushed at a member site | Live | Answer |
|---|---|---|
| NONE, D | NONE | accepted. A no-op body: `OnlyChanged` drops it, and the declaration beside it lands |
| NONE, D | ST, code or empty (abstract with code, or a concrete member made abstract) | accepted: `""` is written at the slot |
| NONE, D | LD/FBD or hidden | NONE is an empty ST body for the language rules: `RefusedLanguageChange(site, live, ST)` answers, as for any ST push (N24). 0 such members in the corpora |
| NONE, not D | NONE, not L (the IDE already holds it so) | accepted, unchanged. C2l: a slotless object can hold text without ABSTRACT. 0 in the corpora |
| NONE, not D | NONE, L | **refused**: ABSTRACT dropped with the NONE line kept. The remedy is the drop-ABSTRACT one (row below): make it concrete in the IDE and run `volt pull`, or delete it in one push and add it with `IMPLEMENTATION ST` in the next — NOT "state `IMPLEMENTATION ST`", which only lands in the drop-ABSTRACT refusal (gate-2 review) |
| NONE, not D | anything else (ST, network, hidden, or a create) | **refused**: the line says abstract and the declaration says concrete. The remedy is `IMPLEMENTATION ST` |
| ST with statements, D | the same body, L | accepted. Nothing is written, so a project that does not compile can still push its other items |
| ST with statements, D | anything else | **refused** (1.1). The refusal names the member and the IDE's own words: "must not contain any statements" |
| ST comment-only, D | ST (any), or a create | accepted, the comment written as is: both compilers build it and both fetch it back as `IMPLEMENTATION ST` with the comment (gate 2, measured) |
| ST comment-only, D | NONE | **refused, on both vendors**: after the fold the slot is invisible, and a CODESYS slotless member cannot hold a comment, so answering by slot would give one text two outcomes. The remedy: delete it in one push and add it with the comment in the next (a create makes a slotted member on both), or leave the body empty. 0 in the corpora |
| ST (any), not D | NONE, L | **refused, on both vendors**: dropping ABSTRACT from a member the IDE holds as abstract with no code. The remedy is to make it concrete in the IDE and run `volt pull`, or to delete it in one push and add it with `IMPLEMENTATION ST` in the next |
| ST (any), not D | NONE, not L | **refused**: a body over a slotless member (only a slotless object reads NONE without ABSTRACT). The remedy is `volt pull` |
| everything else | | unchanged: the hidden, network and language-change rules |

"Statements" in this table means any text left after whitespace and comments are taken away (pragmas count, above).
The first draft counted a comment as code and would have refused a new or changed comment-only abstract body as a
guess; gate 2 measured it instead (the IDE's words are "statements", and a comment is not one on either compiler).

**The table is for member body sites only. At an item's own body and at an action's, `IMPLEMENTATION NONE` stays
refused whatever the declaration says** (gate-2 review). `FUNCTION_BLOCK ABSTRACT` makes no item body a member site:
an abstract FB's body is a real body on both vendors (`FUNCTION_BLOCK … ABSTRACT` heads 52 files across five of the
six corpora; the review found abstract FBs with code in awa-palletizer). Today that push is
refused by `pushed.NoSlot` over a live slot; `BodyFormatGuard.Check` is the one function for the item site and the
member sites and passes the item's declaration for the item, so the step-3 implementation must branch on the site
(`ItemKind.ShapeOf` / the member kind) before it reads D, or the row "NONE, D over ST code → `""` written" would clear
an abstract FB's body without a message. The refusal names the item (or action) and says that `IMPLEMENTATION NONE`
belongs only under an abstract member; the remedy is `IMPLEMENTATION ST`. The same holds for a created item
(`RequireAuthorable`). A test pins it (3.1): `FB_Base` (`FUNCTION_BLOCK ABSTRACT`, body `x := x + 1;`) pushed with
`IMPLEMENTATION NONE` is refused and its body is unchanged.

**The create rule (`RequireAuthorable`)** applies to an added member, and also to a renamed or retyped one, which the
reconciler turns into delete + create:
- NONE with D is **accepted** (today it is refused). The create makes a slotted member, `""` is written, and the next
  pull reads NONE by the fold. 1.1's controls showed that an empty slotted abstract member builds clean on both.
- NONE without D is refused, as in the table.
- Statements under D are refused, as in the table; a comment-only body under D is accepted and written.
- A hidden body is refused, unchanged.

So the pro2193 migration refusal goes away (7 owner files).

On CODESYS a renamed abstract member comes back as a `POUMethodObject` instead of an `AbstractPOUMethodObject`. That
changes nothing the compiler sees (C2n), and the wire does not name the class.

**Changed from the first draft: dropping ABSTRACT is refused for every live NONE, not only a slotless one.** After
the fold, the guard sees a CODESYS slotless member, a CODESYS slotted one and a TwinCAT one as the same text, NONE.
Answering by slot would give one text two outcomes, which is the divergence this change removes. Only a CODESYS
`AbstractPOUMethodObject` truly cannot take the edit (C2l: it stays abstract whatever its text). The cost is that a
member on TwinCAT, or a slotted one on CODESYS, needs the IDE or two pushes to become concrete. The reverse, making a
concrete member abstract with NONE, is accepted in place on both vendors.

### Wire-parity review

For the same declaration and code, both vendors now produce identical text for the method, the GET and the SET,
whatever made the object, and give the same push answer. What stays invisible on the wire is the CODESYS class
(`Abstract…` vs slotted). It builds the same, and C2n already lists it as kept and not recreated.

No divergence is left for owner review. DIALECT C2n gets rewritten to say so.

What the text does show and does not unify is accessor DECLARATIONS that differ in the IDE. CODESYS `create_property`
writes `VAR`/`END_VAR` into each accessor, while a TwinCAT push-made GET has none (1.3). That is different content,
not the same declaration read two ways.

### Migration

The IDE-side text of every TwinCAT abstract member changes from `IMPLEMENTATION ST` to `NONE`. On CODESYS only
pro2193's `Cyclic` changes (3.3 checks exactly that).

Because the item version hashes the folded text, those owners' versions change too. The first push after the upgrade
answers `STALE_ITEM_VERSION` for them until a `volt pull`. The pull brings the NONE line as a one-line remote change,
and git merges it with a local edit elsewhere in the file.

The pushed-side fold covers what is left: a forced push, or a merge that kept the old line. The LSP already reads NONE.

## Design (step 3): the fix — where each piece lands

**Target.** Step 2's rule, built with tests that fail first: the same `ABSTRACT` member pulls the same text, and its push
gets the same answer, on CODESYS SP21 and TwinCAT, whoever made the object.

**Choice: tasks.md 3.2's "read rule in both drivers" is built as the ONE engine fold (step 2), not as a driver read.**
Drivers keep their storage facts unchanged (CODESYS declared-and-null `Implementation` → NONE in `ReadBody`; TwinCAT `""`
→ null). Pieces, in order:
1. `Volt.Engine`: `AbstractMemberFold.Apply(ItemContent, kind)` (Format/St, beside `ImplementationMarker`) — member
   sites only (`ItemKind.ShapeOf` first, then the METHOD / PROPERTY declaration), null/whitespace ST body → NONE. Called
   at `Materializer.BuildSource`, `PushService.ReadLive`, the pushed source after `StReader.Read` (`PushService` 1318),
   and both reads in `PushedText.SameExceptLayout`. `StatedLanguage.NoSlot` → `IsNone`; `StReader`'s NONE-with-code
   wording → "an abstract member holds no code".
2. `ImplementationMarker.Written(NONE)` = `""`; `BodyFormatGuard.PushedLanguage(NONE)` = `St`; `PushService.OnlyChanged`
   drops an unchanged body at every member and accessor site.
3. `BodyFormatGuard`: the step-2 table, branching on the site BEFORE D is read; a `Statements(body)` helper (text left
   after whitespace and comments); `RequireAuthorable` accepts NONE+D, refuses statements under D.
4. DIALECT C2n rewritten: one text for both vendors, no divergence left; the class stays below the wire (kept, not
   recreated). Vendor-facts rows: none new — `abstract-member-code` / `-slot` already record every fact the guard
   cites; their snapshots must stay "every fact as committed".

Rejected (one line each):
- A driver-side read rule: two copies of a text rule — how the divergence began (step 2).
- A driver-side slot check before writing `""`: hides the one engine place that decides a body is sent.
- A new vendor-facts row for the fixed bridge's fetch: the e2e parity suite is that oracle; vendor-facts records the
  vendor, never a Volt answer.

**Red tests first (3.1), each confirmed red before 3.2 lands:** the step-2 guard rows in
`test/Volt.Engine.Tests/sync/AbstractMemberParityTests.cs` (FakeIde, METHOD + accessor each), `PushedTextTests`
(+fold), `UnchangedBodyIsNotWrittenTests` (+member/accessor); driver tests `CodesysAbstractMemberPushTests` (NONE over
LD → ST aspect, `""`) and a TwinCAT twin; e2e: `vendor-parity.test.ts` + an abstract method/property case, and
`items/abstract-member.test.ts` + the migration (a pro2193-shaped NONE owner created into the blank fixture, pulled back
unchanged) on both vendors. Tests that assert the old refusals (create of NONE, `IMPLEMENTATION ST` refused on TwinCAT
parity) change ONLY where step 2 measured their premise wrong — named in the commit, nowhere else.

**Stays refused, by name, before any write:** NONE at an item body or action (incl. `FUNCTION_BLOCK ABSTRACT`);
statements under ABSTRACT unless the live body unchanged; NONE without ABSTRACT (except the IDE holding it so, C2l);
dropping ABSTRACT or a comment over a live NONE; a body over a slotless non-abstract member; `RequireSlot` (D26).

**Migration.** Live (3.3, `-Instance abstract-member-parity`, both vendors up): re-pull pro2193 and diff — exactly
`Cyclic`'s line flips ST → NONE, nothing else; TwinCAT fixture abstract members flip ST → NONE; the first push after the
upgrade answers `STALE_ITEM_VERSION` for those owners until `volt pull`. Full e2e on both vendors green.
