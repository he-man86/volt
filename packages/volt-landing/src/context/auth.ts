import { getRequestEvent } from "solid-js/web"
import { and, Database, eq, inArray, isNull, sql } from "@opencode-ai/console-core/drizzle/index.js"
import { UserTable } from "@opencode-ai/console-core/schema/user.sql.js"
import { redirect } from "@solidjs/router"
import { Actor } from "@opencode-ai/console-core/actor.js"
import { createClient } from "@openauthjs/openauth/client"
import { useSession } from "@solidjs/start/http"
import { Resource } from "@opencode-ai/console-resource"

// Ported from packages/console/app/src/context/auth.ts — volt-landing shares the SAME OpenAuth
// client + session, so it shares login with the console. clientID "app", issuer = VITE_AUTH_URL.
export const AuthClient = createClient({
  clientID: "app",
  issuer: import.meta.env.VITE_AUTH_URL,
})

export interface AuthSession {
  account?: Record<string, { id: string; email: string }>
  current?: string
}

// httpOnly cookie encrypted with ZEN_SESSION_SECRET (shared with the console → shared login).
export function useAuthSession() {
  return useSession<AuthSession>({
    password: Resource.ZEN_SESSION_SECRET.value,
    name: "auth",
    maxAge: 60 * 60 * 24 * 365,
    cookie: { secure: false, httpOnly: true },
  })
}

// Turns the session cookie into an Actor (public | account | user). With a workspace, it looks up
// the user row and returns a `user` actor, else redirects to login. Guards every data server fn.
export const getActor = async (workspace?: string): Promise<Actor.Info> => {
  "use server"
  const evt = getRequestEvent()
  if (!evt) throw new Error("No request event")
  if (evt.locals.actor) return evt.locals.actor
  evt.locals.actor = (async () => {
    const auth = await useAuthSession()
    if (!workspace) {
      const account = auth.data.account ?? {}
      const current = account[auth.data.current ?? ""]
      if (current) {
        return { type: "account", properties: { email: current.email, accountID: current.id } }
      }
      if (Object.keys(account).length > 0) {
        const first = Object.values(account)[0]
        await auth.update((val) => ({ ...val, current: first.id }))
        return { type: "account", properties: { email: first.email, accountID: first.id } }
      }
      return { type: "public", properties: {} }
    }
    const accounts = Object.keys(auth.data.account ?? {})
    if (accounts.length) {
      const user = await Database.use((tx) =>
        tx
          .select()
          .from(UserTable)
          .where(
            and(
              eq(UserTable.workspaceID, workspace),
              isNull(UserTable.timeDeleted),
              inArray(UserTable.accountID, accounts),
            ),
          )
          .limit(1)
          .execute()
          .then((x) => x[0]),
      )
      if (user) {
        await Database.use((tx) =>
          tx
            .update(UserTable)
            .set({ timeSeen: sql`now()` })
            .where(and(eq(UserTable.workspaceID, workspace), eq(UserTable.id, user.id))),
        )
        return {
          type: "user",
          properties: { userID: user.id, workspaceID: user.workspaceID, accountID: user.accountID, role: user.role },
        }
      }
    }
    throw redirect("/auth/authorize")
  })()
  return evt.locals.actor
}
