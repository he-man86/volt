/**
 * A TASK IS EDITABLE FROM THE WORKSPACE — the first non-source item that is.
 *
 * `.task` was a read-only descriptor because access was derived from "is this assembled ST", and a scheduling
 * descriptor is not. That was never a statement about the VENDOR: every field is a live setter on CODESYS
 * (`probe-task-writable.py` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/probe-task-writable.py`) — interval, priority, event, the watchdog's four, and a call list with
 * add/insert/remove/replace), so the read-only-ness was Volt's own, and it meant an engineer could see the
 * schedule in git and change nothing about it.
 *
 * These are the three edits a workspace can express, and the third and fourth are the reason this file is not
 * just "set a field": a `.task` file ADDED is a task created, and one DELETED is a task removed. Neither needed
 * new push machinery — a delete op was always generic — but neither could be BUILT for a read-only kind.
 *
 * BOTH VENDORS, deliberately. This file skipped TwinCAT while that driver refused the write, and the skip
 * outlived the refusal — which is the failure mode a vendor gap actually has: the capability lands and the
 * suite that would prove it stays switched off. The two vendors reach a schedule by routes that share nothing
 * (CODESYS sets live properties; TwinCAT patches the SYSTEM task its PLC task links to and rebuilds the call
 * children — DIALECT C19 / C19b), so a pass on one and a fail on the other is exactly the signal worth having.
 *
 * Where they legitimately differ is NARROW and named here rather than skipped: the folder a task lives in, and
 * the three fields TwinCAT cannot schedule at all (a non-Cyclic type, an event, a watchdog). Everything else —
 * the descriptor bytes, the edit, the call list, create and delete, a non-canonical form written — is asserted
 * identically on both.
 */
