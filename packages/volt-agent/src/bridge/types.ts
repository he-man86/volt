/**
 * Bridge wire types + schemas — the HTTP shape every bridge daemon speaks.
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
 *
 * SCHEMAS ARE THE SOURCE OF TRUTH. Each response is `.parse()`-validated
 * at the `BridgeClient` boundary so a buggy bridge surfaces as a loud
 * "bridge /endpoint returned malformed payload: …" instead of a downstream
 * `undefined is not a function` three layers deep. Response schemas are
 * `.strict()`: unknown fields are a loud error, not a silent strip — at
 * this stage we want both sides to evolve in lockstep.
 */
import { z } from "zod";

// ─── Health ─────────────────────────────────────────────────────────────────

/**
 * GET /health — bridge liveness + the stable identifiers `volt init`
 * binds a workspace to. Every bridge MUST set `platform`, `projectName`,
 * `plcProjectName` to identifiers that are stable across content edits
 * (adds, deletes, renames of POUs) — those three together are the
 * "which IDE project is this?" key.
 */
export const HealthResponseSchema = z
	.object({
		/**
		 * Three-way state:
		 *   "healthy"     — connected, COM channel responsive
		 *   "degraded"    — connected, but COM channel has had errors
		 *                   (read-only behavior recommended)
		 *   "unavailable" — no live handle to the IDE
		 */
		status: z.enum(["healthy", "degraded", "unavailable"]),
		/** Vendor identifier — "beckhoff" | "codesys" | "tia" | ... */
		platform: z.string(),
		/**
		 * OEM variant of the platform — when CODESYS is rebranded by an
		 * OEM (Lenze PLC Designer, Schneider EcoStruxure Machine Expert,
		 * Wago e!Cockpit, etc.), the variant name. Null for vanilla
		 * CODESYS or non-CODESYS platforms. The bridge derives this from
		 * the IDE process's product-info metadata (FileVersionInfo).
		 *
		 * Not consumed by the LSP today — the conformance ruleset is
		 * indexed by `platform` only. Variant matters for library docs
		 * (each OEM ships its own library set) and is plumbed here so
		 * that work can branch on it later without a wire-protocol bump.
		 */
		platformVariant: z.string().nullish(),
		/** True when the bridge has a live handle to the IDE. */
		connected: z.boolean(),
		/** True when the IDE process is reachable. */
		ideAlive: z.boolean(),
		/**
		 * True when the COM channel has had recent errors but is still
		 * responsive. Clients should treat the bridge as read-only-safe
		 * but avoid heavy writes until the next health probe clears it.
		 */
		degraded: z.boolean(),
		/** Human-readable reason for `degraded=true`; null when not degraded. */
		degradedReason: z.string().nullable(),
		/**
		 * Friendly IDE name (e.g. "TcXaeShell"). C# may serialize as null
		 * when not connected, so we accept null/undefined as well as string.
		 */
		ideName: z.string().nullish(),
		/** IDE version string. Same nullability semantics as `ideName`. */
		ideVersion: z.string().nullish(),
		/** Bridge daemon version. */
		version: z.string(),
		/** Solution-level project name (e.g. TwinCAT's `.tsproj` name). */
		projectName: z.string().nullish(),
		/** PLC-project-within-solution name (e.g. TwinCAT's `Untitled2`). */
		plcProjectName: z.string().nullish(),
		/** True when the IDE has unsaved changes. */
		projectDirty: z.boolean().optional(),
	})
	.strict();
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// ─── Build ──────────────────────────────────────────────────────────────────

export const BuildRequestSchema = z.object({
	buildType: z.enum(["incremental", "full"]),
});
export type BuildRequest = z.infer<typeof BuildRequestSchema>;

/**
 * Canonical cross-bridge diagnostic shape. Every bridge (Beckhoff,
 * CODESYS, TIA, …) normalizes its IDE's native error shape to THIS shape
 * at its own boundary — the TS layer never parses vendor-specific paths.
 */
export const BridgeDiagnosticSchema = z
	.object({
		severity: z.enum(["error", "warning", "info"]),
		message: z.string(),
		/** 1-based line within the object's section. 0 when the IDE didn't supply one. */
		line: z.number(),
		/**
		 * Object the diagnostic belongs to. Bare for top-level (`"FB_X"`,
		 * `"PLC_PRG"`); dotted for children (`"FB_X.Execute"`,
		 * `"FB_X.Speed"`). `null` for project-level diagnostics not tied
		 * to a specific object.
		 */
		object: z.string().nullable(),
		/**
		 * Which section of the object — declaration block or implementation
		 * body. `null` when the IDE didn't say.
		 */
		section: z.enum(["decl", "impl"]).nullable(),
	})
	.strict();
