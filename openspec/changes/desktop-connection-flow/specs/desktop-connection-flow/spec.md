## ADDED Requirements

### Requirement: The desktop binds eagerly to opencode's active project

The desktop SHALL bind its workspace as soon as opencode's active project directory is knowable, not only once a chat session is active. Binding MUST NOT require the user to open a chat first.

#### Scenario: A project is open in opencode but no chat has started

- **WHEN** opencode's GUI is showing a PLC project directory that is already a Volt workspace, and the user has not opened a chat session in it
- **THEN** the desktop binds that workspace and the panel shows its connected sync view — it does not sit on "Open a PLC project in opencode to begin"

#### Scenario: Cold start before any signal

- **WHEN** the desktop has launched but opencode has not yet reported any active directory
- **THEN** the panel shows a transient "connecting" state (distinct from the "no project open" onboarding copy) and resolves to the correct state the moment the first signal arrives

### Requirement: The desktop releases the binding when opencode has no active project

The desktop SHALL clear its binding when opencode's GUI leaves the project — observed as requests that carry no `x-opencode-directory` or resolve to opencode's fallback `global` project (`worktree:"/"`), which is what the home / project-list view produces. A released binding MUST push a `bound:false` snapshot so the panel stops showing a previous project's live sync context. The transition MUST be debounced so a single transient directory-less request does not flap the panel.

#### Scenario: User navigates opencode back to its home screen

- **WHEN** the desktop is bound to a project and the user navigates opencode back to its home / project-list view
- **THEN** the desktop releases the binding after the debounce and the panel reflects "no project open" — it does not keep the released project's status shown as if live

#### Scenario: A single stray directory-less request

- **WHEN** a single directory-less request occurs while the user is still on a project (e.g. a background call)
- **THEN** the binding is NOT released, because the no-project transition is debounced and requires a sustained no-project signal

### Requirement: Onboarding distinguishes creating a workspace from reconnecting one

The connection surface SHALL make clear whether picking a detected IDE project **creates** a new Volt workspace (the bound folder is not yet initialized) or **reconnects/rebinds** an existing one (the bound folder is already a Volt workspace, currently offline). The two MUST use distinct copy naming the outcome, and this distinction lives in the shared `@volt/control` model so the VS Code view stays consistent.

#### Scenario: Bound to a folder that is not a Volt workspace yet

- **WHEN** opencode has opened a folder that is not an initialized Volt workspace and IDE projects are detected
- **THEN** the surface presents a **create** action whose copy states it will create a new folder + git repo from the chosen IDE project — not an ambiguous "connect"

#### Scenario: Bound to an initialized workspace that is offline

- **WHEN** the bound folder is an initialized Volt workspace whose bridge is not currently serving it
- **THEN** the surface presents a **reconnect** action with the matching project shown primary, and any non-matching detected projects demoted to an explicit "bind to a different project instead" (rebind)

### Requirement: The UI is vendor-blind — a project is identified by name only

No renderer in either shell SHALL show, prefix, badge, or branch on the vendor to identify or label a project — projects are identified by name alone. `vendor` survives ONLY as routing/identity below the wire (which pipe `volt.bridge.<vendor>`, which LSP `--codesys/--twincat`, matching a saved binding to a live project). The `vendorLabel` display helper MUST NOT exist, and control MUST NOT hand any vendor-derived label to a shell. The only permitted vendor mention in user-facing text is an actionable, vendor-specific recovery instruction (e.g. the CODESYS in-proc host's restart procedure).

#### Scenario: Any picker, list, or identity row

- **WHEN** a project is shown in the connect/reconnect picker, a detected-project list, or the bound-workspace identity row
- **THEN** it is labelled by its project name with no `"CODESYS · "` prefix, vendor badge, or vendor-derived description — regardless of how many vendors are detected

#### Scenario: The shells render control's decisions, they do not re-derive them

- **WHEN** the connection picker is partitioned into create vs reconnect and primary vs alternates
- **THEN** that partition is produced once in `@volt/control` (`connectSurface`) and both shells render the result; neither shell re-filters or re-groups the projects itself

### Requirement: The panel shows one workspace identity

The bound-workspace panel SHALL present a single canonical identity — the project name — with the workspace folder path available in a tooltip. When the folder basename and the project name differ (e.g. after an IDE rename + rebind), the panel MUST show a single one-line reconcile hint naming both, rather than two separate bare name rows.

#### Scenario: Names coincide (freshly created)

- **WHEN** the folder was created by `init` (named after the project) and the names still match
- **THEN** the panel shows exactly one name and no reconcile hint

#### Scenario: Names diverge (rename + rebind)

- **WHEN** the IDE project was renamed and the workspace rebound, so folder basename ≠ project name
- **THEN** the panel shows the project name as the identity plus one reconcile hint naming both, not two undifferentiated rows
