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

### Requirement: The user picks a detected project from one vendor-agnostic list

The connector SHALL present a SINGLE list of detected projects across all vendors — not a per-vendor selector —
and the user SHALL connect by picking one project from it. Each entry SHALL indicate its platform (a short prefix
or a vendor logo) so the vendor is recognizable at a glance, but selection SHALL be one action over one list (the
user never chooses a vendor first). The connector SHALL enumerate open projects via a shared wire `instances`
operation (one shape across vendors) and merge the results into that one list, each entry carrying its vendor so
selection routes to the correct bridge's bind (retarget the TwinCAT worker; rebind the CODESYS in-proc host's
active project). On a successful connect the connector SHALL emit a notification that NAMES the platform (e.g.
"Connected to <project> (CODESYS)"). With no project selected a bridge SHALL report "no project" rather than
auto-attaching to an arbitrary one. This unifies the user experience while preserving the distinct attach
archetypes (ExternalAttach for TwinCAT, InIdeLoad for CODESYS) at the mechanism level.

#### Scenario: One list mixes vendors, each entry labeled by platform
- **WHEN** a TwinCAT project and a CODESYS project are both detected
- **THEN** they appear in the same list, each with its platform prefix/logo, selectable as one action — with no separate CODESYS vs TwinCAT lists

#### Scenario: Picking a project connects it and the notification names the platform
- **WHEN** the user picks a detected project from the list
- **THEN** the connector binds it via that project's vendor mechanism and the connect notification names the platform (e.g. "Connected to MyMachine (CODESYS)")

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
