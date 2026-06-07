/**
 * In-process bridge stub for tests. Simulates the live bridge protocol
 * (getRefs / fetchChanges / pushBatch / build) over an in-memory item
 * map keyed by item name. Items are stored as their assembled
 * `sourceText` (the same shape the real bridge sends/receives).
 *
 * Test code mutates `items` directly to simulate engineer-side IDE
 * edits between rounds (or calls `mutate(name, patch)` for convenience).
 * No HTTP, no PLC, no COM — fast and deterministic.
 */
import { createHash } from "node:crypto";
import type {
	BuildRequest,
	BuildResponse,
	FetchRequest,
	FetchResponse,
	FetchedItem,
	GraphicalChild,
	HealthResponse,
	ImplementationLanguage,
	PushConflict,
	PushOp,
	PushRequest,
	PushResponse,
	RefsResponse,
} from "./types.js";
import type { Remote } from "./remote.js";

/**
 * Test-fixture shape — same fields a real bridge would return for a
 * fetched item. `kind` is required: fixtures must declare the bridge
 * kind explicitly (previously inferred via regex on sourceText, which
 * duplicated bridge logic and silently broke when new kinds landed).
 */
export interface TestBridgeItem {
	name: string;
	kind: string;
	folder?: string;
	language?: ImplementationLanguage;
	sourceText: string;
	/** PLCopen TC6 `<body>` XML for graphical POUs. Drives the
	 *  transpiler path in `materializeItem`. */
	implementationXml?: string;
	/** Non-textual children (FBD/LD/SFC/CFC actions/methods nested
	 *  inside an ST parent) — surfaced as separate read-only files. */
	graphicalChildren?: GraphicalChild[];
}

export interface TestBridgeOptions {
	initialItems?: TestBridgeItem[];
	/** Per-call override for build. Default: ok with no diagnostics. */
	build?: (req: BuildRequest) => Promise<BuildResponse>;
	/** Override the health response — defaults to a synthetic "beckhoff/test-project". */
	health?: Partial<HealthResponse>;
}

interface StoredItem {
	name: string;
	kind: string;
	folder?: string;
	language?: ImplementationLanguage;
	sourceText: string;
	implementationXml?: string;
	graphicalChildren?: GraphicalChild[];
}

export class TestBridge implements Remote {
	items = new Map<string, StoredItem>();
	pushCalls: PushRequest[] = [];
	buildCalls: BuildRequest[] = [];
	/**
	 * When set, getRefs/fetchChanges return THIS projectVersion instead
	 * of the items-hash-derived one. Lets tests simulate the case where
	 * the bridge bumped its projectVersion for a non-item reason (TC's
	 * dirty-bit flip, structural save). Set to `null` to restore the
	 * default behaviour.
	 */
	projectVersionOverride: string | null = null;
	private readonly buildImpl: NonNullable<TestBridgeOptions["build"]>;
	/** Mutable across the bridge's lifetime: scenarios simulate the
	 *  engineer renaming the project mid-session by patching fields here.
	 *  Read by `getHealth()` on every call. */
	healthOverride: Partial<HealthResponse>;

	constructor(opts: TestBridgeOptions = {}) {
		for (const item of opts.initialItems ?? []) {
			this.items.set(item.name, normalizeFixture(item));
		}
		this.buildImpl =
			opts.build ?? (async () => ({ success: true, duration: 0, diagnostics: [] }));
		this.healthOverride = opts.health ?? {};
	}

	/** Patch the in-memory `/health` response — scenarios use this to
	 *  simulate the engineer renaming the project in the IDE between
	 *  Volt CLI calls. */
	mutateHealth(patch: Partial<HealthResponse>): void {
		this.healthOverride = { ...this.healthOverride, ...patch };
	}

	async getHealth(): Promise<HealthResponse> {
		// Defaults match `makeTestEnv`'s saved binding so the binding
		// check (cli/{pull,push,build,status}.ts → verifyProjectBinding)
		// passes by default. Tests exercising the mismatch path mutate
		// these via `healthOverride`.
		return {
			status: "healthy",
			platform: "beckhoff",
			connected: true,
			ideAlive: true,
			degraded: false,
			degradedReason: null,
			version: "0.0.0-test",
			projectName: "ScenarioProject",
			plcProjectName: "ScenarioPlc",
			...this.healthOverride,
		};
	}

	async getRefs(): Promise<RefsResponse> {
		const versions = this.computeVersions();
		const kinds: Record<string, string> = {};
		const folders: Record<string, string> = {};
		for (const [name, item] of this.items) {
			kinds[name] = item.kind;
			folders[name] = item.folder ?? "";
		}
		return {
			projectVersion: this.projectVersionOverride ?? hashMap(versions),
			structureVersion: hashStructure(versions),
			items: versions,
			kinds,
			folders,
		};
	}

