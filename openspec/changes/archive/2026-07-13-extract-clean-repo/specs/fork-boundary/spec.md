## ADDED Requirements

### Requirement: Volt lives in a standalone repo that depends on opencode, not a fork of it

Volt SHALL be a standalone repository containing only its own code (`volt-*` packages, the desktop shell, the
`OPENCODE_CONFIG_DIR` bundle, scripts, and docs) and SHALL consume opencode only as (1) a chained/pinned
**runtime** that serves the backend and GUI over HTTP, and (2) the published **`@opencode-ai/plugin`** SDK. The
repo SHALL NOT contain opencode's source tree; upstream is tracked by dependency version + a compat gate, not by
merging opencode's tree. `volt-*` packages SHALL depend only on **published** opencode packages (never private
ones).

#### Scenario: Tracking a new opencode version is a dependency bump, not a merge
- **WHEN** a new opencode release is adopted
- **THEN** it is taken by bumping the pinned opencode runtime version (+ `bun update @opencode-ai/plugin`) and
  running the compat gate — there is no `git merge` of opencode's source and no `check-divergence` step

#### Scenario: The desktop uses opencode's served GUI, not its source
- **WHEN** the Volt desktop launches
- **THEN** it spawns the pinned opencode (which serves the GUI over HTTP), loads that URL in a BrowserView, and
  draws Volt chrome + the connector panel around it — with no `@opencode-ai/app` dependency and no opencode source
  in the repo

#### Scenario: A package with a private-opencode dependency is not in the core cut
- **WHEN** a `volt-*` package depends on a private opencode package (e.g. `console-core`)
- **THEN** it is excluded from the standalone core repo until that dependency is published, vendored, or removed
