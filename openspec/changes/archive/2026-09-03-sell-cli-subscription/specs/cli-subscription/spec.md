## ADDED Requirements

### Requirement: Volt sells a toolchain subscription, not model access

Volt SHALL NOT operate an LLM gateway. The product is the PLC toolchain, sold as a flat recurring subscription
with no usage metering, no upstream provider keys held by Volt, and no model catalog.

Users bring their own AI — an agent of their choosing and their own provider key. Volt SHALL keep shipping the
language server and the `volt` CLI, because those are what make a PLC project legible to any agent, and they are
independent of any gateway.

#### Scenario: no provider costs are fronted
- **WHEN** a subscriber uses AI assistance alongside Volt
- **THEN** their model usage is billed to them by their own provider, and Volt neither pays for nor meters it

#### Scenario: the agent integration survives the gateway's removal
- **WHEN** the gateway is deleted
- **THEN** the LSP and the `volt` CLI still ship and still reach an agent — the toolchain is what is sold, and it
  never depended on the gateway

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

The licence SHALL be validated against the provider and the verdict cached. A validation failure caused by
**lack of connectivity** SHALL NOT disable the toolchain.

A grace period SHALL apply. Past grace, work already in progress SHALL continue — degradation SHALL apply only
to **binding a new project**, never to projects already bound. Volt is used on plant floors where the network is
unreliable or absent.

#### Scenario: offline within grace
- **WHEN** the provider cannot be reached but the cached verdict is inside its grace period
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

### Requirement: The CLI owns the licence; the connector only accelerates it

Volt is a CLI tool. The **CLI** SHALL own the credential, the login flow and the cache format. Activation SHALL
be an explicit, interactive command.

The connector SHALL NOT be required for any licensing behaviour. Being always-on it MAY refresh the cache
before it goes stale and MAY surface state, but the CLI SHALL be fully functional with the connector stopped,
crashed or never installed.

Routine commands SHALL NOT block on the network. A fresh cache SHALL produce no request at all; a stale cache
SHALL NOT delay a mutating verb. A missing cache SHALL resolve to the free tier, never to a failure.

The credential SHALL be stored per-user or per-machine, never inside a repository — `.git/volt/` is per-project
and a licence key must not land there. Both the key and any activation identifier the provider issues SHALL be
persisted, since validation requires the latter once activation limits are enabled.

#### Scenario: no network call on a routine operation
- **WHEN** an engineer runs `volt push` with a fresh cache
- **THEN** entitlement is read locally and no request leaves the machine as part of that command

#### Scenario: the connector is not installed
- **WHEN** the CLI is used standalone, with no connector present
- **THEN** licensing works end to end — login, validation, refresh and enforcement — with no degradation

#### Scenario: a licence key never enters a repository
- **WHEN** a licence is activated on a machine holding bound projects
- **THEN** no credential is written under `.git/`, and nothing licence-related can be committed by accident

### Requirement: The free tier requires no network and no provider account

A user without a licence key SHALL never contact the provider. The free allowance SHALL be enforced entirely
locally, so evaluation works on a fully disconnected machine.

#### Scenario: evaluating offline from first install
- **WHEN** Volt is installed on a machine with no internet access and no licence key
- **THEN** the free allowance is available immediately and nothing is blocked pending a network call

### Requirement: Licence management is native; billing is hosted

Licence management SHALL be native to the installed software — entering and activating a licence, viewing tier
and expiry, and deactivating the current device. Volt SHALL NOT build a web application for it.

The **CLI** is the canonical route (§ "The CLI owns the licence"). The connector MAY offer a graphical path to
the same operations so a tray user need not open a terminal, but it SHALL delegate to the same credential and
cache rather than maintaining its own.

Billing — payment method, invoices, cancellation — SHALL remain in the provider's hosted portal. Volt SHALL NOT
collect payment details in a native application.

The user SHALL be warned before the grace period expires, rather than only told after it has.

#### Scenario: moving to a new machine
- **WHEN** an engineer replaces their workstation
- **THEN** they can deactivate the old device and activate the new one themselves, without contacting support

#### Scenario: warned before it bites
- **WHEN** the licence has been unverified for a period approaching the grace limit
- **THEN** the user is told while there is still time to act — in the connector's status window if it is
  running, and by the CLI if it is not
