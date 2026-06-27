/** In-memory bridge for tests — implements Remote with sha1 content versions + ifVersion validation. */
import { createHash } from "node:crypto";
import type {
	BuildRequest,
	BuildResponse,
	FetchRequest,
	FetchResponse,
	HealthResponse,
	PushRequest,
	PushResponse,
	RefsResponse,
	Remote,
} from "../bridge/types.js";

export interface MockItem {
	name: string;
	folder?: string;
	sourceText: string;
}

const ver = (s: string): string => createHash("sha1").update(s).digest("hex").slice(0, 16);

export class MockBridge implements Remote {
	readonly port = 8555;
	private items = new Map<string, MockItem>();
	pushCalls: PushRequest[] = [];
	project = { platform: "twincat", projectName: "Proj", plcProjectName: "Plc" };
	connected = true;

	constructor(initial: MockItem[] = []) {
		for (const it of initial) this.items.set(it.name, { folder: "", ...it });
	}

	// ── test mutators ──
	set(name: string, sourceText: string, folder = ""): void {
		this.items.set(name, { name, sourceText, folder });
	}
	remove(name: string): void {
		this.items.delete(name);
	}

	private versions(): Record<string, string> {
		const o: Record<string, string> = {};
		for (const [n, it] of this.items) o[n] = ver(it.sourceText);
		return o;
	}
	private folderMap(): Record<string, string> {
		const o: Record<string, string> = {};
		for (const [n, it] of this.items) o[n] = it.folder ?? "";
		return o;
	}
	private projectVersion(): string {
		const sorted = [...this.items.keys()].sort().map((n) => `${n}:${ver(this.items.get(n)!.sourceText)}`);
		return ver(sorted.join(";"));
	}
	private structureVersion(): string {
		return ver([...this.items.keys()].sort().join(","));
	}

	async getHealth(): Promise<HealthResponse> {
		return {
			status: this.connected ? "healthy" : "unavailable",
			platform: this.project.platform,
			connected: this.connected,
			ideAlive: this.connected,
			degraded: false,
			version: "test",
			projectName: this.project.projectName,
			plcProjectName: this.project.plcProjectName,
		};
	}

	async getRefs(): Promise<RefsResponse> {
		return { projectVersion: this.projectVersion(), structureVersion: this.structureVersion(), items: this.versions(), folders: this.folderMap() };
	}

	async fetchChanges(req: FetchRequest): Promise<FetchResponse> {
		const known = req.knownItems ?? {};
		const changed = [...this.items.values()]
			.filter((it) => known[it.name] !== ver(it.sourceText))
			.map((it) => ({ name: it.name, folder: it.folder, sourceText: it.sourceText, version: ver(it.sourceText) }));
		const removed = Object.keys(known).filter((n) => !this.items.has(n));
		return { projectVersion: this.projectVersion(), structureVersion: this.structureVersion(), changed, removed, items: this.versions() };
	}

	async pushBatch(req: PushRequest): Promise<PushResponse> {
		this.pushCalls.push(req);
		const reject = (name: string, reason: string): PushResponse => ({
			accepted: false,
			conflicts: [{ name, reason }],
			currentProjectVersion: this.projectVersion(),
		});
		if (req.expectedProjectVersion !== undefined && req.expectedProjectVersion !== this.projectVersion()) {
			return reject("*", "project version mismatch");
		}
		for (const op of req.ops) {
			const cur = this.items.get(op.name);
			if (op.op === "set") {
				if (op.ifVersion === null && cur !== undefined) return reject(op.name, "already exists");
				if (op.ifVersion !== null && (cur === undefined || ver(cur.sourceText) !== op.ifVersion)) return reject(op.name, "version mismatch");
			} else if (cur === undefined || ver(cur.sourceText) !== op.ifVersion) {
				return reject(op.name, "version mismatch"); // deleteItem
			}
		}
		for (const op of req.ops) {
			if (op.op === "deleteItem") {
				this.items.delete(op.name);
				continue;
			}
			// set: declarative final state — rename (drop the old name) → move (folder) → content.
			const cur = this.items.get(op.name);
			const finalName = op.toName ?? op.name;
			const finalFolder = op.toFolder ?? cur?.folder ?? "";
			const finalText = op.sourceText ?? cur?.sourceText ?? "";
			if (op.toName !== undefined && op.toName !== op.name) this.items.delete(op.name);
			this.items.set(finalName, { name: finalName, folder: finalFolder, sourceText: finalText });
		}
		return { accepted: true, newProjectVersion: this.projectVersion(), newItems: this.versions() };
	}

	async build(_req: BuildRequest): Promise<BuildResponse> {
		return { success: true, duration: 0, diagnostics: [] };
	}
}
