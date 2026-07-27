/**
 * The connector SESSION client — the frontend's declarative connection presence (openspec connector-session-model).
 *
 * ONE session per app process. A client declares the projects it is currently using (its *interests*) and the
 * connector reconciles the bridges to match; a project serves iff some live session wants it. Instead of imperative
 * connect/disconnect, this client:
 *   • opens a session lazily on the first {@link declareInterest} (POST /session),
 *   • runs a sync poll (~4s) that declares the FULL current interest set, renews the lease, and reads the live view
 *     back — all in one `POST /session/{id}/sync`, whose response IS the connector view the UI renders,
 *   • `DELETE`s the session on shutdown so its interests drop immediately.
 *
 * `enterWorkspace`/`leaveWorkspace` (in actions.ts) mutate the interest set through here; the poll ships it. This is
 * the ONLY way to drive serving — there is no imperative connect/disconnect. Never throws: a down connector leaves
 * the session unopened and is retried by the poll.
 */
import { readBoundProject, type BoundProject } from "./health.js"
import {
  registerSessionView,
  matchesBinding,
  isServing,
  type ConnectorView,
  type DetectedProject,
} from "./connector.js"

interface Interest {
  vendor: string
  projectName: string
}

// Module-level: the one per-app session.
const S: {
  id?: string
  opening?: Promise<void>
  interests: Map<string, Interest> // workspace root (or a pick key) → its durable binding identity
  view?: ConnectorView // the last /sync response — what connectorStatus prefers
  timer?: ReturnType<typeof setInterval>
} = { interests: new Map() }

const POLL_MS = 4_000
const TIMEOUT_MS = 2_000

// connectorStatus() prefers this cached view over GET /status once a session sync has produced one.
registerSessionView(() => S.view)

function controlBase(): string {
  return process.env.VOLT_CONTROL_BASE || "http://127.0.0.1:8550"
}

/** The interests declared across all entered workspaces, de-duplicated (two roots can bind the same project). */
function uniqueInterests(): Interest[] {
  const seen = new Set<string>()
  const out: Interest[] = []
  for (const i of S.interests.values()) {
    const key = JSON.stringify([i.vendor, i.projectName]) // unambiguous; no separator collision, no control chars
    if (!seen.has(key)) {
      seen.add(key)
      out.push(i)
    }
  }
  return out
}

/** Open the session once. A down connector leaves it unopened (S.id undefined) to be retried by the next tick.
 *  Concurrent callers share one attempt. */
