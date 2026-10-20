## 1. Measure

- [ ] 1.1 Time a `refs` on the largest fixture of each vendor (CODESYS two-device, TwinCAT MultiProject) and on an
      ~900-item project: the materialization cost `grep` pays per call. If it dominates, note whether the session's
      last materialization can be reused while `projectVersion` is unchanged (a design question for the owner, not an
      assumption).
- [ ] 1.2 **STOP GATE.** Confirm the materialized text `refs` hashes is byte-identical to `fetch`'s `sourceText` for
      the same item (line endings included), on both vendors. `grep`'s line numbers depend on it. If the two differ
      for any item on either vendor, stop and report before building on it.

## 2. Tests red

- [ ] 2.1 Transport, both vendors' tree shapes: identifier in three places → three matches, paths/lines/text exact,
      `items` versions equal `refs`.
- [ ] 2.2 Case-insensitive default; `caseSensitive: true`; non-ASCII fold; CJK identifier.
- [ ] 2.3 `literal: true` with regex metacharacters; invalid regex → `BAD_REQUEST` naming it, nothing searched;
      catastrophic pattern → per-line timeout → `BAD_REQUEST`.
- [ ] 2.4 Tabs preserved: the matched `text` equals the fetched line; a member after `END_FUNCTION_BLOCK` has its
      fetched line number.
- [ ] 2.5 `paths` globs: `**/*.gvl`, an application root `Line1/**`, a `%2F`-escaped name, a glob matching nothing.
- [ ] 2.6 Scope = what `fetch` ships as text: a network-text body is searched; a body reading
      `IMPLEMENTATION <LANG> UNSUPPORTED` is named in `notSearched` while the item's declaration is still matched;
      an unreadable item is named with its reason; libraries out of scope and unlisted; `unwalkedFolders` passed
      through.
- [ ] 2.7 Bounds: `limit` respected, `totalMatches` counted past it, capped at 10000 with `truncated`.
- [ ] 2.8 Unknown request member → `BAD_REQUEST`.

## 3. Implement

- [ ] 3.1 `Ops.Grep`, `GrepRequest`/`GrepResponse` in `Volt.Contracts`, `GrepService` beside `FetchService` reusing
      the walk and materialization; both drivers through `IIdeDriver`.
- [ ] 3.2 `volt grep <pattern> [--literal] [--case-sensitive] [--path <glob>]… [--limit N]`.
- [ ] 3.3 OpenRPC, `wire.html`. NOT here: `WireProtocol.Version` and the schema pin — a final coordinating step bumps
      to 2 and re-pins once, after `build-selects-application` lands too.

## 4. Live

- [ ] 4.1 e2e on CODESYS SP21 and TwinCAT 4024 fixtures: 1.2, 2.1, 2.4 and 2.6 against the real IDE.
