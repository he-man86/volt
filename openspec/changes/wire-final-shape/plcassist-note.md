# Volt bridge wire, protocol 1 (final shape) — what changes for PLC Assist

DRAFT (2026-10-24). Final when `wire-final-shape` is built. Both owner decisions are made (2026-10-24): `accepted` is
deleted, and the lease is the error frame `STALE_PROJECT_VERSION` with `error.data.currentProjectVersion`.

The protocol number stays **1**: this shape IS protocol 1. A bridge answers a request without `"protocol": 1` (or with
another number) with the error frame `PROTOCOL_MISMATCH`, so move every call at once.

## Every request

- Send `{ "op": "...", "protocol": 1, "body": { ... } }`. `body` may be omitted for `health` and `disconnect`.
- A frame that is no JSON object (`null`, an array) is `BAD_REQUEST`.

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
- A stale `expectedProjectVersion` is the error frame `STALE_PROJECT_VERSION`; the IDE's current version is
  `error.data.currentProjectVersion` (no `<project>` conflict row, no top-level `currentProjectVersion`). Pull, then push
  again.
- The receipt adds `removed`: every path the push made disappear. Update your baseline from `newItems` and `removed`.
- `conflicts[].code` is always present. `conflicts[].name` is always your op's `name`; on `ITEM_EXISTS` the colliding
  item is in `existing`.
- "No version" is an absent `ifVersion`, never `null`.
- A `sourceText` that starts with U+FEFF (a byte-order mark) is refused `BAD_REQUEST` for that op, and nothing of the push
  lands: the text is UTF-8 text, so strip the mark your file reader keeps. Line ends come back as `
`.

## `build`

- `duration` is now `durationMs`.
- `diagnostics[].line` is a line of the item's FETCHED `sourceText` (the coordinates of `grep`), 1-based — never the
  IDE's own count inside a method or the body. It is absent when the IDE states no position (CODESYS never does) or
  Volt cannot place it in that text with certainty (a property accessor's line, an LD/FBD or hidden body). `column`
  comes only with `line`. No more `0`.
- `diagnostics[].severity` is absent when the IDE's own word is not one Volt maps.

## Error codes

- `INTERNAL_ERROR` now means a Volt bug and nothing else: every refusal of a request, an IDE state or a vendor limit
  carries its own code. Report an `INTERNAL_ERROR` to us; do not retry it.
- `IDE_UNSUPPORTED` can also answer ONE call (a frame, a push conflict, or an unreadable entry's `code`): the IDE lacks
  what that call needs, named in the message. As before, do not retry — the IDE has to change.
- `build` may answer `UNSUPPORTED`: the project holds no application to build.

## `grep`

- `matches[].path` is now `matches[].name`.

## Already on dev under protocol 1 (sent 2026-10-23)

- A `deleteItem` quoting `ifVersion` for an item that is gone: `ITEM_MISSING`.
- `BAD_REQUEST` for: `null` where a value is expected, unknown members on `health`/`disconnect`, a push without
  `ops`, a `set` that changes an item's kind (send `deleteItem` + create), a path `refs` could not publish.
