import type { ChangeSet } from "../snapshot/state.js"

export interface PostState {
	projectVersion: string
	structureVersion: string
	synced: string[]
	incoming?: ChangeSet
	outgoing?: ChangeSet
}

export function renderPostState(state: PostState): string {
	const parts: string[] = []
	parts.push(`projectVersion: ${state.projectVersion}`)
	parts.push(`structureVersion: ${state.structureVersion}`)

	if (state.synced.length > 0) {
		parts.push(`synced: ${state.synced.join(", ")}`)
	}

	if (state.incoming && csHasChanges(state.incoming)) {
		parts.push(`incoming: ${formatChangeSet(state.incoming)}`)
	}

	if (state.outgoing && csHasChanges(state.outgoing)) {
		parts.push(`outgoing: ${formatChangeSet(state.outgoing)}`)
	}

	return parts.join("\n")
}

export function renderPorcelainStatus(incoming: ChangeSet, outgoing: ChangeSet): string {
	const lines: string[] = []
	for (const n of incoming.added) lines.push(`iA ${n}`)
	for (const n of incoming.modified) lines.push(`iM ${n}`)
	for (const n of incoming.removed) lines.push(`iD ${n}`)
	for (const n of outgoing.added) lines.push(`oA ${n}`)
	for (const n of outgoing.modified) lines.push(`oM ${n}`)
	for (const n of outgoing.removed) lines.push(`oD ${n}`)
	return lines.join("\n")
}

function csHasChanges(c: ChangeSet): boolean {
	return c.added.length > 0 || c.removed.length > 0 || c.modified.length > 0 || c.moved.length > 0
}

function formatChangeSet(c: ChangeSet): string {
	const parts: string[] = []
	if (c.added.length > 0) parts.push(`+${c.added.length}`)
	if (c.modified.length > 0) parts.push(`~${c.modified.length}`)
	if (c.removed.length > 0) parts.push(`-${c.removed.length}`)
	return parts.join(" ")
}
