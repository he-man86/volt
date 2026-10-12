## ADDED Requirements

### Requirement: the editor extension ships only through the editors' registries
The `volt-vscode` extension SHALL be published to the VS Code Marketplace and Open VSX by the release pipeline, and the
Volt installer SHALL NOT install, update or replace it in any editor.

#### Scenario: a user installs Volt
- **WHEN** the Volt installer runs, interactively or as a silent update
- **THEN** it runs no editor command line and writes into no editor's extension directory

#### Scenario: a user wants the editor support
- **WHEN** the user searches for Volt in VS Code, Cursor or Windsurf
- **THEN** the extension is listed there and updates through the editor's own auto-update
