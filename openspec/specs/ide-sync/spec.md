# ide-sync Specification

## Purpose
TBD - created by archiving change review-ide-sync. Update Purpose after archive.
## Requirements
### Requirement: The live IDE is a git remote-tracking branch

`volt-git` SHALL model the live PLC IDE as a git remote-tracking branch
`refs/remotes/volt/ide`. Each `volt/ide` commit's tree SHALL be the user's branch tree with only
`src/` swapped for the IDE's state, so a merge never touches the project scaffold. Living under
`refs/remotes/` keeps it visible locally but never pushed to a real origin.

#### Scenario: The IDE ref is local-only
- **WHEN** the user pushes their branch to a real origin
- **THEN** `refs/remotes/volt/ide` is not pushed

### Requirement: The engine operates on committed HEAD

`pull` and `push` SHALL diff git refs (`refs/remotes/volt/ide` ↔ `HEAD`), never the working tree —
only committed work syncs to the IDE. To stay ergonomic, `pull`/`push` SHALL first auto-commit any
dirty `src/` so HEAD is current; a clean tree commits nothing.

#### Scenario: Only committed work is pushed
- **WHEN** `push` runs with uncommitted `src/` edits
- **THEN** it auto-commits `src/` first, then pushes the committed HEAD to `volt/ide`

### Requirement: The view reads the working tree

`status` and `show` SHALL read the working tree (including untracked files), so an edit surfaces
the moment it is saved — committed or not. The outgoing axis diffs the working tree against
`volt/ide`; `show WORKSPACE` returns the live working file.

#### Scenario: An unsaved-to-git edit still shows as outgoing
- **WHEN** a `src/` file is edited and saved but not committed
- **THEN** `status` reports it on the outgoing axis

### Requirement: Native git merge reconciles a pull

`pull` SHALL commit the fetched IDE tree onto the `volt/ide` chain, then `git merge` it into the
current branch — fast-forward when there are no local edits, one merge commit otherwise, or
standard conflict markers resolved with `git merge --continue`/`--abort` then a re-run. A dirty
tree SHALL never be merged (auto-commit clears it first). There SHALL be no custom 3-way merge engine.

#### Scenario: Local edits produce a merge, conflicts use git's own resolution
- **WHEN** `pull` runs with local `src/` edits that overlap the IDE's changes
- **THEN** `git merge` raises standard conflict markers, resolved with the editor's normal merge tools

### Requirement: Machine-local state lives in the .git/volt sidecar

Volt's machine-local state SHALL live inside `.git/volt/` (so git never tracks it): `config.json`
(the bridge binding) and `ide-refs.json` (the optimistic-concurrency baseline). There SHALL be no
visible `.volt/` directory. The bridge port SHALL resolve from `--port`, then `VOLT_BRIDGE_PORT`,
then the workspace binding (the port recorded at `init` from the live bridge), falling back to `8555`.

#### Scenario: Machine-local state is never tracked
- **WHEN** a project is initialized with `volt init`
- **THEN** the bridge binding and IDE baseline are written under `.git/volt/` and never tracked — the tracked tree receives only the project scaffold (the `rust/` Cargo crate / `.gitignore` / `.gitattributes` / corpus), which `init` commits

### Requirement: Workspace files are normalized to LF for deterministic diffs

`volt init` SHALL write a root `.gitattributes` that normalizes every workspace file to LF
(`* text=auto eol=lf`). The bridge always materializes LF, so without this Windows git could
round-trip files through CRLF and make the committed `HEAD` blob differ from the verbatim-LF
`volt/ide` baseline — surfacing spurious, unpushable drift, since `pull`/`push` diff
`refs/remotes/volt/ide` ↔ `HEAD`. This normalization is a sync-engine invariant, not cosmetic.

#### Scenario: A read-only manifest shows no phantom drift on Windows
- **WHEN** a workspace is pulled on Windows and a read-only manifest (e.g. a `.library`) is committed
- **THEN** its committed blob matches the `volt/ide` baseline byte-for-byte (LF), so `status`/`push` report no drift for it

### Requirement: init scaffolds a Cargo crate

`volt init` SHALL scaffold a **standard Cargo library crate** (not a Bun/TypeScript project) so the
workspace can compile and test the Rust the LSP transpiles from Structured Text, and so the engineer
can add Cargo crates. The crate SHALL live in a `rust/` subdirectory as a single plain package (no
Cargo workspace), so Cargo never treats the PLC `src/` (the IDE mirror) as Rust source and there is
nothing unusual for a non-Rust user. The scaffold SHALL be idempotent — existing files are kept unless
`force`.

#### Scenario: A plain Cargo crate is written that leaves the PLC src untouched
- **WHEN** `volt init` scaffolds a freshly bound workspace
- **THEN** `rust/Cargo.toml`, `rust/src/lib.rs`, and `rust/tests/*.rs` are written, and `cargo` never compiles the PLC `src/` tree

#### Scenario: The Bun harness is not written
- **WHEN** `volt init` scaffolds a workspace
- **THEN** no `package.json`, `bunfig.toml`, `tsconfig.json`, or `bun:test` example is written

### Requirement: The Cargo scaffold keeps the PLC-specific workspace aids

The Cargo scaffold SHALL retain the vendor-neutral, PLC-specific aids the Bun scaffold provided: the
`.vscode/settings.json` Structured-Text file associations (`.fb`/`.prg`/`.fun`/… → `structured-text`),
the language-reference corpus install, and the `.gitattributes` LF normalization. It SHALL point
rust-analyzer at the crate (`rust-analyzer.linkedProjects: ["rust/Cargo.toml"]`) so the editor works
from the repo root. The root `.gitignore` SHALL ignore Rust build output (`/rust/target/`). The README
SHALL describe the Cargo workflow (`cargo test`, adding crates in `Cargo.toml`).

#### Scenario: ST file associations survive the swap
- **WHEN** the Cargo scaffold is written
- **THEN** `.vscode/settings.json` still maps the kind extensions to `structured-text`, and `.gitignore` ignores `/rust/target/`

