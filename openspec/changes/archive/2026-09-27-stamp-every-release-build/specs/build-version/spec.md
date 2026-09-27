## ADDED Requirements

### Requirement: an unstamped build says it is not a release

When `VOLT_VERSION` is unset, `build-cli.ps1` SHALL leave every binary unstamped (`1.0.0.0`, the "(dev)" sentinel)
and SHALL print that the output is a development build, not a release. It SHALL NOT compute or invent a release
version. When `VOLT_VERSION` is set, it SHALL stamp that value, as today.

#### Scenario: a local build
- **WHEN** `build-cli.ps1` runs with `VOLT_VERSION` unset
- **THEN** the binaries in `dist/` report `1.0.0.0` and the script prints that this is an unstamped development
  build, not a release

#### Scenario: CI's value wins
- **WHEN** `VOLT_VERSION=0.0.1.12345` is set (the release shape `X.Y.Z.<count>`; every component must be ≤ 65534,
  which is why the originally written `0.1.99999` fails to build with CS7034)
- **THEN** every binary is stamped `0.0.1.12345` and no development-build message is printed
