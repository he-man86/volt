Future change — NOT started. Motivated by silent skips during the library-signature work (2026-07-06):
strict no-fallback + facade/split library matching left ~50 empty library folders with no trace.

## Surface
- [ ] Decide the observability surface: additive `diagnostics[]` on the `/fetch` + `/refs` response, a
      retrievable bridge log (endpoint or file), or both. Entry shape `{ kind, name, reason, detail? }`.
- [ ] Emit an entry at EVERY drop/skip site in `FetchService`/`RefsService`:
      library-sig unmatched (no RESOLUTION match) · library with 0 precompiled sigs · render-null sig ·
      dead-code omitted (`omitDeadCode`) · exclude-from-build · malformed item (`SafeVersion` null).
- [ ] Keep it vendor-neutral (Core) so CODESYS + Beckhoff report identically.

## Analyze the edge cases (decide fix vs surface vs accept)
- [ ] **Library facade / Interfaces↔Implementation split** — introspect `ILibManItem` (likely
      `EffectiveResolution`'s concrete path) to build a robust ref→concrete-library map, or fold elements by
      their own `LibraryPath`. Right now unmatched elements are SKIPPED (empty folders).
- [ ] **Libraries with no precompiled sigs** (`L_MC1P_MotionControlBasic`) — is there an alternate extraction
      path (compiled-library export), or is it simply unavailable headless? Emit a signal either way.
- [ ] **Render-null** — confirm method/property are covered by their parent FB; log unknown `POUType`.

## Tests / runbook
- [ ] Committed test: a skipped item produces a `diagnostics` entry with the right `kind`/`reason`.
- [ ] A short "debugging a customer bridge session" runbook (how to read the report / pull the log).

## Notes
- Related: the `bridge-protocol` spec (wire contract) — the response-field variant extends it.
- The `/debug?libsig=summary` + `/debug?libsig=<name>` introspection added during the 2026-07-06 work is the
  starting point for the analysis tasks.
