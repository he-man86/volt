> Owner, 2026-10-23: "you dont have to worrie about setting up a new protocol number. the goal is to find the final
> shape after this workflow." Designed after `volt-cli-rework` (archived 2026-10-24); the owner reviews the shape in
> `design.md` before anything is built.

## Why

The rework kept the wire byte-identical on purpose, so every shape defect its audit found was deferred: a health flag
that only fits CODESYS-family graphics (`networkText`), vendor and kind vocabularies hard-coded in `Volt.Contracts`
instead of coming from the hosts' declarations, a protocol number only `health` carries, two comparers for one name,
values the IDE never stated filled in by the bridge (`dirty: false`, severity `info`, `line: 0`), a push receipt that
cannot update a baseline, and a contract whose prose promises what its schema does not say. PLC Assist codes against
this wire; it should code against its final form once.

## What Changes

- **Protocol stays 1** (owner 2026-10-24), carried on every request; a request without it or of another number is refused before its body is read.
- **The bridge states its own catalog** in `health`: `languages` (replaces `networkText`) and `kinds`, beside `ops`.
  The schema's enums for vendors, kinds, languages, codes, statuses and severities are generated from the hosts'
  declarations, not from `Volt.Contracts`.
- **A fact the IDE does not state is absent, never filled**: `dirty`, `severity`, `line`/`column`.
- **One spelling per fact**: an item path is `name` everywhere (grep's `path` goes); "no version" is absence, never
  `null`; a conflict's `name` is always its op's.
- **A push answer is enough to act on**: `removed` joins the receipt; `accepted` is deleted (every op the conflicts do
  not name landed); the lease refusal becomes the error frame `STALE_PROJECT_VERSION`.
- **The schema carries every promise the prose makes**: frames, `code` required on every conflict and unreadable entry,
  per-op error sets plus one common set, each code's channel. The prose loses its history paragraphs.
- **One name comparer**: a project name is compared like a path (ignoring case), after measuring TwinCAT.
- **BREAKING** for every client: PLC Assist adapts (owner rule: no users, no backward compatibility).

## Impact

- `Volt.Contracts` (Wire, Vocabulary), `Volt.Engine` (Sync, Seam catalog → health), both hosts (dirty, severity,
  positions), `Volt.Cli` (envelope, receipt), `volt-control` (health, receipt), the OpenRPC generator and `docs/`.
- The contract suite and the wire transcripts are re-recorded once for the new shape.
- PLC Assist: one note (`plcassist-note.md`).
