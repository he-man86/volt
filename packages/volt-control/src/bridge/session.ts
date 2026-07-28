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
import { Emitter } from "../state/emitter.js"
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
  viewKey?: string // its serialization, so a poll that changed nothing fires nothing
  settled?: boolean // a tick has produced an answer — only THEN is this feed the source (see registerSessionView)
  timer?: ReturnType<typeof setInterval>
} = { interests: new Map() }

/** Fires when the connector view CHANGED — including changing to "no view" when the connector stops answering.
 *  This is the product's ONE live-connection clock: every workspace's health and every shell's detected-project
 *  list hang off it. Before, three timers (this poll, VoltStatus's own 4s health poll, each shell's 10s project
 *  poll) read the same cached value on unsynchronized schedules, so the UI could render state this client already
 *  knew was stale — a connect/disconnect took up to ~8s to show, and the project list up to ~14s. */
export const onConnectorView = new Emitter<void>()

const POLL_MS = 4_000
const TIMEOUT_MS = 2_000

// Once the feed has an ANSWER, connectorStatus() reads it and never issues its own request — including when that
// answer is "the connector isn't answering". Gated on `settled`, not on the timer existing: the timer is armed
// synchronously by startConnectorFeed, so a read in that window (VS Code's activate does exactly one) would have
// been told "no view" and painted "Volt Connector not running" over a connector that was running. Until the first
// tick answers, callers fall through to the one-shot GET, as they did before any feed existed.
registerSessionView(() => (S.settled === true ? { view: S.view } : undefined))

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
  else publish(undefined) // the connector isn't answering at all — that IS the state
}

/** POST the full interest set (declare + renew + read). Never throws. */
async function syncDeclare(): Promise<void> {
  if (!S.id) return
  try {
    const res = await fetch(`${controlBase()}/session/${S.id}/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ interests: uniqueInterests() }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    publish(res.ok ? ((await res.json()) as ConnectorView) : undefined)
  } catch {
    // The connector stopped answering. Publish that, rather than keeping a remembered view alive: a stale view
    // rendered a dead connector as "running", with its last projects still listed and clickable.
    publish(undefined)
  }
}

/** Adopt a view and notify — but only when it actually differs, so a quiet 4s poll costs nothing downstream. */
function publish(view: ConnectorView | undefined): void {
  S.settled = true // set before the dedup: a repeat answer is still an answer
  const key = view === undefined ? "" : JSON.stringify(view)
  if (key === S.viewKey) return
  S.viewKey = key
  S.view = view
  onConnectorView.fire()
}

/** Start the connector feed — open the session and poll it, whether or not anything is declared yet. An app with
 *  no bound workspace still needs the detected-project list to create one, and that list is this same view. Runs
 *  the first tick now (so the UI fills immediately) and is idempotent; call it once at startup. */
export async function startConnectorFeed(): Promise<void> {
  ensurePolling()
  await tick()
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
  // One declare, one answer — the connector reconciles and re-scans before it replies, so this IS the state. No
  // retry loop: a bridge that wasn't ready reports not-connected, and the user connects again when it is.
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
  const want: BoundProject = { vendor: project.vendor, projectName: project.projectName }
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
  // Drop the view WITHOUT firing: this runs on app quit / deactivate, and a listener woken here would re-render a
  // view that is being disposed (the desktop's send() on a destroyed window throws) — and, with the feed already
  // stopped, would fall through to a live GET on the way out.
  S.view = undefined
  S.viewKey = undefined
  S.settled = undefined
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
  S.viewKey = undefined
  S.settled = undefined
}
