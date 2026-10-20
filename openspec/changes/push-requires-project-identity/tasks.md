## 1. Tests red

- [x] 1.1 Engine: `push` with neither member, with only one, or with one empty → `BAD_REQUEST` naming each missing member;
      nothing walked, nothing applied, on a connected and on a disconnected bridge.
- [x] 1.2 Engine: `build` the same → `BAD_REQUEST`, nothing built.
- [x] 1.3 Engine: `refs` and `fetch` (`init` included) without identity still proceed and echo the walked identity.
- [x] 1.4 Transport: a `push` frame with no identity answers a `BAD_REQUEST` frame naming the members, and a `push` with no
      body at all is refused the same way.
- [x] 1.5 vendor-facts runner (`test/unit/vendor-facts.test.ts`): every push and build it sends carries the identity `refs`
      echoed.

## 2. Implement

- [x] 2.1 `OpGuard.RequireBinding` for the write ops (push, build): the missing-member refusal, then the existing check.
- [x] 2.2 Every Engine/CLI test double request that pushes or builds names its project (Engine tests through `BoundWrite`,
      which binds a request naming no identity to the served project; the FakeIde's default vendor is `codesys`).

## 3. Clients

- [x] 3.1 CLI: push and build send both (they do; pinned by the black-box tests).
- [x] 3.2 e2e harness (`lib/bridge.ts`, `refusals/table.ts`, `refusals/behaviour-changes.test.ts`) and `scripts/vendor-facts.ts`
      send the identity the bridge's `refs` echoes (`lib/pipe.ts` `callBound`: once per pipe, dropped on `connect`/`disconnect`;
      a body naming either member keeps its own).

## 4. Wire

- [x] 4.1 OpenRPC: the two members required on `PushRequest`/`BuildRequest`; `push` lists `BAD_REQUEST`; `wire.html`.
- [ ] 4.2 Schema re-pinned in the release's final step (not here): the protocol number stays 1 (owner, 2026-10-20); the schema hash is re-pinned as protocol 1.
