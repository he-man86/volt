# @opencode-ai/volt-git

**Git-native, single-repo Volt CLI** — built from the ground up beside `volt-cli` (which stays 100%
intact as the fallback until this graduates).

The live PLC IDE is modelled as a **hidden git ref `refs/volt/ide`** inside the *project's own* git
repo; **native `git merge` does the reconciliation**. There is no separate `.volt/snapshot/` bare repo
and no custom 3-way merge engine — git is the merge. See `../volt-cli/SYNC-OPTIONS.md` (option ②) for
the architecture decision, and `IMPLEMENTATION.md` for the build tracker.

```
volt-git init     bind to the local bridge + git-init the project + first pull
volt-git pull     fetch IDE → commit refs/volt/ide → git merge into your branch
volt-git push     workspace src/ → bridge → fast-forward refs/volt/ide
volt-git status   incoming (bridge) + outgoing (git diff) + merge state
```

**Trade-off:** git won't merge a dirty tree, so you **commit before pull** (an auto-stash wrapper is a
planned fast-follow). Everything that touches the PLC (bridge wire, guardrails) and version control
(commits, branches, GitHub) is unchanged from the Volt model.

Self-contained: this package does **not** import from `volt-cli` — it carries its own copies of the
stable contracts (extension registry, bridge wire) so it can outlive volt-cli.
