## Why

`volt-git`'s git-native sync engine is shipped: the live IDE modeled as a git remote-tracking
branch (`refs/remotes/volt/ide`), `pull`/`push` reconciled through native `git merge` on
committed HEAD, auto-commit, `status`/diff on the working tree, the `.git/volt` sidecar. Tested
mock + live (CODESYS 8556 / TwinCAT 8555). Walk it and capture as `ide-sync`.

## What Changes

- Author `specs/ide-sync/spec.md` — IDE-as-remote, operate-on-committed-HEAD (view follows the
  working tree), native-merge reconciliation, one declarative push wire with `ifVersion` guards,
  the `.git/volt` sidecar, port resolution. Folds D11 (and D4 for the control split).

## Capabilities

### New Capabilities
- `ide-sync`: the IDE is a git remote; `pull`/`push` operate on committed HEAD via native `git merge`; the view reads the working tree.

## Impact

Spec/docs only. Source of truth: `packages/volt-git/README.md` + `SYNC-OPTIONS.md`, D11.
