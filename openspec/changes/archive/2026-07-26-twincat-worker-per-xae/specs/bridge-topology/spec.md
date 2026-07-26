# Bridge topology — one worker per IDE, discovered per pipe

## ADDED Requirements

### Requirement: Every running IDE is served by its own worker on its own pipe

Each running IDE instance — CODESYS process or TwinCAT XAE window — SHALL be served by a dedicated bridge worker on
its own per-instance named pipe (`volt.bridge.<vendor>.<pid>`). A worker MUST own exactly one IDE and MUST NOT
multiplex multiple IDEs, so ops on different IDEs run in different processes and cannot serialize against each other.

#### Scenario: Two TwinCAT projects sync in parallel

- **WHEN** two XAE windows are open and a sync op runs against each
- **THEN** each op is served by that window's own worker process, so the two ops run concurrently (not serialized on
  one shared STA thread), matching the CODESYS per-process behavior

#### Scenario: A worker attaches to its IDE by a stable identity

- **WHEN** a TwinCAT worker is assigned an XAE
- **THEN** it attaches by the window's process id (stable for the process lifetime), not by the ephemeral ROT moniker
  or the project name, and re-attaches by that same pid across a DTE re-registration

### Requirement: The connector supervises the per-IDE workers it cannot get for free

For IDEs whose worker is NOT in-proc (TwinCAT — external COM), the connector SHALL start a worker when the IDE
appears and reap it when the IDE is gone, using only a LIGHT enumeration (the IDE's identity + project names, never a
PLC-tree walk). A transient enumeration gap MUST NOT thrash spawn/kill — a worker is reaped only after the IDE has
been absent for N consecutive checks. (CODESYS needs no supervisor: its in-proc host dies with the IDE.)

#### Scenario: An XAE opens then closes

- **WHEN** an XAE window opens
- **THEN** the connector spawns a worker targeting it; **AND WHEN** that window later closes, the connector reaps the
  worker (and the worker also self-exits once its pid is gone), so no orphan worker lingers

#### Scenario: A brief ROT gap does not kill a live worker

- **WHEN** the light enumeration momentarily returns no entry for a window that is still running
- **THEN** the worker is NOT reaped on that single miss — only after N consecutive misses — so a transient COM hiccup
  does not tear down a healthy connection

### Requirement: Both vendors present one unified per-pipe discovery model

The connector SHALL discover both vendors' workers the same way — by their per-instance pipes — and concatenate each
worker's self-describing rows into the one cross-vendor list. There MUST be a single per-pipe project-source type
(parameterised by vendor/prefix), not a per-vendor fan-out-vs-single split; same-name-across-instances still collapses
to one row by the vendor+name identity (the unchanged accepted limit).

#### Scenario: The IProjectSource asymmetry is gone

- **WHEN** the connector aggregates health across all IDEs
- **THEN** it runs the identical per-pipe discovery for CODESYS and TwinCAT, with no vendor branch in the aggregation
  (only the irreducible worker-lifecycle difference — in-proc-self-managed vs connector-supervised — remains, below
  the wire)
