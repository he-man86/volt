import { renderPage } from "../shell.jsx"
import { LegalPage } from "../components/LegalPage.jsx"

// Volt Cookie Policy. Adapted from the PLC Assist production doc; reconciled with Volt's stack (OpenAuth for
// sessions, Stripe for payments; no analytics or advertising trackers). Pending final counsel review.
const UPDATED = "16 July 2026"
// Each section is [title, body, bullets?].
const SECTIONS = [
  [
    "1. What are cookies?",
    "Cookies are small text files stored on your device (computer, tablet, or phone) when you visit a website. They help websites work efficiently, keep you signed in, and remember your preferences.",
  ],
  [
    "2. Essential cookies",
    "These are necessary for the Service to function — page navigation, secure access to your account, and remembering your consent choices. The Service cannot work properly without them. Examples:",
    [
      "Session cookies that keep you signed in.",
      "Security cookies for authentication (OpenAuth).",
      "A cookie that remembers your cookie-consent preference.",
    ],
  ],
  [
    "3. Functionality cookies",
    "These remember your preferences to give you a more personal experience. Example:",
    ["Theme preference (light / dark mode)."],
  ],
  [
    "4. Performance and marketing cookies",
    "We currently do not use third-party analytics cookies, and we do not use marketing or advertising cookies.",
  ],
  [
    "5. Third-party cookies",
    "Some cookies are set by third-party services we rely on. Please see each provider’s own privacy policy for details:",
    [
      "Stripe (payment processing) — may set cookies for fraud prevention and payment security.",
      "OpenAuth / your identity provider (Google or GitHub) — sets cookies for sign-in and session management.",
    ],
  ],
  [
    "6. Managing cookies",
    "Most browsers let you view, delete, or block cookies in their settings (Chrome: Settings › Privacy and security › Cookies; Firefox: Settings › Privacy & Security › Cookies and Site Data; Safari: Settings › Privacy; Edge: Settings › Cookies and site permissions). Blocking or deleting essential cookies may prevent you from signing in or using parts of the Service.",
  ],
  [
    "7. Cookie retention",
    "Retention varies by cookie type: session cookies are deleted when you close your browser; persistent cookies remain for a set period or until you delete them; authentication cookies typically expire after a period of inactivity.",
  ],
  [
    "8. Updates",
    "We may update this Cookie Policy to reflect changes in our practices or for legal or operational reasons. Material changes will be posted here with an updated date.",
  ],
  ["9. Contact", "Questions about our use of cookies? Email privacy@volt-ai.dev."],
]

renderPage(
  <LegalPage
    title="Cookie Policy"
    updated={UPDATED}
    notice="This policy is being finalized ahead of Volt’s general availability. Questions? Email privacy@volt-ai.dev."
    sections={SECTIONS}
  />,
)
