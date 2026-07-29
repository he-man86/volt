# Design — mirroring opencode's model-catalog integration

All findings below were **measured on 2026-07-28** against the installed opencode **1.18.3**
(`%LOCALAPPDATA%\Microsoft\WinGet\Packages\SST.opencode_…\opencode.exe`) and the live gateway at
`https://volt-ai.dev/v1`. Every claim carries the command that produced it — re-run them before trusting
this file. (This repo has burned months on a stale documented observation before; see
`catalog-notes-go-stale-reverify-live`. Treat everything here as a lead with a date on it.)

---

## 1. How opencode registers its OWN gateway (tasks 1.1, 1.5)

**It is a models.dev catalog entry, not code in the binary and not config written at login.**

```bash
curl -s https://models.dev/api.json | node -e '…'   # 173 providers
```

models.dev carries two entries for opencode's own gateway:

| id | api | npm | env | models |
|---|---|---|---|---|
| `opencode` | `https://opencode.ai/zen/v1` | `@ai-sdk/openai-compatible` | `OPENCODE_API_KEY` | 85 |
| `opencode-go` | `https://opencode.ai/zen/go/v1` | `@ai-sdk/openai-compatible` | `OPENCODE_API_KEY` | 22 |

The same JSON is also embedded in the binary as a cold-start fallback (grep hit:
`opencode:{id:"opencode",env:["OPENCODE_API_KEY"],npm:"@ai-sdk/openai-compatible",api:"https://opencode.ai/zen/v1",name:"OpenCode Zen",…}`).

So "mirror opencode" means **a catalog entry**, and the only two ways to get one are (a) upstream a `volt`
provider into `sst/models.dev`, or (b) serve our own catalog and point `OPENCODE_MODELS_URL` at it. Both are
evaluated in §5.

Their login is an **API-key paste**, same as ours — the i18n keys read
`provider.connect.opencodeZen.visit.{prefix,link,suffix}` → "Visit opencode.ai/zen to get your API key."
`opencode-config/plugins/volt-auth.ts` already mirrors this exactly. No OAuth, no device flow.

### 1.1 The finding that decides the design: per-model SDK override

The `opencode` catalog entry does not use one SDK for all 85 models. Its `claude-sonnet-4-5` entry carries:

```json
"provider": { "npm": "@ai-sdk/anthropic" }
```

That field is **also in the user-facing config schema** (`https://opencode.ai/config.json` →
`$defs.ProviderConfig.properties.models.additionalProperties.properties.provider` = `{npm, api}`), so a plain
`provider.volt.models.<id>.provider.npm` works without any catalog involvement.

**Proven at runtime.** A probe server on `localhost:7312` logging method+path+auth headers, with one provider
`volt` (baseURL `http://localhost:7312/v1`) and two models, one carrying the override:

```
PATH POST /v1/chat/completions {"authorization":"Bearer sk-pr…"}                                    ← deepseek-chat
PATH POST /v1/messages {"anthropic-version":"2023-06-01…","x-api-key":"sk-probe…"}                  ← claude-sonnet-4-5
```

One provider id, one auth entry, one baseURL — two wire formats. This is exactly what the Volt gateway
already parses:

- `/v1/chat/completions` → `headers.get("authorization")?.split(" ")[1]` ✔ matches the Bearer above
- `/v1/messages` → `headers.get("x-api-key")` ✔ matches the x-api-key above

**Consequence: the open question "can one plugin register auth for two provider ids?" is moot** — the
per-format split costs zero extra provider rows and zero extra auth ids.

---

## 2. The client does NOT enumerate a gateway's models (task 1.3)

A scratch config declaring a model the gateway does not serve:

```jsonc
"models": { "deepseek-chat": {…}, "totally-bogus-model-xyz": { "name": "Bogus" } }
```

```
$ OPENCODE_CONFIG_DIR=…/cfgtest opencode models | grep volt
volt/deepseek-chat
volt/totally-bogus-model-xyz          ← the gateway has never heard of this
```

The picker is **purely config + catalog driven**. `/v1/models` is never consulted. This kills the hope in the
proposal that "option 1 collapses to serve the right JSON" — serving a correct `/v1/models` buys nothing on
the client side. (It stays useful as the drift oracle for `check-wiring`; see §6.)

---

## 3. What `OPENCODE_MODELS_URL` replaces (task 1.4)

