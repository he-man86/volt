## 1. Tests red

- [ ] 1.1 Engine: `push` with neither member, with only one, or with one empty → `BAD_REQUEST` naming each missing member;
      nothing walked, nothing applied, on a connected and on a disconnected bridge.
- [ ] 1.2 Engine: `build` the same → `BAD_REQUEST`, nothing built.
- [ ] 1.3 Engine: `refs` and `fetch` (`init` included) without identity still proceed and echo the walked identity.
- [ ] 1.4 Transport: a `push` frame with no identity answers a `BAD_REQUEST` frame naming the members, and a `push` with no
      body at all is refused the same way.
- [ ] 1.5 vendor-facts runner (`test/unit/vendor-facts.test.ts`): every push and build it sends carries the identity `refs`
      echoed.

## 2. Implement

- [ ] 2.1 `OpGuard.RequireBinding` for the write ops (push, build): the missing-member refusal, then the existing check.
- [ ] 2.2 Every Engine/CLI test double request that pushes or builds names its project.

## 3. Clients

- [ ] 3.1 CLI: push and build send both (they do; pinned by the black-box tests).
- [ ] 3.2 e2e harness (`lib/bridge.ts`, `refusals/table.ts`, `refusals/behaviour-changes.test.ts`) and `scripts/vendor-facts.ts`
      send the identity the bridge's `refs` echoes.

## 4. Wire

- [ ] 4.1 OpenRPC: the two members required on `PushRequest`/`BuildRequest`; `push` lists `BAD_REQUEST`; `wire.html`.
- [ ] 4.2 Schema re-pinned at protocol 2 in the release's final step (not here).
