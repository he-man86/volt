## ADDED Requirements

### Requirement: the packaging tests survive a reused process id
The packaging tests SHALL clean up earlier test output without failing when the process id that named a folder now belongs
to a process the test run may not inspect.

#### Scenario: a leftover folder whose pid is now a protected process
- **WHEN** `%TEMP%\volt-packaging` holds a `<pid>-…` folder and `<pid>` is now a process the current user cannot query
  (e.g. `audiodg`), so `Process.HasExited` throws access denied
- **THEN** the sweep treats that process as not the test run's own, removes the folder (or leaves it if locked), and the
  packaging tests build and pass

#### Scenario: a folder whose process is still the running test
- **WHEN** a `<pid>-…` folder belongs to a test process that is still running
- **THEN** the sweep leaves it alone, as today
