export type CliError =
	| { kind: "bridge_offline"; port: number }
	| { kind: "binding_mismatch"; expected: string; actual: string }
	| { kind: "merge_conflict"; paths: string[] }
	| { kind: "pull_refused"; reason: string }
	| { kind: "push_rejected"; reason: string }
	| { kind: "workspace_dirty"; paths: string[] }
	| { kind: "not_initialized" }
	| { kind: "invalid_args"; message: string }
	| { kind: "internal"; message: string }

export function formatError(error: CliError): string {
	switch (error.kind) {
		case "bridge_offline":
			return `volt: bridge offline on port ${error.port} — is the IDE running?`
		case "binding_mismatch":
			return `volt: project binding mismatch\n      expected: ${error.expected}\n      actual:   ${error.actual}\n  hint: run \`volt init --force\` to rebind`
		case "merge_conflict":
			return `volt: merge conflict${error.paths.length > 0 ? ` in ${error.paths.join(", ")}` : ""}\n  hint: resolve conflicts and run \`volt merge --continue\``
		case "pull_refused":
			return `volt: pull refused — ${error.reason}`
		case "push_rejected":
			return `volt: push rejected — ${error.reason}`
		case "workspace_dirty":
			return `volt: workspace has uncommitted changes in ${error.paths.join(", ")}\n  hint: commit or stash changes, or use --force`
		case "not_initialized":
			return `volt: workspace not initialized\n  hint: run \`volt init\` first`
		case "invalid_args":
			return `volt: ${error.message}`
		case "internal":
			return `volt: internal error — ${error.message}`
	}
}

export function exitCode(error: CliError): number {
	switch (error.kind) {
		case "merge_conflict":
		case "pull_refused":
		case "push_rejected":
		case "workspace_dirty":
			return 2
		default:
			return 1
	}
}
