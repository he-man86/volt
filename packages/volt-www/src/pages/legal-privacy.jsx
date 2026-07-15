import { renderPage } from "../shell.jsx"

// DRAFT — a working starting point, NOT counsel-reviewed. Volt/legal must review before GA. Reflects the actual
// architecture: PLC source stays local (git); the hosted service handles accounts, billing, and the AI gateway.
const UPDATED = "15 July 2026"
const SECTIONS = [
  ["1. Scope",
    "This Privacy Policy explains what information Volt (“we”, “us”) collects when you use the Volt desktop app, CLI, language tools, and hosted cloud service (the “Service”), and how we use it. It does not cover third-party services you connect to, which have their own policies."],
  ["2. Local-first by design",
    "Your PLC projects, source code, and repository history live in git on your own machines. We do not store or receive your project files. When you use AI features, the specific prompt you submit is transmitted through our gateway to the AI model provider to generate a response — we do not retain that content to build profiles or train models."],
  ["3. Information we collect",
    "Account information: your name and email and, for OAuth sign-in, the basic profile your provider (e.g. Google or GitHub) shares. Billing information: subscription and payment status. Card details are handled by our payment processor (Stripe) — we do not store full card numbers. Usage information: limited telemetry needed to operate the Service, such as API request metadata for rate limiting and billing, and diagnostic logs. Support information: anything you send us when you contact us."],
  ["4. How we use it",
    "To provide, secure, and operate the Service; to authenticate you; to process payments and prevent fraud; to meter and bill AI usage; to respond to your requests; to understand and improve reliability; and to comply with legal obligations. We do not sell your personal information."],
  ["5. Service providers",
    "We share information with providers who process it on our behalf under contract, only as needed to run the Service — including cloud hosting and edge delivery (Cloudflare), our database provider, our payment processor (Stripe), AI model providers (for gateway requests), and identity providers (for OAuth sign-in). These providers act as our processors or independent controllers under their own terms."],
  ["6. Data retention",
    "We keep personal information for as long as your account is active and as needed to provide the Service, then for the period required to meet legal, accounting, and dispute-resolution obligations, after which we delete or anonymize it."],
  ["7. Security",
    "We use industry-standard measures — encryption in transit, access controls, and reputable infrastructure providers — to protect information. No system is perfectly secure; we cannot guarantee absolute security."],
  ["8. Your rights",
    "Depending on where you live (for example, under the GDPR or CCPA), you may have rights to access, correct, delete, port, or restrict the processing of your personal information, and to object or withdraw consent. To exercise these rights, email privacy@volt-ai.dev. We will respond as required by applicable law."],
  ["9. International transfers",
    "We and our providers may process information in countries other than yours. Where required, we use appropriate safeguards for such transfers."],
  ["10. Cookies",
    "The hosted service uses only the cookies needed to keep you signed in and to operate securely. The marketing site does not use advertising trackers."],
  ["11. Children",
    "The Service is not directed to children under 16, and we do not knowingly collect their personal information."],
  ["12. Changes",
    "We may update this Policy from time to time. Material changes will be posted here with an updated date and, where appropriate, additional notice."],
  ["13. Contact",
    "Questions about privacy? Email privacy@volt-ai.dev."],
]

renderPage(() => {
  const { PageHero, Container } = window
  const h = { fontSize: 18, fontWeight: 600, color: "var(--color-text-primary)", margin: "32px 0 8px" }
  const p = { fontSize: 15, lineHeight: "25px", color: "var(--color-text-secondary)", margin: 0 }
  return (
    <>
      <PageHero eyebrow="Legal" title="Privacy Policy" subtitle={`Last updated ${UPDATED}`} />
      <Container style={{ padding: "40px 24px 96px", maxWidth: 740 }}>
        <div style={{ background: "rgba(194,65,12,0.06)", border: "1px solid var(--color-border)", borderRadius: 12, padding: "14px 16px", marginBottom: 24 }}>
          <p style={{ fontSize: 13.5, lineHeight: "21px", color: "var(--color-text-secondary)", margin: 0 }}>
            <strong style={{ color: "var(--color-text-primary)" }}>Draft.</strong> This is a working draft pending
            legal review and does not yet constitute Volt’s binding Privacy Policy.
          </p>
        </div>
        {SECTIONS.map(([title, body]) => (
          <div key={title}>
            <h2 style={h}>{title}</h2>
            <p style={p}>{body}</p>
          </div>
        ))}
      </Container>
    </>
  )
})
