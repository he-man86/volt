/**
 * `volt:` URI scheme — backs read-only virtual documents fed to VS
 * Code's QuickDiff gutter, the SCM panel's diff click, and the
 * built-in 3-pane merge editor.
 *
 * URI shape:
 *   volt://<workspace-token>/<REF>/<workspace-relative-path>
 *
 * where <REF> is one of: HEAD | MERGE_HEAD | ORIG_HEAD | WORKSPACE | BRIDGE
 * and <workspace-token> is a stable identifier for the workspace
 * folder (we use the folder's name; collisions are fine because we
 * also look up by URI scheme matching against the open workspace).
 *
 * BRIDGE is a PURE-READ ref backed by `peekBridgeItem` in
 * `engine/ops.ts` — it fetches the IDE's live state for one item
 * without touching the snapshot or workspace. Clicking a diff for
 * an incoming change can never silently overwrite the local copy.
 *
 * The provider implementation shells `volt show <ref> <path>` and
 * pipes stdout into the TextDocument. VS Code calls
 * `provideTextDocumentContent` lazily — the first time a virtual URI
 * is opened, and again whenever the content provider fires its
 * `onDidChange` event.
 */
import * as vscode from "vscode";
import { cliBin, spawnCaptureBuffer } from "./cli.js";

export const VOLT_URI_SCHEME = "volt";

/**
 * Refs accepted in `volt://<workspace>/<REF>/<path>` URIs.
 *
 * Named refs are the well-known endpoints (HEAD / MERGE_HEAD /
 * ORIG_HEAD / WORKSPACE / BRIDGE). Commit SHAs (4-40 hex chars) are
 * also accepted — used by the "Sync history" view to fetch any
 * historical pull's version of a file.
 */
export type ShowRef = string;

const NAMED_REFS = new Set<string>(["HEAD", "MERGE_HEAD", "ORIG_HEAD", "WORKSPACE", "BRIDGE"]);
const SHA_RE = /^[0-9a-f]{4,40}$/;

function isValidRef(ref: string): boolean {
	return NAMED_REFS.has(ref) || SHA_RE.test(ref);
}

/**
 * Build a `volt:` URI for the given workspace folder + ref + relative
 * path. Used by both the QuickDiff provider (HEAD) and the merge
 * editor wiring (HEAD / MERGE_HEAD / WORKSPACE / ORIG_HEAD).
 */
export function buildVoltUri(
	workspaceFolder: vscode.WorkspaceFolder,
	ref: ShowRef,
	relativePath: string,
): vscode.Uri {
	// Normalize to forward slashes — the CLI treats paths as POSIX.
	const cleaned = relativePath.split(/[\\/]/).filter((s) => s.length > 0).join("/");
	return vscode.Uri.parse(
		`${VOLT_URI_SCHEME}://${encodeURIComponent(workspaceFolder.name)}/${ref}/${cleaned}`,
	);
}

/** Parse a `volt:` URI back into its (folder, ref, path) parts. */
export function parseVoltUri(uri: vscode.Uri):
	| { workspaceName: string; ref: ShowRef; relativePath: string }
	| undefined {
	if (uri.scheme !== VOLT_URI_SCHEME) return undefined;
	const workspaceName = decodeURIComponent(uri.authority);
	// uri.path begins with a leading "/". The first segment is the ref.
	const segments = uri.path.split("/").filter((s) => s.length > 0);
	if (segments.length < 2) return undefined;
	const refSegment = segments[0];
	if (!isValidRef(refSegment)) return undefined;
	const ref = refSegment as ShowRef;
	const relativePath = segments.slice(1).join("/");
	return { workspaceName, ref, relativePath };
}

/**
 * Find the workspace folder by name. Used to resolve the working
 * directory for the `volt show` shell-out.
 *
 * Comparison is case-insensitive because `vscode.Uri.parse` lowercases
 * the authority during URI parsing (RFC 3986 says host is
 * case-insensitive — VS Code's parser normalizes accordingly). So an
 * outgoing URI built from folder name "Nieuwe map (2)" comes back as
 * "nieuwe map (2)" after round-trip; an exact-case match misses,
 * `findFolderByName` returns undefined, and the diff editor's LEFT
 * pane renders empty. Lowercasing both sides fixes it.
 */
function findFolderByName(name: string): vscode.WorkspaceFolder | undefined {
	const target = name.toLowerCase();
	for (const f of vscode.workspace.workspaceFolders ?? []) {
		if (f.name.toLowerCase() === target) return f;
	}
	return undefined;
}

export class VoltContentProvider implements vscode.TextDocumentContentProvider {
	private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
	readonly onDidChange = this.emitter.event;

	/** Notify VS Code that the content of `uri` has changed and should be re-fetched. */
	notifyChange(uri: vscode.Uri): void {
		this.emitter.fire(uri);
	}

	/** Fire a content-changed event for every cached document matching the predicate. */
	notifyAllRefs(): void {
		// VS Code tracks open documents but doesn't expose them as a
		// per-scheme query. We fire on every known open document in our
		// scheme — cheap, and ensures gutter decorations refresh on
		// pull/push.
		for (const doc of vscode.workspace.textDocuments) {
			if (doc.uri.scheme === VOLT_URI_SCHEME) {
				this.emitter.fire(doc.uri);
			}
		}
	}

	async provideTextDocumentContent(
		uri: vscode.Uri,
		token: vscode.CancellationToken,
	): Promise<string> {
		const parsed = parseVoltUri(uri);
		if (parsed === undefined) {
			// Don't throw — that silently kills the diff editor with no
			// signal. Return a visible sentinel string so the user (and
			// any logs they share with us) can see WHY the diff is empty.
			return `(volt: not a valid volt:// URI — got "${uri.toString()}")`;
		}
		const folder = findFolderByName(parsed.workspaceName);
		if (folder === undefined) {
			// Folder closed since the URI was issued — empty content lets
			// the diff editor render a "deleted file" view.
			return "";
		}

		if (token.isCancellationRequested) return "";

		try {
			const result = await spawnCaptureBuffer(
				cliBin(),
				["show", parsed.ref, parsed.relativePath],
				folder.uri.fsPath,
			);
			if (result.code === 0) {
				return result.stdout.toString("utf-8");
			}
			// Exit 2 = path/item didn't exist at that ref. For HEAD /
			// MERGE_HEAD / ORIG_HEAD this is a normal added/removed
			// case and the empty-string render lets the diff editor
			// show it as a creation/deletion. For BRIDGE it's a real
			// error ("the bridge doesn't have this item") and the
			// user should see the message.
			if (result.code === 2 && parsed.ref !== "BRIDGE") {
				return "";
			}
			// Exit 1 / other = bad ref, bad snapshot, bridge unreachable.
			// Surface the stderr text in the diff pane so the user knows
			// what went wrong instead of staring at silently-empty
			// content. Also log to the OutputChannel for retention.
			const reason = result.stderr.trim() || `exit ${result.code}`;
			const msg = `(volt show ${parsed.ref} ${parsed.relativePath} failed: ${reason})`;
			return msg;
		} catch (err) {
			// Spawn-level failure (CLI not found, OOM, etc.). Same
			// principle — sentinel string in the diff pane beats a
			// silent break.
			const reason = err instanceof Error ? err.message : String(err);
			return `(volt show ${parsed.ref} ${parsed.relativePath} threw: ${reason})`;
		}
	}

	dispose(): void {
		this.emitter.dispose();
	}
}
