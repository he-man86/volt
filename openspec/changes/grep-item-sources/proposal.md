> PLC Assist, 2026-10-20. Wanted: the AI's biggest missing tool. Lands in the release coordinated with PLC Assist
> (see Impact).
>
> Owner adjustments, 2026-10-20 (before any code): the scope is **what `fetch` ships as text**, derived from the code
> path `fetch` uses, not a list of languages; the byte-identity of the hashed text and `fetch`'s `sourceText`
> (task 1.2) is a STOP GATE; everything else as proposed. Agreed with PLC Assist during the work: `health` names the
> ops a bridge answers (`ops`), and the wire protocol stays 1 (owner).

## Why

A client that wants to know where a name is used, what writes a variable, or which POU calls a method has one way to
find out today: `fetch` the sources and search them itself. PLC Assist's AI does this by reading item after item —
12 to 20 per question in production (2026-10-20, chats 3e7ea63f and b52a3ad1), building contexts past 200,000 tokens
on an 881-item project — or by fetching the whole project over the relay for every question.

The bridge already holds the answer. `refs` and `fetch` materialize every walked item's source to hash its version,
so searching that text where it is produced is cheap; shipping it to the client to search is not. Every coding agent
the AI is trained on has this tool (`grep` in Claude Code and opencode), and its absence is the largest gap between
what the AI expects to be able to do and what the bridge offers.

## What Changes

- A new op, `grep`: search the text `fetch` ships for the project's items for a pattern, and answer the matching
  LINES — path, 1-based line number, the line's text — never whole sources.
- The line numbers and text are those of the source `fetch` ships for the item, byte for byte, so a client can quote
  a matched line back in a push patch, and `fetch` the item to see its context at the same line.
- Each matched item's version is answered with its matches, the same version `refs` states, so a client knows whether
  the item it holds is the one that matched.
- Options: regular expression or literal text; case-INsensitive by default (IEC 61131-3 identifiers are
  case-insensitive, and a search for `fb_motor` must find `FB_Motor`); an optional path glob limiting which items are
  searched; a cap on returned matches with an honest `truncated` count.
- **The scope is what `fetch` ships as text.** Searched: every walked item whose `fetch` answer carries a
  `sourceText`, network-text bodies (`IMPLEMENTATION LD`/`FBD`) included whenever the bridge serves network text
  (`health.networkText`). Not searched, and named in `notSearched` with the reason: items `fetch` does not ship as
  text (`unreadable`), and every body that reads `IMPLEMENTATION <LANG> UNSUPPORTED` (CFC, SFC, IL; an LD/FBD body
  network text cannot represent or that a bridge with network text off hides) — the item's declaration and its other
  bodies are still searched. A search that finds nothing must never be mistaken for a search that could not look.
- `health.ops`: every op the bridge answers, from its own dispatch table, so a client can tell a bridge that
  searches from one that does not.
- `volt grep <pattern>` on the CLI.

## Non-goals

- Searching library contents (`.library` items and their signatures). A library's signatures cost an extraction (on
  CODESYS a build) the first time per session; that is a separate, opt-in follow-up if a client asks for it.
- A glob op. `refs` already answers every item path; a client filters those itself.
- Replacing anything. `grep` reads; changes stay with `push`.

## Impact

A new op, and a new `health` member, `ops`: every op the bridge answers, from its own dispatch table. An older bridge
refuses an op it does not know and sends no `ops`; PLC Assist reads `health.ops` and treats a bridge without `grep` as
"search unavailable — download the latest bridge", not as a failure. The wire protocol stays 1 (owner, 2026-10-20):
both additions are additive, and a capability is detected through `health.ops`, not through the number. The OpenRPC
schema hash changes; this change leaves the pin alone, and a final coordinating step re-pins it as protocol 1 after
`build-selects-application` lands too.
