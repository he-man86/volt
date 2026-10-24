# Volt bridge wire, protocol 1 (final shape) — what changes for PLC Assist

DRAFT (2026-10-24). Final when `wire-final-shape` is built; the owner may still change the two open points in
`design.md` (deleting `accepted`, the lease as an error frame).

Protocol 2 replaces protocol 1 in one step. A bridge answers a request without `"protocol": 2` with the error frame
`PROTOCOL_MISMATCH`, so move every call at once.

## Every request

- Send `{ "op": "...", "protocol": 1, "body": { ... } }`. `body` may be omitted for `health` and `disconnect`.

## `health`

- `networkText` is gone. Read `languages` (e.g. `["ST","LD","FBD"]`): a body is editable only if its
  `IMPLEMENTATION <LANG>` is listed.
- New: `kinds: [{ extension, writable }]`, this bridge's item kinds.
- `projects[].dirty` may be absent: the IDE did not say. Never treat absent as clean.

## `connect` / `disconnect`

- The result is `{}`; there is no `ok`.
- A project name is matched ignoring case, like a path.

## `refs` / `fetch`

- `unreadable[]` and `unreadableNodes[]` entries carry `code`. Match it, not the reason.
- Send `knownApplications` with `knownItems`: the `applications` the read that produced your baseline stated. Sent
  without it (you do not know them), a known path under an unread folder outside every application the walk states is
  never reported removed.

## `push`

- `accepted` is gone. Every op `conflicts` does not name landed; every op after a refused one is `NOT_ATTEMPTED`.
- A stale `expectedProjectVersion` is the error frame `STALE_PROJECT_VERSION` (no `<project>` conflict row, no
  `currentProjectVersion`). Pull, then push again.
- The receipt adds `removed`: every path the push made disappear. Update your baseline from `newItems` and `removed`.
- `conflicts[].code` is always present. `conflicts[].name` is always your op's `name`; on `ITEM_EXISTS` the colliding
  item is in `existing`.
- "No version" is an absent `ifVersion`, never `null`.

## `build`

- `duration` is now `durationMs`.
- `diagnostics[].line` / `column` are 1-based and absent when the IDE states no position (no more `0`).
- `diagnostics[].severity` is absent when the IDE's own word is not one Volt maps.

## `grep`

- `matches[].path` is now `matches[].name`.

## Already on dev under protocol 1 (sent 2026-10-23)

- A `deleteItem` quoting `ifVersion` for an item that is gone: `ITEM_MISSING`.
- `BAD_REQUEST` for: `null` where a value is expected, unknown members on `health`/`disconnect`, a push without
  `ops`, a `set` that changes an item's kind (send `deleteItem` + create), a path `refs` could not publish.
