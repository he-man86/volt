## 0. Analyse (decides whether anything below happens)
**Owner 2026-10-13:** no customer bridge log is available — do not ask for one. The verdict rests on a structural review of
the post-walk path and the relay tunnel (`RefsService.Handle`, the pipe, `RelayTunnel` send vs. pings on `_sendLock`) and a
local reproduction with stage timestamps on a large project (pro2193, 8106 items; CODESYS 3.5.17 may be installed side by
side if needed). A structural way for one slow op to starve pings or block the relay is fixed regardless of whether it is
provably the customer's trigger. If nothing in Volt can produce the symptom, record that and CLOSE the change (owner: "if not
possible then we will forget about this topic" — the release carries many other improvements); no follow-up.

- [x] 0.1 Reproduce: `refs` over the relay on a CODESYS project of 375+ items (SP21, and the oldest supported version
      if available). Record per size: time to the last progress frame, time to the terminal frame, terminal frame
      size, and whether pings kept flowing during the op. Use PLCAssist's numbers in the proposal as the starting point.
- [x] 0.2 Locate the time: walk vs. building the response vs. pipe vs. `RelayTunnel` send (log timestamps per stage).
- [x] 0.3 Verdict in this file: volt gap / relay (PLCAssist) / IDE or environment — with the evidence. Not volt's →
      stop here and tell PLCAssist.

**Measured 2026-10-14** (SP21 3.5.21.40, pro2193 — 854 tracked items; the real `RelayTunnel` against an in-memory relay
socket that timestamps every frame, over the bridge's real pipe; `ide.ps1 -Instance refs-silent-after-scan`; probe deleted).
SP21 is the oldest version Volt serves (SP18 is refused by name); PLCAssist's SP18/SP21 numbers above agree.

| run | `refs` total | walk (to last progress) | last progress → terminal | terminal frame | progress frames | pings (2 s cadence) |
|---|---|---|---|---|---|---|
| cold | 3183 ms | 3141 ms | 42 ms | 123 898 B | 36 | 1 |
| warm ×4 | 831–1910 ms | 823–1901 ms | 3–9 ms | 123 898 B | 36 | 0–1 |

**Where the time goes:** the walk. Building the response, the pipe and the tunnel's send together are ≤ 42 ms; nothing
after `done == total` can spend 60 s on a project of this size.

**Verdict: the customer's trigger is the environment** — their ISP stops carrying frames over ~16 KB (PLCAssist's relay
logs: no frame, not even a ping, after the request; the same release works from another ISP). On an ordered stream
nothing sent after a stalled frame can arrive, pings included, so no bridge change makes that network carry the reply.
**But Volt had a structural gap that hid it:** `SendAsync` had no bound, so a stalled send held `_sendLock` for ever;
the ping loop parked behind the lock, which stopped the heartbeat AND its watchdog (the silence check runs in the same
loop), and nothing was logged — the bridge sat "connected" and silent until the OS gave up on the TCP flow. That is
fixed below (owner: a structural starvation is fixed regardless).

## 1. Fix (only after 0.3 says volt)

- [ ] 1.1 Red test reproducing the measured stall.
- [ ] 1.2 Fix so `refs` on a few hundred items answers well inside 60 s, and a slow op cannot starve pings.
- [ ] 1.3 Full e2e on both vendors.

## 2. Close

- [ ] 2.1 Tell PLCAssist: the cause, the build that carries the fix.