	async fetchChanges(req: FetchRequest): Promise<FetchResponse> {
		const versions = this.computeVersions();
		const known = req.knownItems ?? {};
		// Honor the optional allowlist the same way both real bridges do:
		// skip materialization for items not in `onlyItems`. Keeps the
		// in-memory test bridge a faithful stand-in so scenario tests
		// exercising peekBridgeItem / preview clicks behave like prod.
		const onlyItems = req.onlyItems !== undefined && req.onlyItems.length > 0
			? new Set(req.onlyItems)
			: undefined;
		const changed: FetchedItem[] = [];
		for (const [name, version] of Object.entries(versions)) {
			if (onlyItems !== undefined && !onlyItems.has(name)) continue;
			if (known[name] !== version) {
				const item = this.items.get(name);
				if (item === undefined) continue;
				const fetched: FetchedItem = {
					name,
					kind: item.kind,
					sourceText: item.sourceText,
					version,
				};
				if (item.folder !== undefined) fetched.folder = item.folder;
				if (item.language !== undefined) fetched.language = item.language;
				if (item.implementationXml !== undefined) fetched.implementationXml = item.implementationXml;
				if (item.graphicalChildren !== undefined && item.graphicalChildren.length > 0) {
					fetched.graphicalChildren = item.graphicalChildren;
				}
				changed.push(fetched);
			}
		}
		const removed: string[] = [];
		for (const name of Object.keys(known)) {
			if (!(name in versions)) removed.push(name);
		}
		return {
			projectVersion: this.projectVersionOverride ?? hashMap(versions),
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

		if (req.expectedProjectVersion !== undefined) {
			const currentProjectVersion = this.projectVersionOverride ?? hashMap(versions);
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

		// Forward-state simulation matching the bridge PushHandler.
		const pending: Record<string, string | null> = { ...versions };
		for (const op of req.ops) {
			const currentVersion = pending[op.name] ?? null;
			switch (op.op) {
				case "pushItem":
					if (op.ifVersion === null) {
						// Create: must NOT exist.
						if (currentVersion !== null) {
							conflicts.push({
								name: op.name,
								yourVersion: null,
								currentVersion,
								reason: "expected to create new item but it already exists",
							});
						} else {
							pending[op.name] = "";
						}
					} else {
						// Update: must match.
						if (currentVersion !== op.ifVersion) {
							conflicts.push({
								name: op.name,
								yourVersion: op.ifVersion,
								currentVersion,
								reason:
									currentVersion === null
										? "expected item to exist but it doesn't"
										: "item changed since you fetched its version",
							});
						}
					}
					break;
				case "deleteItem":
				case "renameItem":
				case "moveItem":
					if (currentVersion !== op.ifVersion) {
						conflicts.push({
							name: op.name,
							yourVersion: op.ifVersion,
							currentVersion,
							reason:
								currentVersion === null
									? "expected item to exist but it doesn't"
									: "item changed since you fetched its version",
						});
					} else {
						if (op.op === "deleteItem") delete pending[op.name];
						else if (op.op === "renameItem") {
							delete pending[op.name];
							pending[op.newName] = "";
						}
					}
					break;
			}
		}

		if (conflicts.length > 0) {
			return {
				accepted: false,
				conflicts,
				currentProjectVersion: hashMap(versions),
			};
		}

		// Apply ops in declared order.
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
	mutate(name: string, item: TestBridgeItem | undefined): void {
		if (item === undefined) this.items.delete(name);
		else this.items.set(name, normalizeFixture({ ...item, name }));
	}

	private applyOp(op: PushOp): void {
		switch (op.op) {
			case "pushItem": {
				// Keep the existing kind on update; default to
				// `function_block` for fresh creates (push only sends
				// source POUs, so FB is a safe baseline — scenarios
				// that need a different kind for a fresh-created item
				// can mutate `items` directly).
				const prior = this.items.get(op.name);
				const kind = prior?.kind ?? "function_block";
				const stored: StoredItem = {
					name: op.name,
					kind,
					sourceText: op.sourceText,
				};
				if (op.folder !== undefined) stored.folder = op.folder;
				this.items.set(op.name, stored);
				return;
			}
			case "deleteItem":
				this.items.delete(op.name);
				return;
			case "renameItem": {
				const existing = this.items.get(op.name);
				if (existing === undefined) return;
				this.items.delete(op.name);
				this.items.set(op.newName, { ...existing, name: op.newName });
				return;
			}
			case "moveItem": {
				const existing = this.items.get(op.name);
				if (existing === undefined) return;
				this.items.set(op.name, { ...existing, folder: op.newFolder });
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

// ─── Fixture normalization ─────────────────────────────────────────────

function normalizeFixture(item: TestBridgeItem): StoredItem {
	if (item.kind === undefined) {
		throw new Error(
			`TestBridge fixture "${item.name}": missing required \`kind\` field. ` +
				`Declare the bridge kind explicitly; the test bridge no longer infers from sourceText.`,
		);
	}
	const stored: StoredItem = {
		name: item.name,
		kind: item.kind,
		sourceText: item.sourceText,
	};
	if (item.folder !== undefined) stored.folder = item.folder;
	if (item.language !== undefined) stored.language = item.language;
	if (item.implementationXml !== undefined) stored.implementationXml = item.implementationXml;
	if (item.graphicalChildren !== undefined && item.graphicalChildren.length > 0) {
		stored.graphicalChildren = item.graphicalChildren;
	}
	return stored;
}

// ─── Hashing ───────────────────────────────────────────────────────────

function hashItem(item: StoredItem): string {
	const h = createHash("sha1");
	// New shape: items ARE their sourceText. Hash that + the folder to
	// produce a stable per-item fingerprint matching the real bridge's
	// content-fingerprint convention.
	h.update(`s=${item.sourceText}\0`);
	h.update(`f=${item.folder ?? ""}\0`);
	if (item.graphicalChildren !== undefined) {
		for (const child of item.graphicalChildren) {
			h.update(`gc=${child.name}|${child.kind}|${child.language}|${child.declaration}|${child.implementationXml}\0`);
		}
	}
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
