The stamping proposal is declined (see proposal.md). One message remains.

## 1. Say it

- [x] 1.1 `build-cli.ps1`: when `VOLT_VERSION` is unset, print that the build is an unstamped development build
      (`1.0.0.0`, "(dev)"), not a release, and how to get a release (set `VOLT_VERSION`, or use the published
      release). The CI path is unchanged.
- [x] 1.2 Run it both ways: unset → the message, DLLs `1.0.0.0`; `VOLT_VERSION=0.1.99999` → no message, DLLs stamped.
      Ran the whole script (`powershell -File packages/volt-cli/scripts/build-cli.ps1`, tests + all four
      publishes) each way on 2026-09-27:
      - unset: printed `VOLT_VERSION is unset: this is an unstamped DEVELOPMENT build (1.0.0.0, reported as
        "(dev)"), not a release. …`; `volt.exe`, `VoltBridgeTwincat.exe`, `Volt.Ide.Codesys.dll`,
        `VoltConnector.exe` (and the `Volt.Relay`/`Volt.Engine` DLLs) all FileVersion `1.0.0.0`;
        `volt --version` → `(dev)`.
      - `VOLT_VERSION=0.1.99999`: **the build fails** (CS7034, `Volt.Contracts`): an assembly version component
        must be ≤ 65534, so this example value cannot be stamped at all. Not a regression — the stamp path is
        unchanged — but the task's value is wrong.
      - `VOLT_VERSION=0.0.1.12345` (the release shape, `X.Y.Z.<count>`): printed only `stamping version
        0.0.1.12345 into every binary`, no development message; every binary above FileVersion `0.0.1.12345`;
        `volt --version` → `0.0.1.12345`.

## 2. Hand-off

- [ ] 2.1 Tell PLC Assist the verdict: ship bridges from Volt's published release, or keep requiring `VOLT_VERSION`
      with its commit check. No Volt change for the stamp itself.
      Not done here: it is a message to another team, for the repo owner to send.
