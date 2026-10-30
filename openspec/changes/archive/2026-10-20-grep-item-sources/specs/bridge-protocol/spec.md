> Superseded 2026-10-30: the current network-text spelling is packages/volt-cli/docs/network-text.html.

## ADDED Requirements

### Requirement: grep searches the text fetch ships
The bridge SHALL accept a `grep` op whose request carries `pattern` (required, non-empty) and optionally `literal`
(default false), `caseSensitive` (default false), `paths` (path globs, default all items) and `limit` (1–1000, default
200). It SHALL search, line by line, the text `fetch` ships as `sourceText` for every walked item whose path matches
`paths`, from the same walk and materialization `fetch` uses — so what is searched is decided by that code path and by
no list of kinds or languages of its own. A network-text body (`IMPLEMENTATION LD`/`FBD`) is searched whenever the
bridge serves network text (`health.networkText`), because `fetch` then ships it as text. `.library` items and library
signatures are out of scope: not searched and not listed. A request member it does not know SHALL be refused with
`BAD_REQUEST`.

#### Scenario: an identifier used in three places
- **WHEN** `FB_Motor.pou` declares `bRunning` and `PLC_PRG.pou` reads `fbMotor.bRunning` twice, and `grep` asks for
  `bRunning`
- **THEN** the answer holds three matches, at the paths and lines where they occur

#### Scenario: a network-text body
- **WHEN** the bridge serves network text and `PRG_Lamp.pou` has an FBD body that `fetch` ships as network text using
  `lamp`, and `grep` asks for `lamp`
- **THEN** the matching lines of the network text are answered at their fetched line numbers

#### Scenario: an unknown member
- **WHEN** a `grep` request carries `regex: true`
- **THEN** the bridge answers `BAD_REQUEST` naming `regex`, and searches nothing

### Requirement: the grep answer names lines, not sources
The answer SHALL carry `matches` (`{ path, line, text }` per matching line, in ordinal path order then line order,
`line` 1-based, `text` the whole line without its line ending, cut to 500 characters with `…`), `items`
(`{ path → version }` for every item with a returned match, the version `refs` states), `searched` (how many items were
searched), `totalMatches`, `truncated`, `notSearched` and `unwalkedFolders`.

#### Scenario: versions of the matched items
- **WHEN** `grep` matches lines in `FB_Motor.pou` and `PLC_PRG.pou`
- **THEN** `items` holds exactly those two paths, each with the version `refs` answers for it, and no source text

#### Scenario: case-insensitive by default
- **WHEN** `grep` asks for `fb_motor` without `caseSensitive`
- **THEN** lines containing `FB_Motor`, `fb_motor` and `FB_MOTOR` all match (and `fbMotor`, another identifier, does not); with `caseSensitive: true` only exact case
  matches

### Requirement: a matched line is the line fetch ships
Line numbers and text SHALL be computed on exactly the source `fetch` answers for the item (its `sourceText`), so a
client's `fetch` of that item has the matched text at the stated line, and the text can be quoted in a push patch's
`search` byte for byte (tabs and spaces preserved, no trimming).

#### Scenario: whitespace preserved
- **WHEN** a line reads `\txErrorActive\t\t:= TRUE;` and `grep` matches it
- **THEN** `text` is `\txErrorActive\t\t:= TRUE;` — the same two tabs a `fetch` of the item shows at that line

#### Scenario: members after the item's end
- **WHEN** a match lies in a METHOD of `FB_Motor.pou`, which `fetch` places after `END_FUNCTION_BLOCK`
- **THEN** `path` is `…/FB_Motor.pou` and `line` is that line's number in the fetched text

### Requirement: the pattern is a regular expression or literal text
With `literal: false`, `pattern` SHALL be a .NET regular expression applied per line with `CultureInvariant`, and
`IgnoreCase` unless `caseSensitive`. With `literal: true` it SHALL be matched as plain text under the same case rule.
Case-insensitive matching SHALL fold non-ASCII letters (`Ä`/`ä`) and leave CJK text unchanged.

