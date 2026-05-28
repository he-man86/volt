/**
 * Bridge wire types — the HTTP shape every bridge daemon speaks.
 * Vendor-agnostic by design: tools depend on the `Remote` interface
 * (see `./remote.ts`), and any bridge (Beckhoff, CODESYS, TIA, …)
 * that satisfies these types is interchangeable.
 *
 * Protocol model: git-inspired refs + atomic batched push.
 *
 *   GET  /health     → liveness + the stable identifiers (platform, projectName,
 *                       plcProjectName) used to pick the workspace dir
 *   GET  /refs       → project + per-item content versions (cheap, no payload)
 *   POST /fetch      → only the items that changed since the client's known versions
 *   POST /push       → atomic batch with per-item ifVersion guards (optimistic
 *                       concurrency); rejects the whole batch on any conflict
 *   POST /build      → build + diagnostics
 *
 * Bridges compute SHA-1 content fingerprints per item and per project.
 * No domain logic on the wire — just primitive item access with
 * versioning and atomic batch validation.
 */

// ─── Health ─────────────────────────────────────────────────────────────────

/**
 * GET /health — bridge liveness + the stable identifiers `volt init`
 * binds a workspace to. Every bridge MUST set `platform`, `projectName`,
 * `plcProjectName` to identifiers that are stable across content edits
 * (adds, deletes, renames of POUs) — those three together are the
 * "which IDE project is this?" key.
 */
export interface HealthResponse {
	status: "healthy" | "degraded" | "down";
	/** Vendor identifier — "beckhoff" | "codesys" | "tia" | ... */
	platform: string;
	/** True when the bridge has a live handle to the IDE. */
	connected: boolean;
	/** True when the IDE process is reachable. */
	ideAlive: boolean;
	/** Friendly IDE name (e.g. "TcXaeShell"). Informational. */
	ideName?: string;
	/** IDE version string. Informational. */
	ideVersion?: string;
	/** Bridge daemon version. */
	version: string;
	/** Solution-level project name (e.g. TwinCAT's `.tsproj` name). */
	projectName?: string;
	/** PLC-project-within-solution name (e.g. TwinCAT's `Untitled2`). */
	plcProjectName?: string;
	/** True when the IDE has unsaved changes. */
	projectDirty?: boolean;
}

// ─── Build ──────────────────────────────────────────────────────────────────

export interface BuildRequest {
	buildType: "incremental" | "full";
}

/**
 * Canonical cross-bridge diagnostic shape. Every bridge (Beckhoff,
 * CODESYS, TIA, …) normalizes its IDE's native error shape to THIS shape
 * at its own boundary — the TS layer never parses vendor-specific paths.
 */
export interface BridgeDiagnostic {
	severity: "error" | "warning" | "info";
	message: string;
	/** 1-based line within the object's section. 0 when the IDE didn't supply one. */
	line: number;
	/**
	 * Object the diagnostic belongs to. Bare for top-level (`"FB_X"`,
	 * `"PLC_PRG"`); dotted for children (`"FB_X.Execute"`,
	 * `"FB_X.Speed"`). `null` for project-level diagnostics not tied
	 * to a specific object.
	 */
	object: string | null;
	/**
	 * Which section of the object — declaration block or implementation
	 * body. `null` when the IDE didn't say.
	 */
	section: "decl" | "impl" | null;
}

export interface BuildResponse {
	/** True iff the build completed with zero failed projects. */
	success: boolean;
	/** Build wall time in milliseconds. */
	duration: number;
	diagnostics: BridgeDiagnostic[];
}

// ─── Item content shapes (used by /fetch and /push) ─────────────────────────

/**
 * IEC 61131 implementation language for an item or child body, as
 * detected by the bridge from the XML wrapper it gets back from the
 * IDE. Bridges that can't classify a body return "UNKNOWN" (a real
 * signal, not a silent default — investigate when you see it).
 *
 * Why this lives at the wire level: AI clients and future graphical
 * LSPs route per language without parsing the body. While a graphical
 * LSP doesn't exist yet, the bridge masks graphical bodies with a
 * placeholder and clients see `language: "FBD"` etc. — once the LSP
 * lands, the mask drops and clients still consume the same field.
 */
export type ImplementationLanguage = "ST" | "FBD" | "LD" | "SFC" | "CFC" | "UNKNOWN";

