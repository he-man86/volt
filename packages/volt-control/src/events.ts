import { request } from "node:http"

/**
 * Subscribe to the bridge's SSE change stream (`GET /events`). Calls `onChange` each time the IDE is edited
 * (the bridge debounces bursts into one event), auto-reconnecting if the stream drops. Returns an unsubscribe.
 *
 * This replaces manual "refresh" for IDE-side changes: the extension calls its normal `refresh()` on each event,
 * so the drift view updates the moment the engineer edits — no polling. First-party call (Node http, no Origin),
 * so the bridge's CSRF guard passes.
 */
export function subscribeChanges(port: number, onChange: () => void): () => void {
	let closed = false
	let current: ReturnType<typeof request> | undefined
	let retry: ReturnType<typeof setTimeout> | undefined

	const reconnect = (): void => {
		if (closed || retry) return
		retry = setTimeout(() => {
			retry = undefined
			connect()
		}, 2000)
	}

	const connect = (): void => {
		if (closed) return
		const req = request(
			{ host: "127.0.0.1", port, path: "/events", headers: { accept: "text/event-stream" } },
			(res) => {
				if (res.statusCode !== 200) {
					res.resume()
					reconnect()
					return
				}
				res.setEncoding("utf-8")
				let buf = ""
				res.on("data", (chunk: string) => {
					buf += chunk
					let nl: number
					while ((nl = buf.indexOf("\n")) >= 0) {
						const line = buf.slice(0, nl).trim()
						buf = buf.slice(nl + 1)
						if (line === "event: change") onChange() // ": keep-alive" and "data:" lines are ignored
					}
				})
				res.on("end", reconnect)
				res.on("error", reconnect)
			},
		)
		req.on("error", reconnect)
		req.end()
		current = req
	}

	connect()
	return () => {
		closed = true
		if (retry) clearTimeout(retry)
		try {
			current?.destroy()
		} catch {
			/* already gone */
		}
	}
}
