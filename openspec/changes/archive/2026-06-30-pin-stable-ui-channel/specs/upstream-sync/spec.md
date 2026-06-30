## ADDED Requirements

### Requirement: Volt ships opencode's stable UI channel

Volt's desktop packaging SHALL build with `OPENCODE_CHANNEL=prod` so the released app defaults to
opencode's **stable** UI (currently the v1 legacy layout), not the in-progress v2 layout that an
unset or `beta` channel selects. Because opencode's own default rule is
`newLayoutDesigns = OPENCODE_CHANNEL !== "prod"`, a Volt `prod` build SHALL automatically adopt
whatever layout opencode promotes to its `prod` channel — including v2 once opencode releases it —
with no Volt code change. Volt MUST NOT hardcode the v1 layout or vendor a separate UI package; it
is one flag-gated `packages/app`.

#### Scenario: A Volt release ships the stable layout
- **WHEN** Volt packages the desktop app with `OPENCODE_CHANNEL=prod`
- **THEN** it defaults to opencode's stable (v1) layout, app name `Volt`, and prod icons

#### Scenario: Volt auto-follows when opencode promotes v2
- **WHEN** opencode makes v2 the default on its `prod` channel and Volt next syncs and rebuilds
- **THEN** Volt's `prod` build renders v2 with no Volt-side change

#### Scenario: A developer can still preview v2
- **WHEN** a developer runs an unset/`beta` build or sets `general.newLayoutDesigns` per-install
- **THEN** the in-progress v2 layout renders, without affecting released Volt builds
