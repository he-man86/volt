// Contact page — form + direct channels.
function ContactPage() {
  const { Input, Button, Card } = window.VoltDesignSystem_704691;
  const [sent, setSent] = React.useState(false);
  const channels = [
    { icon: "doc", t: "Sales", d: "Talk through Enterprise, deployment, and rollout.", a: "sales@volt.dev" },
    { icon: "flask", t: "Support", d: "Help with the desktop app, CLI, or a connected project.", a: "support@volt.dev" },
    { icon: "git", t: "Community", d: "Join other automation engineers building with Volt.", a: "Open community →" },
  ];
  const labelStyle = { fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 6, display: "block" };
  return (
    <React.Fragment>
      <PageHero eyebrow="Contact" title="Talk to the Volt team" subtitle="Questions about your PLC stack, a demo, or Enterprise? Send a note and we'll get back within a day." />
      <Container style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 56, padding: "56px 24px 80px", alignItems: "start" }}>
        {/* form */}
        <div style={{ background: "#fff", border: "1px solid var(--color-border)", borderRadius: 16, padding: 28, boxShadow: "var(--shadow-sm)" }}>
          {sent ? (
            <div style={{ textAlign: "center", padding: "32px 8px" }}>
              <div style={{ width: 44, height: 44, borderRadius: 999, background: "rgba(22,163,68,0.12)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <Icon d={ICONS.check} size={22} stroke="var(--color-success)" />
              </div>
              <h2 style={{ fontSize: 22, fontWeight: 600, color: "var(--color-text-primary)", margin: "16px 0 0" }}>Thanks — message sent</h2>
              <p style={{ fontSize: 15, color: "var(--color-text-secondary)", margin: "8px 0 0" }}>We'll be in touch at the email you provided.</p>
              <div style={{ marginTop: 20 }}><Button variant="outline" onClick={() => setSent(false)}>Send another</Button></div>
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); setSent(true); }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <Input label="First name" placeholder="Jordan" required />
                <Input label="Last name" placeholder="Keller" required />
              </div>
              <div style={{ height: 16 }} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <Input label="Work email" type="email" placeholder="you@company.com" required />
                <Input label="Company" placeholder="Acme Automation" />
              </div>
              <div style={{ height: 16 }} />
              <label style={{ display: "block" }}>
                <span style={labelStyle}>What can we help with?</span>
                <select defaultValue="" required style={{
                  width: "100%", height: 40, padding: "0 12px", fontFamily: "var(--font-sans)", fontSize: 14,
                  color: "var(--color-text-primary)", background: "#fff", border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)", outline: "none", appearance: "none",
                }}>
                  <option value="" disabled>Select a topic…</option>
                  <option>Product demo</option>
                  <option>Enterprise & pricing</option>
                  <option>Technical support</option>
                  <option>Partnership</option>
                  <option>Something else</option>
                </select>
              </label>
              <div style={{ height: 16 }} />
              <label style={{ display: "block" }}>
                <span style={labelStyle}>Message</span>
                <textarea rows={4} placeholder="Tell us about your project and PLC platform…" required style={{
                  width: "100%", padding: "10px 12px", fontFamily: "var(--font-sans)", fontSize: 14, lineHeight: "21px",
                  color: "var(--color-text-primary)", background: "#fff", border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)", outline: "none", resize: "vertical",
                }} />
              </label>
              <div style={{ height: 20 }} />
              <Button variant="primary" type="submit" style={{ width: "100%" }}>Send message</Button>
              <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)", textAlign: "center", margin: "12px 0 0" }}>
                We'll only use your details to respond to this enquiry.
              </p>
            </form>
          )}
        </div>
        {/* channels */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {channels.map((c) => (
            <Card key={c.t} padding={20}>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flexShrink: 0, width: 38, height: 38, borderRadius: 10, background: "var(--color-background)", border: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon d={ICONS[c.icon]} size={18} stroke="var(--color-accent)" />
                </div>
                <div>
                  <div style={{ fontSize: 15.5, fontWeight: 600, color: "var(--color-text-primary)" }}>{c.t}</div>
                  <div style={{ fontSize: 13.5, lineHeight: "20px", color: "var(--color-text-secondary)", margin: "2px 0 8px" }}>{c.d}</div>
                  <a href="#" style={{ fontSize: 13.5, fontWeight: 500, color: "var(--color-link)", textDecoration: "none" }}>{c.a}</a>
                </div>
              </div>
            </Card>
          ))}
          <div style={{ fontSize: 13.5, lineHeight: "21px", color: "var(--color-text-secondary)", padding: "4px 4px 0" }}>
            Prefer to read first? Check the <a href="faq.html" style={{ color: "var(--color-link)", textDecoration: "none" }}>FAQ</a> or <a href="changelog.html" style={{ color: "var(--color-link)", textDecoration: "none" }}>changelog</a>.
          </div>
        </div>
      </Container>
    </React.Fragment>
  );
}

window.ContactPage = ContactPage;