export type BridgeDiagnostic = z.infer<typeof BridgeDiagnosticSchema>;

export const BuildResponseSchema = z
	.object({
		/** True iff the build completed with zero failed projects. */
		success: z.boolean(),
		/** Build wall time in milliseconds. */
		duration: z.number(),
		diagnostics: z.array(BridgeDiagnosticSchema),
	})
	.strict();
export type BuildResponse = z.infer<typeof BuildResponseSchema>;

// ─── Item content shapes (used by /fetch and /push) ─────────────────────────

/**
 * IEC 61131 implementation language for an item, as detected by the
 * bridge. Bridges that can't classify a body return "UNKNOWN" (a real
 * signal, not a silent default — investigate when you see it).
 *
 * Why this lives at the wire level: AI clients and future graphical
 * LSPs route per language without parsing the body. While a graphical
 * LSP doesn't exist yet, the bridge masks graphical bodies with a
 * placeholder embedded in `sourceText`; clients see `language: "FBD"`
 * and know not to interpret the placeholder.
 */
export const ImplementationLanguageSchema = z.enum(["ST", "FBD", "LD", "SFC", "CFC", "UNKNOWN"]);
export type ImplementationLanguage = z.infer<typeof ImplementationLanguageSchema>;

/**
 * Wire-shape v2 (2026-05-29): an item on the wire is one assembled
 * `.st` / `.gvl` / `.dut` / `.itf` file. The bridge owns the split
 * (via StSplitter) into POU + children; the agent owns nothing
 * structural. The workspace file shape and the wire shape are the
 * same `sourceText` — no impedance mismatch, no per-child decomposition.
 */
export const FetchedItemSchema = z
	.object({
		name: z.string(),
		/** Vendor-neutral kind ("function_block" / "function" / "program" /
		 *  "interface" / "gvl" / "structure" / "enumeration" / "union" /
		 *  "alias"). */
		kind: z.string(),
		/** Slash-joined containing folder in the project tree (e.g. "POUs/Motors").
		 *  Empty/absent = item at the project root. */
		folder: z.string().optional(),
		/**
		 * Full assembled file content — exactly what gets written to the
		 * workspace file. The bridge re-assembles POU + children on its
		 * side via StAssembler.
		 */
		sourceText: z.string(),
		/** Language of the body (graphical POUs get masked text + non-ST language tag). */
		language: ImplementationLanguageSchema.optional(),
		/** Per-item version stamp (sha1 short). */
		version: z.string(),
	})
	.strict();
export type FetchedItem = z.infer<typeof FetchedItemSchema>;

// ─── /refs ──────────────────────────────────────────────────────────────────

export const RefsResponseSchema = z
	.object({
		/** sha1 of the sorted (name → itemVersion) map. Changes on ANY edit. */
		projectVersion: z.string(),
		/** sha1 of sorted item names only. Stable across content edits; changes only on add/rename/delete. Used to pick the workspace dir. */
		structureVersion: z.string(),
		/** name → content fingerprint for every top-level CRUD item. */
		items: z.record(z.string()),
		/**
		 * Parallel map of name → vendor-neutral kind string. Lets clients
		 * route per kind without re-inferring from a /fetch round-trip.
		 * Every bridge translates its native type codes to this canonical
		 * vocabulary, so clients stay vendor-agnostic.
		 */
		kinds: z.record(z.string()).optional(),
	})
	.strict();
export type RefsResponse = z.infer<typeof RefsResponseSchema>;

// ─── /fetch ─────────────────────────────────────────────────────────────────

export const FetchRequestSchema = z.object({
	/** Client's currently-known {name → version} map. Omit / pass {} for "I have nothing". */
	knownItems: z.record(z.string()).optional(),
});
export type FetchRequest = z.infer<typeof FetchRequestSchema>;

