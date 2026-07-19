import { renderPage } from "../shell.jsx"
import { Hero } from "../components/Hero.jsx"
import { Platforms } from "../components/Platforms.jsx"
import { Features } from "../components/Features.jsx"
import { FeatureShowcase } from "../components/FeatureShowcase.jsx"
import { DesktopApp } from "../components/mockups/DesktopApp.jsx"
import { VSCode } from "../components/mockups/VSCode.jsx"
import { Bridge } from "../components/mockups/Bridge.jsx"
import { FinalCTA } from "../components/FinalCTA.jsx"

renderPage(
  <>
    <Hero />

    <Platforms />

    <FeatureShowcase
      eyebrow="Desktop app · the all-in-one"
      title="One app that does it all."
      body="The Volt desktop app is the complete package — the AI agent, live IDE sync, and Structured Text diagnostics in a single window. Download, sign in, and you're working. Nothing to configure."
      points={[
        "Everything in one place — agent, IDE sync, and diagnostics",
        "Zero setup — install and go",
        "The fastest way to put Volt on your PLC project",
      ]}
    >
      <DesktopApp panel="sync" theme="light" explorer={false} autoplay />
    </FeatureShowcase>

    <FeatureShowcase
      flip
      bg={false}
      eyebrow="VS Code extension · for power users"
      title="Full Structured Text IntelliSense, in the editor you know."
      body="Live in your editor? The Volt extension brings deep language intelligence to VS Code and Windsurf — the same PLC understanding, with an editor's full power. A bit more to set up, a lot more control."
      points={[
        "Autocomplete, hover, go-to-definition, and signature help",
        "Refactoring and project-wide navigation across your Structured Text",
        "Drift coloring + the opencode agent in the integrated terminal",
        "A few minutes of setup — bring your own editor",
      ]}
    >
      <VSCode autoplay />
    </FeatureShowcase>

    <FeatureShowcase
      eyebrow="Volt Bridge · the connector"
      title="One connector to your live IDE."
      body="The Volt Bridge runs quietly in your system tray, links to your running PLC IDE, and keeps everything in sync. Pick your IDE and Volt does the rest — no ports to wire up by hand."
      points={[
        "Full support for CODESYS-based tooling and TwinCAT/Beckhoff",
        "Auto-selects the bridge port and keeps Volt up to date",
        "More IDEs in consideration — Siemens, Rockwell, and beyond",
      ]}
    >
      <Bridge autoplay />
    </FeatureShowcase>

    <Features />
    <FinalCTA />
  </>,
)
