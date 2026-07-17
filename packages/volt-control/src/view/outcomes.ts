/**
 * The pull/push outcome → next-action decision, once. Both frontends render this descriptor with their
 * native dialogs instead of re-deriving "conflict → open / refused → force / rejected → pull-first ‖ force".
 * Node-free (types only) so it ports to either shell. The shell keeps the raw outcome in scope and, given the
 * chosen action tag, dispatches the matching handler — so the descriptor carries decisions, not UI or payloads.
 */
import type { PullOutcome, PushOutcome } from "../bridge/actions.js"

export type OutcomeTone = "info" | "warn" | "error"

/** A follow-up the shell may offer. `destructive` ⇒ the shell should confirm (modal) before running it. */
export type OutcomeActionTag = "open-conflicts" | "force-pull" | "pull-first" | "force-push"
export interface OutcomeAction {
  tag: OutcomeActionTag
  label: string
  destructive?: boolean
}

export interface OutcomeView {
  tone: OutcomeTone
  message: string
  actions: OutcomeAction[]
}

const OPEN_CONFLICTS: OutcomeAction = { tag: "open-conflicts", label: "Open Conflicts" }
const FORCE_PULL: OutcomeAction = { tag: "force-pull", label: "Force Pull", destructive: true }
const PULL_FIRST: OutcomeAction = { tag: "pull-first", label: "Pull First" }
const FORCE_PUSH: OutcomeAction = { tag: "force-push", label: "Force Push", destructive: true }

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
