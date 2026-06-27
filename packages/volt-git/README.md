# @opencode-ai/volt-git

**Git-native, single-repo Volt CLI** — the `volt` command for syncing IEC 61131-3 PLC projects as
version-controllable text.

The live PLC IDE is modelled as a git **remote-tracking branch `refs/remotes/volt/ide`** (shown in the
graph as `volt/ide` — the IDE *is* a remote you fetch+merge on pull / push to on push) inside the
*project's own* git repo; **native `git merge` does the reconciliation**. There is no separate
`.volt/snapshot/` bare repo and no custom 3-way merge engine — git is the merge. The engine reads/writes
**committed** git state, never the working tree (see below). See `SYNC-OPTIONS.md` (option ②).

```
volt-git init     bind to the local bridge + git-init the project + first pull
volt-git pull     fetch IDE → commit refs/remotes/volt/ide → git merge into your branch
volt-git push     commit first → HEAD → bridge → fast-forward refs/remotes/volt/ide
volt-git status   incoming (bridge) + outgoing (committed HEAD vs the ref) + merge state
```

**Trade-off:** git won't merge a dirty tree, so you **commit before pull** (an auto-stash wrapper is a
planned fast-follow). Everything that touches the PLC (bridge wire, guardrails) and version control
(commits, branches, GitHub) is unchanged from the Volt model.

Self-contained: this package carries its own copies of the stable contracts (extension registry,
bridge wire), with no cross-package imports.
