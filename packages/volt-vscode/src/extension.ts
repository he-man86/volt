import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import * as vscode from "vscode"
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  Trace,
  TransportKind,
} from "vscode-languageclient/node"
import { registerCommands } from "./commands.js"
import { registerMergeEditor } from "./merge.js"
import { VoltStatus, registerWorkspaces } from "./status.js"

interface PlcLanguage {
  languageId: string
  lspPackage: string
  displayName: string
  configKey: string
  settingsRoot: string
  referencePath: string
  additionalLanguageIds?: readonly string[]
  fileWatcherGlob?: string
}

const PLC_LANGUAGES: PlcLanguage[] = [
  {
    languageId: "structured-text",
    lspPackage: "@opencode-ai/volt-lsp",
    displayName: "Structured Text",
    configKey: "volt.structuredText.lspServer",
    settingsRoot: "volt.structuredText",
    referencePath: ".claude/skills/st-reference/codesys-reference/00-index.md",
    additionalLanguageIds: ["plc-interface", "plc-gvl", "plc-dut", "plc-fbd", "plc-ld"],
    fileWatcherGlob: "**/*.{st,gvl,struct,enum,union,alias,itf,fbd,ld}",
  },
]

const CONFIG_XML_LANGUAGES = [
  "plc-visualization", "plc-recipes", "plc-task", "plc-library",
  "plc-textlist", "plc-imagepool", "plc-device", "plc-trace",
  "plc-cam", "plc-alarm", "plc-uml", "plc-tmc",
]

const DIAGNOSTIC_FLAGS = [
  "reservedKeyword", "doubleUnderscore", "consecutiveUnderscores",
  "duplicateDeclaration", "unresolvedIdentifier", "unknownPragma",
  "wrongVendorPragma", "pragmaMissingCompanion", "pragmaConflict",
  "fbLifecycleSignature", "shadowingDeclaration", "initSlotCollision",
  "conversionSourceMismatch",
] as const

const OPT_IN_DIAGNOSTIC_FLAGS = new Set(["shadowingDeclaration", "unknownPragma", "wrongVendorPragma", "initSlotCollision"] as const)

interface ClientState {
  lang: PlcLanguage
  client: LanguageClient
  statusItem: vscode.StatusBarItem
}

const clients = new Map<string, ClientState>()
const statuses = new Map<string, VoltStatus>()

export async function activate(context: vscode.ExtensionContext) {
  registerWorkspaceInitializedContext(context)
  registerConfigXmlFormatter(context)

  registerWorkspaces(context, statuses)
  context.subscriptions.push(
    registerMergeEditor(context),
    ...registerCommands(context, statuses),
  )

  for (const lang of PLC_LANGUAGES) {
    await startLanguageClient(context, lang)
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      for (const lang of PLC_LANGUAGES) {
        if (e.affectsConfiguration(lang.settingsRoot)) void restartClient(context, lang)
      }
    }),
  )
}

export async function deactivate(): Promise<void> {
  await Promise.all([...clients.values()].map((s) => s.client.stop()))
  clients.clear()
}

function registerWorkspaceInitializedContext(context: vscode.ExtensionContext): void {
  const compute = (): boolean => {
    const folders = vscode.workspace.workspaceFolders
    if (folders === undefined) return false
    return folders.some((f) => existsSync(join(f.uri.fsPath, ".volt", "config.json")))
  }
  const publish = (): void => {
    void vscode.commands.executeCommand("setContext", "volt.workspaceInitialized", compute())
  }
  publish()
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(publish))
  const watcher = vscode.workspace.createFileSystemWatcher("**/.volt/config.json")
  watcher.onDidCreate(publish)
  watcher.onDidDelete(publish)
  context.subscriptions.push(watcher)
}

function registerConfigXmlFormatter(context: vscode.ExtensionContext): void {
  const provider: vscode.DocumentFormattingEditProvider = {
    provideDocumentFormattingEdits(document, options) {
      const text = document.getText()
      const formatted = formatXml(text, options.insertSpaces ? " ".repeat(options.tabSize) : "\t")
      if (formatted === text) return []
      const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(text.length))
      return [vscode.TextEdit.replace(fullRange, formatted)]
    },
  }
  for (const languageId of CONFIG_XML_LANGUAGES) {
    context.subscriptions.push(
      vscode.languages.registerDocumentFormattingEditProvider({ language: languageId, scheme: "file" }, provider),
    )
  }
}

