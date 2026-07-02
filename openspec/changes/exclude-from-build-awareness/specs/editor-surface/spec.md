## MODIFIED Requirements

### Requirement: Drift is decorated in the file explorer

The surface SHALL badge changed files in the editor's file explorer: `i` (incoming), `o`
(outgoing), `C` (merge conflict), `RO` (read-only **config kinds** — opaque items such as the library
manager / task configuration / visualization that the AI reads but can't push, identified by item
kind), and `EX` (items excluded from build in the IDE — not compiled, so the LSP skips diagnostics on
them). The `RO` badge SHALL reflect read-only config kinds only; graphical POUs are NOT read-only and
SHALL NOT be badged `RO`. These colors SHALL be deliberately distinct from the editor's own git colors.

#### Scenario: An IDE-changed file is badged incoming
- **WHEN** the IDE has changed a file relative to the baseline
- **THEN** that file shows an `i` badge in the explorer, in a color distinct from git's

#### Scenario: A read-only config kind is badged RO
- **WHEN** an item is an opaque read-only config kind (e.g. a library manager or task configuration)
- **THEN** it shows the `RO` badge; a graphical CFC POU does not

#### Scenario: A build-excluded file is badged EX
- **WHEN** an item's `excludeFromBuild` flag is `true`
- **THEN** that file shows an `EX` badge with a muted color and a tooltip explaining diagnostics are skipped
