import { createHash } from "node:crypto"
import type { BuildRequest, BuildResponse, FetchedItem, FetchRequest, FetchResponse, HealthResponse, PushOp, PushRequest, PushResponse, RefsResponse } from "./types.js"
import type { Remote } from "./types.js"

export interface TestBridgeItem {
	name: string
	folder?: string
	sourceText: string
}

export interface TestBridgeOptions {
	initialItems?: TestBridgeItem[]
	build?: (req: BuildRequest) => Promise<BuildResponse>
	health?: Partial<HealthResponse>
}

interface StoredItem {
	name: string
	folder?: string
	sourceText: string
}

export class TestBridge implements Remote {
	readonly port = 0
	items = new Map<string, StoredItem>()
	pushCalls: PushRequest[] = []
	buildCalls: BuildRequest[] = []
	projectVersionOverride: string | null = null
	private readonly buildImpl: NonNullable<TestBridgeOptions["build"]>
	healthOverride: Partial<HealthResponse>

	constructor(opts: TestBridgeOptions = {}) {
		for (const item of opts.initialItems ?? []) {
			this.items.set(item.name, { name: item.name, folder: item.folder, sourceText: item.sourceText })
		}
		this.buildImpl = opts.build ?? (async () => ({ success: true, duration: 0, diagnostics: [] }))
		this.healthOverride = opts.health ?? {}
	}

	async getHealth(): Promise<HealthResponse> {
		return {
			status: "healthy",
			platform: "beckhoff",
			connected: true,
			ideAlive: true,
			degraded: false,
			degradedReason: null,
			ideName: "TcXaeShell",
			ideVersion: "15.0",
			version: "1.0.0",
			projectName: "TestProject",
			plcProjectName: "Untitled1",
			...this.healthOverride,
		}
	}

	async getRefs(): Promise<RefsResponse> {
		const versions = this.computeVersions()
		const folders: Record<string, string> = {}
		for (const [name, item] of this.items) {
			folders[name] = item.folder ?? ""
		}
		return {
			projectVersion: this.projectVersionOverride ?? hashMap(versions),
			structureVersion: hashStructure(versions),
			items: versions,
			folders,
		}
	}

	async fetchChanges(req: FetchRequest): Promise<FetchResponse> {
		const versions = this.computeVersions()
		const known = req.knownItems ?? {}
		const onlyItems = req.onlyItems !== undefined && req.onlyItems.length > 0
			? new Set(req.onlyItems)
			: undefined
		const changed: FetchedItem[] = []
		for (const [name, version] of Object.entries(versions)) {
			if (onlyItems !== undefined && !onlyItems.has(name)) continue
			if (known[name] !== version) {
				const item = this.items.get(name)
				if (item === undefined) continue
				const fetched: FetchedItem = {
					name,
					sourceText: item.sourceText,
					version,
				}
				if (item.folder !== undefined) fetched.folder = item.folder
				changed.push(fetched)
			}
		}
		const removed: string[] = []
		for (const name of Object.keys(known)) {
			if (!(name in versions)) removed.push(name)
		}
		return {
			projectVersion: this.projectVersionOverride ?? hashMap(versions),
			structureVersion: hashStructure(versions),
			changed,
			removed,
			items: versions,
		}
	}

	/** Set to make the next pushBatch refuse with these exact conflicts (e.g. a structured VG diagnostic
	 *  carrying code + line) — for exercising the CLI's conflict formatting. */
	nextPushConflicts: Extract<PushResponse, { accepted: false }>["conflicts"] | null = null

	async pushBatch(req: PushRequest): Promise<PushResponse> {
		this.pushCalls.push(req)
		const versions = this.computeVersions()
		const currentProjectVersion = this.projectVersionOverride ?? hashMap(versions)
		if (this.nextPushConflicts) {
			const conflicts = this.nextPushConflicts
			this.nextPushConflicts = null
			return { accepted: false, conflicts, currentProjectVersion }
		}
		if (req.expectedProjectVersion !== undefined && req.expectedProjectVersion !== currentProjectVersion) {
			return {
				accepted: false,
				conflicts: [{ name: "<project>", reason: "project version mismatch", yourVersion: req.expectedProjectVersion, currentVersion: currentProjectVersion }],
				currentProjectVersion,
			}
		}
		for (const op of req.ops) {
			this.applyOp(op)
		}
		const newVersions = this.computeVersions()
		return {
			accepted: true,
			newProjectVersion: hashMap(newVersions),
			newItems: newVersions,
		}
	}

	async build(req: BuildRequest): Promise<BuildResponse> {
		this.buildCalls.push(req)
		return this.buildImpl(req)
	}

	mutate(name: string, item: TestBridgeItem | undefined): void {
		const fullName = this.resolveName(name) ?? name
		if (item === undefined) this.items.delete(fullName)
		else this.items.set(fullName, { name: fullName, folder: item.folder, sourceText: item.sourceText })
	}

	mutateHealth(patch: Partial<HealthResponse>): void {
		Object.assign(this.healthOverride, patch)
	}

	private applyOp(op: PushOp): void {
		switch (op.op) {
			case "pushItem": {
				const fullName = this.resolveName(op.name) ?? op.name
				this.items.set(fullName, { name: fullName, sourceText: op.sourceText, folder: op.folder })
				return
			}
			case "deleteItem": {
				const fullName = this.resolveName(op.name)
				if (fullName) this.items.delete(fullName)
				return
			}
			case "renameItem": {
				const oldFull = this.resolveName(op.name)
				if (oldFull === undefined) return
				const existing = this.items.get(oldFull)
				if (existing === undefined) return
				this.items.delete(oldFull)
				const dot = oldFull.lastIndexOf(".")
				const ext = dot >= 0 ? oldFull.slice(dot) : ".st"
				this.items.set(op.newName + ext, { ...existing, name: op.newName + ext })
				return
			}
			case "moveItem": {
				const fullName = this.resolveName(op.name)
				if (fullName === undefined) return
				const existing = this.items.get(fullName)
				if (existing === undefined) return
				this.items.set(fullName, { ...existing, folder: op.newFolder })
				return
			}
		}
	}

	private resolveName(bareOrFull: string): string | undefined {
		if (this.items.has(bareOrFull)) return bareOrFull
		const prefix = bareOrFull + "."
		for (const name of this.items.keys()) {
			if (name.startsWith(prefix)) return name
		}
		return undefined
	}

	private computeVersions(): Record<string, string> {
		const out: Record<string, string> = {}
		for (const [name, item] of this.items) {
			out[name] = hashItem(item)
		}
		return out
	}
}

function hashItem(item: StoredItem): string {
	const h = createHash("sha1")
	h.update(`s=${item.sourceText}\0`)
	h.update(`f=${item.folder ?? ""}\0`)
	return h.digest("hex").slice(0, 16)
}

function hashMap(map: Record<string, string>): string {
	const h = createHash("sha1")
	const names = Object.keys(map).sort()
	for (const name of names) {
		h.update(`${name}=${map[name]}\0`)
	}
	return h.digest("hex").slice(0, 16)
}

function hashStructure(map: Record<string, string>): string {
	const h = createHash("sha1")
	const names = Object.keys(map).sort()
	for (const name of names) h.update(`${name}\0`)
	return h.digest("hex").slice(0, 16)
}
