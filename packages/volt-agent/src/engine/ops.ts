/**
 * Workspace ↔ bridge translation. Called by `volt import` and `volt export`
 * (in `import.ts` / `export.ts`); not used directly by the CLI surface.
 *
 * Workspace layout: ONE FILE PER POU. The file contains the outer POU
 * (FUNCTION_BLOCK / PROGRAM / FUNCTION / INTERFACE) followed by its
 * children (METHOD / ACTION / PROPERTY) as TOP-LEVEL SIBLINGS — the
 * format the `@opencode-ai/volt-lsp-st` parser already speaks. Parent
 * association is implicit from the file name (`POUs/FB_Motor.st`
 * contains everything related to `FB_Motor`). The bridge protocol
 * stays per-child; this module owns the round-trip via `st-assemble.ts`
 * (write side) and `parseSource` from `@opencode-ai/volt-lsp-st` (read side).
 *
 * Two directions:
 *
 *   syncFromBridge: bridge state → snapshot commit
 *     Fetches every changed item, ASSEMBLES each POU + its children
 *     into one workspace file, writes it as a blob into the hidden
 *     snapshot bare repo, builds a tree, creates a deterministic
 *     commit on top of the previous one.
 *
 *   applyPushToBridge: snapshot commit → bridge.pushBatch
 *     Diffs the workspace tree against the prior snapshot tree at the
 *     FILE level (every `.st` file is one POU). For each POU that
 *     changed, PARSES both versions with the LSP and emits per-child
 *     primitive ops.
 *
 * All diff reasoning lives HERE. The bridge stays a dumb applier.
 */
import type { Remote } from "../bridge/remote.js";
import type {
	AIChildInfo,
	AIGetResult,
	CreateChildOp,
	CreatePouOp,
	DeleteAccessorOp,
	DeleteChildOp,
	DeletePouOp,
	PushOp,
	PushResponse,
	SetAccessorOp,
	UpdateChildOp,
	UpdatePouOp,
} from "../bridge/types.js";
import {
	buildTree,
	createDeterministicCommit,
	listTree,
	readBlob,
	resolveRef,
	updateRef,
	writeBlob,
	type IndexEntry,
	type TreeEntry,
} from "./git-cmds.js";
import { listWorkspaceFiles, loadState, saveState, type RepoState } from "./snapshot.js";
import {
	assemblePou,
	type AssembleChild,
	type ChildKind,
	type PouKind as ParsedPouKind,
} from "./st-assemble.js";
import { parseFile, type ParsedChild } from "./st-parse.js";

// ─── Bridge → workspace materialization ────────────────────────────────

/** POU kinds that can hold children (and therefore need an assembled file). */
const COMPOSITE_KINDS = new Set<CreatePouOp["kind"]>([
	"function_block",
	"function",
	"program",
	"interface",
]);

/**
 * Extension per POU kind. Extension communicates what's IN the file:
 *  - `.st`   — ST source (POU body + optional children inline)
 *  - `.gvl`  — Global Variable List (pure declarations)
 *  - `.dut`  — Data Unit Type (struct / union / enum / alias)
 *  - `.itf`  — Interface declaration + method/property signatures.
 *              Pull works; push round-trip is a known TODO — st-parse.ts
 *              currently rejects INTERFACE as outer kind (different AST
 *              shape: nested methods/properties, no body/varSections).
 *              Edit interfaces in TwinCAT for now; pull picks up changes.
 *
 * For POU kinds with a body (function_block / function / program), the
 * BODY LANGUAGE wins over this default — see LANG_EXT. So FB with FBD
 * body lands at `.fbd` even though KIND_EXT["function_block"] = "st".
 *
 * All ST-grammar extensions (.st/.gvl/.dut/.itf) share volt-vscode's
 * structured-text language registration. Graphical body extensions
 * (.fbd/.ld/.sfc/.cfc) have their own language ids in volt-vscode.
 */
