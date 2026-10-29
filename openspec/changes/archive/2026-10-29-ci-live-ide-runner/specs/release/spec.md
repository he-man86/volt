## ADDED Requirements

### Requirement: the live IDE check runs in CI on a self-hosted runner
The release matrix and the contract suite SHALL run on a self-hosted Windows runner with the IDE variants installed, on a
schedule, on demand and on push to `dev`, and SHALL never run for a pull request.

#### Scenario: a nightly run
- **WHEN** the nightly schedule fires
- **THEN** the runner runs the release matrix on the `dev` tip and attaches `release-matrix.json`, which `promote` accepts for that commit

#### Scenario: a fork's pull request
- **WHEN** a pull request from a fork is opened
- **THEN** no job runs on the self-hosted runner
