## ADDED Requirements

### Requirement: A vendor recording is only evidence if exactly one bridge served it

A conformance recording SHALL be taken against exactly one bridge process serving the pipe, built from the source
under test. The bridge SHALL refuse to start a second server on a name already being served, rather than joining
it.

Windows does not enforce this: a second `NamedPipeServerStream` on a live name is another INSTANCE of the same
pipe, and the OS hands each client connection to whichever instance is waiting. Two bridges therefore answer one
name and a single client's calls are split between them at random — which is not a failure but a recording whose
every row was served by a coin flip.

#### Scenario: a second bridge is launched on a live pipe name

- **WHEN** a worker starts on a pipe name another process is already serving
- **THEN** it refuses with "already served" and exits non-zero, rather than becoming a second instance

#### Scenario: a launcher reports a bridge it did not start

- **WHEN** a dev launcher waits for its worker to attach
- **THEN** it confirms the process IT spawned is alive and the attach is newer than that spawn, rather than
  accepting any evidence that some bridge is up

### Requirement: A recorder's restore target is derived, not observed

The text a recorder restores between fixtures SHALL be derived from the same template every fixture is built
from, never read from the live project at startup.

Reading it live is correct only if the previous run finished. A run that is killed dies between "instantiate this
fixture" and "restore", leaving the project declaring that fixture; the next run adopts that as pristine and
writes it back after every fixture. The result is not a crash but a plausible lie — a fixture recording a
diagnostic about a POU belonging to some other fixture, as its own answer.

#### Scenario: a previous run was killed mid-fixture

- **WHEN** the recorder starts and the live PLC_PRG differs from the derived template
- **THEN** it reports the difference and restores the template before recording anything

#### Scenario: a killed run left fixture POUs in the project

- **WHEN** the recorder starts and the project contains items named by the fixture set
- **THEN** it deletes them first, keyed on the fixtures' own names so a project POU is never removed

### Requirement: A long recording survives the IDE dying

A recorder whose run exceeds the mean time between IDE failures SHALL checkpoint its results incrementally and be
able to resume from them.

TwinCAT's out-of-process COM does not survive a two-hour run: measured 2026-09-20, one run died at fixture ~130
when a push hung for 13 minutes and returned to an invalidated project tree. Writing only at the end makes the
cost of any failure the WHOLE run, every time.

#### Scenario: the IDE or the recorder dies mid-run

- **WHEN** a recording run is interrupted at any point
- **THEN** the fixtures already recorded are on disk, and a resumed run skips them

### Requirement: A live IDE session never writes the repository

A tier that serves a project to a live IDE SHALL serve a COPY outside the repository.

The IDE writes the project it has open to disk continuously — POUs appearing and disappearing as fixtures are
pushed and removed — so serving a committed fixture in place makes every session dirty tracked files, and makes
it possible to commit IDE churn along with real work.

#### Scenario: a recording or e2e session runs against a committed fixture project

- **WHEN** a tier is asked to serve one of the committed fixture projects
- **THEN** it copies it to a work directory and serves the copy, leaving the committed tree byte-identical