export const FetchResponseSchema = z
	.object({
		/** Current project version (same as /refs would return). */
		projectVersion: z.string(),
		/** Current structure version (same as /refs would return). */
		structureVersion: z.string(),
		/** Items whose version differs from (or is absent from) the client's known map. */
		changed: z.array(FetchedItemSchema),
		/** Names the client knew about that no longer exist in the IDE. */
		removed: z.array(z.string()),
		/** Full ref map — the client can replace its cache wholesale with this. */
		items: z.record(z.string()),
	})
	.strict();
export type FetchResponse = z.infer<typeof FetchResponseSchema>;

// ─── /push (v2 wire shape) ──────────────────────────────────────────────────
//
// Four item-level ops. The agent treats each workspace file (one item
// per file) as ONE atomic unit and emits ONE op per affected file. The
// bridge re-splits the sourceText into POU + children internally via
// StSplitter; the child diff against TC's current state lives there
// too.
//
// `ifVersion`:
//   pushItem null → create-new (bridge rejects if item already exists)
//   pushItem string → update (must match current version)
//   delete/rename/move string → must match current version
//
// Atomic batch: bridge validates ALL ops' ifVersion against pre-batch
// state (with forward simulation so in-batch dependencies validate
// cleanly), then applies in declared order on success.

/** Top-level item kinds the bridge can produce. */
export const PouKindSchema = z.enum([
	"function_block",
	"function",
	"program",
	"structure",
	"union",
	"enumeration",
	"alias",
	"interface",
	"gvl",
]);
export type PouKind = z.infer<typeof PouKindSchema>;

export const PushItemOpSchema = z.object({
	op: z.literal("pushItem"),
	name: z.string(),
	folder: z.string().optional(),
	/**
	 * Full assembled file content — exactly what the workspace `.st` /
	 * `.gvl` / `.dut` / `.itf` file contains. The bridge runs
	 * StSplitter on it to recover POU + children for COM dispatch.
	 */
	sourceText: z.string(),
	/** `null` = create new; string = update existing (must match). */
	ifVersion: z.string().nullable(),
});
export type PushItemOp = z.infer<typeof PushItemOpSchema>;

export const DeleteItemOpSchema = z.object({
	op: z.literal("deleteItem"),
	name: z.string(),
	ifVersion: z.string(),
});
export type DeleteItemOp = z.infer<typeof DeleteItemOpSchema>;

export const RenameItemOpSchema = z.object({
	op: z.literal("renameItem"),
	name: z.string(),
	newName: z.string(),
	ifVersion: z.string(),
});
export type RenameItemOp = z.infer<typeof RenameItemOpSchema>;

export const MoveItemOpSchema = z.object({
	op: z.literal("moveItem"),
	name: z.string(),
	newFolder: z.string(),
	ifVersion: z.string(),
});
export type MoveItemOp = z.infer<typeof MoveItemOpSchema>;

export const PushOpSchema = z.discriminatedUnion("op", [
	PushItemOpSchema,
	DeleteItemOpSchema,
	RenameItemOpSchema,
	MoveItemOpSchema,
]);
export type PushOp = z.infer<typeof PushOpSchema>;

// ─── Batch envelope ───────────────────────────────────────────────────

export const PushRequestSchema = z.object({
	ops: z.array(PushOpSchema),
	/** Optional batch-level guard. If set, must match current /refs.projectVersion. */
	expectedProjectVersion: z.string().optional(),
});
export type PushRequest = z.infer<typeof PushRequestSchema>;

export const PushConflictSchema = z
	.object({
		name: z.string(),
		yourVersion: z.string().nullable(),
		currentVersion: z.string().nullable(),
		reason: z.string(),
	})
	.strict();
export type PushConflict = z.infer<typeof PushConflictSchema>;

export const PushAcceptedSchema = z
	.object({
		accepted: z.literal(true),
		newProjectVersion: z.string(),
		/** Refreshed ref map — client can adopt this as its new cache. */
		newItems: z.record(z.string()),
	})
	.strict();
export type PushAccepted = z.infer<typeof PushAcceptedSchema>;

export const PushRejectedSchema = z
	.object({
		accepted: z.literal(false),
		conflicts: z.array(PushConflictSchema),
		currentProjectVersion: z.string(),
	})
	.strict();
export type PushRejected = z.infer<typeof PushRejectedSchema>;

export const PushResponseSchema = z.discriminatedUnion("accepted", [
	PushAcceptedSchema,
	PushRejectedSchema,
]);
export type PushResponse = z.infer<typeof PushResponseSchema>;
