/**
 * The pull/push outcome → next-action decision, once. Both frontends render this descriptor with their
 * native dialogs instead of re-deriving "conflict → open / refused → force / rejected → pull-first ‖ force".
 * Node-free (types only) so it ports to either shell. The shell keeps the raw outcome in scope and, given the
 * chosen action tag, dispatches the matching handler — so the descriptor carries decisions, not UI or payloads.
 */
import type { PullOutcome, PushOutcome } from "../bridge/actions.js"

export type OutcomeTone = "info" | "warn" | "error"

/** A follow-up the shell may offer. `destructive` ⇒ `presentOutcome` confirms (modal) before running it, using
 *  `confirmMessage` — so the "cannot be undone" copy lives here, once, not re-written per shell. */
export type OutcomeActionTag = "open-conflicts" | "force-pull" | "pull-first" | "force-push"
export interface OutcomeAction {
  tag: OutcomeActionTag
  label: string
  destructive?: boolean
  confirmMessage?: string
}

export interface OutcomeView {
  tone: OutcomeTone
  message: string
  actions: OutcomeAction[]
}

const OPEN_CONFLICTS: OutcomeAction = { tag: "open-conflicts", label: "Open Conflicts" }
/** The canonical force descriptors (with their "cannot be undone" confirm copy) — exported so a shell's
 *  direct "Force Pull/Push" command reuses the SAME confirm as the outcome-driven path. */
export const FORCE_PULL: OutcomeAction = {
  tag: "force-pull",
  label: "Force Pull",
  destructive: true,
  confirmMessage: "Force pull discards your local workspace edits and overwrites them with the IDE's state. This cannot be undone.",
}
const PULL_FIRST: OutcomeAction = { tag: "pull-first", label: "Pull First" }
export const FORCE_PUSH: OutcomeAction = {
  tag: "force-push",
  label: "Force Push",
  destructive: true,
  confirmMessage: "Force push overwrites the IDE with your workspace, ignoring changes the engineer made since your last pull. This cannot be undone.",
}

export function describePull(outcome: PullOutcome): OutcomeView {
  switch (outcome.kind) {
    case "ok":
      return { tone: "info", message: `Pulled ${outcome.synced.length} file(s) from the IDE.`, actions: [] }
    case "error":
      return { tone: "error", message: `volt pull failed: ${outcome.message}`, actions: [] }
    case "refused":
      return { tone: "warn", message: `volt: ${outcome.reason}`, actions: [FORCE_PULL] }
    case "conflict":
      return {
        tone: "warn",
        message: `Pull hit ${outcome.paths.length} conflict(s) with the IDE. Resolve them with your editor's merge tools, commit, then Pull again to finish.`,
        actions: [OPEN_CONFLICTS],
      }
  }
}

export function describePush(outcome: PushOutcome): OutcomeView {
  switch (outcome.kind) {
    case "ok":
      return { tone: "info", message: `Pushed ${outcome.items.length} item(s) to the IDE.`, actions: [] }
    case "error":
      return { tone: "error", message: `volt push failed: ${outcome.message}`, actions: [] }
    case "rejected":
      return { tone: "warn", message: `volt: ${outcome.reason}`, actions: [PULL_FIRST, FORCE_PUSH] }
  }
}

/** The shell's platform primitives. volt-control owns the FLOW (filter by capability → confirm-if-destructive →
 *  dispatch); the shell only shows dialogs. Injecting these keeps the destructive-confirm and action routing in
 *  ONE place, so both UIs behave identically (e.g. neither can skip the "cannot be undone" confirm). */
export interface OutcomePresenter {
  /** Show the message + the (already capability-filtered) action buttons; resolve to the chosen tag, or
   *  undefined if dismissed. Must handle the zero-action case (just surface the message). */
  choose(view: OutcomeView): Promise<OutcomeActionTag | undefined>
  /** Confirm a destructive action with a modal; resolve true to proceed. */
  confirm(action: OutcomeAction): Promise<boolean>
}

/** Render an outcome and dispatch the chosen action — shared by both shells. Filters to `capabilities` (the
 *  desktop has no merge editor, so it omits `open-conflicts`), confirms destructive actions, then runs. The
 *  shell supplies only the dialog primitives (`presenter`) and the per-tag handlers (`run`). */
export async function presentOutcome(
  view: OutcomeView,
  presenter: OutcomePresenter,
  run: (tag: OutcomeActionTag) => Promise<void>,
  capabilities?: ReadonlySet<OutcomeActionTag>,
): Promise<void> {
  const actions = capabilities === undefined ? view.actions : view.actions.filter((a) => capabilities.has(a.tag))
  const tag = await presenter.choose({ ...view, actions })
  if (tag === undefined) return
  const action = actions.find((a) => a.tag === tag)
  if (action === undefined) return
  if (action.destructive === true && !(await presenter.confirm(action))) return
  await run(tag)
}
