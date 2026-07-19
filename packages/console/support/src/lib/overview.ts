"use server"

// VOLT: fleet overview — a lightweight SUM/COUNT roll-up across all workspaces, read straight from the
// PlanetScale OLTP DB. Cheap at Volt's scale (few workspaces, small tables). opencode routes this kind of
// aggregate to an Athena warehouse (packages/stats) only because at their scale scanning the live DB would
// hurt — see the note in that package. This is a Volt file BESIDE opencode's lookup; their source is untouched.

import { Database, eq, isNull, sql } from "@opencode-ai/console-core/drizzle/index.js"
import { WorkspaceTable } from "@opencode-ai/console-core/schema/workspace.sql.js"
import { UserTable } from "@opencode-ai/console-core/schema/user.sql.js"
import { AuthTable } from "@opencode-ai/console-core/schema/auth.sql.js"
import { BillingTable, UsageTable } from "@opencode-ai/console-core/schema/billing.sql.js"

export type Overview = {
  stats: { label: string; value: string }[]
  workspaces: Record<string, unknown>[]
}

const money = (v: number | null | undefined) => `$${((v ?? 0) / 100000000).toFixed(2)}`
const day = (v: unknown) => {
  if (!v) return "—"
  const d = v instanceof Date ? v : new Date(v as string)
  return isNaN(+d) ? "—" : d.toISOString().split("T")[0]
}
const isEmail = (v: unknown): v is string => typeof v === "string" && v.includes("@")

export async function overview(): Promise<Overview> {
  // Workspaces + their billing (balance / plan). LEFT JOIN so a workspace with no billing row still shows.
  const workspaces = await Database.use((tx) =>
    tx
      .select({
        id: WorkspaceTable.id,
        name: WorkspaceTable.name,
        balance: BillingTable.balance,
        black: BillingTable.subscriptionID,
        go: BillingTable.liteSubscriptionID,
      })
      .from(WorkspaceTable)
      .leftJoin(BillingTable, eq(BillingTable.workspaceID, WorkspaceTable.id)),
  )

  // Users (excl. deleted) with any auth identity, so we can surface a real email per workspace. The join
  // multiplies rows per auth provider — deduped by user id in JS below.
  const userRows = await Database.use((tx) =>
    tx
      .select({
        workspaceID: UserTable.workspaceID,
        userID: UserTable.id,
        role: UserTable.role,
        timeSeen: UserTable.timeSeen,
        userEmail: UserTable.email,
        authSubject: AuthTable.subject,
      })
      .from(UserTable)
      .leftJoin(AuthTable, eq(AuthTable.accountID, UserTable.accountID))
      .where(isNull(UserTable.timeDeleted)),
  )

  // 28-day spend per workspace.
  const spend = await Database.use((tx) =>
    tx
      .select({ workspaceID: UsageTable.workspaceID, spend: sql<number>`SUM(${UsageTable.cost})` })
      .from(UsageTable)
      .where(sql`${UsageTable.timeCreated} >= DATE_SUB(NOW(), INTERVAL 28 DAY)`)
      .groupBy(UsageTable.workspaceID),
  )
  const spendBy = new Map(spend.map((s) => [s.workspaceID, Number(s.spend) || 0]))

  // Aggregate users per workspace: member count, last seen, and a representative email (prefer the owner's).
  type Agg = { members: Set<string>; lastSeen: Date | null; email: string | null; ownerEmail: string | null }
  const agg = new Map<string, Agg>()
  for (const r of userRows) {
    let a = agg.get(r.workspaceID)
    if (!a) {
      a = { members: new Set(), lastSeen: null, email: null, ownerEmail: null }
      agg.set(r.workspaceID, a)
    }
    a.members.add(r.userID)
    const ts = r.timeSeen ? new Date(r.timeSeen as unknown as string) : null
    if (ts && !isNaN(+ts) && (!a.lastSeen || ts > a.lastSeen)) a.lastSeen = ts
    const email = isEmail(r.authSubject) ? r.authSubject : isEmail(r.userEmail) ? r.userEmail : null
    if (email) {
      if (!a.email) a.email = email
      if (r.role === "admin" && !a.ownerEmail) a.ownerEmail = email // admin = the workspace owner
    }
  }

  const rows = workspaces.map((w) => {
    const a = agg.get(w.id)
    const spend28d = spendBy.get(w.id) ?? 0
    const plan = w.go ? "Go" : w.black ? "Black" : "Free"
    const email = a?.ownerEmail ?? a?.email ?? "—"
    return {
      // Both email and id are valid lookup identifiers — shown as visible text so they can be copied/searched.
      email,
      workspace: w.name || "—",
      // __link cells render as anchors; the wrk_ id is visible AND clicks straight into the per-account lookup.
      id: { __link: `/lookup?identifier=${w.id}`, label: w.id },
      plan,
      balance: money(w.balance),
      members: a ? a.members.size : 0,
      lastSeen: day(a?.lastSeen ?? null),
      spend28d: money(spend28d),
      _spend: spend28d,
      _paid: plan !== "Free",
      _lastSeen: a?.lastSeen ?? null,
    }
  })

  rows.sort((a, b) => b._spend - a._spend)

  const activeCutoff = Date.now() - 28 * 86400 * 1000
  const isActive = (r: (typeof rows)[number]) =>
    r._spend > 0 || (!!r._lastSeen && +new Date(r._lastSeen) >= activeCutoff)

  const stats = [
    { label: "Workspaces", value: String(rows.length) },
    { label: "Members", value: String(rows.reduce((n, r) => n + r.members, 0)) },
    { label: "Active (28d)", value: String(rows.filter(isActive).length) },
    { label: "Paying", value: String(rows.filter((r) => r._paid).length) },
    { label: "Balance", value: money(workspaces.reduce((n, w) => n + (w.balance ?? 0), 0)) },
    { label: "Spend (28d)", value: money(rows.reduce((n, r) => n + r._spend, 0)) },
  ]

  const cleaned = rows.map(({ _spend, _paid, _lastSeen, ...r }) => r)
  return { stats, workspaces: cleaned }
}
