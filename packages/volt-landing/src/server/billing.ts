import { action, redirect } from "@solidjs/router"
import { Billing } from "@opencode-ai/console-core/billing.js"
import { withActor } from "~/context/auth.withActor"

// The cleanest signup → plan → Stripe path (Flow A, confirmed against console/app):
// server action → Billing.generateLiteCheckoutUrl → redirect to Stripe Checkout.
// opencode's existing /stripe/webhook (same Stripe account + same DB) persists the
// subscription — volt-landing does NOT need its own webhook.
export const subscribeLite = action(async (form: FormData) => {
  "use server"
  const workspaceID = form.get("workspaceID") as string
  const origin = form.get("origin") as string
  const url = await withActor(
    () =>
      Billing.generateLiteCheckoutUrl({
        successUrl: `${origin}/?subscribed=1`,
        cancelUrl: `${origin}/`,
      }),
    workspaceID,
  )
  if (!url) throw new Error("Stripe did not return a checkout URL")
  return redirect(url)
}, "billing.subscribeLite")
