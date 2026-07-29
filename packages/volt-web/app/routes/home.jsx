import { Hero } from "../components/Hero.jsx"
import { Platforms } from "../components/Platforms.jsx"
import { Features } from "../components/Features.jsx"
import { FeatureShowcase } from "../components/FeatureShowcase.jsx"
import { DesktopApp } from "../components/mockups/DesktopApp.jsx"
import { VSCode } from "../components/mockups/VSCode.jsx"
import { Connector } from "../components/mockups/Connector.jsx"
import { FinalCTA } from "../components/FinalCTA.jsx"

export default function Page() {
  return (
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
        link={{ href: "/docs/desktop-vs-vscode#the-desktop-app", label: "When to use the desktop app" }}
      >
        <DesktopApp panel="sync" theme="light" autoplay />
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
        link={{ href: "/docs/desktop-vs-vscode#the-vs-code-extension", label: "When to use the extension" }}
      >
        <VSCode autoplay />
      </FeatureShowcase>

      <FeatureShowcase
        eyebrow="Volt Connector · always-on"
        title="One connector to your live IDE."
        body="The Volt Connector runs quietly in your system tray, finds your running PLC projects across every vendor, and keeps the bridge live and Volt up to date. You connect from the app — the connector handles the rest."
        points={[
          "Full support for CODESYS-based tooling and TwinCAT/Beckhoff",
          "Finds your open projects and keeps Volt updated automatically",
          "More IDEs in consideration — Siemens, Rockwell, and beyond",
        ]}
      >
        <Connector autoplay />
      </FeatureShowcase>

      <Features />
      <FinalCTA />
    </>
  )
}
