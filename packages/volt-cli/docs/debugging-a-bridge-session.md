# Debugging a bridge session

When something goes missing at a customer site — "my POU / a library type isn't in the workspace", "a push
didn't land" — the bridge's durable log is the first place to look. It answers *what* the bridge did and *why*
it skipped something, after the fact.

## Where the logs are

```
%LOCALAPPDATA%\Volt\logs\
```

Per-source, daily-rotated files, pruned after 14 days:

| File | Written by |
|------|-----------|
| `codesys-YYYY-MM-DD.log`   | the in-proc CODESYS bridge |
| `twincat-YYYY-MM-DD.log`   | the standalone TwinCAT bridge |
| `connector-YYYY-MM-DD.log` | the connector/supervisor (child bridge stdout rides in tagged, too) |

Each line: `[timestamp][source][level] message`. Default level is **Info**; per-item drop detail is **Debug**
(see "Turning on Debug" below).

To collect a session, zip that folder.

## What the sync lines mean

Every `/fetch`, `/refs`, and `/push` logs one completion line.

```
fetch init: 138 items, 5 changed, 1 removed (skipped: 2 unmapped-kind, 4 lib-unmatched) (2009ms)
refs: 138 items (skipped: 1 unreadable) (140ms)
push 3 ops — accepted [created: FooFB.fb; updated: Bar.gvl; deleted: Gone.st] (139 items) (215ms)
push 1 ops — REJECTED (Bar.gvl: item changed since you fetched its version) (12ms)
```

- **push** names exactly what it wrote, grouped by action — the write receipt. A rejected push names the item
  and the conflict/validation reason.
- **fetch/refs** report item/changed/removed counts and, when non-empty, a **drop tally**. A clean pull has no
  `(skipped: …)` clause.

### Drop kinds

| Kind | Meaning | Action |
|------|---------|--------|
| `unmapped-kind`      | an IDE item whose `KindCode` isn't in the item-type table (opaque/unknown) | usually benign; Debug shows the name + code |
| `unreadable`         | the item exists but its body couldn't be read — **body did NOT reach the pull** | a real error — logged at **Warn** with name + reason; investigate |
| `lib-render-null`    | a library sub-signature (method/property, covered by its parent FB) or unknown `POUType` | benign; the element rides in its parent |
| `lib-unmatched`      | a referenced-library element whose owning library matched no `.library` ref by `RESOLUTION` (CODESYS facade / Interfaces↔Implementation split) | it's **not dropped** — look under `Library Manager/(unresolved)/…` in the workspace; the deep fix (concrete-resolution map) is a separate change |

## Diagnosing "my X isn't in the workspace"

1. Search the fetch log for the name: `Select-String -Path codesys-*.log -Pattern 'MyPou'`.
2. No hit at Info? Turn on Debug and re-pull — per-item skip lines (`fetch skip: …`) name each dropped item.
3. Match the kind to the table above. `lib-unmatched` ⇒ it's under `(unresolved)`. `unreadable` ⇒ a
   materialize bug — the Warn line has the reason.

> **"It was excluded from the build in the IDE" is never the explanation.** Exclude-from-build is not modelled:
> an excluded object syncs as an ordinary file like any other, and `FetchService` has no such drop kind — the
> tally has exactly the four above. This table used to list one, with the verdict "expected; confirms the item
> was excluded, not lost", which is a ready-made way to close a genuine missing-item report as normal.

## Turning on Debug

Debug lines (per-item drop names) are off by default. In-process, `VoltLog.Level = VoltLogLevel.Debug`
before the operation; the standalone bridges honor the same level. Info-level tallies are always on, so the
*counts* are visible without opting in — Debug only adds the per-item names.
