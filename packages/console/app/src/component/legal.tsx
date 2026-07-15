import { LanguagePicker } from "~/component/language-picker"

// VOLT: opencode's footer said "© Anomaly", linked opencode's /brand kit, and linked opencode's own
// Terms/Privacy pages — whose text binds users to ANOMALY INNOVATIONS, INC. / "OpenCode", legally wrong for Volt.
// Stripped to the Volt copyright + the language picker. Volt's OWN Terms/Privacy (authored by Volt, to live on
// volt-www) get linked here once they exist — see openspec/changes/volt-branding (Phase 2, legal follow-up).
export function Legal() {
  return (
    <div data-component="legal">
      <span>©{new Date().getFullYear()} Volt</span>
      <span>
        <LanguagePicker align="right" />
      </span>
    </div>
  )
}