**The whole catalog. Not a merge.** Binary: `i = ye.OPENCODE_MODELS_URL || "https://models.dev"`, cached to
`~/.cache/opencode/models-${sha(url)}.json` (the default lands in plain `models.json`; a custom URL gets its
own file, so the models.dev cache is not poisoned).

A local server returning a catalog with only a `volt` provider and one model:

```
$ OPENCODE_MODELS_URL=http://localhost:7311 OPENCODE_CONFIG_DIR=…/emptycfg opencode models
volt/deepseek-chat
$ … | wc -l
1
```

**173 providers → 1.** Every built-in — anthropic, openai, google, the user's own accounts — disappears.

Outage behaviour, measured in both states:

| state | result |
|---|---|
| URL down, cache present | serves the cached custom catalog (1 model) — works offline |
| URL down, cache deleted | falls back to the catalog **bundled in the binary** — 25 models, **and Volt is not among them** |

So a Volt catalog outage on a *fresh* machine leaves the user with a stale 25-model built-in list and **no
Volt models at all**, silently.

---

## 4. Auth (task 1.2)

Credentials live in `~/.local/share/opencode/auth.json`, keyed by provider id, `{ "type": "api", "key": … }`.
There is already a `volt` entry — so `opencode auth login → Volt` **has run at least once**; the proposal's
claim that `volt-auth.ts` "has never been exercised by anything" is too strong. The plugin's `loader()` turns
that entry into the provider's runtime `options.apiKey`, which both SDKs then place in their own header.

What has **not** been exercised is a completion. Attempted live:

```
$ opencode run -m volt/deepseek-chat "Reply with exactly: VOLT_GATEWAY_OK"
Error: Invalid API key.
```

The stored key is invalid/expired. Both gateway routes are up and both reject a bad key identically:

```
POST https://volt-ai.dev/v1/chat/completions  (authorization: Bearer sk-bogus-test) → HTTP 401, empty body
POST https://volt-ai.dev/v1/messages          (x-api-key: sk-bogus-test)            → HTTP 401, empty body
```

**Task 4.1 remains blocked on a real subscriber key** — exactly the human dependency the proposal called out.
Everything else in §6 is implemented and verified without one.

Note for §7: the 401s carry an **empty body**. opencode still renders something usable (`Invalid API key.` on
the openai-compatible path), but there is no gateway-authored message like "no active Volt subscription".

---

## 5. Decision (task 2.1)

**Chosen: generated config (option 3) + per-format models (option 2), which the §1.1 finding makes free.**

`models.json` becomes the single source of truth. `opencode-config/opencode.json`'s `provider.volt.models`
block is **generated** from it, enriched with models.dev metadata, with the per-model `provider.npm` derived
from the wire format `models.json` already declares.

The generator inputs were all already present — nothing new had to be invented:

```jsonc
"providers": { "deepseek": { …, "format": "oa-compat" },        // → default @ai-sdk/openai-compatible
               "anthropic": { …, "format": "anthropic" } },      // → provider.npm = @ai-sdk/anthropic
"zenModels":  { "claude-sonnet-4-5": {
                  "name": "Claude Sonnet 4.5 · via Volt",        // → the picker's display name
                  "cost": { "input": 0.000006, … },              // → cost × 1e6 (models.dev is $/M)
                  "providers": [{ "id": "anthropic",             // → the models.dev coordinate for
                                  "model": "claude-sonnet-4-5" }] } }   //   name/limit/modalities/flags
```

### Rejected: catalog piggyback via `OPENCODE_MODELS_URL` (option 1)

Rejected on the measurements in §3, not on taste:

- It is a **whole-catalog replacement**. Volt would have to mirror all 173 models.dev providers, faithfully
  and forever, or amputate the user's own providers. That is an ongoing service obligation traded for ~20
  lines of JSON metadata.
- **Blast radius**: a Volt catalog outage on a fresh machine drops the user to the binary's bundled 25 models
  and removes every Volt row — silently, since the fetch failure is `logError(…).pipe(ignore)`.
- The env var is **global** and far heavier than `OPENCODE_CONFIG_DIR` (which is purely additive — opencode
  merges it on top of the user's own config; this one *replaces*).
- §2 proved the supposed upside — dynamic model enumeration — does not exist.

### Rejected for now, but it is the real "mirror": upstream a `volt` entry into `sst/models.dev`

This is literally how opencode does it (§1), and it would give Volt's rows built-in-grade metadata with zero
Volt-side maintenance. Not chosen because it is not under Volt's control (a third party's review + release
cadence), it publishes Volt's model list and pricing into a public catalog, and it cannot ship today. It does
not conflict with the chosen design — the generated config keeps working if an upstream entry ever lands, and
that entry could then be generated from the same `models.json`. Worth revisiting once the gateway has
customers.