export interface AIChildInfo {
	name: string;
	declaration?: string;
	implementation?: string;
	/**
	 * Language of `implementation` (ST / FBD / LD / SFC / CFC / UNKNOWN).
	 * Always present for methods and actions. Graphical bodies are
	 * currently returned as a placeholder; the language field tells
	 * you which language is being masked.
	 */
	language?: ImplementationLanguage;
	/** Property getter/setter bodies — only set on PROPERTY children. */
	getterCode?: string;
	setterCode?: string;
	/** Folder within the parent FB (e.g. "Modes" or "Modes/Sub"). Empty/absent = at the FB's root. */
	folder?: string;
	getterDeclaration?: string;
	setterDeclaration?: string;
}

export interface AIGetResult {
	name: string;
	/** Slash-joined containing folder in the project tree (e.g. "POUs/Motors").
	 *  Empty/absent = item lives at the Application / Device root. */
	folder?: string;
	/**
	 * Vendor-neutral kind string ("function_block" / "function" /
	 * "program" / "gvl" / "structure" / "enumeration" / "interface" /
	 * etc.). Every bridge implementation translates its native type
	 * code to this canonical vocabulary, so clients never need
	 * vendor-specific knowledge to route an item.
	 */
	kind?: string;
	declaration?: string;
	implementation?: string;
	/**
	 * Language of `implementation` (ST / FBD / LD / SFC / CFC / UNKNOWN).
	 * Always present for POUs (function blocks, functions, programs).
	 * Absent for declaration-only items (DUTs, GVLs, interfaces) since
	 * those have no implementation body. Graphical bodies are currently
	 * masked with a placeholder string in `implementation`; this field
	 * tells you which language is hidden behind the mask.
	 */
	language?: ImplementationLanguage;
	children?: AIChildInfo[];
	/** Per-item version stamp (sha1 short) — present on items returned by /fetch. */
	version?: string;
}

// ─── /refs ──────────────────────────────────────────────────────────────────

export interface RefsResponse {
	/** sha1 of the sorted (name → itemVersion) map. Changes on ANY edit. */
	projectVersion: string;
	/** sha1 of sorted item names only. Stable across content edits; changes only on add/rename/delete. Used to pick the workspace dir. */
	structureVersion: string;
	/** name → content fingerprint for every top-level CRUD item. */
	items: Record<string, string>;
	/**
	 * Parallel map of name → vendor-neutral kind string. Lets clients
	 * route per kind without re-inferring from a /fetch round-trip.
	 * Every bridge translates its native type codes to this canonical
	 * vocabulary, so clients stay vendor-agnostic.
	 */
	kinds?: Record<string, string>;
}

// ─── /fetch ─────────────────────────────────────────────────────────────────

export interface FetchRequest {
	/** Client's currently-known {name → version} map. Omit / pass {} for "I have nothing". */
	knownItems?: Record<string, string>;
}

export interface FetchResponse {
	/** Current project version (same as /refs would return). */
	projectVersion: string;
	/** Current structure version (same as /refs would return). */
	structureVersion: string;
	/** Items whose version differs from (or is absent from) the client's known map. */
	changed: AIGetResult[];
	/** Names the client knew about that no longer exist in the IDE. */
	removed: string[];
	/** Full ref map — the client can replace its cache wholesale with this. */
	items: Record<string, string>;
}

// ─── /push ──────────────────────────────────────────────────────────────────
//
// Primitive op set. Each op corresponds to ONE COM/API operation on the
// target IDE — no diff logic, no type-detection branching, no enumeration
// happens inside the bridge. The "what changed?" reasoning is the
// CLIENT's job (the `volt export` verb computes it by diffing the
// workspace tree against the last-imported snapshot; an AI/CLI can
// compute it however it wants).
//
// All ops carry an `ifVersion` guard. For ops that AFFECT an item that
// must already exist (update/delete/rename/move), `ifVersion` is the
// expected current version of the *parent POU* (or the POU itself for
// POU-level ops). For creates, `ifVersion` is `null`.
//
// Atomic batch: bridge validates ALL ops' ifVersion against the
// pre-batch state, then applies them in declared order. On any
// validation failure, the whole batch is rejected with per-op
// diagnostics.
//
// Three op categories: POU lifecycle, child lifecycle (method / action /
// property declaration), property accessor lifecycle (Get/Set bodies).

export type PushOp =
	| CreatePouOp
	| UpdatePouOp
	| DeletePouOp
	| RenamePouOp
	| MovePouOp
	| CreateChildOp
	| UpdateChildOp
	| DeleteChildOp
	| RenameChildOp
	| SetAccessorOp
	| DeleteAccessorOp;

/** Top-level POU kinds the bridge can create. */
export type PouKind =
	| "function_block"
	| "function"
	| "program"
	| "structure"
	| "union"
	| "enumeration"
	| "alias"
	| "interface"
	| "gvl";

