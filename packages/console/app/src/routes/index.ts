import { redirect } from "@solidjs/router"

// VOLT: the console is the app only — marketing lives on volt-www (a separate static site). Root goes to /auth,
// which resolves to the user's last workspace or the login flow. Replaces opencode's marketing landing (deleted in
// the Phase-2 public-surface strip). Same pattern opencode used for its own redirect routes (e.g. /discord).
export function GET() {
  return redirect("/auth")
}
