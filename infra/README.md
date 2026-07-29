# infra

Volt deploys **one thing**: the static marketing site at `packages/volt-www`.

```
infra/
  stage.ts   the domain per stage, and the Cloudflare zone id
  www.ts     the StaticSite — packages/volt-www at the apex
sst.config.ts
```

That is the whole surface. There is no database, no auth, no gateway and no backend of Volt's own — payment,
EU VAT, licence keys and the customer portal are Polar's. See
`openspec/changes/sell-cli-subscription`.

## Deploying

```bash
bunx sst deploy --stage dev          # dev.volt-ai.dev
bunx sst deploy --stage production   # volt-ai.dev
```

CI does the same on a push to `dev` that touches `packages/volt-www/`, `infra/` or `sst.config.ts`, and on a
manual `workflow_dispatch` for production. The only credential is `CLOUDFLARE_API_TOKEN`: SST creates the
Workers site, the custom domain and the DNS record.

`sst secret` is not used. Nothing here needs a secret.

## What used to be here

This directory was a vendored copy of opencode's infra, deploying a console and an LLM gateway: PlanetScale,
Upstash Redis, three R2 buckets, a log-processor worker feeding Honeycomb, an OpenAuth issuer, Stripe products
and prices, and thirty `ZEN_MODELS` secret chunks holding the model catalog and every upstream provider API
key.

All of it is gone. Two consequences worth knowing:

- **`sst.config.ts` declares no providers.** The `aws` block in particular used to point at `opencode-dev` /
  `opencode-production` SSO profiles that never existed here, which made *every* `sst` command fail locally —
  `sst secret list` included.
- **The apex is the marketing site.** It used to be the console, with `volt-www` pushed out to `www.`. Nothing
  else wants the apex now.

If you need the deleted files, they are in git history — `packages/console` and the gateway infra were removed
in the commit that references `sell-cli-subscription`.
