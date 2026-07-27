// All marketing copy in one place. Pages/components read from here so copy edits are a single-file change.

// fallow-ignore-next-line unused-export -- canonical brand copy, kept as the single source of truth even when no page currently reads it
export const BRAND = {
  name: "Volt",
  tagline: "The AI coding agent for industrial automation.",
  sub: "Everything you expect from a modern AI code editor — plus deep understanding of PLC projects, Structured Text, and the engineering workflow. Built for CODESYS and TwinCAT.",
}

// Home feature grid + the per-feature detail pages share this list (slug === feature-<slug>.html).
export const FEATURES = [
  {
    slug: "volt-git",
    eyebrow: "Version control",
    title: "Git-native PLC projects",
    blurb: "Pull your live CODESYS or TwinCAT project into git as clean text. Branch, diff, review, and merge with the tools you already know — then push back to the IDE.",
    points: [
      "One repo, real git — the IDE is modeled as a remote you fetch and push",
      "`volt pull` / `volt push` reconcile through native git merge — no bespoke 3-way engine",
      "Every object is one text file, keyed by name — reviewable diffs, no binary blobs",
    ],
  },
  {
    slug: "compiler-intelligence",
    eyebrow: "Language intelligence",
    title: "Compiler-grade Structured Text",
    blurb: "A TypeScript-native language server for IEC 61131-3: go-to-definition, diagnostics, hover, completion, and signature help across your whole project — powered by an embedded CODESYS reference.",
    points: [
      "Navigation and diagnostics tuned against real CODESYS builds",
      "Understands referenced libraries, the device tree, and cross-references",
      "Runs offline — your code is analyzed locally",
    ],
  },
  {
    slug: "ai-native-plc-languages",
    eyebrow: "AI-native",
    title: "AI that reads your PLC code",
    blurb: "Structured Text and editable graphical logic (FBD/LD) become first-class text the agent can read, explain, and edit — not opaque blobs it has to guess at.",
    points: [
      "Graphical bodies round-trip PlcOpen XML to a textual VG form the AI edits",
      "Ask questions, refactor, and generate ST with full project context",
      "Type-checking and codegen stay the IDE's job — Volt keeps you honest",
    ],
  },
  {
    slug: "project-understanding",
    eyebrow: "Context",
    title: "Understands the whole project",
    blurb: "Volt maps your program organization units, function blocks, libraries, and device instances — so the agent answers with your architecture in mind, not a generic guess.",
    points: [
      "Device tree exposed as read-only descriptors the LSP resolves",
      "Library signatures extracted and cached per version",
      "Cross-file references, not single-file autocomplete",
    ],
  },
  {
    slug: "desktop-and-cli",
    eyebrow: "Surfaces",
    title: "Desktop app and CLI",
    blurb: "A native desktop shell for day-to-day engineering, and a scriptable `volt` CLI for the terminal and CI. Same core, your choice of surface.",
    points: [
      "Desktop shell with the agent, the IDE panel, and drift coloring",
      "`volt` CLI: init, pull, push, status, build, log, show, merge",
      "VS Code extension for language intelligence in your existing editor",
    ],
  },
  {
    slug: "privacy",
    eyebrow: "Trust",
    title: "Private by default",
    blurb: "Your PLC code is your IP. Volt runs locally and brings your own AI provider key — nothing about your project is uploaded to make the tooling work.",
    points: [
      "Bring your own model provider — keys stay in your environment",
      "Local analysis; nothing is uploaded to run the language server",
      "Your prompts go to the provider you choose, not to us",
    ],
  },
]

// Nav: Product is a dropdown of the per-feature detail pages (plus a jump to the on-page overview); Resources
// groups the support pages. An entry with `href` (no `items`) renders as a plain link; `items` renders a dropdown.
export const NAV = [
  {
    label: "Product",
    items: [
      { label: "All features", href: "/#features" },
      ...FEATURES.map((f) => ({ label: f.title, href: `/feature-${f.slug}.html` })),
    ],
  },
  { label: "Pricing", href: "/pricing.html" },
  {
    label: "Resources",
    items: [
      { label: "Changelog", href: "/changelog.html" },
      { label: "FAQ", href: "/faq.html" },
      { label: "Contact", href: "/contact.html" },
    ],
  },
]

// Supported PLC platforms — shown as a muted logo band below the hero (wordmarks, not vendor logos).
export const PLATFORMS = ["Beckhoff", "CODESYS", "Schneider", "WAGO", "Lenze", "Keba", "Festo"]

export const PRICING = [
  {
    name: "Free",
    price: "$0",
    note: "Bring your own AI provider",
    features: ["The volt CLI + git-native sync", "Structured Text language intelligence", "Desktop app & VS Code extension", "Your own model provider key"],
    cta: "Download for Windows",
    kind: "download",
  },
  {
    name: "Pro",
    price: "€24",
    period: "/ month",
    note: "Hosted AI, no key required",
    features: ["Everything in Free", "Hosted models — nothing to configure", "Priority language-server updates", "Email support"],
    cta: "Join the public beta",
    kind: "auth", // → the console's /auth (sign up); no checkout yet — accounts are free during the beta
    featured: true,
    beta: true, // PUBLIC BETA: sign up now, free while it lasts — no card, no charge yet
    betaNote: "Free while in public beta — no card required.",
  },
]

export const FAQ = [
  { q: "Which PLCs does Volt support?", a: "CODESYS and TwinCAT/Beckhoff today. Both serve the same wire, so the experience is identical across vendors." },
  { q: "Does my code leave my machine?", a: "No. The language server analyzes your project locally, and you bring your own AI provider key — so prompts go to the provider you choose, not to us." },
  { q: "Is this a fork of my IDE?", a: "No. Volt sits alongside your live CODESYS or TwinCAT IDE and syncs your project into git as text. The IDE stays the source of truth for build and codegen." },
  { q: "What platforms does the installer run on?", a: "Windows — Volt's PLC tooling (the bridges, CODESYS integration) is Windows-native." },
  { q: "Do I need a separate AI subscription?", a: "On the Free plan you bring your own model provider key. Pro includes hosted models — nothing to configure. Pro is in public beta right now: you can sign up free, no card required (it'll be €24/month once billing opens)." },
]

export const CHANGELOG = [
  { version: "0.1", date: "2026", items: ["Git-native pull/push for CODESYS and TwinCAT", "Structured Text language server (nav, diagnostics, hover)", "Desktop app and volt CLI"] },
]

export const FOOTER = {
  columns: [
    { title: "Product", links: [ { label: "Features", href: "/#features" }, { label: "Pricing", href: "/pricing.html" }, { label: "Changelog", href: "/changelog.html" } ] },
    { title: "Resources", links: [ { label: "FAQ", href: "/faq.html" }, { label: "Contact", href: "/contact.html" } ] },
    { title: "Legal", links: [ { label: "Privacy", href: "/legal/privacy.html" }, { label: "Terms", href: "/legal/terms.html" } ] },
  ],
}
