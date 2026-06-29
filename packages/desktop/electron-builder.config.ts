import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)
const packageDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(packageDir, "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")
// The Electron 42 packaging update briefly installed Linux launchers/icons under
// "opencode-desktop". Keep that hidden desktop entry around so existing GNOME/KDE
// pins still resolve after the canonical app id changes back to ai.opencode.desktop.
const legacyDesktopEntry = path.join(packageDir, "resources", "linux", "opencode-desktop.desktop")
const legacyDesktopEntryFpm = `${legacyDesktopEntry}=/usr/share/applications/opencode-desktop.desktop`

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  // Default prod — installers are prod-only; dev/beta require an explicit OPENCODE_CHANNEL (CI sets it per branch).
  return "prod"
})()

const APP_IDS = {
  dev: "dev.volt.desktop.dev",
  beta: "dev.volt.desktop.beta",
  prod: "dev.volt.desktop",
} as const

// Per-channel product name — the single source for both productName and the uninstall entry name.
const PRODUCT_NAMES = { dev: "Volt Dev", beta: "Volt Beta", prod: "Volt" } as const

const getBase = (appId: string): Configuration => ({
  artifactName: "Volt-Setup-${version}-${arch}.${ext}",
  productName: PRODUCT_NAMES[channel],
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  // Linux launchers are .desktop files, so this is the desktop file name,
  // not just the app id. For prod, app id "ai.opencode.desktop" becomes
  // "ai.opencode.desktop.desktop".
  // https://developer.gnome.org/documentation/guidelines/maintainer/integrating.html
  // https://www.electron.build/docs/linux/
  extraMetadata: {
    // Volt: electron-builder derives the per-user install dir from the package `name`. The real name is
    // `@opencode-ai/desktop` (shared with stock opencode → both land in `Programs\@opencode-aidesktop` and
    // collide). Override it for the build only, so Volt installs to `Programs\Volt` and the two COEXIST.
    name: "Volt",
    desktopName: `${appId}.desktop`,
  },
  files: ["out/**/*", "resources/**/*"],
  extraResources: [
    {
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    },
    {
      // Volt: bundle the LSP + CLI binaries so a fresh install carries PLC intelligence without a
      // hand-written global config. Build them first: `bun volt-scripts/dist.ts` → dist/volt/bin.
      from: "../../dist/volt/bin",
      to: "volt/bin",
    },
    {
      // Volt: bundle the connector (background tray gateway + bridge workers) so ONE install carries
      // everything. The nsis.include macros launch it on install + clean its login item on uninstall.
      from: "../../dist/volt/connector",
      to: "volt/connector",
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: true,
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: true,
  },
  protocols: {
    name: "Volt",
    schemes: ["volt"],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    signtoolOptions: {
      sign: signWindows,
    },
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
    // Apps & Features entry: "<product> Desktop" (e.g. "Volt Desktop"). Drop the version electron-builder bakes
    // into the name by default — it stays in DisplayVersion (the Version column). Pairs with the CLI's "Volt CLI".
    uninstallDisplayName: `${PRODUCT_NAMES[channel]} Desktop`,
    // Volt: connector lifecycle (launch on install · stop + drop login item on uninstall). Fork-owned
    // .nsh, referenced by absolute path so it's not a new file inside the upstream desktop package.
    include: path.join(rootDir, "packages/volt-bridge/installer/connector.nsh"),
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    executableName: appId,
    desktop: {
      entry: {
        // Match the installed .desktop file and hicolor icon basename so
        // Linux shells can associate the running Electron window with its launcher.
        StartupWMClass: appId,
      },
    },
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const appId = APP_IDS[channel]
  const base = getBase(appId)

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId,
        rpm: { packageName: "opencode-dev" },
      }
    }
    case "beta": {
      return {
        ...base,
        appId,
        protocols: { name: "Volt Beta", schemes: ["volt"] },
        // Volt updater feed — its own repo, never anomalyco/opencode (else it would self-update to stock opencode).
        publish: { provider: "github", owner: "he-man86", repo: "volt", channel: "beta" },
        rpm: { packageName: "opencode-beta" },
      }
    }
    case "prod": {
      return {
        ...base,
        appId,
        protocols: { name: "Volt", schemes: ["volt"] },
        // Volt updater feed — its own repo, never anomalyco/opencode (else it would self-update to stock opencode).
        publish: { provider: "github", owner: "he-man86", repo: "volt", channel: "latest" },
        deb: { fpm: [legacyDesktopEntryFpm] },
        rpm: { packageName: "opencode", fpm: [legacyDesktopEntryFpm] },
      }
    }
  }
}

export default getConfig()
