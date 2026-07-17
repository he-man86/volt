import { expect, test } from "bun:test"
import { join } from "node:path"
import { volt } from "~/i18n/volt"

// VOLT: the price a customer READS must match the price Volt CHARGES.
//
// These are two different files owned by two different concerns — the number lives in infra/console.ts (a Stripe
// Price resource) and the sentence lives in the i18n overlay — and nothing connected them. So the console
// advertised opencode's pricing ("$5 for your first month, then $10/month") while Stripe charged €24/month. It
// survived review because it is the same STRUCTURE as the truth: a 50%-off first month, then full price. Only the
// currency and the numbers were another company's. A customer read $10 and paid €24.
//
// This is the cheapest possible tie between the two. It does not verify Stripe's live catalogue — it pins the
// declared infra value, which is what the deploy creates.

const INFRA = join(import.meta.dir, "..", "..", "..", "..", "infra", "console.ts")
const BILLING = join(import.meta.dir, "..", "..", "core", "src", "billing.ts")

const SYMBOL: Record<string, string> = { eur: "€", usd: "$", gbp: "£" }

/** The promo copy as the customer reads it: lite-section.tsx splits the description on {{price}} and injects it. */
const renderedPromo = () =>
  volt["workspace.lite.promo.description"]!.replace("{{price}}", volt["workspace.lite.promo.price"]!)

/** billing.ts's CODE, minus comments — this file explains the removed coupon by quoting it, and a naive substring
 *  match cannot tell an explanation of the old behaviour from the behaviour itself. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")

/** The Gateway (opencode calls it "lite") subscription price, read from the Stripe resource the deploy creates. */
async function gatewayPrice(): Promise<{ currency: string; perMonth: number }> {
  const src = await Bun.file(INFRA).text()
  const block = src.match(/const zenLitePrice = new stripe\.Price\([^)]*?\{([\s\S]*?)\n\}\)/)?.[1]
  if (!block) throw new Error("volt-price: could not find the zenLitePrice block in infra/console.ts")
  const currency = block.match(/currency:\s*"([a-z]{3})"/)?.[1]
  const unitAmount = block.match(/unitAmount:\s*(\d+)/)?.[1]
  if (!currency || !unitAmount) throw new Error("volt-price: zenLitePrice is missing currency/unitAmount")
  return { currency, perMonth: Number(unitAmount) / 100 }
}

test("the advertised monthly price is the price infra actually charges", async () => {
  const { currency, perMonth } = await gatewayPrice()
  const symbol = SYMBOL[currency]
  expect(symbol).toBeDefined() // a new currency needs a symbol here before the strings can be trusted

  const promo = renderedPromo()
  expect(promo).toContain(`${symbol}${perMonth}/month`)
  // and must not quote anyone else's currency
  for (const other of Object.values(SYMBOL).filter((s) => s !== symbol)) {
    expect(`${promo} [must not mention ${other}]`).not.toContain(`${other}${perMonth}`)
  }
})

test("the price shown is the flat price — no first-month discount is advertised or applied", async () => {
  const { currency, perMonth } = await gatewayPrice()
  const billing = codeOf(await Bun.file(BILLING).text())

  // Volt sells at a flat rate: checkout must NOT default-apply opencode's 50%-off-first-month coupon. If that line
  // ever comes back (say, an opencode bump re-applies it), the copy below becomes a lie in the customer's favour
  // and the margin quietly halves for every new subscriber — so fail here rather than find out in Stripe.
  expect(billing).not.toContain("return LiteData.firstMonth50Coupon")

  // The campaign coupons are opt-in (they need a CouponTable row for that email) and stay.
  expect(billing).toContain("return LiteData.firstMonth100Coupon")

  const price = volt["workspace.lite.promo.price"]!
  expect(price).toContain(`${SYMBOL[currency]}${perMonth}`)
  // NB: assert on the value itself, not a labelled string — a label mentioning the banned phrase matches itself.
  expect(price.toLowerCase()).not.toContain("first month")
  expect(renderedPromo().toLowerCase()).not.toContain("first month")
})
