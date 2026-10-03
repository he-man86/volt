## 0. Design gate — do this first

- [x] 0.1 (volt, 2026-10-03: confirmed, FITS — see the proposal's assessment.) Verify the observation and confirm or refute PLCAssist's reading (see "Analyse first"); if refuted or intended, record why and stop. Then check the request against volt's design (`push-keeps-what-landed`: all-or-nothing, the kept state in the
      reason; `PushConflict.Code`'s "never branch on prose"; the CLI baseline for a refused op). Record FITS, or
      CONFLICTS + why + the volt-native alternative. Build only what fits.

## 1. Test red

- [ ] 1.1 Engine tests over the existing `OpOutcome` cases (`CreateRollbackTests`, the `MemberRefusal` oracles):
      `UpdateKept`, `Renamed`, `Replaced` and a failed rollback each give `partiallyApplied: true`; a rolled-back
      create and a pre-flight refusal give none.
- [ ] 1.2 A rename case asserts the new-name field.

## 2. Build

- [ ] 2.1 `PushConflict` fields; `ConflictFor` sets them from `OpOutcome`; regenerated docs.

## 3. Verify

- [ ] 3.1 Live on CODESYS: a push whose single update is refused on a new member answers `partiallyApplied: true`.
- [ ] 3.2 Full C# suites and `bun run check` green.
