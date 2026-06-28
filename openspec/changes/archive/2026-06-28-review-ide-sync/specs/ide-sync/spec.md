## ADDED Requirements

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
then the workspace binding (default CODESYS `8556`, Beckhoff `8555`).

#### Scenario: No tracked workspace directory
- **WHEN** a project is initialized with `volt init`
- **THEN** the binding is written under `.git/volt/` and nothing is added to the tracked tree
