- [x] 1.1 `ide-run.ps1`: run membership (`Test-RunOwns`) and the foreign selection (`Select-Foreign`), pure; offline tests.
- [x] 1.2 `ide.ps1`: `-Run` / `$VOLT_IDE_RUN`; `up` refuses beside a foreign IDE under the launch lock; the `check` verb.
- [x] 1.3 `release:matrix`: run `release-matrix`; `down` every own instance first; one `check` before any cell; down on
      SIGINT/SIGTERM/SIGHUP. `mixed-version.ts`: its prefix is the run when none is set; down on signal.
- [x] 1.4 `vendor-facts.ts`, `completeness.ts`, `corpus-migration.ts`: down on signal (each already downs in `finally`).
- [x] 1.5 Docs: CLAUDE.md's ide.ps1 paragraph, `scripts/README.md`, `packages/volt-cli/test/e2e/README.md`.
- [x] 1.6 Live (the next small matrix): the matrix refuses by name beside a foreign IDE and starts beside none; its two
      cells start together without refusing each other; a Ctrl+C leaves no IDE; a killed run's IDE is closed by the
      next run's start.
- [x] 1.7 Follow-up, outside this change (a running workflow holds edits there): the e2e harness and
      `ide-restart.test.ts` reopen a TwinCAT shell themselves — confirm the reopened XAE is recorded under the run's
      instance (or reopened through `ide.ps1 up`), so a sibling's check never sees it as foreign.

Live, 2026-10-24 (`--only codesys-3.5.21.40-64,codesys-3.5.21.60-32 --jobs 2`): first run started beside a foreign
CODESYS — fixed (design: one function decides the refusal; offline tests for one process and for none); then refused by
pid and command line beside it, started both cells together beside none, a CTRL_C_EVENT mid-suite closed both IDEs
through the handler, and a hard-killed run's two IDEs were closed by the next run's sweep. 1.7: `ide-restart.test.ts`
reopens through `ide.ps1 up -Reopen` on its own instance (run inherited via `VOLT_IDE_RUN`); `tc-reopen.ts` reopens
inside the same XAE. Live on TwinCAT 14: the reopened XAE and its worker are in the instance's record, and a sibling's
`check` names nothing.
