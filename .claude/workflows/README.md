# Workflows

Saved workflows run an openspec change (or a queue of them) with agents. One executor does the work:

| File | What |
|---|---|
| `execute-change.js` | Runs one change from its `tasks.md`: status → (design) → implement → review → gate → close. Resumable: it continues at the first unticked task. |
| `run-queue.js` | Runs several changes in a fixed order, each through `execute-change`; a red stop ends the queue. |
| `frontend-conformance.js`, `transpile-restructure.js` | Thin wrappers that call `execute-change` for one change (with its `requires`). |

## The default flow — and how big its steps are

The flow is always the same (design only where a step changes a model, tests first, one review, a full gate before
every commit, a close that archives). **How big each step is** is set in ONE place: the `DEFAULTS` block at the top of
`execute-change.js`.

| Setting | Default | Meaning |
|---|---|---|
| `smallChange` | 12 | A change with at most this many open tasks (and no model step) runs as **one agent**: tests, gate, commits, close. |
| `roundTasks` | 25 | Larger changes run in rounds of at most this many tasks (one implement, one review, one gate per round). |
| `roundTasksThorough` | 15 | Round size when a change runs `thorough`. |
| `designLines` | 40 | A design section stays this short: target, choice and why, rejected options in one line each, migration. |
| `secondReview` | false | A second review round on HIGH findings. Off by default; on when `thorough`. |

**Light is the default.** The heavier process is opt-in per change: pass `{ thorough: true }` — for one run
(`Workflow execute-change { change: X, thorough: true }`) or permanently in `run-queue.js`'s `QUEUE` entry. Use it for
a change that reshapes a core model (e.g. the transpiler's pointer/string models), not for features or fixes.

To mix modes in one change, launch per section: `{ change: X, sections: ['0', '1'] }` light, then `{ change: X, sections:
['2', '3'], thorough: true }`, then a last launch with no `sections` (it closes). A launch with `sections` never closes.

Before launching a workflow, estimate its agent count and hours against the size of the work (owner rule,
2026-10-04): a small feature that gets more than about two agents is too heavy.

## Rules every run follows (in `execute-change.js`'s `RULES`)

Recordings are the oracle; tests run from the package directory; the gate and close run the full suites with
`VOLT_REQUIRE_FULL=1`; live IDEs only through `ide.ps1 -Instance <change>` with `VOLT_E2E_INSTANCE=<change>`; stage
explicit paths only; commit, never push.

## Launching

Git checks these files out with CRLF line endings, and the launch check refuses CRLF ("control characters"). Launch an
LF copy: `sed 's/\r$//' .claude/workflows/<name>.js > <scratchpad>/<name>.js`, then `Workflow({ scriptPath })`.
