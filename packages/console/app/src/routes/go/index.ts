import { redirect } from "@solidjs/router"

// VOLT: `/go` is the REFERRAL LANDING PAGE — `component/go-referral` hands out invite links of the form
// `/go?ref=CODE`, so this path is public and load-bearing even though opencode's Go marketing page (which used to
// live here) is gone. The `?ref=` capture does NOT happen here: `src/middleware.ts` runs on every request and sets
// the referral cookie before this handler, so redirecting keeps the invite intact — the code is redeemed later by
// `createReferralFromCookie()` on the Gateway tab / at lite checkout.
//
// It redirects to /auth because an invitee is by definition signing up, and opencode's page sold "OpenCode Go"
// with links to its deleted /docs. Volt's marketing lives on volt-www; the console is app-only.
export function GET() {
  return redirect("/auth")
}