### Already rejected in the proposal, restated so the record is in one place

- **Overriding `provider.anthropic.options.baseURL`** to reroute the user's own Anthropic account through
  Volt: invisible re-billing, breaks the additive-and-safe rule the whole `OPENCODE_CONFIG_DIR` integration
  rests on.
- **`enabled_providers`/`disabled_providers`** to hide the built-ins: if "only Volt" is ever wanted it belongs
  behind an explicit login-time opt-in, never in the default shipped dir.

### Honest limits of the chosen design (per the DoD's "say so explicitly")

Upstream metadata reaches Volt's rows **when the generator is re-run and the result committed** — not
automatically at the user's runtime. `bun volt-scripts/gen-model-config.ts` is a one-command refresh and
`check-wiring` fails on id/name/cost/format drift, but a context-window bump at Anthropic does *not* reach a
shipped Volt install until someone regenerates and releases. That is the price of not running a catalog, and
it is the right trade at two models.

### `lite` vs `zen` model lists (open question 5)

Not relevant to the picker. Both lists in `models.json` currently hold the **same two ids** and differ only in
display name; the gateway's `/v1` routes are all `modelList: "lite"`. The picker derives from `zenModels`
(the superset by intent). If the two lists ever diverge in *ids*, `check-wiring`'s `/v1/models` assertion is
what will catch it, since `/v1/models` answers from the list the routes actually serve.

---

## 6. What was implemented

> Superseded in part by §9 — the generated-config half was replaced by opencode's own workflow on request.
> §§1–5 (the measurements and the decision between the three options) still stand; §8 records the two bugs the
> review caught. Read §9 for the shape that actually shipped.

- **`volt-scripts/gen-model-config.ts`** — reads `models.json`, resolves each `zenModels` entry through its
  declared `providers[0]` coordinate into models.dev, and writes `provider.volt.models` into
  `opencode-config/opencode.json`. Volt owns name + cost; models.dev owns limit/modalities/capability flags;
  `providers.<id>.format` decides `provider.npm`. Unknown format or missing upstream model = hard failure, no
  guessing. **(Since deleted — see §9.)**
- **`opencode-config/opencode.json`** — `provider.volt.models` is generated output. **(Now hand-maintained;
  the generated content was kept as-is.)**
- **`volt-scripts/check-wiring.ts`** — new section asserting picker ids == `zenModels` ids, and per-model
  name / cost / `provider.npm` == what `models.json` implies. Plus a networked `/v1/models` id check that
  reports **skipped** (not passed) when the gateway is unreachable. **(Reduced to the `/v1/models` id check —
  the others compared against `models.json`, which no longer exists.)**

---

## 7. Decisions taken on the remaining verification tasks

- **4.3 — a user with no Volt subscription still sees the Volt rows.** This matches opencode's own Zen, whose
  85 rows are in the catalog for everyone regardless of subscription. Attempting one yields a gateway 401,
  which opencode renders as `Invalid API key.` The gateway's 401 body is empty (§4); making it return a
  message the client can surface ("no active Volt subscription — volt-ai.dev/account") is a worthwhile
  follow-up on the console side, but it is a gateway change, not a client one, and is out of scope here.
- **4.4 — uninstall.** The chosen design introduces **no new global state**. `OPENCODE_MODELS_URL` is not set,
  so the existing `OPENCODE_CONFIG_DIR` + `PATH` uninstall contract is unchanged and already covered by
  `bun run test:install`.

---

## 8. Review pass — corrections found by reading the vendored gateway (2026-07-28, same day)

The first cut of this design asserted a gateway constraint instead of reading the gateway. Two corrections,
both from `packages/console`, both changing shipped output.

### 8.1 CORRECTION: the gateway **does** serve 1M context — the 200k cap was wrong

The first implementation carried a `VERIFIED_LIMITS` table capping `claude-sonnet-4-5` at 200k, justified as
"Volt's gateway does not send the `context-1m-2025-08-07` beta header." **That was false and it was checkable
in this repo the whole time:**

