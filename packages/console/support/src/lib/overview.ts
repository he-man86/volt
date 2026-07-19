"use server"

// VOLT: fleet overview — a lightweight SUM/COUNT roll-up across all workspaces, read straight from the
// PlanetScale OLTP DB. Cheap at Volt's scale (few workspaces, small tables). opencode routes this kind of
// aggregate to an Athena warehouse (packages/stats) only because at their scale scanning the live DB would
// hurt — see the note in that package. This is a Volt file BESIDE opencode's lookup; their source is untouched.

import { Database, eq, isNull, sql } from "@opencode-ai/console-core/drizzle/index.js"
import { WorkspaceTable } from "@opencode-ai/console-core/schema/workspace.sql.js"
import { UserTable } from "@opencode-ai/console-core/schema/user.sql.js"
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

  // Members + last-seen per workspace (excludes deleted users).
  const members = await Database.use((tx) =>
    tx
      .select({
        workspaceID: UserTable.workspaceID,
        members: sql<number>`COUNT(*)`,
        lastSeen: sql<unknown>`MAX(${UserTable.timeSeen})`,
      })
      .from(UserTable)
      .where(isNull(UserTable.timeDeleted))
      .groupBy(UserTable.workspaceID),
  )

  // 28-day spend per workspace.
  const spend = await Database.use((tx) =>
    tx
      .select({
        workspaceID: UsageTable.workspaceID,
        spend: sql<number>`SUM(${UsageTable.cost})`,
      })
      .from(UsageTable)
      .where(sql`${UsageTable.timeCreated} >= DATE_SUB(NOW(), INTERVAL 28 DAY)`)
      .groupBy(UsageTable.workspaceID),
  )

  const memberBy = new Map(members.map((m) => [m.workspaceID, m]))
  const spendBy = new Map(spend.map((s) => [s.workspaceID, Number(s.spend) || 0]))

  const rows = workspaces.map((w) => {
    const m = memberBy.get(w.id)
    const spend28d = spendBy.get(w.id) ?? 0
    const plan = w.go ? "Go" : w.black ? "Black" : "Free"
    return {
      // __link cells render as anchors; each workspace deep-links into the existing per-account lookup.
      workspace: { __link: `/lookup?identifier=${w.id}`, label: w.name || w.id },
      plan,
      balance: money(w.balance),
      members: Number(m?.members ?? 0),
      lastSeen: day(m?.lastSeen ?? null),
      spend28d: money(spend28d),
      _spend: spend28d,
      _paid: plan !== "Free",
      _lastSeen: m?.lastSeen ?? null,
    }
  })

  rows.sort((a, b) => b._spend - a._spend)

  const activeCutoff = Date.now() - 28 * 86400 * 1000
  const isActive = (r: (typeof rows)[number]) =>
    r._spend > 0 || (!!r._lastSeen && !isNaN(+new Date(r._lastSeen as string)) && +new Date(r._lastSeen as string) >= activeCutoff)

  const stats = [
    { label: "Workspaces", value: String(rows.length) },
    { label: "Members", value: String(rows.reduce((n, r) => n + r.members, 0)) },
    { label: "Active (28d)", value: String(rows.filter(isActive).length) },
    { label: "Paying", value: String(rows.filter((r) => r._paid).length) },
    { label: "Balance", value: money(workspaces.reduce((n, w) => n + (w.balance ?? 0), 0)) },
    { label: "Spend (28d)", value: money(rows.reduce((n, r) => n + r._spend, 0)) },
  ]

  // Drop the internal sort/derived fields before returning.
  const cleaned = rows.map(({ _spend, _paid, _lastSeen, ...r }) => r)
  return { stats, workspaces: cleaned }
}
