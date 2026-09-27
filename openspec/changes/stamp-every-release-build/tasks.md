The stamping proposal is declined (see proposal.md). One message remains.

## 1. Say it

- [ ] 1.1 `build-cli.ps1`: when `VOLT_VERSION` is unset, print that the build is an unstamped development build
      (`1.0.0.0`, "(dev)"), not a release, and how to get a release (set `VOLT_VERSION`, or use the published
      release). The CI path is unchanged.
- [ ] 1.2 Run it both ways: unset → the message, DLLs `1.0.0.0`; `VOLT_VERSION=0.1.99999` → no message, DLLs stamped.

## 2. Hand-off

- [ ] 2.1 Tell PLC Assist the verdict: ship bridges from Volt's published release, or keep requiring `VOLT_VERSION`
      with its commit check. No Volt change for the stamp itself.
