> Draft, owner to confirm. Ships with the next bridge release.

## 1. Bridge

- [ ] 1.1 `hello` carries `lastDrop` on every connection after the first (test first; `Announces_itself_before_anything_else` pins hello's members).
- [ ] 1.2 `docs/relay-protocol.md` states the member and that a relay ignores it unless it reads it.

- [x] 1.3 Ping 10 s / silence 25 s (owner's go, 2026-11-06), test first: a downstream held 53 s then resumed is dropped within silence + one tick, its in-flight request abandoned by name and not answered on the redial; `relay-protocol.md` states the new numbers.

## 2. Together with PLC Assist

- [ ] 2.1 Its relay logs `lastDrop` (its change, its owner's yes).
- [ ] 2.2 Read the causes for the affected token when it runs the release, then decide on the ride-through wait (the limits are already 10 s / 25 s, 1.3).
