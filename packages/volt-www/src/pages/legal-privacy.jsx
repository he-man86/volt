import { renderPage } from "../shell.jsx"
import { LegalPage } from "../components/LegalPage.jsx"

// Volt Privacy Policy. Reflects Volt's ACTUAL architecture (PLC source stays local in git; the hosted service
// handles accounts, billing, and the AI gateway, which meters usage metadata — not prompt/completion content).
// Reassurances ("what we don't do", NL processing) adapted from the PLC Assist production docs; PLC Assist's
// stored-conversation-history / AI-improvement-consent claims were intentionally NOT ported — Volt doesn't do
// those. Pending final counsel review.
const UPDATED = "16 July 2026"
// Each section is [title, body, bullets?].
const SECTIONS = [
  ["1. Scope",
    "This Privacy Policy explains what information Volt (“we”, “us”) collects when you use the Volt desktop app, CLI, language tools, and hosted cloud service (the “Service”), and how we use it. It does not cover third-party services you connect to, which have their own policies."],
  ["2. Local-first by design",
    "Your PLC projects, source code, and repository history live in git on your own machines. We do not store or receive your project files. When you use AI features, the specific prompt you submit is transmitted through our gateway to the AI model provider to generate a response; the gateway records usage metadata (such as model, token counts, and cost) for rate-limiting and billing, not the content of your prompts or the model’s responses."],
  ["3. Information we collect",
    "Account information: your name and email and, for OAuth sign-in, the basic profile your provider (e.g. Google or GitHub) shares. Billing information: subscription and payment status. Card details are handled by our payment processor (Stripe) — we do not store full card numbers. Usage information: request metadata needed to operate the Service, such as token counts and cost for rate-limiting and billing, plus diagnostic logs (including IP address, browser, and access times). Support information: anything you send us when you contact us."],
  ["4. How we use it",
    "To provide, secure, and operate the Service; to authenticate you; to process payments and prevent fraud; to meter and bill AI usage; to respond to your requests; to monitor and improve reliability; and to comply with legal obligations."],
  ["5. What we don’t do",
    "We are deliberate about what we don’t collect or do:",
    [
      "We do not sell your personal information.",
      "We do not use Your Content or the prompts you send through the gateway to train AI models.",
      "We do not store the content of your AI prompts or responses — only the usage metadata needed to meter and bill.",
      "Our AI model providers are contractually bound not to use your data to train their models.",
    ]],
  ["6. Service providers",
    "We share information with providers who process it on our behalf under contract, only as needed to run the Service — including cloud hosting and edge delivery (Cloudflare), our database provider (PlanetScale), our payment processor (Stripe), AI model providers (Anthropic and DeepSeek, for gateway requests), and identity providers (for OAuth sign-in). We may also disclose information where required to comply with applicable laws or legal processes. These providers act as our processors or as independent controllers under their own terms."],
  ["7. Data retention",
    "We keep personal information for as long as your account is active and as needed to provide the Service, then for the period required to meet legal, accounting, and dispute-resolution obligations, after which we delete or anonymize it."],
  ["8. Security",
    "We use industry-standard measures — encryption in transit (TLS), access controls, and reputable infrastructure providers — to protect information. No system is perfectly secure; we cannot guarantee absolute security."],
  ["9. Your rights",
    "Depending on where you live (for example, under the GDPR or CCPA), you may have rights to access, correct, delete, port, or restrict the processing of your personal information, and to object or withdraw consent. To exercise these rights, email privacy@volt-ai.dev. We will respond as required by applicable law."],
  ["10. International transfers",
    "We are based in the Netherlands and process information there and in other countries where our service providers operate. If you are located elsewhere, your information may be transferred to and processed in the Netherlands or those countries. Where required, we use appropriate safeguards for such transfers."],
  ["11. Cookies",
    "The hosted service uses only the cookies needed to keep you signed in and to operate securely; the marketing site does not use advertising trackers. See our Cookie Policy at /legal/cookies.html for details."],
  ["12. Children",
    "The Service is not directed to children under 16, and we do not knowingly collect their personal information."],
  ["13. Changes",
    "We may update this Policy from time to time. Material changes will be posted here with an updated date and, where appropriate, additional notice."],
  ["14. Contact",
    "Questions about privacy? Email privacy@volt-ai.dev."],
]

renderPage(
  <LegalPage
    title="Privacy Policy"
    updated={UPDATED}
    notice="This policy is being finalized ahead of Volt’s general availability. Questions? Email privacy@volt-ai.dev."
    sections={SECTIONS}
  />,
)
