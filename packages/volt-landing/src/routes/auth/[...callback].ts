import { redirect } from "@solidjs/router"
import type { APIEvent } from "@solidjs/start/server"
import { AuthClient, useAuthSession } from "~/context/auth"

// GET /auth/callback → exchange code, decode subject, store {id,email} in the session.
// Mirrors packages/console/app/src/routes/auth/[...callback].ts. The issuer worker (opencode's
// auth.ts) already created the Account + default Workspace on first login.
export async function GET(input: APIEvent) {
  const url = new URL(input.request.url)
  const code = url.searchParams.get("code")
  if (!code) return redirect("/auth/authorize")

  const result = await AuthClient.exchange(code, `${url.origin}${url.pathname}`)
  if (result.err) throw new Error(result.err.message)

  const decoded = AuthClient.decode(result.tokens.access, {} as any)
  if (decoded.err) throw new Error(decoded.err.message)
  const id = decoded.subject.properties.accountID

  const session = await useAuthSession()
  await session.update((value) => ({
    ...value,
    account: { ...value.account, [id]: { id, email: decoded.subject.properties.email } },
    current: id,
  }))
  return redirect("/")
}
