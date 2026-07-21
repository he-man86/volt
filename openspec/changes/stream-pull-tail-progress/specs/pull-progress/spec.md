## ADDED Requirements

### Requirement: Pull/init progress covers the whole operation, in labeled phases

`volt init` and `volt pull` SHALL stream progress for the ENTIRE operation, not only the bridge fetch. After the
fetch returns, the CLI SHALL continue emitting `ProgressFrame`s for the local work — materializing changed items
and writing them to disk (a `writing` phase with `done`/`total` over the changed-item count), and the git
commit/index step (a `finalizing` phase, which MAY be indeterminate). Each frame SHALL carry a `phase` so a
frontend can label the current step. The progress stream SHALL NOT go silent for a majority of the operation's
wall-clock time on a large project.

#### Scenario: Frames continue past the bridge fetch on a large pull
- **WHEN** `volt init`/`volt pull` runs on a project whose local materialize+write dominates the wall-clock
- **THEN** progress frames are emitted after the final `fetch` frame — a `writing` phase advancing to its total and
  a `finalizing` phase — up to near process exit, so a progress bar keeps moving instead of freezing at 100 %

#### Scenario: Phases are labeled
- **WHEN** the CLI transitions from fetching to writing to finalizing
- **THEN** each emitted frame carries the corresponding `phase`, and the frontends render a matching label
  ("Fetching…", "Writing files…", "Finalizing…") rather than a single unlabeled bar

### Requirement: The post-pull status refresh is not an unexplained pause

The shell's post-init/pull status refresh — a `volt status` → full `refs` walk — SHALL be surfaced to the user as a
labeled step (e.g. "Refreshing status…") or an indeterminate indicator, and SHALL NOT appear as a finished-looking
toast pinned at 100 % while the walk runs.

#### Scenario: Status refresh after pull is visible
- **WHEN** an init/pull finishes and the shell runs its follow-up `volt status`
- **THEN** the user sees a labeled "refreshing status" indication for the duration of that `refs` walk, not a
  static completed bar