```ts
// packages/console/app/src/routes/zen/util/provider/anthropic.ts:24
const supports1m = reqModel.includes("sonnet") || reqModel.includes("opus-4-6")
…
if (supports1m) headers.set("anthropic-beta", "context-1m-2025-08-07")   // :38
```

`reqModel` is the id the *client* asked for — `claude-sonnet-4-5` — which contains "sonnet". The header is
sent. The cap has been deleted; the limit is now 1M/64k, identical to Zen's row.

This is the exact failure mode `catalog-notes-go-stale-reverify-live` describes, committed inside the change
that was written to avoid it. The lesson generalises: **the gateway is vendored into this repo — read it
rather than inferring its behaviour from the outside.**

### 8.2 Metadata is now sourced from opencode's OWN gateway entry first

Volt's gateway *is* opencode's console code, so "this model behind an opencode gateway" describes Volt exactly,
and it differs from the direct-provider entry in ways that matter. `claude-sonnet-4-5` shows both:

| field | `anthropic` (direct) | `opencode` (Zen) | Volt now |
|---|---|---|---|
| `limit.context` | 1000000 | 1000000 | 1000000 |
| `interleaved` | *absent* | `true` | `true` |

`interleaved` was being dropped purely because we resolved through the direct-provider coordinate. The
generator now prefers `catalog.opencode.models[<volt id>]` and falls back to the declared coordinate (which is
what `deepseek-chat` uses — Zen carries `deepseek-v4-*`, not `deepseek-chat`). Volt's Claude row is now
byte-identical to Zen's apart from `name` and `cost`.

### 8.3 OPEN — cache and >200k rates bill at ZERO, and this change makes that live

`calculateCost` (`routes/zen/util/handler.ts:1021`) bills a component only when `models.json` declares its
rate:

```ts
if (!modelCost.cacheRead) return undefined     // …and undefined contributes 0 to the total
```

and switches the whole rate card above 200k input tokens only `if (modelInfo.cost200K)`. `models.json`
declares **none** of `cacheRead`, `cacheWrite5m`, `cacheWrite1h`, `cost200K`. So today:

| Anthropic charges Volt | Volt bills the user |
|---|---|
| cache read $0.30/M | **$0** |
| cache write $3.75/M (5m) | **$0** |
| input above 200k $6/M (2×) | $6/M — flat, i.e. **zero margin** |

This was dormant before: Claude went over `@ai-sdk/openai-compatible`, which drops prompt caching entirely, so
no cache tokens existed to under-bill. **Switching Claude to the native Anthropic wire — the whole point of
§1.1 — turns prompt caching on, and with it this leak.** Removing the 200k cap (§8.1) exposes the tier gap the
same way.

The generator and `check-wiring` now carry every rate `models.json` declares straight through to the picker
(`cacheRead → cache_read`, `cacheWrite5m → cache_write`, `cost200K → context_over_200k`), so a declared rate
cannot be billed-but-unshown. (`cacheWrite1h` is billed but has no slot in opencode's config `cost` schema,
which carries a single `cache_write` — so it is intentionally not displayed.)

**DeepSeek was leaking harder than Claude, for a different reason.** The oa-compat helper does:

```ts
// packages/console/app/src/routes/zen/util/provider/openai-compatible.ts:73
inputTokens: inputTokens - (cacheReadTokens ?? 0),
```

Cached tokens are *moved out of* `inputTokens`. With `cacheRead` undeclared they are then billed at zero — so
Volt lost the whole $0.54/M input charge on every cache hit, not merely a cheap cache rate. DeepSeek caches
aggressively, and a long PLC session is mostly cache hits.

**Resolved (decision taken 2026-07-28):** mirror Zen's structure at Volt's existing markup — every component
Anthropic/DeepSeek charges for is now declared, none bills at zero, and each keeps the markup already applied
to fresh input.

| | upstream charges Volt | Volt bills |
|---|---|---|
| `claude-sonnet-4-5` cacheRead / cacheWrite5m / cacheWrite1h | $0.30 / $3.75 / $6.00 | $0.60 / $7.50 / $12.00 |
| `claude-sonnet-4-5` >200k (input / output) | $6.00 / $22.50 | $12.00 / $45.00 |
| `deepseek-chat` cacheRead | $0.0028 | $0.0108 (the same 3.86× as its input) |

DeepSeek has no cache-write charge upstream (a miss is billed as ordinary input), so none is declared — that
absence is correct, not a gap.

