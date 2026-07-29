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

- [ ] 2.0 **PRE-FLIGHT, blocks everything (§0.2c).** Confirm with Polar whether `/activate` and `/validate` can
      be called from an end-user machine with the licence key and `organization_id` alone, or whether they
      require a server-side token. If the latter, add a stateless Cloudflare Worker to proxy `/validate` — no
      database, no state, but "no backend at all" becomes "one endpoint" and the proposal needs correcting.

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

> §0.2b: the **CLI owns this**. The connector is an accelerator and must never be required.

- [ ] 3.1 `volt login` (and `volt logout`): explicit, interactive, blocking. Calls `/activate`, persists the
      key **and the returned activation id** — validation needs the latter once activation limits are on.
- [ ] 3.2 Credential + cache storage: **per-user/per-machine, never under `.git/`**. Decide the location and
      who can read it. A licence key must not be committable by accident.
- [ ] 3.3 CLI: read the cached verdict on every command; **no network call when the cache is fresh**, and never
      block a mutating verb when it is stale. Refresh opportunistically on a cheap command with a short timeout.
- [ ] 3.4 CLI: enforce the project allowance against its own count of bound repos (§0.1). Refuse a *new*
      binding beyond the allowance; never restrict a project already bound.
- [ ] 3.5 Connector (optional path): refresh the same cache on its existing update cadence so the CLI rarely
      needs to; surface tier and expiry in the status window; **warn before grace bites**. Offer a GUI route to
      activation and deactivate-this-device so a tray user need not open a terminal (§0.9).
- [ ] 3.6 Verify the whole licensing path works with the connector **absent** — that is the supported
      standalone configuration, not a degraded one.
- [ ] 3.7 Tests for every enforcement path: valid, cancelled, revoked, offline-within-grace,
      offline-past-grace-on-an-existing-project (must keep working), offline-past-grace-binding-a-new-one (must
      refuse clearly), at-the-allowance-boundary, no-cache-at-all, and **no-connector-at-all**. This sits in front of every paying
      customer and must not be discovered in production.

## 4. `volt-www` becomes the storefront

- [ ] 4.1 Pricing page: free vs pro, the 3-project allowance stated plainly, €19/month.
- [ ] 4.2 Buy button → Polar checkout. Post-purchase, tell the user where their key is and how to enter it in
      the connector.
- [ ] 4.3 Document the licence model where a customer will actually look — what free includes, what happens
      offline, how to move machines.
- [ ] 4.4 Keep it static on Cloudflare. No SSR, no framework migration: `volt-www` is React + Vite and stays
      that way (§0.3 — the console it would have merged into is not being built). It is a Vite **MPA**: one
      HTML file per page, no router. After 4.2 it has no dependency on Volt infrastructure at all — static
      files plus one external checkout link.

### 4b. Audit gateway-era claims — the site currently sells a product Volt will not have

> The live marketing site promises **hosted AI at €24/month** with a signup CTA pointing at the console being
> deleted. Every one of those claims inverts. This is not cosmetic: a customer could buy expecting hosted
> models, and three of the documents involved are contracts.

- [ ] 4b.1 `src/content.js` → `PRICING`: `price` €24 → €19; Pro's `note` "Hosted AI, no key required" and
      feature "Hosted models — nothing to configure" are now false; `cta` "Join the public beta" → buy;
      `kind: "auth"` (points at the console's `/auth`) → Polar checkout; drop `beta` / `betaNote`
      ("Free while in public beta — no card required").
      **The axis of the pitch changes**: Free vs Pro is no longer "your key vs our models" but **3 projects vs
      unlimited**. Both tiers bring their own key now, so the differentiator moves from AI to scale.
- [ ] 4b.2 `src/content.js` → FAQ: the answer stating "Pro includes hosted models — nothing to configure…
      it'll be €24/month once billing opens" is wrong in every clause.
- [ ] 4b.3 `src/docs/getting-started.mdx:145` — "Pro is hosted and free during the public beta".
- [ ] 4b.4 **`src/pages/legal-terms.jsx`** — describes "the hosted Volt cloud service", "a gateway that proxies
      AI model requests", a whole "3. Accounts" section requiring an account, restrictions on "use the AI
      gateway", a licence grant for "transmitting the prompts you submit to the AI gateway", and billing
      "through our payment processor (Stripe)". Under this change there is no gateway, no account, and Polar is
      the **merchant of record** — a reseller, not merely a processor. That is a different legal relationship
      and must be stated as such.
- [ ] 4b.5 **`src/pages/legal-privacy.jsx`** — states that prompts are "transmitted through our gateway to the
      AI model provider", that the gateway "records usage metadata… for rate-limiting and billing", that Volt
      collects "your name and email and, for OAuth sign-in, the basic profile", and that "Card details are
      handled by our payment processor (Stripe)". None of that will be true. A privacy policy describing
      collection that does not happen is inaccurate even though it over-claims.
- [ ] 4b.6 **`src/pages/legal-cookies.jsx`** — "secure access to your account" and "Stripe (payment
      processing) — may set cookies". No accounts, no Stripe. Verify the remaining claim "we currently do not
      use third-party analytics cookies" still holds: `vite.config.js` injects the Cloudflare Web Analytics
      beacon, which is cookieless by design, so it should — but confirm rather than assume.
- [ ] 4b.7 Have the three legal documents reviewed before launch. `legal-cookies.jsx` already carries a
      "pending final counsel review" note; they are contracts, and this change alters what the Service *is*.
- [ ] 4b.8 **Take the win.** `content.js` already claims "Volt runs locally and brings your own AI provider
      key — nothing about your project is uploaded" and "Your prompts go to the provider you choose, not to
      us". That was true of Free only and contradicted the privacy policy's gateway clause. It is now true of
      **every** tier — the privacy story gets stronger, and the contradiction disappears. Say so plainly.

## 5. Verify

- [ ] 5.1 End to end on a real purchase: buy → key issued → `volt login` activates → CLI reports pro → bind a
      4th project successfully. Repeat via the connector's GUI path to confirm both reach the same state.
- [ ] 5.2 Cancel in Polar's portal → the key is revoked → the next validation picks it up → the CLI degrades to
      the free allowance without touching bound projects. Test with the connector running AND absent.
- [ ] 5.3 Offline: disconnect; within grace everything works; past grace existing projects still
      `pull`/`push`/`merge` and only a new binding is refused.
- [ ] 5.4 Free path: fresh install, no key, 3 projects bind, the 4th is refused with a clear message —
      **on a machine with no internet at all**, since free must never contact the provider.
- [ ] 5.5 `bun run compat`, `bun volt-scripts/check-wiring.ts`, typecheck and lint all green.
- [ ] 5.6 Confirm the deleted services are gone from the bill — PlanetScale, Upstash, R2, Honeycomb, AWS.

## Open questions

- **Multi-seat / team.** Polar supports multi-seat subscriptions. Whether Volt exposes that, and how seats map
  to the project allowance, is undecided and deliberately out of scope.
- **Refund and dispute handling.** Polar is merchant of record, so refunds run through them; confirm what a
  refund does to an issued licence key before the first sale rather than after.
- **Telemetry attribution.** §0.5 notes a hashed licence key can attribute telemetry without an auth system.
  That is asserted, not designed — it belongs to the telemetry change, not this one.
