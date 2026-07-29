## ADDED Requirements

### Requirement: Volt sells a toolchain subscription, not model access

Volt SHALL NOT operate an LLM gateway. The product is the PLC toolchain; access to it is sold as a flat
recurring subscription with no usage metering, no upstream provider keys held by Volt, and no model catalog.

Users bring their own AI: an opencode install and their own provider key. `opencode-config` SHALL continue to
ship the LSP registration, the `volt` tool and the permission gates, because those are what make opencode
PLC-aware and they are independent of any gateway.

#### Scenario: no provider costs are fronted
- **WHEN** a subscriber uses AI assistance alongside Volt
- **THEN** their model usage is billed to them by their own provider, and Volt neither pays for nor meters it

#### Scenario: the agent integration survives the gateway's removal
- **WHEN** the gateway and its client-side config are deleted
- **THEN** `bun run compat` still passes — the LSP loads and the `volt` tool registers with its permission gate

### Requirement: `packages/volt-console` is Volt-owned, not vendored

The dashboard SHALL live in a new package written and owned by Volt. `packages/console` SHALL be deleted, and
with it the vendored-console rule and the obligation to keep merges clean against opencode's console.

The data model SHALL follow opencode's proven shape — account, workspace, user, billing, key — reimplemented
rather than copied, and without the gateway-specific tables.

#### Scenario: no upstream merge obligation remains
- **WHEN** opencode releases a new version
- **THEN** nothing in Volt's commercial backend needs merging, because none of it is vendored

#### Scenario: teams are a tier, not a rewrite
- **WHEN** a team tier is introduced later
- **THEN** it builds on the workspace + membership model already present, rather than requiring a new one

### Requirement: Tiers are free, pro, and (later) team

The subscription SHALL model **free** and **pro**, with **team** designed for but not implemented. A
workspace SHALL have exactly one tier at a time, and the tier SHALL be derived from Stripe rather than stored
as the source of truth.

Free SHALL be limited by **number of bound projects**, not by time. There is no trial clock. A bound project is
a git repo root carrying `.git/volt/config.json`. Free allows 3; pro is unlimited.

The limit SHALL be carried in the licence response and enforced by the client against its own bindings.
Registering project identifiers with the server is NOT permitted — it would contradict the privacy constraint
that Volt never collects identifiers from customer machines.

#### Scenario: tier follows Stripe
- **WHEN** a subscription is created, cancelled or lapses in Stripe
- **THEN** the workspace's tier reflects that change without manual intervention

#### Scenario: downgrade is not destructive
- **WHEN** a pro subscription ends
- **THEN** the workspace returns to free, no user data is deleted, and projects already bound keep working

#### Scenario: free is not time-limited
- **WHEN** a free user returns after months of not using Volt
- **THEN** their allowance is unchanged — nothing has expired

### Requirement: A licence key gates pro features, and never strands an offline engineer

Each workspace SHALL have a licence key. The CLI SHALL hold it, validate it against the console on a schedule,
and cache the result.

Validation failure caused by **lack of connectivity** SHALL NOT immediately disable the toolchain. A grace
period SHALL apply, and behaviour after it expires SHALL be a deliberate, documented decision rather than an
accident of error handling. Volt is used on plant floors where the network is unreliable or absent.

Past grace, work already in progress SHALL continue. Degradation SHALL apply only to **binding a new project**,
never to projects already bound. An engineer offline for weeks must not lose access to the machines they are
working on.

#### Scenario: offline within grace
- **WHEN** the CLI cannot reach the console but the cached licence is inside its grace period
- **THEN** the toolchain continues to work exactly as before

#### Scenario: offline past grace, working on existing projects
- **WHEN** the grace period has expired, the console is unreachable, and the engineer is working on projects
  already bound
- **THEN** everything continues to work — pull, push and merge included

#### Scenario: offline past grace, binding something new
- **WHEN** the grace period has expired and the engineer runs `volt init` beyond the free allowance
- **THEN** that binding is refused with a plain explanation of why and how to fix it — never a bare failure or
  a silent downgrade

#### Scenario: revoked key
- **WHEN** a key is revoked or the subscription is cancelled
- **THEN** the CLI reflects that at its next successful validation, and says which it was

### Requirement: A missed webhook cannot leave a paying customer without a key

Key issuance SHALL NOT depend solely on receiving `checkout.session.completed`. A reconciliation path SHALL
exist that treats Stripe as the source of truth, so a dropped or failed webhook is recoverable without manual
database access.

#### Scenario: the webhook never arrives
- **WHEN** a customer completes checkout but the webhook is lost
- **THEN** they can still obtain their key — by revisiting the dashboard, or by an automatic reconciliation —
  without anyone editing the database by hand

### Requirement: The deploy model is unchanged — everything as code

Infrastructure SHALL remain declared in `infra/` and deployed by SST from GitHub Actions, including the Stripe
product, price and webhook endpoint. Provisioning SHALL NOT move into a dashboard.

The `dev` and `production` stage split SHALL be preserved, as SHALL the support portal.

#### Scenario: pricing is code
- **WHEN** the subscription price or product changes
- **THEN** it changes in `infra/` and takes effect on deploy — not by clicking in the Stripe dashboard

#### Scenario: a stage is reproducible
- **WHEN** a stage is deployed from a clean checkout
- **THEN** every resource it needs is created by the deploy, given its secrets
