import { LegalPage } from "../components/LegalPage.jsx"

// Volt Cookie Policy.
//
// Rewritten 29 July 2026. The previous version listed session cookies, OpenAuth authentication cookies, a
// consent-preference cookie, a theme cookie and Stripe's fraud-prevention cookies. Volt sets NONE of these and
// never did on this site — the list was inherited from the PLC Assist SaaS docs, and the auth stack it named was
// deleted with the console (openspec/changes/sell-cli-subscription).
//
// Verified against the live site before writing: no Set-Cookie header on any route, no document.cookie,
// localStorage or sessionStorage anywhere in the app, and no analytics beacon in the built output. So this policy
// says the true thing, which is "none" — and explains where cookies DO appear (Polar's own checkout).
//
// If VITE_CF_ANALYTICS_TOKEN is ever set at build, revisit §3: Cloudflare Web Analytics is cookieless, so the
// answer stays "no cookies", but the sentence about no beacon being shipped becomes wrong.
const UPDATED = "29 July 2026"
// Each section is [title, body, bullets?].
const SECTIONS = [
  [
    "1. Volt’s website uses no cookies",
    "This is the entire policy, and it is unusual enough to be worth stating first: volt-ai.dev sets no cookies at all. Not essential ones, not functional ones, not analytics or advertising ones. There is nothing to consent to and nothing to opt out of, which is why you were not shown a cookie banner. The site is a set of static files with no backend, no sign-in and no forms, so there is no session to keep and no preference to remember.",
  ],
  [
    "2. What cookies are",
    "Cookies are small text files a website stores on your device so it can recognise your browser later — typically to keep you signed in, remember preferences, or track you across sites. Related technologies such as localStorage, sessionStorage and pixel trackers do the same job by other means. Volt’s site uses none of them either.",
  ],
  [
    "3. Analytics",
    "We currently ship no analytics of any kind: the site sends no beacon and no measurement request. If we later add basic traffic measurement it will be Cloudflare Web Analytics, which is cookieless by design — it does not store an identifier on your device, does not fingerprint you and does not follow you to other sites. We will update this page before enabling it.",
  ],
  [
    "4. Hosting",
    "Cloudflare serves the site and, like any host, processes connection data (such as your IP address and user agent) to deliver and protect it. Cloudflare may set a security cookie when it needs to challenge traffic it believes is abusive; that is part of their protection layer rather than anything Volt configures or reads. See Cloudflare’s own policy for detail.",
  ],
  [
    "5. When you buy",
    "Checkout is hosted by Polar, our merchant of record — the buy button sends you to their domain. Polar and their payment processors set their own cookies there, which are necessary to complete a payment and prevent fraud. Those cookies are governed by Polar’s cookie and privacy policies, not this one, and they are set on Polar’s site rather than ours.",
  ],
  [
    "6. The Volt software",
    "Cookies are a browser mechanism, so they do not apply to the Volt command-line tools, connector, desktop app or VS Code extension. Those store your licence key and its cached validation locally on your machine so that everyday commands work offline. That is local application state, not a tracking cookie, and none of it is transmitted to us.",
  ],
  [
    "7. Managing cookies",
    "Since we set none, there is nothing here to manage. For the third-party cases above, most browsers let you view, delete or block cookies in their settings (Chrome: Settings › Privacy and security › Cookies; Firefox: Settings › Privacy & Security › Cookies and Site Data; Safari: Settings › Privacy; Edge: Settings › Cookies and site permissions). Blocking cookies on Polar’s checkout may stop a payment from completing.",
  ],
  [
    "8. Updates",
    "We will update this page if our practices change — before the change ships, not after. Material changes will be posted here with a new date.",
  ],
  ["9. Contact", "Questions about cookies? Email privacy@volt-ai.dev."],
]

export const meta = () => [
  { title: "Cookie Policy — Volt" },
  { name: "description", content: "Volt’s website sets no cookies at all — there is nothing to consent to." },
]

export default function Page() {
  return (
    <LegalPage
      title="Cookie Policy"
      updated={UPDATED}
      notice="Volt is not yet open for purchase. This policy describes the site as it actually behaves today and is pending final review by counsel before sales open. Questions? Email privacy@volt-ai.dev."
      sections={SECTIONS}
    />
  )
}
