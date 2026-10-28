> PLC Assist, 2026-10-20. Coordination for the release that ships `grep-item-sources`, `build-selects-application`
> and project identity required on a push. Owner decision recorded here; open questions below need Volt's answer
> before PLC Assist builds its side.

## Why

That release changes the wire for PLC Assist in three places at once: a new op (`grep`), a new optional build member
(`applications`), and a push that is refused without project identity. PLC Assist ships its side in the same moment
(new tools, a chat-version bump, new bridge packages), so both sides need one written agreement on what goes on the
wire and how the switch-over behaves.

## What Changes

- **The relay protocol stays 1** (owner, 2026-10-20). The bridge keeps sending `hello.protocol: 1` in this release
  although the wire changes, as in release 0.1.17884. PLC Assist's relay is not changed and accepts only 1. An older
  bridge is caught by PLC Assist itself: a bridge downloaded before the release shows "needs updating", and an op it
  does not know (`grep`) is answered to the user as "download the latest bridge".
- **`WireProtocol.Version` and the schema pin**: whatever Volt needs internally, the number the bridge puts in
  `hello.protocol` for the relay stays 1. If the two are the same constant today, they need splitting for this
  release.

  > Volt: Owner (Volt), 2026-10-20: the protocol stays 1 EVERYWHERE in this release — `hello.protocol`,
  > `health.protocol` and the OpenRPC version. No split is needed; the schema hash is re-pinned as protocol 1, as in
  > 0.1.17884. PLC Assist detects the new capabilities by `health.ops` (question 5), not by the number.

## Questions for Volt (please answer in this file, under each)

1. **Project identity on a push — which field?** Name of the request member, and where it lives (`PushRequest` top
   level?).

   > Volt: The members that exist today on every bound request (`BoundRequest`, top level of the request body):
   > `expectedProjectName` and `expectedPlatform`. Nothing new to add. What changes: on `push` (the one writing op) both
   > become REQUIRED on `push` AND `build`; read ops (`refs`, `fetch`, `grep`) keep them optional and check whichever is
> supplied. `build` counts as a write: on TwinCAT a build saves the served solution's changed documents (XAE's own
> "Before building: Save all changes", DIALECT D45/D46), so a build of the wrong project writes to disk.

2. **Its value?** The `projectName` that `refs`/`fetch` answer, something else from `refs` (a project id, the
   `.project` / `.sln` path), or a value from `health`?

   > Volt: `expectedProjectName` = the `projectName` that `refs`/`fetch` answer (also `health.projects[].project`), compared
   > exactly (ordinal, case-sensitive). `expectedPlatform` = the vendor id (`codesys` | `twincat`), compared ignoring case.

3. **What does a push without it, or with the wrong one, answer?** Error code and message, so PLC Assist maps it to a
   user-facing reason rather than "unknown".

   > Volt: Missing either member on `push` or `build` → `BAD_REQUEST`, naming the missing member, nothing written or built (the strict reader already
   > answers this way for a malformed body). Wrong name or vendor → `WRONG_PROJECT` (exists today): "the bridge is serving
   > <vendor>/<name>, but this workspace is bound to <vendor>/<name> — open the bound project in the IDE (or Reconnect)".
   > Nothing is written in either case.

4. **Does anything else in the release break an existing request?** (Today PLC Assist sends `refs`, `fetch` with
   `onlyItems`/`init`, `push`, `build`, `health`.) Anything beyond the push identity that a client written for
   0.1.17884 gets refused for.

   > Volt: One thing: the push identity above. The protocol number stays 1 (owner), so a `health.protocol === 1`
   > check keeps working. Not breaking: `build.applications` is optional (absent = every application, as today); `grep` is
   > a new op; a request frame is capped at 64 MiB (`BAD_REQUEST` over it; the largest real project push is ~6 MB); a push
   > op's `op` may now sit anywhere in the object (it had to come first).

5. **`health` — will it state that `grep` exists** (a capability or the bridge version), so PLC Assist can tell
   "this bridge has no grep" without sending a `grep` and parsing the refusal?

   > Volt: Yes. `health` gains `ops`: the list of op names the bridge answers (`refs`, `fetch`, `push`, `build`, `grep`, …).
   > "No grep" = `grep` not in `ops` (or no `ops` at all: an older bridge).

6. **The release number and a pre-release build** PLC Assist can run its live suites against before the release
   (its release gate runs CODESYS SP21 and TwinCAT 4024 against the bridges it packages).

   > Volt: RELEASED: **0.1.17931** (latest, commit 858c5363d3, 2026-10-20), release matrix green on all five cells.
   > Prerelease 0.1.17928 (same product code) is superseded: it failed one test on CODESYS 3.5.18, fixed in the test.

## Impact

PLC Assist's side is written down in its own repo: `openspec/changes/plc-grep-and-glob` (tools `plcGrep` and
`plcGlob`, push identity, one chat-version bump). It is built once questions 1–5 are answered, and released together
with Volt's release.
