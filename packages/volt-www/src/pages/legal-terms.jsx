import { renderPage } from "../shell.jsx"

// DRAFT — a working starting point, NOT counsel-reviewed. Volt/legal must review before GA. Deliberately not
// opencode's terms (those bind users to Anomaly Innovations). Structured so counsel edits prose, not layout.
const UPDATED = "15 July 2026"
const SECTIONS = [
  ["1. Agreement to these terms",
    "These Terms of Service (“Terms”) govern your access to and use of Volt — the desktop application, command-line tools, language server, VS Code extension, and the hosted Volt cloud service (together, the “Service”), operated by Volt (“we”, “us”). By downloading, installing, or using the Service you agree to these Terms. If you use the Service on behalf of an organization, you accept these Terms for that organization."],
  ["2. The Service",
    "Volt is a toolchain for managing IEC 61131-3 PLC projects (CODESYS, TwinCAT/Beckhoff) as version-controllable text, with optional AI assistance. Your PLC project files live in your own git repository on your own machines. The hosted service provides account management, billing, and a gateway that proxies AI model requests. We may add, change, or remove features over time."],
  ["3. Accounts",
    "You need an account for the hosted parts of the Service. You must provide accurate information, keep your credentials secure, and are responsible for activity under your account. You must be able to form a binding contract and not be barred from using the Service under applicable law."],
  ["4. Acceptable use",
    "You agree not to: use the Service unlawfully or to infringe others’ rights; attempt to break, overload, or reverse-engineer the Service except where such restriction is prohibited by law; resell or provide the hosted service to third parties except as expressly permitted; or use the AI gateway to generate content that is illegal or violates an underlying model provider’s policies."],
  ["5. Your content",
    "You retain all rights to your PLC projects, source code, and other content (“Your Content”). Volt does not claim ownership of it. You grant us only the limited rights needed to operate the Service for you — for example, transmitting the prompts you submit to the AI gateway to the relevant model provider to return a response. We do not use Your Content to train models."],
  ["6. AI features",
    "The Service can generate code, explanations, and other output using third-party AI models. AI output may be incorrect, incomplete, or unsuitable. You are solely responsible for reviewing, testing, and validating any output before use — see the safety notice below. AI features depend on third-party providers and may change or be unavailable."],
  ["7. Safety-critical notice",
    "Volt is an engineering aid, not a certified safety system. It is not qualified, certified, or intended for use as the basis of safety-critical or life-critical control without independent verification. PLC code affects physical equipment and people. You must independently review, simulate, and validate all code — whether written by you, by Volt, or by an AI model — and comply with all applicable safety standards and site procedures before commissioning or deploying it. You assume all risk of deployment."],
  ["8. Fees and billing",
    "Paid plans are billed in advance on a recurring basis through our payment processor (Stripe). Fees are non-refundable except where required by law or expressly stated. We may change pricing with reasonable notice; changes apply to the next billing cycle. You are responsible for applicable taxes. You can cancel at any time; access continues until the end of the paid period."],
  ["9. Intellectual property",
    "The Service, including the Volt software, brand, and site, is owned by us and our licensors and protected by law. These Terms grant you a limited, non-exclusive, non-transferable right to use the Service; they do not transfer any of our intellectual property to you. Open-source components are licensed under their own terms."],
  ["10. Third-party services",
    "The Service builds on and interoperates with third-party software and services (including the open-source opencode agent, AI model providers, and cloud infrastructure). We are not responsible for third-party services, and your use of them may be subject to their own terms."],
  ["11. Disclaimers",
    "THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE” WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, ACCURACY, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, SECURE, OR ERROR-FREE, OR THAT ANY OUTPUT IS ACCURATE OR RELIABLE."],
  ["12. Limitation of liability",
    "TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, DATA, OR GOODWILL, OR FOR DAMAGE TO EQUIPMENT OR PROPERTY, ARISING FROM YOUR USE OF THE SERVICE. OUR TOTAL LIABILITY FOR ANY CLAIM WILL NOT EXCEED THE AMOUNTS YOU PAID US FOR THE SERVICE IN THE 12 MONTHS BEFORE THE CLAIM."],
  ["13. Termination",
    "You may stop using the Service at any time. We may suspend or terminate your access if you breach these Terms or if we reasonably need to protect the Service or others. On termination your right to use the Service ends; sections that by their nature should survive (ownership, disclaimers, liability limits) survive."],
  ["14. Changes to these terms",
    "We may update these Terms from time to time. If we make material changes we will provide reasonable notice (for example, by posting here or notifying you). Continued use after changes take effect means you accept the revised Terms."],
  ["15. Governing law",
    "[To be set by Volt/counsel — governing law and venue.] These Terms are governed by those laws, excluding conflict-of-law rules."],
  ["16. Contact",
    "Questions about these Terms? Email legal@volt-ai.dev."],
]

renderPage(() => {
  const { PageHero, Container } = window
  const h = { fontSize: 18, fontWeight: 600, color: "var(--color-text-primary)", margin: "32px 0 8px" }
  const p = { fontSize: 15, lineHeight: "25px", color: "var(--color-text-secondary)", margin: 0 }
  return (
    <>
      <PageHero eyebrow="Legal" title="Terms of Service" subtitle={`Last updated ${UPDATED}`} />
      <Container style={{ padding: "40px 24px 96px", maxWidth: 740 }}>
        <div style={{ background: "rgba(194,65,12,0.06)", border: "1px solid var(--color-border)", borderRadius: 12, padding: "14px 16px", marginBottom: 24 }}>
          <p style={{ fontSize: 13.5, lineHeight: "21px", color: "var(--color-text-secondary)", margin: 0 }}>
            <strong style={{ color: "var(--color-text-primary)" }}>Draft.</strong> This is a working draft pending
            legal review and does not yet constitute Volt’s binding Terms of Service.
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
