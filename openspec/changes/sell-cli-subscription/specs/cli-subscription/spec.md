## ADDED Requirements

### Requirement: Volt sells a toolchain subscription, not model access

Volt SHALL NOT operate an LLM gateway. The product is the PLC toolchain, sold as a flat recurring subscription
with no usage metering, no upstream provider keys held by Volt, and no model catalog.

Users bring their own AI — an opencode install and their own provider key. `opencode-config` SHALL continue to
ship the LSP registration, the `volt` tool and the permission gates, because those are what make opencode
PLC-aware and they are independent of any gateway.

#### Scenario: no provider costs are fronted
- **WHEN** a subscriber uses AI assistance alongside Volt
- **THEN** their model usage is billed to them by their own provider, and Volt neither pays for nor meters it

#### Scenario: the agent integration survives the gateway's removal
- **WHEN** the gateway and its two client-side files are deleted
- **THEN** `bun run compat` still passes — the LSP loads and the `volt` tool registers with its permission gate

### Requirement: Volt operates no backend of its own

Payment, tax, licence issuance, licence revocation and the customer portal SHALL be provided by the merchant of
record. Volt SHALL NOT build or operate a database, an authentication system, or a web application beyond the
static marketing site.

Should any of these later become necessary, it SHALL be justified as its own change rather than anticipated
with placeholder infrastructure.

#### Scenario: no Volt-side account exists
- **WHEN** a customer subscribes
- **THEN** they receive a licence key and manage everything through the provider's portal — there is no Volt
  login, no Volt-side user record, and no password to reset

#### Scenario: tax is not Volt's obligation
- **WHEN** a customer in an EU member state subscribes
- **THEN** VAT is calculated, collected and remitted by the merchant of record, and Volt performs no VAT
  registration or OSS filing

### Requirement: Free is limited by project count, not by time

Free SHALL allow **3 bound projects** with full capability. Pro SHALL be unlimited. There SHALL be no trial
clock and no expiry on the free tier.

A bound project is a git repo root carrying `.git/volt/config.json`. The allowance SHALL be enforced by the
client against its own bindings — the provider's activation limits count *devices*, not projects, and cannot
express this.

#### Scenario: free is not time-limited
- **WHEN** a free user returns after months of not using Volt
- **THEN** their allowance is unchanged; nothing has expired

#### Scenario: the allowance restricts new bindings only
- **WHEN** a user at the free allowance runs `volt init` on a fourth project
- **THEN** that binding is refused with a clear message, and the three already bound continue to work fully

#### Scenario: downgrade is not destructive
- **WHEN** a pro subscription is cancelled and the user holds more projects than the free allowance
- **THEN** every already-bound project keeps working, and only new bindings are refused

### Requirement: Enforcement never strands an offline engineer

The connector SHALL validate the licence on a schedule and cache the verdict. A validation failure caused by
**lack of connectivity** SHALL NOT disable the toolchain.

A grace period SHALL apply. Past grace, work already in progress SHALL continue — degradation SHALL apply only
to **binding a new project**, never to projects already bound. Volt is used on plant floors where the network is
unreliable or absent.

#### Scenario: offline within grace
- **WHEN** the connector cannot reach the provider but the cached verdict is inside its grace period
- **THEN** the toolchain works exactly as before

#### Scenario: offline past grace, working on existing projects
- **WHEN** grace has expired, the provider is unreachable, and the engineer is working on projects already bound
- **THEN** everything continues to work, `pull`, `push` and `merge` included

#### Scenario: offline past grace, binding something new
- **WHEN** grace has expired and the engineer binds beyond the free allowance
- **THEN** the binding is refused with a plain explanation of what happened and how to fix it — never a bare
  failure and never a silent downgrade

#### Scenario: cancellation is distinguishable from unreachability
- **WHEN** validation succeeds and reports the subscription cancelled
- **THEN** the client says so explicitly, rather than presenting it as a connectivity problem

### Requirement: The CLI makes no network call to determine entitlement

The connector SHALL own validation; the CLI SHALL read a locally cached verdict. Adding an HTTP round-trip to
`volt push` would tax every operation an engineer performs.

The cache SHALL be the contract, not the connector: the CLI SHALL behave correctly when the connector is
stopped, crashed or never installed. A missing cache SHALL resolve to the free tier, never to a failure.

#### Scenario: no network call on a routine operation
- **WHEN** an engineer runs `volt push`
- **THEN** entitlement is read from the local cache and no request leaves the machine as part of that command

#### Scenario: the connector is not running
- **WHEN** the CLI is used with the connector stopped or never installed
- **THEN** it applies the last cached verdict, or the free tier if there is none — it never fails or blocks on
  the connector's absence

### Requirement: Licence management is native; billing is hosted

Entering and activating a licence, viewing tier and expiry, and deactivating the current device SHALL live in
the connector, where the software actually runs.

Billing — payment method, invoices, cancellation — SHALL remain in the provider's hosted portal. Volt SHALL NOT
collect payment details in a native application.

The connector SHALL warn before the grace period expires, rather than only reporting after it has.

#### Scenario: moving to a new machine
- **WHEN** an engineer replaces their workstation
- **THEN** they can deactivate the old device and activate the new one themselves, without contacting support

#### Scenario: warned before it bites
- **WHEN** the licence has been unverified for a period approaching the grace limit
- **THEN** the connector surfaces that in its status window while there is still time to act
