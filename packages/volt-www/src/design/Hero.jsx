function Hero() {
  const { Button } = window.VoltDesignSystem_704691;
  return (
    <section style={{ maxWidth: 1120, margin: "0 auto", padding: "72px 24px 40px", textAlign: "left" }}>
      <h1 style={{ fontSize: 56, lineHeight: "62px", fontWeight: 600, letterSpacing: "-0.03em", color: "var(--color-text-primary)", margin: 0, maxWidth: 760, textWrap: "balance" }}>
        The only AI tool an automation engineer needs
      </h1>
      <p style={{ fontSize: 18, lineHeight: "28px", color: "var(--color-text-secondary)", maxWidth: 600, margin: "20px 0 0", textWrap: "pretty" }}>
        Everything you expect from modern AI coding tools — plus deep understanding of PLC projects, industrial automation, and engineering workflows.
      </p>
      <div style={{ display: "flex", gap: 12, justifyContent: "flex-start", marginTop: 28 }}>
        {/* volt: OS-detected download from the console resolver */}
        <a href={window.VOLT.downloadUrl()} style={{ textDecoration: "none", display: "inline-flex" }}>
          <Button variant="primary" size="lg">
            <Icon d={["M12 3v11", "M8 10l4 4 4-4", "M5 20h14"]} size={18} stroke="var(--color-text-on-accent)" />
            Download for free
          </Button>
        </a>
      </div>
      <div id="demo" style={{ marginTop: 56, scrollMarginTop: 76 }}>
        <HeroMockup />
      </div>
    </section>
  );
}
window.Hero = Hero;
