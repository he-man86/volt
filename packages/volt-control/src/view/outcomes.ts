/**
 * The pull/push outcome → next-action decision, once. Both frontends render this descriptor with their
 * native dialogs instead of re-deriving "conflict → open / refused → force / rejected → pull-first ‖ force".
 * Node-free (types only) so it ports to either shell. The shell keeps the raw outcome in scope and, given the
 * chosen action tag, dispatches the matching handler — so the descriptor carries decisions, not UI or payloads.
 */
import type { PullOutcome, PushOutcome, MergeOutcome } from "../bridge/actions.js"
import { changeCount, type StatusJson } from "./types.js"

export type OutcomeTone = "info" | "warn" | "error"

/** A follow-up the shell may offer. `destructive` ⇒ `presentOutcome` confirms (modal) before running it, using
 *  `confirmMessage` — so the "cannot be undone" copy lives here, once, not re-written per shell. */
export type OutcomeActionTag = "open-conflicts" | "force-pull" | "pull-first" | "force-push" | "finish-merge" | "abort-merge"
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
/** Finish the in-progress merge (`volt merge --continue`): stages resolutions, commits, and advances the IDE
 *  baseline — so status/push are correct immediately, no follow-up pull. */
export const FINISH_MERGE: OutcomeAction = { tag: "finish-merge", label: "Finish Merge" }
export const ABORT_MERGE: OutcomeAction = {
  tag: "abort-merge",
  label: "Abort Merge",
  destructive: true,
  confirmMessage: "Abort discards this merge and restores your workspace to before the pull. Your in-merge edits are lost. This cannot be undone.",
}

/** The two endings of a Connect/Reconnect (declaring THIS window's interest), described ONCE. The failure text is
 *  the session client's — it knows WHY (connector down vs the project not open). */
export function describeConnect(r: { ok: boolean; message?: string }): OutcomeView {
  if (!r.ok) return { tone: "error", message: r.message ?? "Reconnect failed.", actions: [] }
  return { tone: "info", message: "Connected — syncing with the IDE.", actions: [] }
}

/** The two endings of a Disconnect (dropping THIS window's interest), described ONCE so the shells can't word them
 *  differently. In the session model the bridge keeps serving if another window/app still wants the project, so a
 *  success is worded as "here", not a global disconnect. */
export function describeDisconnect(r: { ok: boolean }): OutcomeView {
  if (!r.ok) return { tone: "error", message: "Couldn't reach the Volt Connector — is it running?", actions: [] }
  return { tone: "info", message: "Stopped syncing this project here. The IDE stays open — connect again to resume.", actions: [] }
}

/** No shared INIT confirm, deliberately. `confirmInitMessage`/`confirmInitDetail` lived here and were never
 *  called by either shell — VS Code imported them and hardcoded its own; the desktop has none by design,
 *  because its flow is a folder PICKER and the picker plus the button is the confirmation.
 *
 *  Deleted rather than wired up, on two grounds. Their copy had gone stale: it says "set up this folder" from
 *  when init bound an existing folder, and init now CREATES one inside a chosen parent. And the `platform`
 *  parameter would print a vendor label, contradicting the vendor-blind rule both panels are tested against.
 *  Wiring them was not a refactor but a rewrite, and adding a third helper beside a dead pair is accumulation.
 *
 *  Init confirmation is host-shaped: a modal in VS Code, a folder picker on the desktop. That is the finding,
 *  not an omission to be closed later. */

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
        message: `Pull hit ${outcome.paths.length} conflict(s) with the IDE. Resolve each file (edit, or take a whole side), then Finish Merge.`,
        actions: [OPEN_CONFLICTS, FINISH_MERGE, ABORT_MERGE],
      }
  }
}

/** The `volt merge --continue|--abort` result toast. `unresolved` means markers still remain — keep resolving. */
export function describeMerge(outcome: MergeOutcome): OutcomeView {
  switch (outcome.kind) {
    case "done":
      return { tone: "info", message: outcome.message, actions: [] }
    case "unresolved":
      return { tone: "warn", message: outcome.message, actions: [OPEN_CONFLICTS, FINISH_MERGE, ABORT_MERGE] }
    case "error":
      return { tone: "error", message: `volt merge failed: ${outcome.message}`, actions: [] }
  }
}

/** `status` is the tracker's current drift — used ONLY to explain an empty push: "nothing to push" is
 *  misleading when the reason is that the IDE is ahead (the no-op push never contacts the bridge, so the CLI
 *  can't know). Given the drift, we say "pull first" with the button instead of a bare "Pushed 0 item(s)". */
export function describePush(outcome: PushOutcome, status?: StatusJson): OutcomeView {
  switch (outcome.kind) {
    case "ok": {
      if (outcome.items.length > 0)
        return { tone: "info", message: `Pushed ${outcome.items.length} item(s) to the IDE.`, actions: [] }
      const incoming = status ? changeCount(status.incoming) : 0
      if (incoming > 0)
        return {
          tone: "warn",
          message: `Nothing to push — the IDE has ${incoming} change(s) you haven't pulled yet. Pull first.`,
          actions: [PULL_FIRST],
        }
      return { tone: "info", message: outcome.message ?? "Nothing to push — the IDE already matches your workspace.", actions: [] }
    }
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
