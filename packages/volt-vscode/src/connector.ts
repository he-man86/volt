/**
 * Client for the Volt Connector's control plane (:8550). Lets the extension SEE
 * every bridge's orchestration state and start one when it's down — without the
 * user leaving the editor or touching the tray. All best-effort: if the connector
 * isn't running, every call resolves to a clear "no-connector" result.
 */
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