#### Scenario: a literal with regex characters
- **WHEN** `grep` asks for `fbMotor(` with `literal: true`
- **THEN** every line containing `fbMotor(` matches

#### Scenario: CJK identifiers
- **WHEN** an item declares `电机控制 : FB_电机;` and `grep` asks for `电机控制`
- **THEN** that line matches

### Requirement: a bad pattern is refused before searching
A pattern that does not compile SHALL be refused with `BAD_REQUEST` naming the parse error, before the walk. Matching
SHALL run with a per-line timeout, and a pattern that times out SHALL be refused with `BAD_REQUEST` naming it, with no
partial answer. A `limit` outside 1–1000 SHALL be refused with `BAD_REQUEST`.

#### Scenario: an invalid regular expression
- **WHEN** `grep` asks for `fbMotor(` with `literal: false`
- **THEN** the bridge answers `BAD_REQUEST` naming the unclosed group, and searches nothing

#### Scenario: a catastrophic pattern
- **WHEN** `grep` asks for `(a+)+$` against a line of 5000 `a`s followed by `b`
- **THEN** the bridge answers `BAD_REQUEST` naming the timeout, and no matches

### Requirement: path globs select which items are searched
Each entry of `paths` SHALL be matched against the item's full path as `refs` publishes it (escapes such as `%2F`
included), ignoring case: `*` matches within one path segment, `**` matches across segments (zero or more), `?`
matches one character within a segment, and every other character matches itself. An item is in scope when any entry
matches. A glob that matches no item is not an error: the answer simply searches nothing for it.

#### Scenario: only global variable lists
- **WHEN** `grep` asks for `xEnable` with `paths: ["**/*.gvl"]`
- **THEN** only `.gvl` items are searched and `searched` counts only them

#### Scenario: one application
- **WHEN** a project holds `Line1/Plc Logic/App` and `Line2/Plc Logic/App`, and `paths` is `["Line1/**"]`
- **THEN** no match from under `Line2/` is answered

### Requirement: what could not be searched is said
An item in scope SHALL appear in `notSearched` (`{ name, reason }`, the item's path and why, one entry per item) and
never silently be left out, when `fetch` ships none of its text — it is `unreadable` (the reason `refs` gives) — or
when one of its bodies reads `IMPLEMENTATION <LANG> UNSUPPORTED` (the reason names each such body, its member and its
language; the item's declaration and its other bodies ARE searched). Folders the walk could not enter SHALL be answered
in `unwalkedFolders`, as `refs` answers them.

#### Scenario: a CFC body
- **WHEN** `PRG_Conveyor.pou` has a CFC body and a ST declaration, and `grep` asks for a name used in both
- **THEN** the declaration's line is matched, and `notSearched` holds `PRG_Conveyor.pou` with a reason naming the CFC
  body

#### Scenario: an unreadable item
- **WHEN** `FB_Broken.pou` is in `refs`' `unreadable` list and in scope
- **THEN** `notSearched` holds `FB_Broken.pou` with the reason `refs` gives, and no match is answered for it

### Requirement: health names the ops the bridge answers
`health` SHALL carry `ops`: the name of every op the bridge answers, taken from its own dispatch table, so the list
and what the bridge serves cannot disagree. A client SHALL read a `health` without `ops` as a bridge from before the
list.

#### Scenario: a bridge that searches
- **WHEN** a client asks `health` of a bridge that serves `grep`
- **THEN** `ops` holds `grep` beside `health`, `refs`, `fetch`, `push` and `build`, and every name in it is answered
  by the bridge, while a name not in it is refused as an unknown op

### Requirement: the answer is bounded
At most `limit` matches SHALL be returned. The search SHALL still count every match for `totalMatches`, and SHALL stop
at 10,000 with `totalMatches: 10000` (read: at least 10,000); `truncated` is true whenever `totalMatches` exceeds the
matches returned, so a pattern such as `.` cannot make the answer unbounded.

#### Scenario: a pattern matching everything
- **WHEN** `grep` asks for `.` on an 881-item project with the default limit
- **THEN** 200 matches are answered, `truncated` is true, and `totalMatches` is at most 10000