const KIND_EXT: Record<CreatePouOp["kind"], string> = {
	function_block: "st",
	function: "st",
	program: "st",
	interface: "itf",
	gvl: "gvl",
	structure: "dut",
	union: "dut",
	enumeration: "dut",
	alias: "dut",
};

/**
 * Extension per body language. Applies only to POU kinds with a body
 * (function_block, function, program). Bridge sends `language` per item
 * in /fetch; we map that to a file extension so an FBD POU lands at
 * `.fbd`, an LD POU at `.ld`, etc.
 *
 * Graphical bodies are currently masked with a placeholder by the
 * bridge (the real graphical content is binary / XML), so the file
 * round-trip is informational — the placeholder shows there IS a POU
 * of that language at that location. Push of graphical POUs will fail
 * at parseFile until a graphical LSP exists and the bridge unmasks.
 */
const LANG_EXT: Record<string, string> = {
	ST: "st",
	FBD: "fbd",
	LD: "ld",
	SFC: "sfc",
	CFC: "cfc",
	UNKNOWN: "st",
};

/** Every extension this workspace recognizes as a POU file. */
const POU_EXTENSIONS = [".st", ".gvl", ".dut", ".itf", ".fbd", ".ld", ".sfc", ".cfc"] as const;

export interface SyncOptions {
	/**
	 * Skip the cache short-circuit AND the per-item incremental-fetch
	 * optimization. Forces a full re-materialization from bridge state.
	 *
	 * Required after `volt export --force` adopts bridge state: at that
	 * point `state.projectVersion` already equals `refs.projectVersion`
	 * (we just synced them), so the normal sync would no-op — leaving
	 * the snapshot tree out of sync with `state.items`. With this flag,
	 * the snapshot tree gets rebuilt from a full `/fetch`, picking up
	 * the engineer-added items we adopted but never materialized.
	 */
	fullRebuild?: boolean;
}

