/**
 * In-process bridge stub for tests. Simulates the live bridge protocol
 * (getRefs / fetchChanges / pushBatch / build) over an in-memory item
 * map, with content-fingerprint versioning that matches the production
 * shape (sha1-of-content, recursive over children).
 *
 * Test code mutates `items` directly to simulate engineer-side IDE
 * edits between rounds (or calls `mutate(name, patch)` for convenience).
 * No HTTP, no PLC, no COM — fast and deterministic.
 */
import { createHash } from "node:crypto";
import type {
	AIChildInfo,
	AIGetResult,
	BuildRequest,
	BuildResponse,
	FetchRequest,
	FetchResponse,
	HealthResponse,
	PushConflict,
	PushOp,
	PushRequest,
	PushResponse,
	RefsResponse,
} from "./types.js";
import type { Remote } from "./remote.js";

export interface TestBridgeOptions {
	initialItems?: AIGetResult[];
	/** Per-call override for build. Default: ok with no diagnostics. */
	build?: (req: BuildRequest) => Promise<BuildResponse>;
	/** Override the health response — defaults to a synthetic "beckhoff/test-project". */
	health?: Partial<HealthResponse>;
}

export class TestBridge implements Remote {
	items = new Map<string, AIGetResult>();
	pushCalls: PushRequest[] = [];
	buildCalls: BuildRequest[] = [];
	private readonly buildImpl: NonNullable<TestBridgeOptions["build"]>;
	private readonly healthOverride: Partial<HealthResponse>;

	constructor(opts: TestBridgeOptions = {}) {
		for (const item of opts.initialItems ?? []) {
			this.items.set(item.name, withInferredKind(item));
		}
		this.buildImpl =
			opts.build ?? (async () => ({ success: true, duration: 0, errors: 0, warnings: 0, diagnostics: [] }));
		this.healthOverride = opts.health ?? {};
	}

	async getHealth(): Promise<HealthResponse> {
		return {
			status: "healthy",
			platform: "beckhoff",
			connected: true,
			ideAlive: true,
			version: "0.0.0-test",
			projectName: "TestSolution",
			plcProjectName: "TestPlc",
			...this.healthOverride,
		};
	}

	async getRefs(): Promise<RefsResponse> {
		const versions = this.computeVersions();
		return {
			projectVersion: hashMap(versions),
			structureVersion: hashStructure(versions),
			items: versions,
		};
	}

	async fetchChanges(req: FetchRequest): Promise<FetchResponse> {
		const versions = this.computeVersions();
		const known = req.knownItems ?? {};
		const changed: AIGetResult[] = [];
		for (const [name, version] of Object.entries(versions)) {
			if (known[name] !== version) {
				const item = this.items.get(name);
				if (item !== undefined) changed.push({ ...item, version });
			}
		}
		const removed: string[] = [];
		for (const name of Object.keys(known)) {
			if (!(name in versions)) removed.push(name);
		}
		return {
			projectVersion: hashMap(versions),
			structureVersion: hashStructure(versions),
			changed,
			removed,
			items: versions,
		};
	}

	async pushBatch(req: PushRequest): Promise<PushResponse> {
		this.pushCalls.push(req);
		const versions = this.computeVersions();
		const conflicts: PushConflict[] = [];

		// Validate batch-level guard.
		if (req.expectedProjectVersion !== undefined) {
			const currentProjectVersion = hashMap(versions);
			if (req.expectedProjectVersion !== currentProjectVersion) {
				return {
					accepted: false,
					conflicts: [
						{
							name: "<project>",
							yourVersion: req.expectedProjectVersion,
							currentVersion: currentProjectVersion,
							reason: "project version mismatch",
						},
					],
					currentProjectVersion,
				};
			}
		}

		// Per-op validation against pre-batch state. Ops on the same POU
		// must use the same ifVersion (the pre-batch POU hash) — validation
		// is against pre-batch, application is sequential.
		for (const op of req.ops) {
			const affected = affectedPouName(op);
			if (affected === undefined) continue;
			const currentVersion = versions[affected] ?? null;
			const isCreate =
				(op.op === "createPou" || op.op === "createChild") && op.ifVersion === null;
			const isCreateAccessor = op.op === "setAccessor" && op.ifVersion === null;
			if (isCreate || isCreateAccessor) {
				// createPou: parent (= self) must not exist.
				// createChild/setAccessor with ifVersion=null: parent (POU) must EXIST.
				if (op.op === "createPou" && currentVersion !== null) {
					conflicts.push({
						name: op.name,
						yourVersion: null,
						currentVersion,
						reason: "expected to create new POU but it already exists",
					});
				}
				// For child/accessor creates, the parent must exist.
				if (op.op !== "createPou" && currentVersion === null) {
					conflicts.push({
						name: affected,
						yourVersion: null,
						currentVersion: null,
						reason: "expected parent POU to exist for create-child/setAccessor",
					});
				}
				continue;
			}
			if (op.ifVersion !== null && currentVersion !== op.ifVersion) {
				conflicts.push({
					name: affected,
					yourVersion: op.ifVersion,
					currentVersion,
					reason:
						currentVersion === null
							? "expected POU to exist but it doesn't"
							: "POU changed since you fetched its version",
				});
			}
		}

		if (conflicts.length > 0) {
			return {
				accepted: false,
				conflicts,
				currentProjectVersion: hashMap(versions),
			};
		}

		// All guards passed — apply ops in declared order.
		for (const op of req.ops) {
			this.applyOp(op);
		}
		const newVersions = this.computeVersions();
		return {
			accepted: true,
			newProjectVersion: hashMap(newVersions),
			newItems: newVersions,
		};
	}

