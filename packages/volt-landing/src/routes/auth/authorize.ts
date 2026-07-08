import type { APIEvent } from "@solidjs/start/server"
import { AuthClient } from "~/context/auth"

// GET /auth/authorize → redirect to the OpenAuth issuer. Mirrors
// packages/console/app/src/routes/auth/authorize.ts.
export async function GET(input: APIEvent) {
  const callbackUrl = new URL("./callback", input.request.url)
  const result = await AuthClient.authorize(callbackUrl.toString(), "code")
  return Response.redirect(result.url, 302)
}