import { describe, it, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { bridge, id, fid, pushOps, fetchItem, requireHealthy, BASE, VENDOR, folderOf, inFolder, mainProgram, fileOf } from "../harness"

// CODESYS drills tasks out of a task-configuration container; a TwinCAT task sits at the PLC project root. The folder is
// READ from where the fixture's own task lives, never spelled: the container's name is the project's - `Task
// Configuration` from the template of 3.5.21.40, `TaskConfiguration` in the 3.5.18.30 fixture (its scripting names it so
// and refuses the other name, environment-dependency-audit 2.5b), `Taskkonfiguration` from a German template.
async function taskFolder(): Promise<string> {
	const r = await bridge.refs()
	const task = Object.keys(r.items ?? {}).find((n) => n.endsWith(".task"))
	expect(task, "the fixture project has no task to place a new one beside").toBeDefined()
	return folderOf(task!)
}

describe(`items / a task is writable (${BASE})`, () => {
	setDefaultTimeout(180_000)
	beforeAll(async () => {
		await requireHealthy()
	})

	const refs = async () => await bridge.refs()
	const versionOf = async (name: string) => (await refs()).items[name] ?? null
	const clean = async (name: string) => {
		const v = await versionOf(name)
		if (v !== null) await pushOps([{ op: "deleteItem", name, ifVersion: v }])
	}

	/** The one task every fixture project has, whatever it is called. */
	async function anyTask(): Promise<string> {
		const names = Object.keys((await refs()).items ?? {}).filter((n) => n.endsWith(".task"))
		expect(names.length, "the fixture project has no task to edit").toBeGreaterThan(0)
		return names[0]!
	}

	it("a task's descriptor round-trips unchanged — it was already correct, now it is also writable", async () => {
		// The read side moved onto the shared format when the write side appeared. This is the check that the
		// move changed no bytes: these are hashed into the item version, so a re-flow is a diff in every repo.
		const name = await anyTask()
		const before = (await fetchItem(name)).sourceText
		const r = await pushOps([{ op: "set", name, sourceText: before, ifVersion: await versionOf(name) }])
		expect(r.accepted, `pushing a task its own bytes was refused: ${JSON.stringify(r.conflicts)}`).toBe(true)
		expect((await fetchItem(name)).sourceText).toBe(before)
	})

	it("an EDITED field reaches the IDE and comes back", async () => {
		const name = await anyTask()
		const original = (await fetchItem(name)).sourceText

		// Priority is the safest field to move: it changes no timing and every task has one.
		const current = /^Priority:\s*(\S+)/m.exec(original)
		expect(current, `no Priority line in:\n${original}`).not.toBeNull()
		const changed = current![1] === "9" ? "8" : "9"
		const edited = original.replace(/^(Priority:\s*)\S+/m, `$1${changed}`)

		try {
			const r = await pushOps([{ op: "set", name, sourceText: edited, ifVersion: await versionOf(name) }])
			expect(r.accepted, `push refused: ${JSON.stringify(r.conflicts)}`).toBe(true)

			const back = (await fetchItem(name)).sourceText
			expect(back).toContain(`Priority:  ${changed}`)
			// …and NOTHING ELSE moved. A descriptor write that reshapes the rest of the schedule would be far
			// worse than one that refuses.
			expect(back).toBe(edited)
		} finally {
			await pushOps([{ op: "set", name, sourceText: original, ifVersion: await versionOf(name) }])
		}
	})

	it("the CALL LIST is content: a POU added to it runs, and the order is kept", async () => {
		const name = await anyTask()
		const original = (await fetchItem(name)).sourceText
		const main = await mainProgram()
		expect(main, "no main program to schedule").not.toBeNull()
		const pou = fileOf(main!).replace(/\.[^.]+$/, "")

		// Rewrite the Calls line to exactly this one POU — the list is a sequence, so replacing it is the honest
		// way to assert the whole of it rather than that an entry happens to be present.
		const withCalls = /^Calls:/m.test(original)
			? original.replace(/^Calls:.*$/m, `Calls:     ${pou}`)
			: original.trimEnd() + `\nCalls:     ${pou}\n`

		try {
			const r = await pushOps([{ op: "set", name, sourceText: withCalls, ifVersion: await versionOf(name) }])
			expect(r.accepted, `push refused: ${JSON.stringify(r.conflicts)}`).toBe(true)
			expect((await fetchItem(name)).sourceText).toBe(withCalls)
		} finally {
			await pushOps([{ op: "set", name, sourceText: original, ifVersion: await versionOf(name) }])
		}
	})

	/**
	 * A priority no OTHER task holds. TwinCAT schedules by priority and will not seat two tasks on the same one:
	 * asking for a taken slot leaves the new task where the IDE put it, which reads as "the write did not take"
	 * and is really "you asked for something the vendor forbids". Found live — the original literal `20` is the
	 * priority the fixture's own PlcTask already runs at. CODESYS does not care, so deriving it is correct on
	 * both rather than a TwinCAT special case.
	 */
	async function freePriority(): Promise<number> {
		const taken = new Set<number>()
		for (const n of Object.keys((await refs()).items ?? {}).filter((x) => x.endsWith(".task")))
			for (const m of (await fetchItem(n)).sourceText.matchAll(/^Priority:\s*(\d+)/gm)) taken.add(Number(m[1]))
		for (let p = 30; p < 90; p++) if (!taken.has(p)) return p
		throw new Error(`no free task priority: ${[...taken].join(", ")}`)
	}

	it("a NEW .task file creates a real task, and DELETING it removes one", async () => {
		const name = inFolder(await taskFolder(), fid("task_new", "task"))
		await clean(name)

		// A watchdog that is off: TwinCAT holds the flag alone; CODESYS keeps its time, unit and sensitivity behind it, so
		// the line states them and a bare `off` is refused there by name (openspec bridge-one-to-one §3).
		const watchdog = VENDOR === "codesys" ? "off '' ms (sensitivity 1)" : "off"
		const body = `Type:      Cyclic\nInterval:  100 ms\nPriority:  ${await freePriority()}\nWatchdog:  ${watchdog}\n`
		const created = await pushOps([{ op: "set", name, sourceText: body, ifVersion: null }])
		expect(created.accepted, `create refused: ${JSON.stringify(created.conflicts)}`).toBe(true)

		// It is a real task the IDE now schedules, not a file on the side: it comes back through `refs` and
		// materializes with the settings it was given.
		expect(await versionOf(name)).not.toBeNull()
		expect((await fetchItem(name)).sourceText).toBe(body)

		const removed = await pushOps([{ op: "deleteItem", name, ifVersion: await versionOf(name) }])
		expect(removed.accepted, `delete refused: ${JSON.stringify(removed.conflicts)}`).toBe(true)
		expect(await versionOf(name)).toBeNull()
	})

	/**
	 * The ONE place the vendors legitimately part, asserted rather than skipped — an ACCEPTED irreducible vendor
	 * capability (owner, 2026-10-04; openspec bridge-refusal-review 8.4, DIALECT C19b). CODESYS schedules a watchdog;
	 * TwinCAT has no per-task watchdog with a time and a sensitivity (re-measured 2026-10-04: `TIRT^PlcTask` holds
	 * `ExceedWarning`, a count of tolerated overruns, and `WatchdogStackCapacity`, neither a time), so it REFUSES the
	 * push `UNSUPPORTED`, naming the watchdog, instead of dropping the line — a file that keeps saying
	 * `Watchdog: 50 ms (sensitivity 1)` over a task with no watchdog is the silent divergence this capability avoids.
	 */
	it("a watchdog is scheduled on CODESYS and REFUSED on TwinCAT — never silently dropped", async () => {
		const name = await anyTask()
		const original = (await fetchItem(name)).sourceText
		const edited = original.replace(/^Watchdog:.*$/m, "Watchdog:  50 ms (sensitivity 1)")
		expect(edited, "the task's descriptor has no Watchdog line to move").not.toBe(original)

		try {
			const r = await pushOps([{ op: "set", name, sourceText: edited, ifVersion: await versionOf(name) }])
			if (VENDOR === "twincat") {
				expect(r.accepted, "TwinCAT accepted a watchdog it cannot schedule").toBe(false)
				expect(r.conflicts?.[0]?.code, JSON.stringify(r.conflicts)).toBe("UNSUPPORTED")
				expect(JSON.stringify(r.conflicts).toLowerCase()).toContain("watchdog")
				// …and the refusal changed NOTHING. A rejected push that half-applied would be worse than one
				// that silently dropped the field.
				expect((await fetchItem(name)).sourceText).toBe(original)
			} else {
				expect(r.accepted, `push refused: ${JSON.stringify(r.conflicts)}`).toBe(true)
				expect((await fetchItem(name)).sourceText).toBe(edited)
			}
		} finally {
			if ((await fetchItem(name)).sourceText !== original)
				await pushOps([{ op: "set", name, sourceText: original, ifVersion: await versionOf(name) }])
		}
	})

	it("a body that is not canonical is written, and the canonical text comes back (bridge-refusal-review 2.13)", async () => {
		// The task's OWN settings, re-spaced: the same descriptor in another form. It used to be refused with the
		// exact text to use; the settings are what the IDE holds, so it is written and the next read is canonical.
		const name = await anyTask()
		const original = (await fetchItem(name)).sourceText
		const respaced = original
			.split("\n")
			.map((l: string) => l.replace(/^(\w+):\s+/, "$1: "))
			.join("\n")
		expect(respaced, "the descriptor has no padded label to re-space").not.toBe(original)
		try {
			const r = await pushOps([{ op: "set", name, sourceText: respaced, ifVersion: await versionOf(name) }])
			expect(r.accepted, `push refused: ${JSON.stringify(r.conflicts)}`).toBe(true)
			expect((await fetchItem(name)).sourceText).toBe(original)
		} finally {
			if ((await fetchItem(name)).sourceText !== original)
				await pushOps([{ op: "set", name, sourceText: original, ifVersion: await versionOf(name) }])
		}
	})
})
