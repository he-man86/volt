/**
 * `volt.merge.openEditor` — opens VS Code's built-in 3-pane merge
 * editor (introduced in 1.69) against a workspace file mid-merge. The
 * editor gets four URIs:
 *
 *   base    — ORIG_HEAD blob (the merge base; common ancestor)
 *   input1  — the live workspace file (ours, mid-resolution)
 *   input2  — MERGE_HEAD blob (theirs, fetched at merge start)
 *   output  — the live workspace file (where the user writes the result)
 *
 * Three of those (base/input1/input2) are read-only and backed by the
 * `volt:` content provider. The output URI is the real on-disk file
 * — VS Code writes the resolved content there when the user clicks
 * "Complete Merge". The user then clicks "Continue Merge" in the Volt
 * SCM view, which calls `volt merge --continue` and finalizes the
 * merge commit.
 *
 * Per-file pick-a-side resolution lives in `scm.ts` under
 * `volt.merge.useMine` / `volt.merge.useTheirs` — those mirror git's
 * `git checkout --ours/--theirs <path>` and are the right tool for
 * graphical conflicts (FBD/LD/SFC/CFC) which can't take inline
 * conflict markers.
 *
 * If `_open.mergeEditor` is unavailable (old VS Code, or rare
 * configurations), we fall back to `vscode.diff` showing ours vs
 * theirs — coarser but still usable.
 */
import * as vscode from "vscode";
import { buildVoltUri } from "./scm-content-provider.js";

export function registerMergeEditor(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand("volt.merge.openEditor", openMergeEditor),
	);
}

async function openMergeEditor(arg: unknown): Promise<void> {
	const fileUri = extractUri(arg);
	if (fileUri === undefined) {
		vscode.window.showWarningMessage("Volt: no file selected for merge editor.");
		return;
	}
	const folder = vscode.workspace.getWorkspaceFolder(fileUri);
	if (folder === undefined) {
		vscode.window.showWarningMessage("Volt: file is not in any open workspace folder.");
		return;
	}
	const rel = vscode.workspace.asRelativePath(fileUri, false);

	const baseUri = buildVoltUri(folder, "ORIG_HEAD", rel);
	const oursUri = buildVoltUri(folder, "WORKSPACE", rel);
	const theirsUri = buildVoltUri(folder, "MERGE_HEAD", rel);

	const args = {
		base: { resource: baseUri, detail: "merge base (ORIG_HEAD)" },
		input1: {
			resource: oursUri,
			title: "Workspace (ours)",
			description: "your edits",
			detail: "Workspace",
		},
		input2: {
			resource: theirsUri,
			title: "IDE (theirs)",
			description: "the engineer's edits in the PLC IDE",
			detail: "IDE",
		},
		output: fileUri,
	};

	try {
		// The command is technically "internal" (underscore-prefixed) but
		// has been the de-facto extension entry point since 1.69 and is
		// what VS Code's own git extension uses.
		await vscode.commands.executeCommand("_open.mergeEditor", args);
	} catch (err) {
		// Fall back to a side-by-side diff between ours and theirs.
		console.warn("volt: _open.mergeEditor unavailable, falling back to diff", err);
		await vscode.commands.executeCommand(
			"vscode.diff",
			oursUri,
			theirsUri,
			`${rel} — Workspace vs IDE`,
		);
		vscode.window.showInformationMessage(
			"Volt: built-in merge editor unavailable on this VS Code build — showing diff. Resolve manually in the workspace file and run `volt merge --continue`.",
		);
	}
}

function extractUri(arg: unknown): vscode.Uri | undefined {
	if (arg === undefined || arg === null) {
		return vscode.window.activeTextEditor?.document.uri;
	}
	if (arg instanceof vscode.Uri) return arg;
	if (typeof arg === "object") {
		const maybeUri = (arg as { uri?: unknown }).uri;
		if (maybeUri instanceof vscode.Uri) return maybeUri;
		const maybeResourceUri = (arg as { resourceUri?: unknown }).resourceUri;
		if (maybeResourceUri instanceof vscode.Uri) return maybeResourceUri;
	}
	return undefined;
}
