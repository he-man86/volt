## Why

Volt's gateway IS opencode's Zen, forked (`packages/console`). But Volt's **client** side is hand-rolled: a
`provider.volt` block in `opencode-config/opencode.json` that names two models with hand-typed display names and
hand-typed context/output limits. opencode's own client does none of that — so the picker shows opencode's
Anthropic and DeepSeek families (rich metadata, kept current) and, beneath them, two Volt rows we maintain by hand.
That reads as duplicates, and it drifts: a new model, a price change, or a context-window bump upstream reaches
opencode's entries automatically and ours never.

Three lists have to agree today and nothing enforces it: `models.json` (`zenModels` — what the gateway serves and
bills), `opencode-config/opencode.json` (`provider.volt.models` — what the picker offers), and whatever the upstream
provider actually supports. Two are checked by a comment; the third is checked by nobody.

## What we know (measured, 2026-07-28)

- **opencode's catalog is models.dev**, fetched and cached as `models.json` under its cache dir, and redirectable:
  `OPENCODE_MODELS_URL || "https://models.dev"` (read out of the installed 1.18.3 binary, alongside a
  `models --refresh` CLI flag). That is where every built-in provider's models, names, limits and costs come from —
  which is exactly why those rows look right and ours look thin.
- **The Volt gateway already serves both wire formats**, each authenticating the way the matching SDK sends:
  - `/v1/chat/completions` → `parseApiKey: headers.get("authorization")?.split(" ")[1]` (what `@ai-sdk/openai-compatible` sends)
  - `/v1/messages` → `parseApiKey: headers.get("x-api-key")` (what `@ai-sdk/anthropic` sends)
  - both over `modelList: "lite"`, and `liteModels` == `zenModels` == the two ids the picker declares.
- **`/v1/models` is live** and returns exactly those two ids, so the gateway can already answer a catalog query.
- The documented custom-provider shape (`npm` + `name` + `options.baseURL` + `models[id].name`, optional
  `limit`/`options`) is what we ship — this is a *drift and duplication* problem, not a malformed-config problem.

## What this change is

Understand how opencode wires its OWN gateway client-side, then mirror it instead of maintaining a parallel
hand-written declaration. Concretely, decide between and then implement:

1. **Catalog piggyback** — Volt serves a models.dev-shaped catalog (upstream content + the `volt` provider entry)
   and the installer points `OPENCODE_MODELS_URL` at it. Volt's models then carry the same metadata quality as the
   built-ins and inherit upstream updates for Anthropic/DeepSeek automatically. Cost: Volt owns a catalog endpoint
   (availability, freshness, and a cache-poisoning blast radius), and the env var is **global** — it replaces
   models.dev for that user, which is a much bigger footprint than `OPENCODE_CONFIG_DIR` and must stay reversible.
2. **Per-format providers** — split Claude onto `@ai-sdk/anthropic` (native `/v1/messages`: prompt caching and
   reasoning blocks, which openai-compat drops and which matter over long PLC sessions) and keep DeepSeek on
   openai-compatible. Costs a second provider row, and `plugins/volt-auth.ts` must supply credentials for both ids.
3. **Status quo + generated config** — keep one openai-compatible provider, but GENERATE `provider.volt.models`
   from `models.json` at build time so the three lists cannot drift, and enrich it from models.dev metadata.

Whatever we pick, the invariant to land is: **one source of truth for "which models does Volt serve", with the
picker, the gateway and billing derived from it** — not three files agreeing by convention.

## Open questions (answer before designing)

- How does opencode register its own gateway as a provider — is `opencode`/`zen` an entry in the models.dev catalog,
  or code in the binary? Read their repo (`sst/opencode`), not the bundle, for the provider registration and the
  `auth login` → gateway flow. This decides whether "mirror them" means a catalog entry or a plugin.
- Does opencode's client enumerate a gateway's models dynamically (`/v1/models`) or only from the catalog? If
  dynamic, option 1 collapses to "serve the right JSON" and the config entry can shrink to almost nothing.
- What exactly does `OPENCODE_MODELS_URL` replace — the whole catalog, or is it merged? If whole, option 1 requires
  Volt to mirror models.dev faithfully and stay current, which is an ongoing obligation, not a one-off.
- Can one plugin register auth for two provider ids (needed by option 2)?
- Does the gateway's `lite` vs `zen` model list distinction matter for what the picker should show?

## Non-goals

- Overriding `provider.anthropic.options.baseURL` to reroute the user's OWN account through Volt. It works and it is
  invisible: same model name, same picker row, different billing. That breaks the additive-and-safe rule the whole
  `OPENCODE_CONFIG_DIR` integration rests on, and it is explicitly rejected.
- Hiding built-in providers with `enabled_providers`/`disabled_providers` in the shipped config. If "only Volt" is
  ever wanted, it belongs behind an explicit login-time opt-in, never in the default dir.
