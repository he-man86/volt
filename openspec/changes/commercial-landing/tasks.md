## 1. Scaffold (done — installed + typechecks green)

- [x] 1.1 SolidStart framework skeleton (`vite.config.ts`, entry files, `app.tsx`, tsconfig `include: ["src"]`)
- [x] 1.2 Auth login flow ported from `console/app` (`routes/auth/authorize.ts` + `[...callback].ts`, `context/auth.ts`)
- [x] 1.3 Lite Stripe-checkout action wired (`server/billing.ts`, reuses `Billing.generateLiteCheckoutUrl`)
- [x] 1.4 `getActor` + `withActor` ported (`context/auth.ts`, `auth.withActor.ts`) — the data-fn guard
- [x] 1.5 `bun install` + `bun typecheck` pass (part of the `volt-*` pre-push set)

## 2. Design + build the landing

- [ ] 2.1 Branding, copy, pricing (hero / features / pricing), PLC messaging — replace the placeholder `index.tsx`
- [ ] 2.2 Wire the Subscribe form to `subscribeLite` (pass the signed-in `workspaceID` + `origin`)

## 3. Finish auth/billing surface

- [ ] 3.1 Confirm shared `ZEN_SESSION_SECRET` (share login with the console) or run volt-landing's own session
- [ ] 3.2 If adding a post-signup dashboard, add a `middleware.ts` + reuse the ported `getActor`/`withActor`

## 4. Infra (see deploy-revenue-cloud/design.md §4 — domain topology)

- [ ] 4.1 Move `Console` off root: `infra/console.ts` `domain` → `console.${domain}` (frees the root for volt-landing)
- [ ] 4.2 Add a `volt-landing` SolidStart resource on root `${domain}`, linking the same `Resource.*` as `console/app`
- [ ] 4.3 Set `VITE_AUTH_URL` + `VITE_STRIPE_PUBLISHABLE_KEY` in its `environment:` block
- [ ] 4.4 For shared login: scope the session cookie to `.${domain}` (scaffold is host-only), or run a separate session

## 5. Verify

- [ ] 5.1 Site renders; `/auth/authorize` → GitHub/Google login → account created
- [ ] 5.2 Subscribe → Stripe Checkout → webhook → subscription row in DB
