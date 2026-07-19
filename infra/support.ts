import { domain } from "./stage"
import { database } from "./console"

// VOLT: deploy opencode's vendored support-lookup portal (packages/console/support) UNCHANGED at
// support.${domain}. It's a per-customer lookup (auth / workspaces / billing / usage) that reads the prod
// DB via Resource.Database.
//
// This mirrors opencode's own secondary-SolidStart pattern (their `Teams`/`Stats` apps in infra/enterprise.ts
// + infra/stats.ts): `sst.cloudflare.x.SolidStart` with a subdomain + `link: [database]`, no buildCommand (the
// framework default, like their `Console`). NOTE: opencode does not deploy `console/support` at all — its infra
// has no support entry — so there is no literal opencode deploy to copy; this is their deploy *shape*, applied.
//
// The build runs on CI/WSL (SolidStart's vite build mangles Windows paths, same as the console app).
const host = `support.${domain}`

export const support = new sst.cloudflare.x.SolidStart("Support", {
  domain: host,
  path: "packages/console/support",
  link: [database],
})

// Gate: Cloudflare Access (Zero Trust) in front of the hostname — email SSO, zero app code, vendored app
// untouched. The vendored support app ships with NO login (app.tsx has no auth) and this exposes customer
// billing/usage, so the gate is REQUIRED. opencode gates its own internal apps via Access configured in the
// Cloudflare dashboard (not in IaC — that's why their infra has no Access resource); we codify it here instead
// so there is no ungated exposure window and no manual step. Allowed operators come from SUPPORT_ALLOWED_EMAILS
// (comma-separated); defaults to the account owner.
//
// ponytail: Access is the native platform gate — chosen over an app-side password so the vendored package stays
// as-is. One-time prereqs, or the deploy fails / the portal is left open:
//   1. Zero Trust enabled on the Cloudflare account (free tier is fine).
//   2. The deploy token has "Access: Apps and Policies — Edit".
// If this resource fails to provision, support.${domain} is UNPROTECTED customer data — fix and re-deploy first.
const allowedEmails = (process.env.SUPPORT_ALLOWED_EMAILS ?? "mheijmans@gmail.com")
  .split(",")
  .map((email) => email.trim())
  .filter(Boolean)

export const supportAccess = new cloudflare.ZeroTrustAccessApplication("SupportAccess", {
  accountId: sst.cloudflare.DEFAULT_ACCOUNT_ID,
  name: "Volt support",
  domain: host,
  type: "self_hosted",
  sessionDuration: "24h",
  policies: [
    {
      name: "operators",
      decision: "allow",
      precedence: 1,
      includes: allowedEmails.map((email) => ({ email: { email } })),
    },
  ],
})
