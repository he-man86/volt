/**
 * @opencode-ai/volt-app — Volt's Solid components for the opencode DESKTOP app.
 *
 * STUB. Built in Phases 2–3 + B (see README). Renders `@opencode-ai/volt-control` and mounts into
 * `packages/app` via the GUI `<Slot/>` (Phase 2). Holds ONLY override/added components — never a
 * copy of `packages/app`.
 *
 * Planned exports (added when solid-js + volt-control are wired):
 *   VoltPanel(props)            — sidebar panel: status list, push/pull/build buttons, diagnostics
 *                                 (the volt-vscode SCM/history UX, in the desktop app)
 *   registerVoltPanel(registry) — registers VoltPanel into packages/app's <Slot name="sidebar">
 *   VoltMark / VoltSplash       — Volt brand SVG, aliased over @opencode-ai/ui/logo (branding, Phase B)
 */
export const VOLT_APP_STUB = "see packages/volt-app/README.md (Phases 2–3, B)"
