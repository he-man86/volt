## ADDED Requirements

### Requirement: CODESYS connects by guided user-activation, never by the connector launching the IDE

The connector SHALL NOT launch or open any IDE. For CODESYS (which has no external attach API and must load the
bridge in-process), the connector SHALL instead provide a **guided activation** affordance: a clear description of
how to load the Volt pipe host into an already-open CODESYS, plus an action that copies the exact activation
command (the `start_pipe.py` invocation) to the clipboard. Once the user activates the script, the connector
SHALL detect the running in-proc host over its named pipe with no further user action. The install-discovery and
IDE-launch machinery (CODESYS install globbing/registry/manual picker, `--runscript` launch, the `/launch`
control endpoint) SHALL be removed.

#### Scenario: The user activates CODESYS from guidance, and the connector detects it
- **WHEN** the user opens the "Activate in CODESYS" affordance, copies the command, and runs it in an open CODESYS
- **THEN** the in-proc host starts serving `volt.bridge.codesys`, and the connector's next health probe shows CODESYS up — without the connector having launched CODESYS

#### Scenario: The connector never launches an IDE
- **WHEN** any connector action related to CODESYS is invoked
- **THEN** no CODESYS process is spawned by the connector (guidance + clipboard only)

### Requirement: Both vendors detect open projects and let the user select one

For each vendor, once its bridge is reachable, the connector SHALL enumerate the open project(s) via a wire
`instances` operation and present them to the user for selection, and selecting a project SHALL bind the bridge to
it (retarget the TwinCAT worker; rebind the CODESYS in-proc host's active project). The enumeration SHALL use one
shared shape across vendors. With no project selected the bridge SHALL report "no project" rather than
auto-attaching to an arbitrary one. This unifies the *user experience* across vendors while preserving the
distinct attach archetypes (ExternalAttach for TwinCAT, InIdeLoad for CODESYS) at the mechanism level.

#### Scenario: Selecting a project connects the bridge (TwinCAT)
- **WHEN** TwinCAT is running with a project open and the user picks it from the connector's project list
- **THEN** the worker attaches to that project and the connector shows "connected to <project>"

#### Scenario: Selecting a project connects the bridge (CODESYS)
- **WHEN** the CODESYS in-proc host is active with a project open and the user picks it from the connector's project list
- **THEN** the host binds that project and the connector shows "connected to <project>"

#### Scenario: The project list is populated, not empty
- **WHEN** a bridge is reachable with at least one open project
- **THEN** the connector's status snapshot carries the enumerated projects (never a hardcoded empty/`null` list)

### Requirement: The connector presents a Volt-branded status surface

The connector SHALL present its status through a Volt-branded surface — carrying Volt's visual identity (the bolt
mark, wordmark, palette, and typography shared with the console and marketing site) — rather than only an
unstyled context menu. The surface SHALL show, per vendor, the current state, the connected/selected project, and
the single primary action appropriate to that state (for CODESYS: activate → select project → connected; for
TwinCAT: open IDE → select project → connected). The tray icon (aggregate connection color) and state-change
toasts SHALL remain.

#### Scenario: The surface shows per-vendor state and the right next action
- **WHEN** the user opens the connector surface while CODESYS is not yet activated and TwinCAT has a project connected
- **THEN** the CODESYS card offers "Activate in CODESYS" and the TwinCAT card shows "connected to <project>", each with Volt branding
