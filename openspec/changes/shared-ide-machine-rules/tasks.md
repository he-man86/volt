- [ ] 1.1 `ide-run.ps1`: run membership (`Test-RunOwns`) and the foreign selection (`Select-Foreign`), pure; offline tests.
- [ ] 1.2 `ide.ps1`: `-Run` / `$VOLT_IDE_RUN`; `up` refuses beside a foreign IDE under the launch lock; the `check` verb.
- [ ] 1.3 `release:matrix`: run `release-matrix`; `down` every own instance first; one `check` before any cell; down on
      SIGINT/SIGTERM/SIGHUP. `mixed-version.ts`: its prefix is the run when none is set; down on signal.
- [ ] 1.4 `vendor-facts.ts`, `completeness.ts`, `corpus-migration.ts`: down on signal (each already downs in `finally`).
- [ ] 1.5 Docs: CLAUDE.md's ide.ps1 paragraph, `scripts/README.md`, `packages/volt-cli/test/e2e/README.md`.
- [ ] 1.6 Live (the next small matrix): the matrix refuses by name beside a foreign IDE and starts beside none; its two
      cells start together without refusing each other; a Ctrl+C leaves no IDE; a killed run's IDE is closed by the
      next run's start.
- [ ] 1.7 Follow-up, outside this change (a running workflow holds edits there): the e2e harness and
      `ide-restart.test.ts` reopen a TwinCAT shell themselves — confirm the reopened XAE is recorded under the run's
      instance (or reopened through `ide.ps1 up`), so a sibling's check never sees it as foreign.
