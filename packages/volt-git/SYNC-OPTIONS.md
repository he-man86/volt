# Volt sync storage & merge — architecture options

How the workspace text stays reconciled with the live IDE has **three viable shapes**. This doc
specifies each, the workflow it produces, and the implementation impact — so we can pick deliberately.

> **Scope.** This is *only* about the middle band of the system (where the IDE baseline lives + who
> merges). The two outer bands never change and are not in scope:
> - **IDE I/O** (fetch/apply items, item⇄text translation, guardrails: `ifVersion`, read-only items,
>   `structureVersion`, vendor asymmetries) → **always the Volt bridge.** Git can't drive a PLC.
> - **Version control** (commit / branch / push to GitHub) → **always plain git.**
> - **UI** → a small Volt toolbar (Pull / Push / Build / health) bolted onto opencode's git panel
>   (Phase 2). **Identical in all three options** — opencode renders the file list, diffs, and
>   conflict markers; Volt only adds the IDE-action buttons + a bridge probe for the "N incoming" badge.

Phase 1 (`volt init` git-inits the project root) is the prerequisite for all of this — it makes the
text a real git repo so opencode + git tooling can see it. **Already shipped.**

---

## The two axes

Everything below is a combination of two independent choices:

1. **Repo count** — where the IDE baseline (the "last synced state") is stored:
   - a **separate** `.volt/snapshot/` bare repo, or
   - **inside the project repo** (a branch or a hidden ref).
2. **Merge engine** — who reconciles when both the IDE and the workspace changed:
   - Volt's **custom engine** (merges a *dirty* working tree → no commit needed), or
   - **`git merge`** (needs a *clean* tree → commit-before-pull).

|  | custom engine | `git merge` |
|---|---|---|
| **2 repos** | ① **today** | — (pointless) |
| **1 repo** | ③ sweet spot | ② **full git** |

---

## Option ① — Today (2 repos · custom engine)

```
┌─ .git  (root) ──────────┐   ┌─ .volt/snapshot/ ───────┐
│ your commits            │   │ the IDE baseline        │
│ text blobs  ███████     │   │ text blobs  ███████ ←dup│
└─────────────────────────┘   └─────────────────────────┘
```

- **Baseline:** `.volt/snapshot/` bare repo, `refs/heads/main` + `state.json#commitSha`.
- **Status / merge / log:** Volt's own code (`snapshot/`, `merge/engine.ts`, `volt log`).
- **Workflow:** edit freely → `volt pull` merges your *uncommitted* edits → `volt push` → commit
  *whenever you want*. **Never need to commit to sync.**
- **Pros:** total isolation (the user's git physically cannot see Volt's baseline); most forgiving UX.
- **Cons:** the text is stored **twice**; `merge/engine.ts` is the most complex code we own;
  `isBareRepoAt` plumbing exists only to handle "a bare repo nested in a working tree."
- **Implementation impact:** none — this is what ships.

---

## Option ② — Full git (1 repo · `git merge`)  ← leaning

```
┌─ .git  (root) ─────────────────────────────┐
│  branch  main      → your work             │
│  branch  volt/ide  → the IDE baseline      │
│  text blobs  ███████   (shared, stored ONCE)│
└────────────────────────────────────────────┘
```

The IDE is modelled as a **local branch `volt/ide`** — one deterministic commit per sync.

- **`volt pull`** = mirror the live IDE onto `volt/ide` (deterministic commit) → **`git merge volt/ide`**
  into your branch.
- **`volt push`** = your tree → IDE (bridge + guardrails) → fast-forward `volt/ide` to match.
- **`volt status`** = `git rev-list main..volt/ide` (incoming) + `git diff volt/ide` (outgoing).
- **History** = `git log volt/ide`.

### Workflow feel (the thing to evaluate)

Day in the life:
1. `git clone` the repo → `volt init` (binds *your* IDE; `git init` is a no-op on a clone).
2. Edit `POU_A.st` in opencode.
3. **Push to the IDE** → `volt push`. *No commit needed* (push doesn't merge; it only fast-forwards
   the `volt/ide` branch, not your working branch).
4. **Pull IDE changes** → here's the catch: if you have **uncommitted edits**, you must
   **`git commit` (or stash) first**, because `git merge` refuses a dirty tree. On a clean tree, pull
   is instant.
5. Conflict → standard git conflict markers → resolve → `git add` → finish.
6. Commit milestones + `git push` to share with the team.

So the **only** friction vs today is **step 4 when you have local edits**. It does *not* bite when you
push, when you pull on a clean tree, or when only the IDE changed.

**Two ways to soften step 4** (each adds a little orchestration back):
- **Auto-stash:** `volt pull` does `git stash → git merge volt/ide → git stash pop`. Hides the commit
  requirement entirely — *but* `stash pop` can itself conflict, so you re-add a thin resume path.
- **Auto-WIP-commit:** commit the dirty tree to a throwaway `wip` commit, merge, let the user squash.
  Visible but trivial.

> Verdict on feel: with **auto-stash**, ② feels ~like today (pull anytime) at the cost of a little
> orchestration. **Without** it, ② asks for "commit before pull" — clean git hygiene, but a habit
> change for non-git-fluent PLC engineers.

