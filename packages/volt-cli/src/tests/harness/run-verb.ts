/**
 * Run CLI commands directly in-process against a test env.
 */
import type { TestEnv } from "./make-test-env.js"
import { pull, type PullInput } from "../../commands/pull.js"
import { push, type PushInput } from "../../commands/push.js"
import { init, type InitInput } from "../../commands/init.js"
import { status, type StatusInput } from "../../commands/status.js"
import { build, type BuildInput } from "../../commands/build.js"
import { show } from "../../commands/show.js"

export interface VerbRun {
	exitCode: number
	stdout: string
	stderr: string
}

type Flags = Record<string, boolean | string>

function capture(fn: () => Promise<void>): Promise<VerbRun> {
	const stdoutChunks: string[] = []
	const stderrChunks: string[] = []

	const origStdoutWrite = process.stdout.write.bind(process.stdout)
	const origStderrWrite = process.stderr.write.bind(process.stderr)
	const origLog = console.log
	const origError = console.error

	process.stdout.write = ((chunk: string | Uint8Array): boolean => {
		stdoutChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"))
		return true
	}) as typeof process.stdout.write
	process.stderr.write = ((chunk: string | Uint8Array): boolean => {
		stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"))
		return true
	}) as typeof process.stderr.write
	console.log = (...args: unknown[]): void => {
		stdoutChunks.push(args.map(String).join(" ") + "\n")
	}
	console.error = (...args: unknown[]): void => {
		stderrChunks.push(args.map(String).join(" ") + "\n")
	}

	let exitCode = 0
	const promise = fn().then(() => {
		const ec = process.exitCode
		exitCode = typeof ec === "number" ? ec : 0
	}).catch((err: unknown) => {
		const msg = err instanceof Error ? err.message : String(err)
		stderrChunks.push(msg + "\n")
		exitCode = 1
	}).finally(() => {
		process.stdout.write = origStdoutWrite
		process.stderr.write = origStderrWrite
		console.log = origLog
		console.error = origError
		process.exitCode = undefined
	})

	return promise.then(() => ({
		exitCode,
		stdout: stdoutChunks.join(""),
		stderr: stderrChunks.join(""),
	}))
}

export async function runPull(env: TestEnv, flags: Flags = {}): Promise<VerbRun> {
	return capture(async () => {
		const input: PullInput = {}
		if (flags.force === true) input.force = true
		if (flags.json === true) input.json = true
		if (flags.dryRun !== undefined) input.dryRun = Boolean(flags.dryRun)
		if (flags.noMerge !== undefined) input.noMerge = Boolean(flags.noMerge)
		const result = await pull(env.workspace, env.bridge, input)
		if (result.kind !== "ok") {
			process.stderr.write(`pull ${result.kind}: ${"reason" in result ? result.reason : ""}\n`)
			process.exitCode = 2
		}
	})
}

export async function runPush(env: TestEnv, flags: Flags = {}): Promise<VerbRun> {
	return capture(async () => {
		const input: PushInput = {}
		if (flags.force === true) input.force = true
		if (flags.json === true) input.json = true
		if (flags.dryRun !== undefined) input.dryRun = Boolean(flags.dryRun)
		if (flags.noDriftCheck !== undefined) input.noDriftCheck = Boolean(flags.noDriftCheck)
		const result = await push(env.workspace, env.bridge, input)
		if (result.kind !== "ok") {
			process.stderr.write(`push ${result.kind}: ${"reason" in result ? result.reason : ""}\n`)
			process.exitCode = 2
		}
	})
}

export async function runInit(env: TestEnv, flags: Flags = {}): Promise<VerbRun> {
	return capture(async () => {
		const input: InitInput = {}
		if (flags.force === true) input.force = true
		if (flags.noScaffold !== undefined) input.noScaffold = Boolean(flags.noScaffold)
		const result = await init(env.workspace, env.bridge, input)
		if (result.kind === "ok") return
		const err = result.error
		const msg = err.kind === "internal" ? err.message : err.kind
		process.stderr.write(`${msg}\n`)
		process.exitCode = err.kind === "binding_mismatch" ? 2 : 1
	})
}

export async function runStatus(env: TestEnv, flags: Flags = {}): Promise<VerbRun> {
	return capture(async () => {
		const input: StatusInput = {}
		if (flags.json === true) input.json = true
		if (flags.porcelain === true) input.porcelain = true
		await status(env.workspace, env.bridge, input)
	})
}

export async function runShow(env: TestEnv, flags: Flags): Promise<VerbRun> {
	return capture(async () => {
		const ref = String(flags._positional ?? "HEAD")
		const path = String(flags._positional2 ?? "")
		await show(env.workspace, env.bridge, ref, path)
	})
}

export async function runBuild(env: TestEnv, flags: Flags = {}): Promise<VerbRun> {
	return capture(async () => {
		const input: BuildInput = {}
		if (flags.full !== undefined) input.full = Boolean(flags.full)
		await build(env.workspace, env.bridge, input)
	})
}
