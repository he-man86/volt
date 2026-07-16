import { renderPage } from "../shell.jsx"

// Volt Cookie Policy. Adapted from the PLC Assist production doc; reconciled with Volt's stack (OpenAuth for
// sessions, Stripe for payments; no analytics or advertising trackers). Pending final counsel review.
const UPDATED = "16 July 2026"
// Each section is [title, body, bullets?].
const SECTIONS = [
  ["1. What are cookies?",
    "Cookies are small text files stored on your device (computer, tablet, or phone) when you visit a website. They help websites work efficiently, keep you signed in, and remember your preferences."],
  ["2. Essential cookies",
    "These are necessary for the Service to function — page navigation, secure access to your account, and remembering your consent choices. The Service cannot work properly without them. Examples:",
    [
      "Session cookies that keep you signed in.",
      "Security cookies for authentication (OpenAuth).",
      "A cookie that remembers your cookie-consent preference.",
    ]],
  ["3. Functionality cookies",
    "These remember your preferences to give you a more personal experience. Example:",
    [
      "Theme preference (light / dark mode).",
    ]],
  ["4. Performance and marketing cookies",
    "We currently do not use third-party analytics cookies, and we do not use marketing or advertising cookies."],
  ["5. Third-party cookies",
    "Some cookies are set by third-party services we rely on. Please see each provider’s own privacy policy for details:",
    [
      "Stripe (payment processing) — may set cookies for fraud prevention and payment security.",
      "OpenAuth / your identity provider (Google or GitHub) — sets cookies for sign-in and session management.",
    ]],
  ["6. Managing cookies",
    "Most browsers let you view, delete, or block cookies in their settings (Chrome: Settings › Privacy and security › Cookies; Firefox: Settings › Privacy & Security › Cookies and Site Data; Safari: Settings › Privacy; Edge: Settings › Cookies and site permissions). Blocking or deleting essential cookies may prevent you from signing in or using parts of the Service."],
  ["7. Cookie retention",
    "Retention varies by cookie type: session cookies are deleted when you close your browser; persistent cookies remain for a set period or until you delete them; authentication cookies typically expire after a period of inactivity."],
  ["8. Updates",
    "We may update this Cookie Policy to reflect changes in our practices or for legal or operational reasons. Material changes will be posted here with an updated date."],
  ["9. Contact",
    "Questions about our use of cookies? Email privacy@volt-ai.dev."],
]

renderPage(() => {
  const { PageHero, Container } = window
  const h = { fontSize: 18, fontWeight: 600, color: "var(--color-text-primary)", margin: "32px 0 8px" }
  const p = { fontSize: 15, lineHeight: "25px", color: "var(--color-text-secondary)", margin: 0 }
  const ul = { margin: "8px 0 0", paddingLeft: 22, color: "var(--color-text-secondary)" }
  const li = { fontSize: 15, lineHeight: "25px", marginBottom: 4 }
  return (
    <>
      <PageHero eyebrow="Legal" title="Cookie Policy" subtitle={`Last updated ${UPDATED}`} />
      <Container style={{ padding: "40px 24px 96px", maxWidth: 740 }}>
        <div style={{ background: "rgba(194,65,12,0.06)", border: "1px solid var(--color-border)", borderRadius: 12, padding: "14px 16px", marginBottom: 24 }}>
          <p style={{ fontSize: 13.5, lineHeight: "21px", color: "var(--color-text-secondary)", margin: 0 }}>
            <strong style={{ color: "var(--color-text-primary)" }}>Pending review.</strong> This policy is being
            finalized ahead of Volt’s general availability. Questions? Email privacy@volt-ai.dev.
          </p>
        </div>
        {SECTIONS.map(([title, body, bullets]) => (
          <div key={title}>
            <h2 style={h}>{title}</h2>
            <p style={p}>{body}</p>
            {bullets && (
              <ul style={ul}>
                {bullets.map((b) => <li key={b} style={li}>{b}</li>)}
              </ul>
            )}
          </div>
        ))}
      </Container>
    </>
  )
})