### Pros
- **Deletes the most custom code we own:** `merge/engine.ts` (+ the `MERGE_HEAD`/`--continue`/`--abort`
  resume protocol) → `git merge`; most of `snapshot/` → it's just a branch; custom status → `git diff`;
  `volt log` → `git log`.
- **One repo, text stored once** (no duplication; the `isBareRepoAt` plumbing goes away).
- The merge is a **real git merge** — opencode/git tooling can see it.

### Cons / risks
- **Commit-before-pull** (unless auto-stash) — the headline UX change.
- **Entanglement:** `volt/ide` + deterministic IDE commits live in the user's repo — visible in
  `git log --all` / `git branch -a`, user-deletable, and **must never be pushed** (each engineer's IDE
  differs). Mitigate by keeping it under `refs/volt/*` (not pushed by `git push`) rather than a normal
  branch, and educating that it's machine-local.
- **Migration:** existing `.volt/snapshot/` workspaces must be converted to the branch model.

### Implementation impact
- **Delete:** `merge/engine.ts`, most of `snapshot/repo.ts` + `snapshot/workspace.ts` (snapshot repo),
  `commands/merge.ts`, custom diff in `commands/status.ts`, `commands/log.ts`.
- **Rewrite:** `commands/pull.ts` (fetch → commit to `volt/ide` → `git merge`), `commands/push.ts`
  (apply to IDE → ff `volt/ide`), `commands/status.ts` (git queries).
- **Keep untouched:** `bridge/*`, item⇄text translation, the guardrails (in push), corpus/scaffold,
  Phase-1 `ensureRepo`.
- **New (small):** `volt/ide` ref management, the clean-tree guard (+ optional auto-stash).
- **Net:** a significant rewrite of the sync core, but it **removes more than it adds** — the engine and
  the second repo are the bulk of today's complexity.

---

## Option ③ — Sweet spot (1 repo · custom engine · hidden ref)

```
┌─ .git  (root) ─────────────────────────────┐
│  your commits                              │
│  refs/volt/baseline → IDE baseline (hidden)│
│  text blobs  ███████   (shared, stored ONCE)│
└────────────────────────────────────────────┘
   .volt/ → config + merge state   (no second repo)
```

Move the baseline from a **separate bare repo** into a **hidden ref** in the project repo, but **keep
the custom forgiving engine** (it reads its base tree from the ref; keeps merge state in `.volt/` plain
files, never touching git's `MERGE_HEAD`).

- **Workflow feel:** identical to today — **pull anytime, never commit.**
- **Pros:** one repo, **text stored once**, and **no commit-before-pull**. Strictly less storage than
  today with the same UX.
- **Cons:** the baseline ref + objects live inside the user's repo (mild entanglement: visible to
  `git for-each-ref`, user-deletable → `pull` rebuilds it). Less than ②'s entanglement (no branch, no
  merge-state in `.git`), more than today's hard isolation.
- **Implementation impact (smallest of the changes):**
  - **Change:** `snapshot/` writes objects to the **project repo** under `refs/volt/baseline` instead of
    a bare `.volt/snapshot/`; merge state moves to `.volt/` plain files.
  - **Keep:** `merge/engine.ts`, status, log — all unchanged (they just read the base from the ref).
  - **Net:** a targeted change to *where* the snapshot stores, not *how* it merges. Lowest risk.

---

## Full comparison

| | ① today | ② full git | ③ sweet spot |
|---|---|---|---|
| repos | **2** | **1** | **1** |
| text on disk | twice | once | once |
| baseline lives in | `.volt/snapshot/` repo | `volt/ide` branch | `refs/volt/baseline` ref |
| who merges | Volt engine | **`git merge`** | Volt engine |
| status / log | Volt | `git diff` / `git log` | Volt / `git log` |
| commit before pull? | no | **yes** (or auto-stash) | no |
| isolation | total | shared (branch) | shared (hidden ref) |
| custom code | most | **least** | medium |
| UI work | Phase-2 toolbar | Phase-2 toolbar | Phase-2 toolbar |
| IDE I/O + guardrails | Volt bridge | Volt bridge | Volt bridge |
| impl effort | — (current) | high (rewrite, net-delete) | low (relocate storage) |
| migration | — | yes | yes (lighter) |

---

## How to evaluate ② (leaning choice)

1. **Prototype exists:** `scratchpad/proto-git-sync.ts` runs the four reconciliation scenarios through
   native `git merge` (auto-merge, conflict, dirty-tree refusal). `bun proto-git-sync.ts`.
2. **Next step to *feel* it:** wire ② into the real CLI behind a `--git-merge` flag (pull/push/status
   only), keep ① as default. Run a week of real edits on a throwaway workspace and judge step-4 friction.
3. **Decision gate:** is **commit-before-pull** acceptable (or is **auto-stash** good enough)? If yes →
   ② is the cleanest, least-code design and gives the single repo you want. If the friction grates and
   auto-stash feels too magic → **③** gives you the single repo *without* the friction, at a fraction
   of the implementation cost.

> Recommendation: if "one repo" is the goal, **both ② and ③ deliver it.** ② is the boldest
> (most code deleted, git-native merge, commit-before-pull); ③ is the safe path to the same single-repo
> win while keeping today's forgiving UX. Prototype ② behind a flag before committing to the rewrite.
