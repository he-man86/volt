## ADDED Requirements

### Requirement: a refused item does not refuse the batch

A push SHALL refuse an item that fails for its own reasons, before or during apply, without refusing the other items in the batch; every other item SHALL still be applied. Only a stale project lease or a malformed request SHALL refuse the whole batch.

#### Scenario: one item refused by the IDE during apply
- **WHEN** a push of three creates reaches the third, and the IDE refuses it (e.g. a METHOD named `Log`)
- **THEN** the first two remain applied, the response is `accepted: true` with one conflict naming the third, and the receipt carries the versions of the two applied items

#### Scenario: one malformed item caught before apply
- **WHEN** a push of three items has one item that fails pre-flight (e.g. INVALID_ST)
- **THEN** the other two are applied, and the response is `accepted: true` with one conflict naming the malformed item

#### Scenario: nothing applicable
- **WHEN** every item in a push is refused
- **THEN** the response is `accepted: false` with a conflict per item, as today

### Requirement: a refused item leaves nothing behind

When the IDE refuses an item part-way through applying it, the bridge SHALL undo that item's partial effect, so the project holds neither a new empty object nor a half-written existing one.

#### Scenario: object created, member refused
- **WHEN** the IDE creates `FB_X` and then refuses one of its methods
- **THEN** after the push `FB_X` does not exist (it was a create) and is listed only as a conflict

### Requirement: refusal reasons are client-neutral

`conflicts[].reason` SHALL NOT contain instructions for a specific client, such as running a CLI command.

#### Scenario: a refusal after other items landed
- **WHEN** a push is accepted with a conflict
- **THEN** the conflict's reason describes the refusal only, and contains no `volt pull` or other CLI instruction
