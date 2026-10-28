## 1. Volt

- [x] 1.1 Answer questions 1–6 in `proposal.md`. (Answered in place, 2026-10-20.)
- [x] 1.2 Keep `hello.protocol` at 1 in the release (split it from `WireProtocol.Version` if they are one constant).
- [x] 1.3 Hand PLC Assist a pre-release build, then the release number. (0.1.17931, 858c5363d3; then 0.1.18029.)

## 2. PLC Assist (in its own repo, `openspec/changes/plc-grep-and-glob`)

- [x] 2.1 Push identity in `plcWrite` per Volt's answers 1–3.
- [x] 2.2 `plcGrep`, `plcGlob`, one chat-version bump; `build` `applications` in the wire types only.
- [x] 2.3 Live suites against the pre-release; release gate against the release; ship the same day.

## Close-out (2026-10-28)

Shipped: Volt 0.1.17931 (2026-10-20) carried grep, `build` `applications` and push identity with the protocol at 1;
PLC Assist built its side against it and later gated 0.1.18029 green and went live in production on it. Section 2 is
PLC Assist's own work, recorded done on their report. Nothing left open; archived.
