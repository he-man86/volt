/**
 * File-Explorer decorations for "this file differs from the IDE" — Volt's
 * drift axis, which is ORTHOGONAL to git ("differs from last commit"). A
 * file can be git-clean but IDE-drifted, or vice versa, so these are
 * designed to read as a distinct signal that sits ALONGSIDE git, never
 * reusing git's colors or letters:
 *
 *   ↓  incoming  — the IDE changed this; pull to absorb
 *   ↑  outgoing  — you changed this locally; push to send
 *   !  conflict  — both sides changed; resolve before pushing
 *
 * Colors are contributed theme colors (`volt.drift*Foreground`, see
 * package.json) in a blue/purple/amber family — deliberately not git's
 * tan/green/red. `propagate` rolls the badge up to parent folders.
 *
 * Data comes from the same `volt status --json` the SCM tree already
 * polls; `refresh()` is driven off `VoltWorkspace.onDidChangeStatus`.
 */
import * as vscode from "vscode";
import type { StatusJson } from "./volt-types.js";

type DriftKind = "incoming" | "outgoing" | "conflict";

const DECOR: Record<DriftKind, { badge: string; color: string; verb: string }> = {
	conflict: { badge: "!", color: "volt.driftConflictForeground", verb: "conflicts with the IDE — resolve before pushing" },
	incoming: { badge: "↓", color: "volt.driftIncomingForeground", verb: "changed in the IDE — pull to absorb" },
	outgoing: { badge: "↑", color: "volt.driftOutgoingForeground", verb: "changed locally — push to send to the IDE" },
};

/** A workspace's root + its latest `volt status` (undefined before the first poll). */
export interface WorkspaceDrift {
	root: vscode.Uri;
	status: StatusJson | undefined;
}

export interface DriftCounts {
	incoming: number;
	outgoing: number;
	conflicts: number;
}

export class VoltDriftDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
	private readonly emitter = new vscode.EventEmitter<vscode.Uri[]>();
	readonly onDidChangeFileDecorations = this.emitter.event;
	/** fsPath → drift kind. Rebuilt wholesale on every refresh. */
	private drift = new Map<string, DriftKind>();

	provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
		const kind = this.drift.get(uri.fsPath);
		if (kind === undefined) return undefined;
		const d = DECOR[kind];
		const deco = new vscode.FileDecoration(d.badge, `Volt: ${d.verb}`, new vscode.ThemeColor(d.color));
		deco.propagate = true;
		return deco;
	}

	/**
	 * Recompute drift from the current per-workspace statuses, fire a
	 * change for every affected URI, and return the totals (for the
	 * status-bar item). Priority: conflict > outgoing > incoming.
	 */
	refresh(workspaces: readonly WorkspaceDrift[]): DriftCounts {
		const next = new Map<string, DriftKind>();
		for (const ws of workspaces) {
			const s = ws.status;
			if (s === undefined) continue;
			for (const c of s.merging?.conflicts ?? []) {
				next.set(abs(ws.root, c.path), "conflict");
			}
			for (const name of changeNames(s.outgoing)) {
				const p = s.pathByName[name];
				if (p !== undefined && !next.has(abs(ws.root, p))) next.set(abs(ws.root, p), "outgoing");
			}
			for (const name of changeNames(s.incoming)) {
				const p = s.pathByName[name];
				if (p !== undefined && !next.has(abs(ws.root, p))) next.set(abs(ws.root, p), "incoming");
			}
		}

		const counts: DriftCounts = { incoming: 0, outgoing: 0, conflicts: 0 };
		for (const k of next.values()) {
			if (k === "conflict") counts.conflicts++;
			else if (k === "outgoing") counts.outgoing++;
			else counts.incoming++;
		}

		const affected = new Set<string>([...this.drift.keys(), ...next.keys()]);
		this.drift = next;
		if (affected.size > 0) {
			this.emitter.fire([...affected].map((p) => vscode.Uri.file(p)));
		}
		return counts;
	}

	dispose(): void {
		this.emitter.dispose();
	}
}

function changeNames(c: { added: string[]; modified: string[]; removed: string[] }): string[] {
	return [...c.modified, ...c.added, ...c.removed];
}

/** Absolute fs path for a workspace-relative (forward-slash) path. */
function abs(root: vscode.Uri, relPath: string): string {
	return vscode.Uri.joinPath(root, ...relPath.split("/")).fsPath;
}