async function ensureSession(): Promise<void> {
  if (S.id) return
  if (S.opening) return S.opening
  S.opening = (async () => {
    try {
      const res = await fetch(`${controlBase()}/session`, { method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!res.ok) return // connector down / still starting — retry later
      const body = (await res.json()) as { sessionId?: string }
      if (body.sessionId) S.id = body.sessionId
    } catch {
      // connector down — retried on the next tick
    }
  })()
  try {
    await S.opening
  } finally {
    S.opening = undefined
  }
}

function ensurePolling(): void {
  if (S.timer) return
  S.timer = setInterval(() => void tick(), POLL_MS)
  // Never keep the host process alive just for the poll.
  ;(S.timer as { unref?: () => void }).unref?.()
}

function stopPolling(): void {
  if (S.timer) {
    clearInterval(S.timer)
    S.timer = undefined
  }
}

/** One poll iteration: (re)open the session, then declare the current interest set. */
async function tick(): Promise<void> {
  await ensureSession()
  if (S.id) await syncDeclare()
}

/** POST the full interest set (declare + renew + read). Never throws; keeps the last view on a transient error. */
async function syncDeclare(): Promise<void> {
  if (!S.id) return
  try {
    const res = await fetch(`${controlBase()}/session/${S.id}/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ interests: uniqueInterests() }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.ok) S.view = (await res.json()) as ConnectorView
  } catch {
    // keep the last view
  }
}

// ── the public API actions.ts delegates to ──

/** Declare interest in the project THIS workspace is bound to (navigate-to / manual Connect): add it to the interest
 *  set and sync immediately so the bridge connects without waiting for the poll. `ok` reflects whether the bound
 *  project is actually serving now (so the manual "Reconnect" button can report "not detected — open it"); the
 *  automatic follow callers ignore the result. */
export async function declareInterest(root: string): Promise<{ ok: boolean; message?: string }> {
  const bound = readBoundProject(root)
  if (bound === undefined) return { ok: false, message: "This folder isn't a Volt workspace — initialize it first." }

  S.interests.set(root, { vendor: bound.vendor, projectName: bound.projectName })
  ensurePolling()
  await ensureSession()
  await syncDeclare()
  return declareResult(bound)
}

function declareResult(bound: BoundProject): { ok: boolean; message?: string } {
  const proj = S.view?.projects.find((p) => matchesBinding(p, bound))
  if (proj && isServing(proj)) return { ok: true }
  if (S.view === undefined) return { ok: false, message: "The Volt Connector isn't running." }
  return { ok: false, message: `“${bound.projectName}” isn't connected yet — open it in your IDE, then reconnect.` }
}

/** Drop interest in this workspace's project (navigate-away / close / manual Disconnect): remove it and sync so the
 *  connector gates the bridge if no other client wants it. `ok` = the connector took the declaration. */
export async function dropInterest(root: string): Promise<{ ok: boolean }> {
  const had = S.interests.delete(root)
  // Nothing declared here and no session even opened → a pure no-op; don't open a session just to drop nothing.
  if (!had && S.id === undefined) return { ok: true }

  await ensureSession()
  if (S.id !== undefined) ensurePolling() // a live session must renew, never linger un-polled after a stray drop
  if (!had) return { ok: true }
  await syncDeclare()
  return { ok: S.view !== undefined }
}

// ── init/rebind support: select a PICKED (not-yet-bound) project without pinning it ──

// A pick's interest is keyed distinctly from any workspace root so it can be handed over to the real root later.
function pickKey(projectId: string): string {
  return `::pick::${projectId}`
}

/** Select a PICKED project on its bridge so `volt init` can fetch it — as a TEMPORARY app-session interest, handed to
 *  the created/rebound workspace root on success and released on failure. Returns whether the project is now serving. */
export async function selectPickedProject(project: DetectedProject): Promise<boolean> {
  const want: BoundProject = { vendor: project.vendor, projectName: project.projectName ?? project.displayName }
  S.interests.set(pickKey(project.id), want)
  ensurePolling()
  await ensureSession()
  await syncDeclare()
  // Match the way the connector resolves an interest — by vendor+name (matchesBinding), not the ephemeral row id.
  return isServing(S.view?.projects.find((p) => matchesBinding(p, want)))
}

/** Hand a pick's temporary interest to the workspace root that will now own it (after `volt init` created it), so the
 *  ongoing connection is keyed by the workspace and cleared by leaveWorkspace/shutdown. The declared SET is unchanged
 *  (same vendor+name), so no bridge churns. */
export function adoptPickedProject(project: DetectedProject, workspaceRoot: string): void {
  const interest = S.interests.get(pickKey(project.id))
  if (interest === undefined) return
  S.interests.delete(pickKey(project.id))
  S.interests.set(workspaceRoot, interest)
}

/** Drop a pick's temporary interest (init failed / cancelled), gating it on the next sync. */
export async function releasePickedProject(project: DetectedProject): Promise<void> {
  if (S.interests.delete(pickKey(project.id))) await syncDeclare()
}

/** Clean shutdown (app quit / extension deactivate): stop the poll and DELETE the session so its interests drop at
 *  once rather than after the lease TTL. Returns a promise the caller can await (VS Code folds it into deactivate). */
export async function shutdownSession(): Promise<void> {
  stopPolling()
  const id = S.id
  S.id = undefined
  S.interests.clear()
  S.view = undefined
  if (id === undefined) return
  try {
    await fetch(`${controlBase()}/session/${id}`, { method: "DELETE", signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    // best-effort; the lease expiry cleans it up anyway
  }
}

/** Test-only: reset all session state (poll timer, id, view, interests). */
export function __resetSessionForTest(): void {
  stopPolling()
  S.id = undefined
  S.opening = undefined
  S.interests.clear()
  S.view = undefined
}