/** Sub-POU child kinds (live inside an FB / interface). Property has its OWN accessor ops. */
export type ChildKind = "method" | "action" | "property";

// ─── POU lifecycle ────────────────────────────────────────────────────

export interface CreatePouOp {
	op: "createPou";
	name: string;
	folder?: string;
	kind: PouKind;
	declaration: string;
	/** Body code. Not applicable for DUTs (structure/union/enumeration/alias), interfaces, GVLs. */
	implementation?: string;
	/** Must be `null`: this op refuses to overwrite. */
	ifVersion: null;
}

export interface UpdatePouOp {
	op: "updatePou";
	name: string;
	/**
	 * Full declaration. Required — caller always sends the complete
	 * current state of the field, even if it didn't change. Mirrors
	 * TwinCAT's COM model where DeclarationText + ImplementationText
	 * are paired properties on the same item: the IDE never writes one
	 * without the other, and neither does any well-behaved bridge.
	 */
	declaration: string;
	/**
	 * Full implementation. Required. Pass empty string for POU kinds
	 * that don't have an implementation (the bridge silently no-ops
	 * the write on those types).
	 */
	implementation: string;
	ifVersion: string;
}

export interface DeletePouOp {
	op: "deletePou";
	name: string;
	ifVersion: string;
}

export interface RenamePouOp {
	op: "renamePou";
	name: string;
	newName: string;
	ifVersion: string;
}

export interface MovePouOp {
	op: "movePou";
	name: string;
	newFolder: string;
	ifVersion: string;
}

// ─── Child lifecycle (method / action / property declaration) ─────────
//
// `parent` is the top-level POU containing the child. `folder` is the
// optional in-FB organizational folder. For property children, the
// `declaration` is treated as STRUCTURED metadata (TwinCAT canonicalizes
// it: only name/access/returnType survive; comments are dropped). The
// editable freeform text for a property lives in its Get/Set accessors —
// use `setAccessor` ops to push body code.

export interface CreateChildOp {
	op: "createChild";
	parent: string;
	name: string;
	folder?: string;
	kind: ChildKind;
	declaration: string;
	/** Body. Not applicable for `kind: "property"` (use setAccessor for that). */
	implementation?: string;
	/** Must be `null`. */
	ifVersion: null;
}

export interface UpdateChildOp {
	op: "updateChild";
	parent: string;
	name: string;
	/**
	 * Full declaration. Required — same pairing rule as UpdatePouOp.
	 * For child kinds where declaration is semantically empty (action),
	 * pass empty string.
	 */
	declaration: string;
	/**
	 * Full implementation. Required. Pass empty string for child kinds
	 * that don't have an implementation (property — use `setAccessor`
	 * ops to push Get/Set bodies).
	 */
	implementation: string;
	/** Parent POU's version at op-issuance time. */
	ifVersion: string;
}

export interface DeleteChildOp {
	op: "deleteChild";
	parent: string;
	name: string;
	ifVersion: string;
}

export interface RenameChildOp {
	op: "renameChild";
	parent: string;
	name: string;
	newName: string;
	ifVersion: string;
}

// ─── Property accessor lifecycle (Get / Set bodies) ───────────────────
//
// Properties in TwinCAT (and most PLC IDEs) have 0+ accessors — Get and
// Set — each with their OWN declaration (local VAR blocks) and
// implementation (the body). These ops manage them.
//
// `parent` is the top-level POU containing the property. `property` is
// the property's name within that parent.

export interface SetAccessorOp {
	op: "setAccessor";
	parent: string;
	property: string;
	which: "get" | "set";
	/** Local VAR_xxx block for this accessor. Omit if the accessor has no locals. */
	declaration?: string;
	implementation: string;
	/** Parent POU's version, or `null` if the accessor doesn't exist yet. */
	ifVersion: string | null;
}

export interface DeleteAccessorOp {
	op: "deleteAccessor";
	parent: string;
	property: string;
	which: "get" | "set";
	ifVersion: string;
}

// ─── Batch envelope ───────────────────────────────────────────────────

export interface PushRequest {
	ops: PushOp[];
	/** Optional batch-level guard. If set, must match current /refs.projectVersion. */
	expectedProjectVersion?: string;
}

export interface PushConflict {
	name: string;
	yourVersion: string | null;
	currentVersion: string | null;
	reason: string;
}

export type PushResponse = PushAccepted | PushRejected;

export interface PushAccepted {
	accepted: true;
	newProjectVersion: string;
	/** Refreshed ref map — client can adopt this as its new cache. */
	newItems: Record<string, string>;
}

export interface PushRejected {
	accepted: false;
	conflicts: PushConflict[];
	currentProjectVersion: string;
}