	async build(req: BuildRequest): Promise<BuildResponse> {
		this.buildCalls.push(req);
		return this.buildImpl(req);
	}

	// ─── Test helpers ──────────────────────────────────────────────────

	/** Add or replace an item to simulate engineer-side IDE edits. */
	mutate(name: string, item: AIGetResult | undefined): void {
		if (item === undefined) this.items.delete(name);
		else this.items.set(name, withInferredKind({ ...item, name }));
	}

	private applyOp(op: PushOp): void {
		switch (op.op) {
			// ── POU-level
			case "createPou": {
				const created: AIGetResult = {
					name: op.name,
					kind: op.kind,
					...(op.folder !== undefined && { folder: op.folder }),
					declaration: op.declaration,
					...(op.implementation !== undefined && { implementation: op.implementation }),
					children: [],
				};
				this.items.set(op.name, created);
				return;
			}
			case "updatePou": {
				const existing = this.items.get(op.name);
				if (existing === undefined) return;
				const updated: AIGetResult = { ...existing };
				if (op.declaration !== undefined) updated.declaration = op.declaration;
				if (op.implementation !== undefined) updated.implementation = op.implementation;
				this.items.set(op.name, updated);
				return;
			}
			case "deletePou":
				this.items.delete(op.name);
				return;
			case "renamePou": {
				const existing = this.items.get(op.name);
				if (existing === undefined) return;
				this.items.delete(op.name);
				this.items.set(op.newName, { ...existing, name: op.newName });
				return;
			}
			case "movePou": {
				const existing = this.items.get(op.name);
				if (existing === undefined) return;
				this.items.set(op.name, { ...existing, folder: op.newFolder });
				return;
			}

			// ── Child-level
			case "createChild": {
				const parent = this.items.get(op.parent);
				if (parent === undefined) return;
				const children = [...(parent.children ?? [])];
				const newChild: AIChildInfo = {
					name: op.name,
					...(op.folder !== undefined && { folder: op.folder }),
					declaration: op.declaration,
					...(op.implementation !== undefined && op.kind !== "property" && { implementation: op.implementation }),
				};
				children.push(newChild);
				this.items.set(op.parent, { ...parent, children });
				return;
			}
			case "updateChild": {
				const parent = this.items.get(op.parent);
				if (parent === undefined) return;
				const children = (parent.children ?? []).map((c) => {
					if (c.name !== op.name) return c;
					const updated: AIChildInfo = { ...c };
					if (op.declaration !== undefined) updated.declaration = op.declaration;
					if (op.implementation !== undefined) updated.implementation = op.implementation;
					return updated;
				});
				this.items.set(op.parent, { ...parent, children });
				return;
			}
			case "deleteChild": {
				const parent = this.items.get(op.parent);
				if (parent === undefined) return;
				const children = (parent.children ?? []).filter((c) => c.name !== op.name);
				this.items.set(op.parent, { ...parent, children });
				return;
			}
			case "renameChild": {
				const parent = this.items.get(op.parent);
				if (parent === undefined) return;
				const children = (parent.children ?? []).map((c) =>
					c.name === op.name ? { ...c, name: op.newName } : c,
				);
				this.items.set(op.parent, { ...parent, children });
				return;
			}

			// ── Accessor-level
			case "setAccessor": {
				const parent = this.items.get(op.parent);
				if (parent === undefined) return;
				const children = (parent.children ?? []).map((c) => {
					if (c.name !== op.property) return c;
					const updated: AIChildInfo = { ...c };
					if (op.which === "get") {
						if (op.declaration !== undefined) updated.getterDeclaration = op.declaration;
						updated.getterCode = op.implementation;
					} else {
						if (op.declaration !== undefined) updated.setterDeclaration = op.declaration;
						updated.setterCode = op.implementation;
					}
					return updated;
				});
				this.items.set(op.parent, { ...parent, children });
				return;
			}
			case "deleteAccessor": {
				const parent = this.items.get(op.parent);
				if (parent === undefined) return;
				const children = (parent.children ?? []).map((c) => {
					if (c.name !== op.property) return c;
					const updated: AIChildInfo = { ...c };
					if (op.which === "get") {
						delete updated.getterDeclaration;
						delete updated.getterCode;
					} else {
						delete updated.setterDeclaration;
						delete updated.setterCode;
					}
					return updated;
				});
				this.items.set(op.parent, { ...parent, children });
				return;
			}
		}
	}

