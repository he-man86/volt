# @opencode-ai/volt-git

> Git-native, single-repo Volt CLI — the `volt` command that syncs IEC 61131-3 PLC projects as version-controllable text.

The `volt` command (`init` · `pull` · `push` · `status` · `build` · `log` · `show` · `merge`). It models the live PLC IDE as a git remote-tracking branch inside the project's own repo, so syncing the IDE is native `git fetch`/`merge`/`push` — no custom 3-way merge engine and no separate snapshot store.

## Role in Volt

```
live PLC IDE  ──HTTP──  bridge (C#)  ──HTTP wire──  volt-git (TS)  ──>  git repo of text files
 CODESYS / TwinCAT       per-vendor                  init/pull/push          analyzed by volt-lsp-codesys
                                                     status/build/log         edited in volt-vscode
```

volt-git sits between two things it talks to: the **bridge** (a local daemon exposing one live IDE over a small HTTP wire) and the **git repo** of `src/` text it materializes from that IDE. It pulls items from the bridge into `src/` for `volt-lsp-codesys` to analyze and `volt-vscode` to edit, and pushes committed `src/` edits back to the IDE. It depends only on the `Remote` interface (`bridge/client.ts`), so the wire — not the vendor driver — is the boundary. Self-contained: it carries its own copies of the stable contracts (extension registry, bridge wire) with no cross-package imports beyond `@opencode-ai/volt-lsp-codesys` (the language-reference corpus installed at `init`).

## How it works

The live IDE is a git **remote-tracking branch `refs/remotes/volt/ide`** (shown in the graph as `volt/ide` — the IDE *is* a remote you fetch+merge on pull, push to on push). Each `volt/ide` commit's tree is the user's branch tree with only `src/` swapped for the IDE's state, so a merge never touches the scaffold. Living under `refs/remotes/` keeps it visible locally but never pushed to a real origin.

- **The engine operates on committed history.** `pull` and `push` diff git refs (`refs/remotes/volt/ide` ↔ `HEAD`), never the working tree — only committed work syncs to the IDE, the same way `git push` only sends commits. To make this ergonomic, `pull`/`push` first run `autoCommitSrc` (auto-commit of any dirty `src/` so HEAD is current); a clean tree commits nothing, so committing by hand keeps full control over message/granularity.
- **`status` and `show` read the working tree.** `status`'s outgoing axis diffs the *working tree* (incl. untracked files) against `volt/ide`, so an edit surfaces the moment you save — committed or not. `show WORKSPACE` returns the live working file. (This is the live view; `push` still sends committed HEAD after auto-commit.)
- **Native `git merge` reconciles.** `pull` commits the fetched IDE tree onto the `volt/ide` chain, then `git merge`s it into the current branch: no local edits → fast-forward; local edits → one merge commit (or conflict markers resolved with `git merge --continue`/`--abort`, then re-run `volt pull`). A dirty tree is never merged (auto-commit clears it first).
- **One declarative push wire.** Each diff row (add / modify / delete / rename / move, in any combination) becomes exactly one `set` or `deleteItem` op, each carrying an `ifVersion` optimistic-concurrency guard; the bridge applies them atomically. Read-only items (`.cfc`/`.sfc`/…) are refused.
- **The `.git/volt/` sidecar.** Volt's machine-local state lives *inside* `.git/` (so git never tracks it): `config.json` (the bridge binding — platform + project names) and `ide-refs.json` (the optimistic-concurrency baseline: what the IDE last had). There is no visible `.volt/` directory.
- **Port resolution.** The bridge port resolves from `--port`, then `VOLT_BRIDGE_PORT`, then the workspace binding (`.git/volt/config.json`, recorded at `init`), defaulting to `8555`. Per-vendor convention: CODESYS `8556`, Beckhoff `8555`.

## Commands

```bash
volt init     # bind to the bridge, git-init the project, scaffold + install the ST corpus, first pull
volt pull     # auto-commit src → fetch the IDE → git merge into your branch   [--force] [--dry-run] [--json]
volt push     # auto-commit src → push HEAD → fast-forward refs/remotes/volt/ide
              #   [--force] [--dry-run] [--force-with-lease=<v>] [--json]
volt status   # incoming (IDE) / outgoing (working tree) / merge state         [--json] [--porcelain]
volt build    # build via the IDE; returns diagnostics                         [--full] [--json]
volt log      # the IDE-sync history (commits on refs/remotes/volt/ide)        [--json] [--limit N]
volt show     # a file at a ref:  <ref> <path>
              #   HEAD | VOLTIDE | WORKSPACE | MERGE_OURS|THEIRS|BASE | BRIDGE | <any git ref>
volt merge    # finish a conflicted pull:  --continue | --abort | --resolve <path> [--use-ours|--use-theirs]

# flags: --workspace <dir>  --port <n>
```

```bash
bun typecheck   # tsgo --noEmit
bun test        # bun test runner (cd into the package — tests can't run from repo root)
bun run build   # tsc -> dist/ (also runs on prepare; the bin is ./dist/bin.js)
```

## Layout

| Path | Role |
|---|---|
| `src/bin.ts` | CLI entry — parses args, resolves the port, dispatches each verb, renders the result, sets the exit code. |
| `src/sync/` | The sync engine: `pull.ts`, `push.ts`, `status.ts`, `refs.ts` (the `refs/remotes/volt/ide` model + sidecar baseline), `diff.ts`, `types.ts`. |
| `src/git/plumbing.ts` | The only place that shells out to `git` — object-store ops (build the `volt/ide` tree) + worktree ops (status/merge/diff/auto-commit). |
| `src/translate/materialize.ts` | Item ⇄ file translation: one IDE item = one src-relative file (pure path/content mapping; the bridge already materialized editable FBD/LD as VG text, CFC/SFC read-only). |
| `src/registry/extensions.ts` | The single flat table of tracked extensions + their default access (`st`/`fbd`/`ld`/`itf` rw, `cfc`/`sfc` read-only). |
| `src/config/workspace.ts` | The `.git/volt/` workspace binding — config paths, load/save, binding verification, configured-port lookup. |
| `src/workspace/files.ts` | `src/` file IO + the root `.gitignore`/`.gitattributes`; src-relative path helpers. |
| `src/bridge/client.ts`, `src/bridge/types.ts` | `BridgeClient` (schema-validated loopback HTTP) + the `Remote` interface and wire types. |
| `src/show.ts` | `volt show` — raw file bytes at a ref (git refs, the IDE baseline, the live workspace/bridge, merge sides). |
| `src/log.ts` | `volt log` — the IDE-sync history off `refs/remotes/volt/ide`. |
| `src/init.ts` | `volt init` — bind, git-init, write config, scaffold, install the corpus, first pull. |
| `src/scaffold.ts` | Turns a Volt-bound directory into a Bun project (package.json, tsconfig, bunfig, README, `.vscode`, example test); idempotent. |

## See also

- [`./SYNC-OPTIONS.md`](./SYNC-OPTIONS.md) — the sync-model decision record (why the IDE-as-remote-branch option won).
- [`../../VOLT-DESIGN.md`](../../VOLT-DESIGN.md) — Volt design, roadmap, and decision log.
- [`../../CLAUDE.md`](../../CLAUDE.md) — repo guidance + the fork-surface map.
- [`../volt-bridge/ARCHITECTURE.md`](../volt-bridge/ARCHITECTURE.md) — the bridge on the other side of the HTTP wire.