> Deploying this needs `bun volt-scripts/set-models.ts --apply <stage>` + a redeploy; until then the gateway
> keeps billing the old rate card. `check-wiring`'s `/v1/models` assertion only compares **ids**, so it will
> not catch a stale deployed rate card — the ids are unchanged here.

---

## 9. Final shape — opencode's flow, one forced deviation

Requested after §8: mirror opencode's *workflow*, not just its wire behaviour. Their setup is two independent
halves (§1), and both are now adopted.

### 9.1 The gateway catalog is a secret, not a committed file

opencode keeps no catalog file. `core/script/update-models.ts` reads the deployed `ZEN_MODELS1..30`, opens it
in `vim`, validates, writes it back. Volt now does the same loop — `volt-scripts/update-models.ts`, `$EDITOR`
instead of `vim` (Windows). Deleted: `models.json`, `set-models.ts`, `gen-model-config.ts`, and the deploy step
that provisioned the catalog.

**The deviation, and why it is forced.** Their script edits the deployed SST secret directly. That works
because the person editing holds the state their deploys run from. Volt's deploys run on a GitHub runner with
its own SST state — measured 2026-07-28:

```
$ bunx sst secret list --stage dev     # from the dev machine
secrets in stage state: 46 | real: 7 | placeholder: 39
REAL: GITHUB_CLIENT_ID_CONSOLE, HONEYCOMB_API_KEY, ZEN_SESSION_SECRET,
      GITHUB_CLIENT_SECRET_CONSOLE, STRIPE_PUBLISHABLE_KEY, GOOGLE_CLIENT_ID, STRIPE_SECRET_KEY
```

Exactly the 7 set locally are real; everything CI provisions reads as a placeholder — while the live gateway
serves both models. The states are separate, and the passphrase is not the obstacle (decryption works). A
laptop edit of the SST secret would land where no deploy reads.

So the catalog travels the path all other Volt secrets take: the **`ZEN_MODELS1..30`** chunks live in `.env`
locally and as GitHub environment secrets for CI, loaded by `deploy-secrets.ts` inside the deploy job. The edit
loop is opencode's; only the storage location moves.

### 9.2 Nothing else changed — that was the point

`infra/console.ts` still declares the 30 `sst.Secret`s exactly as opencode does; `infra/` is untouched.
`deploy.yml` lists all 30 like every other secret. `deploy-secrets.ts` needed no catalog-specific logic — it
already resolves anything `infra/` declares.

Two earlier attempts were wrong and were reverted: composing the catalog *as infra code* (it made
`ZEN_MODELS1..30` stop being secrets, a bigger departure than necessary), and storing it as a single
`ZEN_MODELS_JSON` value (the array *is* the storage shape). Storage stays opencode's; only provisioning differs.

It did surface one genuine latent bug. Bun auto-loads `.env` into `process.env`, and `deploy-secrets.ts`
preferred `process.env` over its own parse — so Bun's dotenv (which strips outer quotes but leaves `\"`
escapes) shadowed it and double-escaped every quoted value. Precedence is now `.env` first; in CI there is no
`.env`, so GitHub secrets are still authoritative. Quoting matters here because 5 of the 30 chunks begin with
a `"` and one is space-padded.

Verified end to end: `.env` → `update-models --print` → `deploy-secrets` → `.env.deploy`, all 30 chunks
reassembling to the exact document with API keys, `cost200K` and `cacheRead` intact, no placeholders, all 49
emitted lines quoted.

### 9.3 The picker side is a models.dev entry

`models.dev/providers/volt/` holds the provider entry in their TOML format — the mechanism that makes
opencode's own client need no generated config (§1). Once merged upstream, `provider.volt` is deleted from
`opencode-config/opencode.json` and opencode picks Volt up with no config at all. Not opened as a PR: it is a
public repo and it publishes Volt's price list.

### 9.4 What this costs

Accepted deliberately, stated plainly:

- **Prices are no longer reviewable.** The cache-billing bug in §8.3 was found by reading `models.json` in a
  diff. In a secret blob, nothing surfaces it.
- **No drift check.** `check-wiring` keeps one assertion — picker ids vs the deployed `/v1/models` — because
  it is the only remaining guard on a now hand-maintained block. Names, limits and prices are unchecked.
- **Three places to change a price by hand**: the `ZEN_MODELS` catalog, `provider.volt.models`, and
  `models.dev/` (dollars per token in the first, per million in the others).
- **`MIGRATION.md` is load-bearing.** The §8.3 rate card was never deployed; it exists only there now.
