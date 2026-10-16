# infra

Volt deploys **one thing**: the static marketing site at `packages/volt-web`.

```
infra/
  stage.ts   the domain per stage, and the Cloudflare zone id
  www.ts     the StaticSite — packages/volt-web at the apex
sst.config.ts
```

That is the whole surface. There is no database, no auth and no backend of Volt's own.

## Deploying

```bash
bunx sst deploy --stage dev          # dev.volt-ai.dev
bunx sst deploy --stage production   # volt-ai.dev
```

CI does the same on a push to `dev` that touches `packages/volt-web/`, `infra/` or `sst.config.ts`, and on a
manual `workflow_dispatch` for production. The only credential is `CLOUDFLARE_API_TOKEN`: SST creates the
Workers site, the custom domain and the DNS record.

`sst secret` is not used. Nothing here needs a secret. `sst.config.ts` declares no providers, and the site
takes the apex.
