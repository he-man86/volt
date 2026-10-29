## ADDED Requirements

### Requirement: the bridge works on every supported platform variant
The bridge SHALL work on a 64-bit TwinCAT XAE shell, on 32-bit CODESYS across the supported service packs, and on the VM
configurations of the checklist, without any developer-tool component.

#### Scenario: a 64-bit XAE
- **WHEN** the bridge serves TcXaeShell64 (TwinCAT 3.1.4026) on a machine without Visual Studio
- **THEN** refs, fetch, push and build succeed