function formatXml(xml: string, indent: string): string {
  const trimmed = xml.trim()
  if (!trimmed) return xml
  const lines = trimmed.replace(/>\s*</g, ">\n<").split("\n")
  let depth = 0
  const out: string[] = []
  for (let raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const isClosing = /^<\//.test(line)
    const isSelfClosing = /\/\s*>$/.test(line) || /^<\?/.test(line) || /^<!--/.test(line) || /^<!\[CDATA\[/.test(line)
    const hasInlineClose = /^<([\w:.-]+)(\s[^>]*)?>.*<\/\1>$/.test(line)
    if (isClosing) depth = Math.max(0, depth - 1)
    out.push(indent.repeat(depth) + line)
    if (!isClosing && !isSelfClosing && !hasInlineClose) depth++
  }
  return out.join("\n") + "\n"
}

async function startLanguageClient(context: vscode.ExtensionContext, lang: PlcLanguage): Promise<void> {
  const serverModule = resolveServerModule(lang, context)
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  statusItem.text = `$(circle-slash) ${lang.displayName}`
  statusItem.tooltip = "Volt language server status"
  statusItem.command = `volt.${lang.languageId}.showOutput`
  context.subscriptions.push(statusItem)

  if (serverModule === undefined) {
    statusItem.text = `$(warning) ${lang.displayName}`
    statusItem.tooltip = `LSP server not found. Set ${lang.configKey} or install ${lang.lspPackage}.`
    statusItem.show()
    vscode.window.showWarningMessage(
      `Volt: couldn't find ${lang.lspPackage}. Syntax highlighting works, but features like hover and go-to-definition are disabled. Install the package or set ${lang.configKey} to a path.`,
    )
    return
  }

  const serverOptions: ServerOptions = {
    run: { command: process.execPath, args: [serverModule, "--stdio"], transport: TransportKind.stdio },
    debug: { command: process.execPath, args: [serverModule, "--stdio"], transport: TransportKind.stdio },
  }

  const languageIds = [lang.languageId, ...(lang.additionalLanguageIds ?? [])]
  const traceSetting = vscode.workspace.getConfiguration(lang.settingsRoot).get<"off" | "messages" | "verbose">("trace", "off")
  const traceOutputChannel = vscode.window.createOutputChannel(`Volt — ${lang.displayName} (LSP trace)`)
  context.subscriptions.push(traceOutputChannel)

  const clientOptions: LanguageClientOptions = {
    documentSelector: languageIds.map((language) => ({ scheme: "file", language })),
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher(lang.fileWatcherGlob ?? `**/*.${lang.languageId}`),
    },
    outputChannelName: `Volt — ${lang.displayName}`,
    traceOutputChannel,
    initializationOptions: buildInitializationOptions(lang),
  }

  const client = new LanguageClient(`volt-${lang.languageId}`, `Volt (${lang.displayName})`, serverOptions, clientOptions)

  statusItem.text = `$(sync~spin) ${lang.displayName}`
  statusItem.show()

  clients.set(lang.languageId, { lang, client, statusItem })
  context.subscriptions.push({ dispose: () => void client.stop() })

  try {
    await client.start()
    await client.setTrace(
      traceSetting === "verbose" ? Trace.Verbose
        : traceSetting === "messages" ? Trace.Messages
        : Trace.Off,
    )
    statusItem.text = `$(check) ${lang.displayName}`
    statusItem.tooltip = `Volt (${lang.displayName}) — running`
  } catch (err) {
    statusItem.text = `$(error) ${lang.displayName}`
    statusItem.tooltip = `Volt (${lang.displayName}) — failed to start`
    vscode.window.showErrorMessage(
      `Volt: ${lang.displayName} LSP failed to start. ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

async function restartClient(context: vscode.ExtensionContext, lang: PlcLanguage): Promise<void> {
  const existing = clients.get(lang.languageId)
  if (existing !== undefined) {
    existing.statusItem.dispose()
    await existing.client.stop()
    clients.delete(lang.languageId)
  }
  await startLanguageClient(context, lang)
}

interface PlcLspInitOptions {
  diagnostics?: Partial<Record<string, boolean>>
  hover?: { showSource?: boolean }
  completion?: { snippetSupport?: boolean }
  vendor?: "codesys" | "twincat" | "auto"
}

function buildInitializationOptions(lang: PlcLanguage): PlcLspInitOptions {
  const cfg = vscode.workspace.getConfiguration(lang.settingsRoot)
  const diagnostics: Record<string, boolean> = {}
  for (const flag of DIAGNOSTIC_FLAGS) {
    const conservativeDefault = !OPT_IN_DIAGNOSTIC_FLAGS.has(flag as never)
    diagnostics[flag] = cfg.get<boolean>(`diagnostics.${flag}`, conservativeDefault)
  }
  const vendor = cfg.get<"codesys" | "twincat" | "auto">("vendor", "auto")
  return {
    vendor,
    diagnostics,
    hover: { showSource: cfg.get<boolean>("hover.showSource", true) },
    completion: { snippetSupport: cfg.get<boolean>("completion.snippetSupport", true) },
  }
}

function resolveServerModule(lang: PlcLanguage, context: vscode.ExtensionContext): string | undefined {
  const cfg = vscode.workspace.getConfiguration()
  const override = cfg.get<string>(lang.configKey, "").trim()
  if (override.length > 0 && existsSync(override)) return override

  const extDir = join(context.extensionPath, "dist")
  const bundled = join(extDir, "lsp-server.js")
  if (existsSync(bundled)) return bundled

  const candidates: string[] = []
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    candidates.push(folder.uri.fsPath)
  }
  candidates.push(context.extensionPath)

  for (const startDir of candidates) {
    const hit = findUpward(startDir, join("node_modules", lang.lspPackage, "dist", "bin.js"))
    if (hit !== undefined) return hit
  }

  const globalHit = findGlobalNpmPackage(lang.lspPackage)
  if (globalHit !== undefined) return globalHit

  return undefined
}

function findUpward(startDir: string, relativePath: string): string | undefined {
  let current = resolve(startDir)
  const parsed = { root: resolve(current, "/") }
  for (;;) {
    const candidate = join(current, relativePath)
    if (existsSync(candidate)) return candidate
    const parent = dirname(current)
    if (parent === current || parent === parsed.root) {
      const rootCandidate = join(parent, relativePath)
      return existsSync(rootCandidate) ? rootCandidate : undefined
    }
    current = parent
  }
}

function findGlobalNpmPackage(pkg: string): string | undefined {
  try {
    const r = spawnSync("npm", ["root", "-g"], { encoding: "utf-8", shell: process.platform === "win32" })
    if (r.status !== 0) return undefined
    const globalRoot = r.stdout.trim()
    const candidate = join(globalRoot, pkg, "dist", "bin.js")
    return existsSync(candidate) ? candidate : undefined
  } catch {
    return undefined
  }
}
