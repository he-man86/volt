import { LegalPage } from "../components/LegalPage.jsx"

// Volt Privacy Policy.
//
// Rewritten 29 July 2026. The previous version described collecting account names and emails via OAuth, storing
// billing status, metering AI usage through a gateway, and sharing data with PlanetScale, Stripe, Anthropic and
// DeepSeek as our processors. None of that exists — the console and the gateway were deleted
// (openspec/changes/sell-cli-subscription) and Volt now runs no backend at all.
//
// This policy is short because the honest answer is short: we operate no servers, so there is almost nothing to
// disclose. The substantive content is therefore about who ELSE processes data (Polar as merchant of record,
// Cloudflare as host, your own AI provider) and what stays on your machine.
const UPDATED = "29 July 2026"
// Each section is [title, body, bullets?].
const SECTIONS = [
  [
    "1. The short version",
    "Volt runs no servers. We have no database, no user accounts and no analytics on you. Your PLC code, your git history and your AI prompts never reach us — not as a policy choice we could quietly reverse, but because there is no system of ours for them to reach. The personal data we hold is limited to emails you send us. Payment is handled by Polar, who are the merchant of record and hold your purchase details under their own policy.",
  ],
  [
    "2. Who we are",
    "Volt (“we”, “us”) publishes the Volt software. We are based in the Netherlands. For any processing described here, we are the data controller, and you can reach us at privacy@volt-ai.dev.",
  ],
  [
    "3. What stays on your machine",
    "The following never leaves your computer, and we have no means of obtaining it:",
    [
      "Your PLC projects, source code and git history — Volt syncs your IDE to a git repository on your own disk.",
      "Your AI prompts and the responses to them. You supply your own provider key and your agent talks to that provider directly; we are not in that path and could not see them even if we wanted to.",
      "Your AI provider key and your Volt licence key, which are stored locally on your machine.",
      "Which projects you have bound. The free-tier limit is enforced by the software against your own local state; it is never reported to us.",
    ],
  ],
  [
    "4. What we actually collect",
    "Very little, and only in these situations:",
    [
      "Email. If you write to hello@, privacy@ or legal@volt-ai.dev, we receive your address, your message and anything you choose to include, so that we can reply. Our mail is hosted by a European provider.",
      "Licence validation. When you activate or revalidate a licence, the software sends your licence key and activation id to Polar — not to us. Polar necessarily sees the connecting IP address and processes it under their policy. We receive no telemetry from this and learn nothing about when or how you use Volt.",
      "Update downloads. When Volt checks for or downloads an update, it requests a file from our public release location on GitHub. GitHub logs that request, including your IP address, under their own policy. We do not receive per-user download data.",
      "Website visits. Our site is static files served by Cloudflare, who process request data (including IP addresses) to deliver and protect it. See §6.",
    ],
  ],
  [
    "5. Purchases — handled by Polar",
    "We sell through Polar, who act as the merchant of record. Polar collects and holds what a purchase requires — your name, email, billing address, country for VAT purposes and payment details — and issues your licence key. They are an independent controller for that data under their own privacy policy, not our processor. We never see or store your card details. We can see the subscription status attached to a licence, which is what tells us whether a key is valid.",
  ],
  [
    "6. Our website",
    "volt-ai.dev is a set of static files. It has no backend, no sign-in and no forms — the contact page is a plain mailto: link, so nothing is submitted to us. It sets no cookies whatsoever (see our Cookie Policy). Cloudflare hosts it and processes connection data such as IP address and user agent to serve and protect the site, as any host must. If we later enable Cloudflare Web Analytics we will say so here; it is cookieless and does not fingerprint or track visitors across sites.",
  ],
  [
    "7. What we do not do",
    "Stated plainly, because the industry norm is the opposite:",
    [
      "We do not sell or share your personal information, and we run no advertising.",
      "We do not profile you, build a behavioural record, or track you across sites.",
      "We do not train models on anything of yours.",
      "We do not phone home. Volt sends nothing to us during normal use — no telemetry, no crash reports, no usage statistics.",
    ],
  ],
  [
    "8. Legal bases and retention",
    "Where the GDPR applies: we process support email to respond to you and on the basis of our legitimate interest in supporting our software; purchase data is processed by Polar to perform your contract with them and to meet their tax obligations. We keep support email for as long as needed to handle the matter and any follow-up, and delete it when it no longer serves a purpose. Polar sets its own retention for purchase records, which tax law requires them to keep for several years.",
  ],
  [
    "9. Your rights",
    "Under the GDPR and comparable laws you may request access to the personal data we hold about you, correction, erasure, restriction, portability, and you may object to processing. In practice the only data we are likely to hold is your correspondence. Email privacy@volt-ai.dev and we will respond within the time the law allows. For purchase data, contact Polar directly, since they are the controller. If you are in the EU or UK you also have the right to lodge a complaint with your data-protection authority — in the Netherlands, the Autoriteit Persoonsgegevens.",
  ],
  [
    "10. International transfers",
    "We are in the Netherlands. The third parties named here (Polar, Cloudflare, GitHub) may process data outside the EEA, including in the United States, under the transfer safeguards set out in their own policies. Because we do not send them personal data about you beyond what §4 and §5 describe, our own transfers are minimal.",
  ],
  [
    "11. Security",
    "Traffic to our site and to the licensing endpoint is encrypted in transit (TLS). The strongest protection here is structural rather than procedural: we hold almost no data, so there is very little to lose. Your licence key is stored on your own machine and should be treated like any other credential. No system is perfectly secure and we cannot guarantee absolute security.",
  ],
  [
    "12. Children",
    "Volt is a professional engineering tool, is not directed to children under 16, and we do not knowingly collect their personal data.",
  ],
  [
    "13. Changes",
    "We may update this Policy. Material changes will be posted here with a new date. If Volt ever starts collecting something it does not collect today — telemetry, crash reports, analytics — we will say so here before it ships, not after.",
  ],
  ["14. Contact", "Questions about privacy? Email privacy@volt-ai.dev."],
]

export const meta = () => [
  { title: "Privacy Policy — Volt" },
  {
    name: "description",
    content:
      "Volt runs no servers. Your PLC code, git history and AI prompts never reach us, and the site sets no cookies.",
  },
]

export default function Page() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated={UPDATED}
      notice="Volt is not yet open for purchase. This policy describes how the software actually works today and is pending final review by counsel before sales open. Questions? Email privacy@volt-ai.dev."
      sections={SECTIONS}
    />
  )
}
