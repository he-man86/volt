# One-time migration — committed `models.json` → the `ZEN_MODELS1..30` secrets

`models.json` and `set-models.ts` are gone. The catalog lives in the 30 secrets `infra/console.ts` already
declared (opencode's shape, unchanged), resolved by `deploy-secrets.ts` like every other secret: `.env`
locally, GitHub environment secrets for CI. `update-models.ts` is the only thing that treats them as 30.

**Do this before the commit lands**, for `dev` and `production`. The document below was never deployed — it
carries the cache / `cost200K` pricing added in this change (design.md §8.3), which fixed cached tokens billing
at **zero**. Without it the gateway keeps the old rate card and the billing bug stays.

```bash
# 1. local — ALREADY DONE (2026-07-28): the 30 chunks are in .env, built from the document below with the
#    DEEPSEEK_API_KEY / ANTHROPIC_API_KEY that were in .env at the time. Verify with:
bun volt-scripts/update-models.ts --print
#    (to change it later, run without --print — it joins the chunks and opens them in $EDITOR)

# 2. CI — STILL TO DO
bun volt-scripts/update-models.ts --push dev
bun volt-scripts/update-models.ts --push production

# 3. verify
bunx sst deploy --stage dev                # or let the deploy workflow run
curl -s https://volt-ai.dev/v1/models      # both ids still served
```

`--push` runs `gh secret set ZEN_MODELS<n> --env <stage>` thirty times; `deploy.yml` passes all 30 through.

> Unset ⇒ each chunk resolves to `PLACEHOLDER_UNSET`, and the gateway throws on `JSON.parse` of the join.
> Do not deploy a stage without setting them.
>
> Chunks are stored **quoted** in `.env`: 5 of the 30 begin with a `"` and one is space-padded, so unquoted
> values get mangled. `deploy-secrets.ts` was fixed to unquote on read and quote on write — before that, Bun's
> automatic `.env` → `process.env` loading shadowed the script's own parse and double-escaped every value.

`${DEEPSEEK_API_KEY}` / `${ANTHROPIC_API_KEY}` were placeholders the old `set-models.ts` substituted at deploy
time. **Nothing substitutes them any more** — paste the real values. That is the direct cost of dropping the
committed file: the keys live inside the catalog secret, which is why the whole document is a secret.

## The document

```json
{
  "providers": {
    "deepseek": {
      "displayName": "DeepSeek",
      "api": "https://api.deepseek.com/v1",
      "apiKey": "PASTE_DEEPSEEK_API_KEY",
      "format": "oa-compat"
    },
    "anthropic": {
      "displayName": "Anthropic",
      "api": "https://api.anthropic.com/v1",
      "apiKey": "PASTE_ANTHROPIC_API_KEY",
      "format": "anthropic"
    }
  },
  "zenModels": {
    "deepseek-chat": {
      "name": "DeepSeek · via Volt",
      "cost": { "input": 0.00000054, "output": 0.0000022, "cacheRead": 0.0000000108 },
      "providers": [{ "id": "deepseek", "model": "deepseek-chat" }]
    },
    "claude-sonnet-4-5": {
      "name": "Claude Sonnet 4.5 · via Volt",
      "cost": {
        "input": 0.000006,
        "output": 0.00003,
        "cacheRead": 0.0000006,
        "cacheWrite5m": 0.0000075,
        "cacheWrite1h": 0.000012
      },
      "cost200K": {
        "input": 0.000012,
        "output": 0.00006,
        "cacheRead": 0.0000012,
        "cacheWrite5m": 0.000015,
        "cacheWrite1h": 0.000024
      },
      "providers": [{ "id": "anthropic", "model": "claude-sonnet-4-5" }]
    }
  },
  "liteModels": {
    "deepseek-chat": {
      "name": "DeepSeek (Volt)",
      "cost": { "input": 0.00000054, "output": 0.0000022, "cacheRead": 0.0000000108 },
      "providers": [{ "id": "deepseek", "model": "deepseek-chat" }]
    },
    "claude-sonnet-4-5": {
      "name": "Claude (Volt)",
      "cost": {
        "input": 0.000006,
        "output": 0.00003,
        "cacheRead": 0.0000006,
        "cacheWrite5m": 0.0000075,
        "cacheWrite1h": 0.000012
      },
      "cost200K": {
        "input": 0.000012,
        "output": 0.00006,
        "cacheRead": 0.0000012,
        "cacheWrite5m": 0.000015,
        "cacheWrite1h": 0.000024
      },
      "providers": [{ "id": "anthropic", "model": "claude-sonnet-4-5" }]
    }
  }
}
```

`cost` is **dollars per token** here (the gateway's unit); models.dev states dollars per **million** — the same
numbers × 1e6. Relevant if Volt is ever registered as a models.dev provider (design.md §9.3); the entry was
drafted and then dropped from the repo as a speculative artifact.
