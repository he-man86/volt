## ADDED Requirements

### Requirement: `models.json` is the single source of truth for the Volt model catalog

"Which models does Volt serve" SHALL have exactly one authoritative declaration — `models.json` at the repo root.
The gateway's served list and billing already derive from it (via `set-models.ts` → `ZEN_MODELS1..30`); the
opencode picker entry (`provider.volt.models` in `opencode-config/opencode.json`) SHALL be **generated** from it
rather than hand-maintained beside it.

The generator SHALL derive, per model: the display name and the per-million cost from `models.json` itself
(Volt's own label and Volt's own prices, not upstream's), and the context/output limits, modalities and
capability flags from the models.dev entry named by that model's declared `providers[0]` coordinate. It SHALL
fail loudly — never guess or fall back — when a declared coordinate is absent from models.dev or a provider
declares a wire format with no mapped SDK.

#### Scenario: a model added to the gateway reaches the picker
- **WHEN** a model is added to `models.json` `zenModels` and `bun volt-scripts/gen-model-config.ts` is run
- **THEN** `provider.volt.models` gains an entry carrying that model's upstream metadata, and no metadata is
  typed by hand anywhere

#### Scenario: upstream metadata is refreshed without editing the config by hand
- **WHEN** upstream changes a model's context window and the generator is re-run
- **THEN** the committed picker entry updates from models.dev, and the change is visible as a diff of generated
  output rather than a hand edit

#### Scenario: a coordinate that does not exist is a hard failure
- **WHEN** `models.json` names a `providers[0]` coordinate that models.dev does not carry
- **THEN** the generator exits non-zero naming the missing coordinate, and does not write a partial or
  hand-guessed entry

### Requirement: The three model lists cannot silently drift

`check-wiring.ts` SHALL assert that the picker's model ids, `models.json` `zenModels` ids, and the ids the
deployed gateway answers at `/v1/models` all agree, and that each picker entry's display name, cost and
per-model SDK match what `models.json` implies. The SDK mapping SHALL be imported from the generator so the
check and the generator cannot diverge.

Assertions requiring the network SHALL report as **skipped/unverified** when the gateway is unreachable —
never as passed — so CI stays offline and key-free without a green tick standing in for a check that never ran.

#### Scenario: the picker is stale relative to the gateway catalog
- **WHEN** a model is added to `models.json` but the picker entry is not regenerated
- **THEN** `check-wiring` fails, naming both lists and the command that fixes it

#### Scenario: a hand edit desynchronises a price or a name
- **WHEN** a picker entry's cost or display name no longer matches `models.json`
- **THEN** `check-wiring` fails, naming the field and both values

#### Scenario: the gateway is unreachable
- **WHEN** `check-wiring` runs with no route to `volt-ai.dev`
- **THEN** the `/v1/models` assertion reports `SKIPPED` and is counted as unverified, and the run does not fail

### Requirement: One Volt provider serves both gateway wire formats

Volt SHALL expose a single `volt` provider id — one baseURL, one stored credential — and select the wire format
**per model** using opencode's `models.<id>.provider.npm` override, driven by the `format` each provider already
declares in `models.json`.

A model on an `oa-compat`/`openai` provider SHALL use the provider-level `@ai-sdk/openai-compatible`, reaching
`/v1/chat/completions` with an `authorization: Bearer` header. A model on an `anthropic` provider SHALL override
to `@ai-sdk/anthropic`, reaching `/v1/messages` with an `x-api-key` header. Both SHALL match the parsing the
console's `/v1` routes already perform.

#### Scenario: Claude uses the native Anthropic wire
- **WHEN** a Claude model backed by an `anthropic`-format provider is selected in the picker
- **THEN** the request goes to `/v1/messages` with `x-api-key`, so prompt caching and reasoning blocks survive

#### Scenario: no second provider row or credential is introduced
- **WHEN** the per-format split is in effect
- **THEN** the picker still shows one Volt provider, and `plugins/volt-auth.ts` still registers exactly one
  provider id

### Requirement: The integration introduces no global state beyond `OPENCODE_CONFIG_DIR`

Volt SHALL NOT set `OPENCODE_MODELS_URL`. That variable replaces the entire models.dev catalog rather than
merging into it — measured at 173 providers reduced to 1 — which would make Volt responsible for mirroring every
provider the user relies on, and would remove every Volt row on a cold-cache outage. The uninstall contract SHALL
therefore remain exactly the existing `OPENCODE_CONFIG_DIR` + `PATH` reversal.

#### Scenario: the user's own providers are untouched
- **WHEN** Volt's config dir is active
- **THEN** every built-in provider and the user's own configured providers remain listed, with Volt merged on top

#### Scenario: uninstall returns opencode to vanilla
- **WHEN** Volt is uninstalled
- **THEN** removing the two existing env vars is sufficient; no catalog URL or other global setting is left behind
