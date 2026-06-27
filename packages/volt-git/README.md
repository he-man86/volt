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
volt-git pull     auto-commit local edits → fetch IDE → git merge onto your branch
volt-git push     auto-commit local edits → push HEAD → land refs/remotes/volt/ide on HEAD
volt-git status   incoming (bridge) + outgoing (committed HEAD vs the ref) + merge state
```

**Simple flow:** `volt push` and `volt pull` are the only commands you need — each auto-commits your
working changes first (no manual `git commit`), so the engine always operates on committed state. A clean
tree commits nothing, so committing by hand keeps full control. Everything that touches the PLC (bridge
wire, guardrails) and version control (commits, branches, GitHub) is unchanged from the Volt model.

Self-contained: this package carries its own copies of the stable contracts (extension registry,
bridge wire), with no cross-package imports.
