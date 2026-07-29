> Read `proposal.md`, then `design.md`. All of §0 is decided — this change is mostly deletion.
>
> **Order is delete-first** (§0.8): nothing is being sold, so there is nothing to keep running, and section 1
> removes obstacles the rest would otherwise route around — including the `aws` provider that today blocks
> every `sst` command, `sst secret list` included.

## 1. Delete the gateway and the console

- [ ] 1.1 Delete `packages/console` entirely — with it the vendored-console rule in `CLAUDE.md`, the merge
      obligation against opencode, and the `support.${domain}` portal (§0.6, not rebuilt).
- [ ] 1.2 Remove the gateway's infra: `ZEN_MODELS1..30`, the upstream provider API keys, `ZEN_LIMITS`, Upstash
      secrets, the `ZenData` / `ZenDataNew` / `Bucket` R2 buckets and the LogProcessor worker.
- [ ] 1.3 Remove the vendors that existed only for it: PlanetScale, AWS SES (`core/src/aws.ts`, `aws4fetch`,
      both `AWS_SES_*` secrets) and Honeycomb (`infra/monitoring.ts`, the `honeycombio` provider, both keys).
      Confirm each disappears from the bill.
- [ ] 1.4 Delete the `aws` provider block from `sst.config.ts` **early** — it blocks every `sst` command.
- [ ] 1.5 Remove the two client-side gateway files: the `provider.volt` block in
      `opencode-config/opencode.json` and `opencode-config/plugins/volt-auth.ts`. Nothing in `volt-cli`,
      `volt-control`, `volt-desktop` or the LSP touches the gateway. **`bun run compat` must still pass** — the
      LSP, the `volt` tool and its permission gate are unaffected and must keep working.
- [ ] 1.6 Delete the model-catalog scripts (`update-models`, `promote-models`, `pull-models`) and the
      authoring-stage machinery documented in `infra/README.md`.
- [ ] 1.7 Reduce `infra/` to what remains: `volt-www` and DNS. Rewrite `infra/README.md` — most of its groups
      A–G describe opencode's console and stop applying.
- [ ] 1.8 Update `CLAUDE.md`: the vendored-console rule, the `packages/console` description, the two-package
      commercial-side claim and the gateway architecture are all wrong after this.
- [ ] 1.9 Deprovision the deployed gateway: delete the Cloudflare Workers, R2 buckets, the PlanetScale database
      and the Stripe products. Zero subscribers (§0.8) means nothing needs preserving — but check the Stripe
      account has no live subscription before deleting anything.

## 2. Polar setup

- [ ] 2.1 Create the Polar organisation and product: **Volt Pro, €19/month recurring** (§0.7).
- [ ] 2.2 Attach the **licence key benefit**: brandable prefix (`VOLT_*****`), no expiry (the subscription's
      status is the source of truth), **revoke on cancellation**.
- [ ] 2.3 Decide and set the **activation limit per licence** — how many machines one subscriber may run on.
      This is Polar's device limit, distinct from Volt's project allowance (§0.1). A PLC engineer commonly has
      a desktop and a laptop; 1 would be hostile.
- [ ] 2.4 Verify the merchant-of-record tax behaviour on a real EU B2B purchase: VAT reverse charge applied,
      invoice correct. This is the claim that removes VAT registration from Volt, so confirm it rather than
      assume it.
- [ ] 2.5 Confirm what `/validate` returns for each state Volt must distinguish: active, cancelled, past-due,
      revoked, unknown key. The enforcement in §0.2 depends on telling "cancelled" from "cannot reach Polar".

## 3. Licence enforcement in the client

- [ ] 3.1 Connector: call Polar `/validate` on the existing update cadence (§0.2b) and write a cached verdict
      — tier, allowance, `validatedAt`. Weekly is sufficient given a 14-day grace.
- [ ] 3.2 Connector: an activation flow — enter a key, call `/activate`, register this device, show the result.
      Plus deactivate-this-device, so a user can move machines without contacting support (§0.9).
- [ ] 3.3 Connector: surface licence state in the status window, and **warn before grace bites** — "unverified
      for 11 days" is far better than discovering it on day 15.
- [ ] 3.4 CLI: read the cached verdict, **make no network call**. Must work with the connector stopped,
      crashed or never installed; a missing cache resolves to free, never to failure (§0.2b).
- [ ] 3.5 CLI: enforce the project allowance against its own count of bound repos (§0.1). Refuse a *new*
      binding beyond the allowance; never restrict a project already bound.
- [ ] 3.6 Decide where the key and the cache live on disk, and who can read them.
- [ ] 3.7 Tests for every enforcement path: valid, cancelled, revoked, offline-within-grace,
      offline-past-grace-on-an-existing-project (must keep working), offline-past-grace-binding-a-new-one (must
      refuse clearly), at-the-allowance-boundary, and no-cache-at-all. This sits in front of every paying
      customer and must not be discovered in production.

## 4. `volt-www` becomes the storefront

- [ ] 4.1 Pricing page: free vs pro, the 3-project allowance stated plainly, €19/month.
- [ ] 4.2 Buy button → Polar checkout. Post-purchase, tell the user where their key is and how to enter it in
      the connector.
- [ ] 4.3 Document the licence model where a customer will actually look — what free includes, what happens
      offline, how to move machines.
- [ ] 4.4 Keep it static on Cloudflare. No SSR, no framework migration: `volt-www` is React + Vite and stays
      that way (§0.3 — the console it would have merged into is not being built).

## 5. Verify

- [ ] 5.1 End to end on a real purchase: buy → key issued → connector activates → CLI reports pro → bind a 4th
      project successfully.
- [ ] 5.2 Cancel in Polar's portal → the key is revoked → the connector reflects it at next validation → the
      CLI degrades to the free allowance without touching bound projects.
- [ ] 5.3 Offline: disconnect; within grace everything works; past grace existing projects still
      `pull`/`push`/`merge` and only a new binding is refused.
- [ ] 5.4 Free path: fresh install, no key, 3 projects bind, the 4th is refused with a clear message.
- [ ] 5.5 `bun run compat`, `bun volt-scripts/check-wiring.ts`, typecheck and lint all green.
- [ ] 5.6 Confirm the deleted services are gone from the bill — PlanetScale, Upstash, R2, Honeycomb, AWS.

## Open questions

- **Multi-seat / team.** Polar supports multi-seat subscriptions. Whether Volt exposes that, and how seats map
  to the project allowance, is undecided and deliberately out of scope.
- **Refund and dispute handling.** Polar is merchant of record, so refunds run through them; confirm what a
  refund does to an issued licence key before the first sale rather than after.
- **Telemetry attribution.** §0.5 notes a hashed licence key can attribute telemetry without an auth system.
  That is asserted, not designed — it belongs to the telemetry change, not this one.
