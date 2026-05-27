/**
 * Remote — the minimal primitive surface every bridge (Beckhoff, CODESYS,
 * TIA Portal, …) exposes over its localhost HTTP daemon. Tools depend on
 * this interface, not on the concrete `BridgeClient` class, so a new bridge
 * implementation only needs to satisfy this shape to plug in.
 *
 * Protocol model is git-inspired:
 *   - getRefs()      — "what does the IDE have, and at what versions?" (no content)
 *   - fetchChanges() — "given my known versions, what's new?" (only deltas)
 *   - pushBatch()    — atomic batch with per-item optimistic concurrency
 *   - compile()      — build the project
 *
 * Bridges implement content versioning (sha1 of declaration + implementation
 * + recursive children) but no other "intelligence" — no diff computation,
 * no merge logic, no PLC type rules. Domain logic stays in the TS layer.
 *
 * Vendoring external libraries is fair game in constrained bridges (see
 * the simplejson precedent in PLCAssist's CODESYS bridge). The real
 * IronPython constraint is "no C extensions / no async / no heavy I/O
 * frameworks," not "stdlib only."
 */
import type {
	CompileRequest,
	CompileResponse,
	FetchRequest,
	FetchResponse,
	HealthResponse,
	PushRequest,
	PushResponse,
	RefsResponse,
} from "./types.js";

export interface Remote {
	/**
	 * Liveness + stable project identifiers (platform/projectName/
	 * plcProjectName) — `plc init` writes them into the workspace's
	 * config so subsequent verbs know which IDE project to talk to.
	 * Cheap; no COM walk required.
	 */
	getHealth(): Promise<HealthResponse>;

	/**
	 * Cheap: just the project version + per-item content versions.
	 * The wire equivalent of `git ls-remote`. Use to detect drift before
	 * deciding whether to fetch or push.
	 */
	getRefs(): Promise<RefsResponse>;

	/**
	 * Bridge returns only the items whose version differs from (or is
	 * absent from) the client's known map, plus names of items the client
	 * knew about that no longer exist. The wire equivalent of `git fetch`
	 * with negotiation.
	 */
	fetchChanges(req: FetchRequest): Promise<FetchResponse>;

	/**
	 * Atomic batch push with per-item optimistic concurrency. The bridge
	 * pre-validates every op's `ifVersion` against current state — if ANY
	 * mismatch, the WHOLE batch is rejected with full conflict info.
	 * Equivalent to `git push` non-fast-forward refusal scaled to per-item
	 * granularity.
	 */
	pushBatch(req: PushRequest): Promise<PushResponse>;

	/** Build the project and return diagnostics. */
	compile(req: CompileRequest): Promise<CompileResponse>;
}
