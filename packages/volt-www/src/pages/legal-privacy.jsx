import { renderPage } from "../shell.jsx"

// PLACEHOLDER — not legal text. Volt's real Privacy Policy is authored by Volt/counsel and replaces this body.
renderPage(() => {
  const { PageHero, Container } = window
  return (
    <>
      <PageHero eyebrow="Legal" title="Privacy Policy" subtitle="Volt's Privacy Policy is being finalized." />
      <Container style={{ padding: "56px 24px 96px", maxWidth: 720 }}>
        <p style={{ fontSize: 16, lineHeight: "26px", color: "var(--color-text-secondary)" }}>
          This page will hold Volt's Privacy Policy — how Volt handles your data and what stays on your machine.
          It's being prepared and will be published here before general availability. For questions in the meantime,{" "}
          <a href="contact.html" style={{ color: "var(--color-link)", textDecoration: "none", fontWeight: 500 }}>
            contact us
          </a>
          .
        </p>
      </Container>
    </>
  )
})
