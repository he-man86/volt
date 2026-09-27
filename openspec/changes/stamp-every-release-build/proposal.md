## Status: the original proposal is DECLINED (review 2026-09-27); one small part remains

## The report

`build-cli.ps1` stamps `/p:Version` only when `VOLT_VERSION` is set (`packages/volt-cli/scripts/build-cli.ps1:36-38`).
PLC Assist packages its downloadable bridges from a LOCAL `packages/volt-cli/dist`, so every bridge it shipped
reported `1.0.0.0`, and an old download could not be told from a new one. It proposed that `build-cli.ps1` always
stamp, computing `<maj.min>.<commit count>` via `scripts/version.ts` when `VOLT_VERSION` is unset.

## Why it is declined (checked against the code)

- **The unstamped build is deliberate, not a gap.** `build-cli.ps1` says so ("Empty outside CI: a dev build stays
  1.0.0"), and `1.0.0.0` is the "(dev)" sentinel `Program.ShippedVersion` (`volt --version`) and the updater rely on.
- **Volt's releases are stamped.** `release.yml` sets `VOLT_VERSION`, with `fetch-depth: 0` so the commit count is
  right. A Volt release never reports `1.0.0.0`.
- **The fix would make binaries lie.** A local build — possibly of a dirty tree, which the proposal only warned about
  — would carry a real release number such as `0.1.17020`, identical to the published build of that commit but with
  different content. That contradicts the rule stated in the same block: "a binary cannot lie about its own version".
  It would also make a stale local build compare as current against the updater.
- **The cause is on the consumer's side.** Shipping bridges from a local `dist/` bypasses Volt's release. The right
  fix belongs to PLC Assist: ship the bridges from Volt's published GitHub release, or keep requiring
  `VOLT_VERSION` in its packager together with its existing check that the stamp matches the commit.

## What remains

- **An unstamped build says so.** When `VOLT_VERSION` is unset, `build-cli.ps1` prints one line: the output is an
  unstamped development build (`1.0.0.0`, reported as "(dev)") and is not a release; set `VOLT_VERSION` or use the
  published release. Today it prints nothing in that case, so a consumer only learns it from the shipped binary.

## Non-goals

- No change to the version scheme, `scripts/version.ts`, `release.yml`, or `ide.ps1`.
- `build-cli.ps1` does not compute a version.

## Impact

- `packages/volt-cli/scripts/build-cli.ps1` (one message). Consumers: PLC Assist's `tools/package-bridges.mjs`
  keeps its `VOLT_VERSION` requirement, or switches to the published release.
