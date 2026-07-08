## ADDED Requirements

### Requirement: All Volt bridge components log to one durable, rotated location through a shared seam

Every Volt bridge component SHALL write leveled, timestamped log lines to a single durable location that
survives a reboot (not a temp directory the OS may clear) — the connector, each vendor worker, the in-proc
bridge, and the CLI where practical. Log files SHALL be rotated (per-source daily files) and pruned after a bounded
retention. Bridge Core SHALL emit its log points through a single logging abstraction so both vendors produce
identical log output (**parity**); the concrete file sink is chosen per host, so the abstraction remains safe to
load inside the in-process (net48) IDE host without conflicting with the host's own assemblies.

#### Scenario: A worker crash is captured durably with context
- **WHEN** a vendor worker writes an error or crashes
- **THEN** the line is written to the shared durable log location with a timestamp, source, and level, and
  survives a reboot

#### Scenario: Both vendors log identically
- **WHEN** the same Core code path runs under CODESYS and under TwinCAT
- **THEN** the emitted log lines are identical in shape (same seam), differing only in the source tag

#### Scenario: Logs do not grow without bound
- **WHEN** the bridge has run for many days
- **THEN** old log files are pruned past the retention window and current files are rotated

### Requirement: A single "collect diagnostics" action produces one shareable support bundle

The connector SHALL offer a "collect diagnostics" action — from the tray, the control plane, and the editor
extension — that produces one timestamped archive containing the logs plus a snapshot of current state: each
bridge's `/health`, the connector `/status`, the wire/app versions, and OS/IDE versions. The archive SHALL be
written to an obvious location (the Desktop) so a user can send exactly one file for support.

#### Scenario: Collecting diagnostics yields one file
- **WHEN** a user invokes "collect diagnostics"
- **THEN** a single timestamped archive is produced containing the logs and the health/version/OS snapshot

#### Scenario: The bundle carries the versions needed to diagnose a mismatch
- **WHEN** the archive is opened
- **THEN** it contains each bridge's reported wire/app version alongside the client version, so a version
  mismatch is visible without a live session

### Requirement: The connector provides its own log window

The connector SHALL surface the logs in a window it owns (opened from the tray), NOT through a separate renderer
layer. The window SHALL show a live tail filterable by source and severity, support search, color lines
consistently with the tray status palette, and offer the collect-diagnostics action. The logs are not required to
be surfaced in any other Volt UI.

#### Scenario: The connector's log window tails and filters logs
- **WHEN** a user opens the log window from the tray
- **THEN** it shows live log lines filterable by source and severity, colored consistently with the tray status
  palette, and offers the collect-diagnostics action
