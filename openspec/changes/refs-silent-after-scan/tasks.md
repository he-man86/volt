## 0. Analyse (decides whether anything below happens)
**Owner 2026-10-13:** no customer bridge log is available — do not ask for one. The verdict rests on a structural review of
the post-walk path and the relay tunnel (`RefsService.Handle`, the pipe, `RelayTunnel` send vs. pings on `_sendLock`) and a
local reproduction with stage timestamps on a large project (pro2193, 8106 items; CODESYS 3.5.17 may be installed side by
side if needed). A structural way for one slow op to starve pings or block the relay is fixed regardless of whether it is
provably the customer's trigger. If nothing in Volt can produce the symptom, record that and CLOSE the change (owner: "if not
possible then we will forget about this topic" — the release carries many other improvements); no follow-up.

- [ ] 0.1 Reproduce: `refs` over the relay on a CODESYS project of 375+ items (SP21, and the oldest supported version
      if available). Record per size: time to the last progress frame, time to the terminal frame, terminal frame
      size, and whether pings kept flowing during the op. Use PLCAssist's numbers in the proposal as the starting point.
- [ ] 0.2 Locate the time: walk vs. building the response vs. pipe vs. `RelayTunnel` send (log timestamps per stage).
- [ ] 0.3 Verdict in this file: volt gap / relay (PLCAssist) / IDE or environment — with the evidence. Not volt's →
      stop here and tell PLCAssist.

## 1. Fix (only after 0.3 says volt)

- [ ] 1.1 Red test reproducing the measured stall.
- [ ] 1.2 Fix so `refs` on a few hundred items answers well inside 60 s, and a slow op cannot starve pings.
- [ ] 1.3 Full e2e on both vendors.

## 2. Close

- [ ] 2.1 Tell PLCAssist: the cause, the build that carries the fix.
