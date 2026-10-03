## ADDED Requirements

### Requirement: a push refused before the first write names every refused op

A push SHALL decide every per-item refusal that is decidable before the first write — the gate's per-item conflicts
(`STALE_ITEM_VERSION`, `ITEM_EXISTS`, `ITEM_MISSING`, `ITEM_UNVERIFIED`, `UNREADABLE`) and the pre-flight's (run over
the ops the gate did not refuse, including a POU or METHOD / ACTION / PROPERTY name the driver's IDE was measured to
refuse, `UNSUPPORTED`) — before writing anything, and when any op is refused SHALL write nothing and answer
`accepted: false` with one conflict per refused op (code, reason, line) — not only the first. Two refusals concern the
request as a whole and are answered alone: a stale project lease (`STALE_PROJECT_VERSION`), and a malformed request
(`BAD_REQUEST` for the ops' own shape — a name that is not a wire name, two ops on one item), which names the first
offending op.

#### Scenario: two malformed items in one batch
- **WHEN** a push of four items has two items that fail pre-flight (INVALID_ST)
- **THEN** nothing is written, the response is `accepted: false`, and it carries a conflict for EACH of the two

#### Scenario: a member name the IDE was measured to refuse
- **WHEN** a push creates a DUT and an FB whose METHOD is named `Log`, a word both vendors were measured to refuse
- **THEN** nothing is written, the response is `accepted: false`, and its one conflict names the FB with code `UNSUPPORTED`

#### Scenario: a stale item and a malformed item in one batch
- **WHEN** a push sets `A` with a stale `ifVersion` and `B` with text that fails pre-flight
- **THEN** nothing is written, the response is `accepted: false`, and it carries a conflict for `A` and one for `B`

### Requirement: accepted means something landed, and every op not landed is named

When the live IDE refuses an op after earlier ops were written, the push SHALL stop at that op (earlier ops are not
rolled back) and answer `accepted: true` with the usual receipt (`newItems`, `newFolders`, `newProjectVersion`) and
a conflict for every op that did not land: the refused op with its own code, and each op after it with
`NOT_ATTEMPTED`. When no op was applied in full the response SHALL be `accepted: false`; whatever of the refused op
itself the IDE kept (an update's declaration or a member it deleted, a create whose removal failed) SHALL be stated
in that op's conflict reason.

#### Scenario: one item refused by the IDE during apply
- **WHEN** a push of `[create a DUT, create an FB whose METHOD name the IDE refuses]` reaches the FB (a name no
  measurement listed, so the pre-flight passed it)
- **THEN** the DUT remains, the FB does not exist, and the response is `accepted: true` with the DUT's version in the receipt and one conflict naming the FB

#### Scenario: the first op is refused and nothing of it landed
- **WHEN** the IDE refuses the first op of a push and its create is rolled back
- **THEN** the response is `accepted: false`

#### Scenario: a single update refused after its declaration was written
- **WHEN** a push of one update is refused by the IDE on a new member after the item's declaration was written
- **THEN** the response is `accepted: false` and the conflict's reason says the declaration was written and stays

### Requirement: a refused create leaves nothing behind, or says it did

When the IDE refuses a create part-way, the bridge SHALL remove the object it began; if that removal itself fails,
the op's conflict SHALL say the object remains.

#### Scenario: object created, member refused
- **WHEN** the IDE creates `FB_X` and then refuses one of its methods
- **THEN** after the push `FB_X` does not exist and is listed only as a conflict

### Requirement: the apply refusal carries no client instruction

A conflict reported for an op refused during apply SHALL NOT carry CLI instructions (such as `volt pull`,
"pull first", "push again" or `--force`) in its reason — neither the push's own note nor the reason of a refusal raised
inside the apply loop (an item changed in the IDE while the push was applied, a hidden body whose language changed);
the CLI renders its own advice from the code.

#### Scenario: a refusal after other items landed
- **WHEN** a push is accepted with a conflict
- **THEN** the conflict's reason describes the refusal only

#### Scenario: an item changed in the IDE while the push was applied
- **WHEN** a push of `[create A, update B]` lands `A` and finds `B` changed in the IDE since the gate read it
- **THEN** the push is accepted with one conflict for `B` whose reason contains none of `volt pull`, `pull first`, `push again`, `--force`

### Requirement: the CLI adopts only what landed

On an accepted push carrying conflicts, `volt push` SHALL move `volt/ide` for the applied ops only, and SHALL adopt
the receipt's versions for every name the baseline already held or an applied op produced, except a conflicted name
(so an item outside the op set that the IDE rewrote — a native rename's referencing item — enters the baseline as it
does on a full push); every conflicted item keeps its previous baseline and stays outgoing.

#### Scenario: a partially refused push
- **WHEN** `volt push` of two edits is accepted with one conflict, and the refused op left nothing in the IDE (its
  create rolled back, or it was `NOT_ATTEMPTED`)
- **THEN** `volt status` shows only the refused edit as outgoing, and the next `volt push` re-sends only it

#### Scenario: the refused op partly landed
- **WHEN** `volt push` is accepted with a conflict on an update whose declaration the IDE kept (or on a create whose
  removal failed)
- **THEN** that item keeps its old baseline, the next `volt push` is refused (`STALE_ITEM_VERSION` / `ITEM_EXISTS`),
  and after `volt pull` brings the IDE's state in, `volt push` re-sends the remaining edit

#### Scenario: a rename lands beside a refused op
- **WHEN** `volt push` of `[rename X to Y, update Z]` lands the rename (the IDE rewrites `W`, which references `X`)
  and refuses `Z`
- **THEN** the baseline holds `W` at its post-rename version and `Z` at its old one
