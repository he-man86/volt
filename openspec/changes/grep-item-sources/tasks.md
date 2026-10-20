## 1. Measure

- [x] 1.1 Time a `refs` on the largest fixture of each vendor (CODESYS two-device, TwinCAT MultiProject) and on an
      ~900-item project: the materialization cost `grep` pays per call. If it dominates, note whether the session's
      last materialization can be reused while `projectVersion` is unchanged (a design question for the owner, not an
      assumption).
      — Measured 2026-10-20, live: CodesysTestProject.3.5.21.40 (73 items) refs 15–17 ms, grep 16–51 ms; TwinCAT
      MultiProject 4024 (41 items) refs 272 ms, grep 314 ms; Pro2193 on CODESYS SP21 (881 items, 695 searched, 186
      libraries) refs 11.0 s cold then 0.88–1.05 s, grep 0.79–1.08 s whatever the pattern (`.` capped at 10000
      included). The walk's materialization IS the cost (grep ≈ refs); the search itself is noise. Reusing the last
      materialization while `projectVersion` is unchanged would need the version without the walk, which is the walk —
      not pursued; an owner question only if ~1 s per search on an 881-item project proves too slow.
- [x] 1.2 **STOP GATE.** Confirm the materialized text `refs` hashes is byte-identical to `fetch`'s `sourceText` for
      the same item (line endings included), on both vendors. `grep`'s line numbers depend on it. If the two differ
      for any item on either vendor, stop and report before building on it.
      — PASSED: by construction (`ProjectSnapshot.Walk` hashes `mat.Text` and `fetch` ships that same string), and live:
      every item's fetched `sourceText` hashes (`Hasher.ComputeItemVersion`) to its `refs` version — CODESYS SP21 73/73,
      TwinCAT 4024 MultiProject 41/41, a network-text FBD body included (`test/e2e/endpoints/grep.test.ts`).

## 2. Tests red

- [x] 2.1 Transport, both vendors' tree shapes: identifier in three places → three matches, paths/lines/text exact,
      `items` versions equal `refs`.
- [x] 2.2 Case-insensitive default; `caseSensitive: true`; non-ASCII fold; CJK identifier.
- [x] 2.3 `literal: true` with regex metacharacters; invalid regex → `BAD_REQUEST` naming it, nothing searched;
      catastrophic pattern → per-line timeout → `BAD_REQUEST`.
- [x] 2.4 Tabs preserved: the matched `text` equals the fetched line; a member after `END_FUNCTION_BLOCK` has its
      fetched line number.
- [x] 2.5 `paths` globs: `**/*.gvl`, an application root `Line1/**`, a `%2F`-escaped name, a glob matching nothing.
- [x] 2.6 Scope = what `fetch` ships as text: a network-text body is searched; a body reading
      `IMPLEMENTATION <LANG> UNSUPPORTED` is named in `notSearched` while the item's declaration is still matched;
      an unreadable item is named with its reason; libraries out of scope and unlisted; `unwalkedFolders` passed
      through.
- [x] 2.7 Bounds: `limit` respected, `totalMatches` counted past it, capped at 10000 with `truncated`.
- [x] 2.8 Unknown request member → `BAD_REQUEST`.
- [x] 2.9 `health.ops` equals the host's dispatch table (every listed op dispatches, every other name is unknown).

## 3. Implement

- [x] 3.1 `Ops.Grep`, `GrepRequest`/`GrepResponse` in `Volt.Contracts`, `GrepService` beside `FetchService` reusing
      the walk and materialization; both drivers through `IIdeDriver`. `health.ops` from `BridgePipeHost.Served`.
- [x] 3.2 `volt grep <pattern> [--literal] [--case-sensitive] [--path <glob>]… [--limit N]`.
- [x] 3.3 OpenRPC, `wire.html`. NOT here: the schema pin — the protocol stays 1, and a final coordinating step re-pins
      it once, after `build-selects-application` lands too. Until then
      `DocDataTests.The_wire_shape_is_pinned_beside_its_protocol_number` is red, deliberately.

## 4. Live

- [x] 4.1 e2e on CODESYS SP21 and TwinCAT 4024 fixtures: 1.2, 2.1, 2.4 and 2.6 against the real IDE
      (`test/e2e/endpoints/grep.test.ts`, 7/7 on both).
