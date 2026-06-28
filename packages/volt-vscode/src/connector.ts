/**
 * Client for the Volt Connector's control plane (:8550). Lets the extension SEE
 * every bridge's orchestration state and start one when it's down — without the
 * user leaving the editor or touching the tray. All best-effort: if the connector
 * isn't running, every call resolves to a clear "no-connector" result.
 */
import * as vscode from "vscode"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

const CONTROL = "http://127.0.0.1:8550"
const TIMEOUT_MS = 1500

export interface ConnectorBridge {
	id: string
	displayName: string
	port: number
	archetype: "ExternalAttach" | "InIdeLoad" | string
	enabled: boolean
	status: string
	workerRunning: boolean
}

/** Returns the connector's bridge list, or undefined if the connector isn't reachable. */
export async function getConnectorBridges(): Promise<ConnectorBridge[] | undefined> {
	try {
		const r = await fetch(`${CONTROL}/status`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
		if (!r.ok) return undefined
		const body = (await r.json()) as { bridges?: ConnectorBridge[] }
		return body.bridges ?? []
	} catch {
		return undefined
	}
}

/** The conventional per-user install location for the connector bundle. THE
 *  installer must copy VoltConnector.exe (+ its workers) here, and the extension
 *  launches it from here — keep these in sync. Per-user (%LOCALAPPDATA%) so no
 *  admin/UAC is needed, matching the HKCU login-item registration. */
export function defaultConnectorExe(): string | undefined {
	const local = process.env.LOCALAPPDATA
	return local === undefined ? undefined : join(local, "Programs", "Volt", "VoltConnector.exe")
}

/** Locate VoltConnector.exe: explicit setting, env override, then the conventional
 *  install path. Returns undefined if none exists (connector not installed yet). */
function locateConnectorExe(): string | undefined {
	const cfg = vscode.workspace.getConfiguration("volt").get<string>("connector.path")
	if (cfg !== undefined && cfg.length > 0 && existsSync(cfg)) return cfg
	const env = process.env.VOLT_CONNECTOR_EXE
	if (env !== undefined && env.length > 0 && existsSync(env)) return env
	const fallback = defaultConnectorExe()
	if (fallback !== undefined && existsSync(fallback)) return fallback
	return undefined
}

export type EnsureResult = "running" | "started" | "not-found"

/** Ensure the connector is up: probe :8550 and, if silent, launch VoltConnector.exe
 *  detached and wait briefly for it to bind. The tray app is single-instance, so a
 *  redundant launch is harmless. */
export async function ensureConnectorRunning(): Promise<EnsureResult> {
	if ((await getConnectorBridges()) !== undefined) return "running"
	const exe = locateConnectorExe()
	if (exe === undefined) return "not-found"
	try {
		spawn(exe, ["--silent"], { detached: true, stdio: "ignore" }).unref()
	} catch {
		return "not-found"
	}
	for (let i = 0; i < 12; i++) {
		await new Promise((r) => setTimeout(r, 300))
		if ((await getConnectorBridges()) !== undefined) return "started"
	}
	return "started" // launched; may still be coming up
}

export type StartResult = "started" | "no-bridge" | "no-connector"

/** Start the bridge serving `port`: restart its worker (ExternalAttach) or launch
 *  the IDE with the loader (InIdeLoad). */
export async function startBridgeByPort(port: number): Promise<StartResult> {
	const bridges = await getConnectorBridges()
	if (bridges === undefined) return "no-connector"
	const bridge = bridges.find((b) => b.port === port)
	if (bridge === undefined) return "no-bridge"

	const action = bridge.archetype === "InIdeLoad" ? "launch" : "restart"
	try {
		const r = await fetch(`${CONTROL}/bridges/${bridge.id}/${action}`, {
			method: "POST",
			body: "", // empty body so http.sys accepts the POST (sets Content-Length: 0)
			signal: AbortSignal.timeout(TIMEOUT_MS),
		})
		return r.ok ? "started" : "no-bridge"
	} catch {
		return "no-connector"
	}
}