export async function syncFromBridge(
	repoPath: string,
	bridge: Remote,
	opts: SyncOptions = {},
): Promise<string> {
	const refs = await bridge.getRefs();
	const state = loadState(repoPath);

	if (!opts.fullRebuild && state !== undefined && state.projectVersion === refs.projectVersion) {
		const sha = resolveRef(repoPath, "refs/heads/main");
		if (sha === state.commitSha) return sha;
	}

	const knownItems = opts.fullRebuild ? {} : (state?.items ?? {});
	const fetchResp = await bridge.fetchChanges({ knownItems });

	const entries = new Map<string, IndexEntry>();
	const folders: Record<string, string> = { ...(state?.folders ?? {}) };
	const items: Record<string, string> = { ...fetchResp.items };

	// Seed with prev tree entries we haven't been told to change. Each
	// POU is one file path; keep the prior blob unless the bridge
	// reported a change for that name.
	if (state !== undefined) {
		const prevTreeEntries = listTree(repoPath, state.commitSha);
		for (const entry of prevTreeEntries) {
			if (entry.path === ".gitattributes") {
				entries.set(entry.path, { path: entry.path, sha: entry.sha, mode: entry.mode });
				continue;
			}
			const name = pouNameFromPath(entry.path);
			if (name === undefined) continue;
			if (fetchResp.removed.includes(name)) continue;
			if (fetchResp.changed.some((c) => c.name === name)) continue;
			if (!(name in items)) continue;
			entries.set(entry.path, { path: entry.path, sha: entry.sha, mode: entry.mode });
		}
	}

	for (const item of fetchResp.changed) {
		const { path, content } = materializeItem(item);
		entries.set(path, { path, sha: writeBlob(repoPath, normalizeLineEndings(content)) });
		folders[item.name] = item.folder ?? "";
	}

	for (const name of fetchResp.removed) {
		delete folders[name];
	}

	const gitattributesSha = writeBlob(
		repoPath,
		"*.st text eol=lf\n*.gvl text eol=lf\n*.dut text eol=lf\n*.itf text eol=lf\n*.fbd text eol=lf\n*.ld text eol=lf\n*.sfc text eol=lf\n*.cfc text eol=lf\n",
	);
	entries.set(".gitattributes", { path: ".gitattributes", sha: gitattributesSha });

	const sortedEntries = [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
	const treeSha = buildTree(repoPath, sortedEntries);

	const message = `IDE state @ projectVersion=${refs.projectVersion}\nstructureVersion=${refs.structureVersion}\n`;
	const parentSha = state?.commitSha;
	const commitSha = createDeterministicCommit(repoPath, treeSha, parentSha, message);

	updateRef(repoPath, "refs/heads/main", commitSha);
	saveState(repoPath, {
		projectVersion: refs.projectVersion,
		commitSha,
		items,
		folders,
	});

	return commitSha;
}

/** Materialize a bridge item into a single workspace file (path + content). */
function materializeItem(item: AIGetResult): { path: string; content: string } {
	const folder = item.folder ?? "";
	const kind = inferPouKind(item.declaration ?? "");
	const ext = pickExtension(kind, item.language);
	const path = joinPath(folder, `${item.name}.${ext}`);

	if (!COMPOSITE_KINDS.has(kind)) {
		// Simple POU (GVL, DUT, alias): one declaration block, no wrapper,
		// no children. Emit declaration text as-is.
		return { path, content: joinDeclImpl(item.declaration, item.implementation) };
	}

	const content = assemblePou({
		kind: kind as ParsedPouKind,
		declaration: item.declaration ?? "",
		implementation: item.implementation ?? "",
		children: (item.children ?? []).map(bridgeChildToAssemble),
	});
	return { path, content };
}

function bridgeChildToAssemble(c: AIChildInfo): AssembleChild {
	const kind = inferChildKind(c.declaration ?? "");
	// Bridge's `folder` field carries the in-FB organizational path
	// (e.g. "Modes/SubModes"). Round-trip via the `(* folder: X *)`
	// trailing comment on the assembled signature line — handled by
	// the assembler when `folder` is set.
	const folderPart = c.folder !== undefined && c.folder.length > 0 ? { folder: c.folder } : {};
	if (kind === "property") {
		const out: AssembleChild = {
			kind,
			name: c.name,
			declaration: c.declaration ?? `PROPERTY ${c.name}`,
			...folderPart,
		};
		if (c.getterCode !== undefined || c.getterDeclaration !== undefined) {
			out.getter = {
				...(c.getterDeclaration !== undefined && { declaration: c.getterDeclaration }),
				...(c.getterCode !== undefined && { implementation: c.getterCode }),
			};
		}
		if (c.setterCode !== undefined || c.setterDeclaration !== undefined) {
			out.setter = {
				...(c.setterDeclaration !== undefined && { declaration: c.setterDeclaration }),
				...(c.setterCode !== undefined && { implementation: c.setterCode }),
			};
		}
		return out;
	}
	return {
		kind,
		name: c.name,
		declaration: c.declaration ?? "",
		...(c.implementation !== undefined && { implementation: c.implementation }),
		...folderPart,
	};
}

// ─── Drift-cause diagnostic ───────────────────────────────────────────

/**
 * "Did WE cause this drift, or did someone external?" answer for a
 * workspace that's been flagged as drifted.
 *
 * Returns true when the workspace's current files would assemble to
 * EXACTLY what the bridge currently has — i.e. a `volt import` would
 * be a content no-op (it'd only update the snapshot's recorded
 * version). Most common case: a previous `volt export` succeeded on
 * the bridge but the process died before `saveState` persisted the
 * receipt, leaving the snapshot stale-but-correct.
 *
 * Returns false on any real engineer-side change.
 *
 * Cost: one `/fetch` call. Caller decides whether to spend it
 * (currently only `runStatus` does, when drift is already detected).
 */
export async function workspaceMatchesBridge(
	workspaceRoot: string,
	bridge: Remote,
): Promise<boolean> {
	const { changed: bridgeItems } = await bridge.fetchChanges({ knownItems: {} });
	const wsFiles = listWorkspaceFiles(workspaceRoot);
	const wsByPath = new Map(
		wsFiles.map((f) => [f.path, normalizeLineEndings(f.content.toString("utf-8"))]),
	);

	// Every bridge item must materialize to a workspace file with the
	// identical assembled content.
	const expectedPaths = new Set<string>([".gitattributes"]);
	for (const item of bridgeItems) {
		const { path, content } = materializeItem(item);
		expectedPaths.add(path);
		const wsContent = wsByPath.get(path);
		if (wsContent === undefined) return false;
		if (normalizeLineEndings(content) !== wsContent) return false;
	}

	// Workspace must not have any extra .st files beyond what the
	// bridge has — anything else is a workspace-side addition that
	// would mean the workspace is AHEAD of the bridge, not in-sync.
	for (const wsPath of wsByPath.keys()) {
		if (!expectedPaths.has(wsPath) && POU_EXTENSIONS.some((e) => wsPath.endsWith(e))) return false;
	}

	return true;
}

// ─── Workspace → bridge push (LSP-driven diff translation) ────────────

/**
 * Translate the diff between two snapshot commits into a list of
 * primitive bridge ops. Per-POU, parse-driven: every `.st` file is one
 * POU, so the file-level diff maps directly to POU events; per-child
 * changes come from running the LSP parser on each file.
 */
export async function applyPushToBridge(
	repoPath: string,
	bridge: Remote,
	newCommitSha: string,
): Promise<{ accepted: true; commitSha: string } | { accepted: false; reason: string }> {
	const state = loadState(repoPath);
	if (state === undefined) {
		return { accepted: false, reason: "no snapshot to diff against — run `volt import` once first" };
	}

	const newTreeEntries = listTree(repoPath, newCommitSha);
	const prevTreeEntries = listTree(repoPath, state.commitSha);

	const ops = buildPushOps(repoPath, prevTreeEntries, newTreeEntries, state);
	if (ops.length === 0) {
		saveState(repoPath, { ...state, commitSha: newCommitSha });
		return { accepted: true, commitSha: newCommitSha };
	}

	const pushReq = { ops, expectedProjectVersion: state.projectVersion };
	const resp: PushResponse = await bridge.pushBatch(pushReq);

	if (!resp.accepted) {
		const summary = resp.conflicts
			.map((c) => `${c.name}: ${c.reason} (yours=${c.yourVersion ?? "null"}, current=${c.currentVersion ?? "null"})`)
			.join("; ");
		return { accepted: false, reason: `bridge rejected push: ${summary}` };
	}

	const newFolders: Record<string, string> = {};
	for (const entry of newTreeEntries) {
		const name = pouNameFromPath(entry.path);
		if (name === undefined) continue;
		const segs = entry.path.split("/");
		newFolders[name] = segs.slice(0, -1).join("/");
	}

	saveState(repoPath, {
		projectVersion: resp.newProjectVersion,
		commitSha: newCommitSha,
		items: { ...resp.newItems },
		folders: newFolders,
	});

	return { accepted: true, commitSha: newCommitSha };
}

interface PouFile {
	name: string;
	folder: string;
	entry: TreeEntry;
}

function buildPouFileMap(entries: readonly TreeEntry[]): Map<string, PouFile> {
	const out = new Map<string, PouFile>();
	for (const entry of entries) {
		const name = pouNameFromPath(entry.path);
		if (name === undefined) continue;
		const segs = entry.path.split("/");
		const folder = segs.slice(0, -1).join("/");
		out.set(name, { name, folder, entry });
	}
	return out;
}

function buildPushOps(
	repoPath: string,
	prevEntries: readonly TreeEntry[],
	newEntries: readonly TreeEntry[],
	state: RepoState,
): PushOp[] {
	const prev = buildPouFileMap(prevEntries);
	const curr = buildPouFileMap(newEntries);
	const ops: PushOp[] = [];

	// 1. POU deletions.
	for (const [name] of prev) {
		if (curr.has(name)) continue;
		const ifVersion = state.items[name];
		if (ifVersion === undefined) continue;
		const op: DeletePouOp = { op: "deletePou", name, ifVersion };
		ops.push(op);
	}

	// 2. POU creates + updates.
	for (const [name, currFile] of curr) {
		const prevFile = prev.get(name);
		const currContent = denormalizeLineEndings(readBlob(repoPath, currFile.entry.sha));
		if (prevFile === undefined) {
			ops.push(...buildCreatePouOps(name, currFile, currContent));
			continue;
		}
		const folderChanged = prevFile.folder !== currFile.folder;
		const contentChanged = prevFile.entry.sha !== currFile.entry.sha;
		if (!folderChanged && !contentChanged) continue;

		const ifVersion = state.items[name];
		if (ifVersion === undefined) continue;

		if (folderChanged) {
			ops.push({ op: "movePou", name, newFolder: currFile.folder, ifVersion });
		}
		if (contentChanged) {
			const prevContent = denormalizeLineEndings(readBlob(repoPath, prevFile.entry.sha));
			ops.push(...diffPou(name, prevContent, currContent, ifVersion));
		}
	}

	return ops;
}

// ─── Per-POU diff ──────────────────────────────────────────────────────

function buildCreatePouOps(name: string, currFile: PouFile, currContent: string): PushOp[] {
	const ops: PushOp[] = [];
	const kind = inferPouKind(currContent);
	if (!COMPOSITE_KINDS.has(kind)) {
		const split = splitDeclImpl(currContent);
		const createPou: CreatePouOp = {
			op: "createPou",
			name,
			...(currFile.folder.length > 0 && { folder: currFile.folder }),
			kind,
			declaration: split.declaration,
			...(split.implementation !== undefined && { implementation: split.implementation }),
			ifVersion: null,
		};
		ops.push(createPou);
		return ops;
	}

	const parsed = parseFile(currContent, name);
	const createPou: CreatePouOp = {
		op: "createPou",
		name,
		...(currFile.folder.length > 0 && { folder: currFile.folder }),
		kind,
		declaration: parsed.pou.declaration,
		implementation: parsed.pou.implementation,
		ifVersion: null,
	};
	ops.push(createPou);

	for (const child of parsed.children.values()) {
		ops.push(...createChildOps(name, child));
	}
	return ops;
}

function createChildOps(parent: string, child: ParsedChild): PushOp[] {
	const ops: PushOp[] = [];
	const folderPart = child.folder !== undefined && child.folder.length > 0
		? { folder: child.folder }
		: {};
	if (child.kind === "property") {
		const createChild: CreateChildOp = {
			op: "createChild",
			parent,
			name: child.name,
			kind: "property",
			declaration: child.declaration,
			...folderPart,
			ifVersion: null,
		};
		ops.push(createChild);
		if (child.getter !== undefined) {
			const setAcc: SetAccessorOp = {
				op: "setAccessor",
				parent,
				property: child.name,
				which: "get",
				...(child.getter.declaration.length > 0 && { declaration: child.getter.declaration }),
				implementation: child.getter.implementation,
				ifVersion: null,
			};
			ops.push(setAcc);
		}
		if (child.setter !== undefined) {
			const setAcc: SetAccessorOp = {
				op: "setAccessor",
				parent,
				property: child.name,
				which: "set",
				...(child.setter.declaration.length > 0 && { declaration: child.setter.declaration }),
				implementation: child.setter.implementation,
				ifVersion: null,
			};
			ops.push(setAcc);
		}
		return ops;
	}
	const createChild: CreateChildOp = {
		op: "createChild",
		parent,
		name: child.name,
		kind: child.kind,
		declaration: child.declaration,
		...(child.implementation.length > 0 && { implementation: child.implementation }),
		...folderPart,
		ifVersion: null,
	};
	ops.push(createChild);
	return ops;
}

function diffPou(
	name: string,
	prevContent: string,
	currContent: string,
	ifVersion: string,
): PushOp[] {
	const kind = inferPouKind(currContent);
	if (!COMPOSITE_KINDS.has(kind)) {
		// Simple POU — opaque blob; emit updatePou with full split.
		const split = splitDeclImpl(currContent);
		const updatePou: UpdatePouOp = {
			op: "updatePou",
			name,
			declaration: split.declaration,
			implementation: split.implementation ?? "",
			ifVersion,
		};
		return [updatePou];
	}

	const prev = parseFile(prevContent, name);
	const curr = parseFile(currContent, name);
	const ops: PushOp[] = [];

	if (
		prev.pou.declaration !== curr.pou.declaration ||
		prev.pou.implementation !== curr.pou.implementation
	) {
		const updatePou: UpdatePouOp = {
			op: "updatePou",
			name,
			declaration: curr.pou.declaration,
			implementation: curr.pou.implementation,
			ifVersion,
		};
		ops.push(updatePou);
	}

	for (const childName of prev.children.keys()) {
		if (curr.children.has(childName)) continue;
		const deleteChild: DeleteChildOp = { op: "deleteChild", parent: name, name: childName, ifVersion };
		ops.push(deleteChild);
	}

	for (const [childName, currChild] of curr.children) {
		const prevChild = prev.children.get(childName);
		if (prevChild === undefined) {
			ops.push(...createChildOps(name, currChild));
			continue;
		}
		ops.push(...diffChild(name, prevChild, currChild, ifVersion));
	}

	return ops;
}

function diffChild(
	parent: string,
	prev: ParsedChild,
	curr: ParsedChild,
	ifVersion: string,
): PushOp[] {
	const ops: PushOp[] = [];

	if (curr.kind === "property" && prev.kind === "property") {
		if (prev.declaration !== curr.declaration) {
			const updateChild: UpdateChildOp = {
				op: "updateChild",
				parent,
				name: curr.name,
				declaration: curr.declaration,
				implementation: "",
				ifVersion,
			};
			ops.push(updateChild);
		}
		ops.push(...diffAccessor(parent, curr.name, "get", prev.getter, curr.getter, ifVersion));
		ops.push(...diffAccessor(parent, curr.name, "set", prev.setter, curr.setter, ifVersion));
		return ops;
	}

	if (prev.declaration !== curr.declaration || prev.implementation !== curr.implementation) {
		const updateChild: UpdateChildOp = {
			op: "updateChild",
			parent,
			name: curr.name,
			declaration: curr.declaration,
			implementation: curr.implementation,
			ifVersion,
		};
		ops.push(updateChild);
	}
	return ops;
}

function diffAccessor(
	parent: string,
	propName: string,
	which: "get" | "set",
	prev: ParsedChild["getter"],
	curr: ParsedChild["getter"],
	ifVersion: string,
): PushOp[] {
	if (prev === undefined && curr === undefined) return [];
	if (prev !== undefined && curr === undefined) {
		const del: DeleteAccessorOp = {
			op: "deleteAccessor",
			parent,
			property: propName,
			which,
			ifVersion,
		};
		return [del];
	}
	if (curr === undefined) return [];
	if (
		prev !== undefined &&
		prev.declaration === curr.declaration &&
		prev.implementation === curr.implementation
	) {
		return [];
	}
	const setOp: SetAccessorOp = {
		op: "setAccessor",
		parent,
		property: propName,
		which,
		...(curr.declaration.length > 0 && { declaration: curr.declaration }),
		implementation: curr.implementation,
		ifVersion: prev === undefined ? null : ifVersion,
	};
	return [setOp];
}

// ─── Helpers ──────────────────────────────────────────────────────────

function pouNameFromPath(path: string): string | undefined {
	for (const ext of POU_EXTENSIONS) {
		if (path.endsWith(ext)) {
			const segs = path.split("/");
			const fileName = segs[segs.length - 1]!;
			return fileName.slice(0, -ext.length);
		}
	}
	return undefined;
}

/**
 * Choose the file extension for an item.
 *
 * Logic:
 *  1. Interface always → `.itf` (no body language applies).
 *  2. Pure-declaration kinds (gvl / dut variants) → KIND_EXT.
 *  3. POU body kinds (FB / function / program) → LANG_EXT[language]
 *     when bridge reports a body language; else KIND_EXT (`.st`).
 */
function pickExtension(kind: CreatePouOp["kind"], language?: string): string {
	if (kind === "interface") return KIND_EXT[kind];
	if (!COMPOSITE_KINDS.has(kind)) return KIND_EXT[kind] ?? "st";
	// POU body — prefer language-driven extension if bridge tells us.
	if (language !== undefined && LANG_EXT[language] !== undefined) {
		return LANG_EXT[language]!;
	}
	return KIND_EXT[kind] ?? "st";
}

function inferPouKind(declaration: string): CreatePouOp["kind"] {
	const head = declaration.trimStart().toUpperCase();
	if (head.startsWith("FUNCTION_BLOCK")) return "function_block";
	if (head.startsWith("FUNCTION")) return "function";
	if (head.startsWith("PROGRAM")) return "program";
	if (head.startsWith("INTERFACE")) return "interface";
	if (head.startsWith("VAR_GLOBAL")) return "gvl";
	if (head.startsWith("TYPE")) {
		const upper = declaration.toUpperCase();
		if (upper.includes("STRUCT")) return "structure";
		if (upper.includes("UNION")) return "union";
		if (upper.includes("(")) return "enumeration";
		return "alias";
	}
	return "function_block";
}

function inferChildKind(declaration: string): ChildKind {
	const head = declaration.trimStart().toUpperCase();
	if (head.startsWith("METHOD")) return "method";
	if (head.startsWith("ACTION")) return "action";
	if (head.startsWith("PROPERTY")) return "property";
	return "method";
}

function joinPath(...parts: string[]): string {
	return parts.filter((p) => p.length > 0).join("/");
}

function joinDeclImpl(decl: string | undefined, impl: string | undefined): string {
	const d = decl ?? "";
	const i = impl ?? "";
	if (d.length === 0) return i;
	if (i.length === 0) return d;
	const sep = d.endsWith("\n") ? "" : "\n";
	return `${d}${sep}\n${i}`;
}

interface SplitDeclImpl {
	declaration: string;
	implementation?: string;
}

/**
 * Split declaration and implementation text for SIMPLE POUs (GVL, DUT,
 * alias) — the kinds the LSP parser doesn't structurally decompose for
 * us. Composite POUs (FB / PROGRAM / FUNCTION / INTERFACE) go through
 * `parseFile` instead, which gives full AST-driven extraction.
 *
 * Heuristic: declaration is everything up to and including the LAST
 * `END_VAR`; implementation is whatever follows. Good enough for the
 * non-composite cases that have neither nested children nor structured
 * blocks beyond their VAR sections.
 */
function splitDeclImpl(source: string): SplitDeclImpl {
	const lastEndVar = source.lastIndexOf("END_VAR");
	if (lastEndVar < 0) return { declaration: source.trimEnd() };
	const eol = source.indexOf("\n", lastEndVar);
	if (eol < 0) return { declaration: source.trimEnd() };
	const declRaw = source.slice(0, eol);
	const rest = source.slice(eol + 1);
	if (rest.trim().length === 0) return { declaration: declRaw.trimEnd() };
	return { declaration: declRaw.trimEnd(), implementation: rest.trim() };
}

function normalizeLineEndings(s: string): string {
	return s.replace(/\r\n/g, "\n");
}

function denormalizeLineEndings(s: string): string {
	return s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
}

