import { request } from "node:http"

/**
 * Watch the bridge for IDE-side changes by polling `GET /refs` every 4 seconds and comparing
 * `projectVersion`. Calls `onChange` each time the version differs from the last seen value.
 * Returns an unsubscribe function. No persistent connection — one lightweight HTTP request per poll.
 */
export function subscribeChanges(port: number, onChange: () => void): () => void {
	let closed = false
	let timer: ReturnType<typeof setInterval> | undefined
	let lastVersion = ""

	const poll = (): void => {
		if (closed) return
		const req = request(
			{ host: "127.0.0.1", port, path: "/refs", headers: { accept: "application/json" } },
			(res) => {
				if (res.statusCode !== 200) {
					res.resume()
					return
				}
				let body = ""
				res.setEncoding("utf-8")
				res.on("data", (chunk: string) => {
					body += chunk
				})
				res.on("end", () => {
					try {
						const data = JSON.parse(body) as { projectVersion?: string }
						if (data.projectVersion && data.projectVersion !== lastVersion) {
							lastVersion = data.projectVersion
							onChange()
						}
					} catch {
						/* skip malformed responses */
					}
				})
			},
		)
		req.on("error", () => {
			/* bridge not reachable — will retry next poll */
		})
		req.end()
	}

	poll()
	timer = setInterval(poll, 4000)

	return () => {
		closed = true
		if (timer) clearInterval(timer)
	}
}
