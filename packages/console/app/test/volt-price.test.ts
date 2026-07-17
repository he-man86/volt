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

  const description = volt["workspace.lite.promo.description"]!
  expect(description).toContain(`${symbol}${perMonth}/month`)
  // and must not quote anyone else's currency
  for (const other of Object.values(SYMBOL).filter((s) => s !== symbol)) {
    expect(`${description} [must not mention ${other}]`).not.toContain(`${other}${perMonth}`)
  }
})

test("the advertised first month matches the coupon checkout actually applies", async () => {
  const { currency, perMonth } = await gatewayPrice()
  const billing = await Bun.file(BILLING).text()

  // Checkout hands first-time subscribers firstMonth50Coupon unless they already redeemed GO1MONTH50.
  // If that default ever changes, the "first month" sentence is a lie and this should fail rather than drift.
  expect(billing).toContain("return LiteData.firstMonth50Coupon")

  expect(volt["workspace.lite.promo.price"]).toContain(`${SYMBOL[currency]}${perMonth / 2}`)
})
