## MODIFIED Requirements

### Requirement: The workspace is cross-indexed

The server SHALL cross-index the whole workspace so that types declared in unopened files resolve. This SHALL hold for the **running server**, not only the binder or offline corpus loads: on `initialize` (when a workspace root is provided) the server SHALL crawl the workspace for kind-named source files (`.fb`, `.prg`, `.fun`, `.itf`, `.struct`, `.enum`, `.union`, `.alias`, `.gvl`) and seed the project symbol table from disk. For any file the client has opened, the open document SHALL take precedence over its on-disk contents (open buffer wins), so an unsaved edit still drives analysis. The eager index SHALL NOT introduce any diagnostic on valid code that would not have been produced when every file was open — the zero-false-positive guarantee holds unchanged.

#### Scenario: A type in an unopened file resolves
- **WHEN** a file references a DUT declared in another, unopened file
- **THEN** go-to-definition and type resolution succeed

#### Scenario: Cross-file resolution works with only the referencing file open
- **WHEN** the client has opened only `PLC_PRG.prg`, which references `E_Mode` declared in an unopened sibling `E_Mode.enum`
- **THEN** `E_Mode` resolves and no `Identifier 'E_Mode' not defined` diagnostic is produced

#### Scenario: An open buffer overrides the on-disk version
- **WHEN** a file is open with unsaved edits that differ from disk
- **THEN** analysis, resolution, and diagnostics reflect the open buffer, not the on-disk copy

## ADDED Requirements

### Requirement: The workspace index stays fresh on file changes

The server SHALL declare and handle `workspace/didChangeWatchedFiles` for kind-named source files and for the reference files it crawls (`.library`, `.device`, `.task`). On a create, change, or delete of a watched file, the server SHALL re-index so that subsequent queries reflect the new on-disk state without requiring the affected file to be opened, and SHALL invalidate any cached project scope. The reference-name crawl (library namespaces, device instance names, task program roots) SHALL be re-runnable on these events, not performed only at `initialize`.

#### Scenario: A newly added source file becomes resolvable without opening it
- **WHEN** a new `.struct` file is added on disk (e.g. by `volt pull`) and a watched-files change event is delivered
- **THEN** references to the new type resolve without the file being opened in the editor

#### Scenario: A deleted source file stops resolving
- **WHEN** a source file is deleted on disk and a watched-files change event is delivered
- **THEN** the types it declared are no longer in the project scope and references to them are reported unresolved

#### Scenario: A changed library reference is picked up without restart
- **WHEN** a `.library` file changes on disk and a watched-files change event is delivered
- **THEN** the refreshed library namespaces are reflected in resolution without restarting the server
