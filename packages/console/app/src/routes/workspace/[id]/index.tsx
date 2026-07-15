import { Navigate, useParams } from "@solidjs/router"

// VOLT: Volt sells one product (Go), so opencode's Zen landing (PAYG model catalog + BYOK-gateway ProviderSection)
// is retired — this index redirects to Go, which becomes the workspace home. Top-up/balance is unaffected: it lives
// on the Billing tab. Revert: restore this file from opencode v1.17.20.
export default function () {
  const params = useParams()
  return <Navigate href={`/workspace/${params.id}/go`} />
}