	private computeVersions(): Record<string, string> {
		const out: Record<string, string> = {};
		for (const [name, item] of this.items) {
			out[name] = hashItem(item);
		}
		return out;
	}
}

/** The POU whose version an op's ifVersion is validated against. */
function affectedPouName(op: PushOp): string | undefined {
	switch (op.op) {
		case "createPou":
		case "updatePou":
		case "deletePou":
		case "renamePou":
		case "movePou":
			return op.name;
		case "createChild":
		case "updateChild":
		case "deleteChild":
		case "renameChild":
		case "setAccessor":
		case "deleteAccessor":
			return op.parent;
		default:
			return undefined;
	}
}

// ─── Test-side kind inference ──────────────────────────────────────────
//
// A real bridge reads `kind` from the IDE's COM metadata. TestBridge has
// no IDE — its source of truth is the declaration text the fixture
// author wrote. Inferring kind from that text at injection time keeps
// the wire shape strict (engine always sees `kind` set) without forcing
// every test fixture to repeat itself. This is fixture-side
// normalization, NOT an engine fallback.

function withInferredKind(item: AIGetResult): AIGetResult {
	if (item.kind !== undefined) return item;
	const kind = inferKindFromDeclaration(item.declaration ?? "");
	return kind === undefined ? item : { ...item, kind };
}

function inferKindFromDeclaration(decl: string): string | undefined {
	// Strip comments / attributes / leading whitespace before matching.
	const stripped = decl
		.replace(/\(\*[\s\S]*?\*\)/g, "")
		.replace(/\/\/[^\n]*/g, "")
		.replace(/\{[^}]*\}/g, "")
		.trim();
	if (/^FUNCTION_BLOCK\b/i.test(stripped)) return "function_block";
	if (/^FUNCTION\b/i.test(stripped)) return "function";
	if (/^PROGRAM\b/i.test(stripped)) return "program";
	if (/^INTERFACE\b/i.test(stripped)) return "interface";
	if (/\bVAR_GLOBAL\b/i.test(stripped)) return "gvl";
	if (/^TYPE\b[\s\S]*?:\s*STRUCT\b/i.test(stripped)) return "structure";
	if (/^TYPE\b[\s\S]*?:\s*\(/i.test(stripped)) return "enumeration";
	if (/^TYPE\b[\s\S]*?:\s*UNION\b/i.test(stripped)) return "union";
	if (/^TYPE\b/i.test(stripped)) return "alias";
	return undefined;
}

// ─── Hashing (deterministic, matches production shape conceptually) ────

function hashItem(item: AIGetResult): string {
	const h = createHash("sha1");
	h.update(`d=${item.declaration ?? ""}\0`);
	h.update(`i=${item.implementation ?? ""}\0`);
	const children = [...(item.children ?? [])].sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	h.update("c[\0");
	for (const c of children) {
		h.update(` n=${c.name}\0`);
		h.update(`d=${c.declaration ?? ""}\0`);
		h.update(`i=${c.implementation ?? ""}\0`);
		h.update(`gd=${c.getterDeclaration ?? ""}\0`);
		h.update(`gc=${c.getterCode ?? ""}\0`);
		h.update(`sd=${c.setterDeclaration ?? ""}\0`);
		h.update(`sc=${c.setterCode ?? ""}\0`);
		h.update(`p=${c.folder ?? ""}\0`);
		h.update(" --\0");
	}
	h.update("]\0");
	return h.digest("hex").slice(0, 16);
}

function hashMap(map: Record<string, string>): string {
	const h = createHash("sha1");
	const names = Object.keys(map).sort();
	for (const name of names) {
		h.update(`${name}=${map[name]}\0`);
	}
	return h.digest("hex").slice(0, 16);
}

function hashStructure(map: Record<string, string>): string {
	const h = createHash("sha1");
	const names = Object.keys(map).sort();
	for (const name of names) h.update(`${name}\0`);
	return h.digest("hex").slice(0, 16);
}
