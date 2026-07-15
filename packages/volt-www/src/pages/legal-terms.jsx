import { renderPage } from "../shell.jsx"

// PLACEHOLDER — not legal text. Volt's real Terms of Service are authored by Volt/counsel and replace this body.
// (Deliberately not opencode's terms, which bind users to Anomaly Innovations.)
renderPage(() => {
  const { PageHero, Container } = window
  return (
    <>
      <PageHero eyebrow="Legal" title="Terms of Service" subtitle="Volt's Terms of Service are being finalized." />
      <Container style={{ padding: "56px 24px 96px", maxWidth: 720 }}>
        <p style={{ fontSize: 16, lineHeight: "26px", color: "var(--color-text-secondary)" }}>
          This page will hold Volt's Terms of Service. They're being prepared and will be published here before
          general availability. For questions in the meantime,{" "}
          <a href="contact.html" style={{ color: "var(--color-link)", textDecoration: "none", fontWeight: 500 }}>
            contact us
          </a>
          .
        </p>
      </Container>
    </>
  )
})
