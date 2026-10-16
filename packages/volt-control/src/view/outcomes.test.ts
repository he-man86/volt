import { expect, test } from "bun:test"
import { presentOutcome, rebindConfirmation, FORCE_PULL, FINISH_MERGE, type OutcomePresenter, type OutcomeView, type OutcomeActionTag, type Confirmation } from "./outcomes.js"

// A presenter that records what it was shown and answers with a fixed choice + confirm.
function presenter(pick: OutcomeActionTag | undefined, confirmed: boolean) {
  const shown: OutcomeView[] = []
  const confirms: Confirmation[] = []
  const p: OutcomePresenter = {
    choose: async (view) => {
      shown.push(view)
      return pick
    },
    confirm: async (action) => {
      confirms.push(action)
      return confirmed
    },
  }
  return { p, shown, confirms }
}

const view: OutcomeView = { tone: "warn", message: "m", actions: [FORCE_PULL, FINISH_MERGE] }

test("an action the shell has no handler for is not offered, and cannot be dispatched", async () => {
  const { p, shown } = presenter("force-pull", true)
  let ran = false
  await presentOutcome(view, p, { "finish-merge": async () => void (ran = true) })
  expect(shown[0]?.actions.map((a) => a.tag)).toEqual(["finish-merge"])
  expect(ran).toBe(false) // force-pull was chosen but has no handler: nothing runs
})

test("a destructive action confirms first; a declined confirm runs nothing", async () => {
  for (const confirmed of [true, false]) {
    const { p, confirms } = presenter("force-pull", confirmed)
    let ran = false
    await presentOutcome(view, p, { "force-pull": async () => void (ran = true) })
    expect(confirms).toEqual([FORCE_PULL])
    expect(ran).toBe(confirmed)
  }
})

test("a non-destructive action runs without a confirm", async () => {
  const { p, confirms } = presenter("finish-merge", false)
  let ran = false
  await presentOutcome(view, p, { "finish-merge": async () => void (ran = true) })
  expect(confirms).toEqual([])
  expect(ran).toBe(true)
})

test("the rebind confirm names the project it re-points to", () => {
  const c = rebindConfirmation("MyMachine_v2")
  expect(c.label).toBe("Rebind")
  expect(c.confirmMessage).toContain("“MyMachine_v2”")
  expect(c.confirmMessage).toContain("Only the binding changes")
})
