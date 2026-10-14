## ADDED Requirements

### Requirement: a stalled send is named and never starves the heartbeat
Every frame the bridge sends over the relay tunnel SHALL be bounded by the tunnel's silence limit (60 s). A frame that
has not gone out within it SHALL be named in one WARN line (its size and the bound), the connection's end line SHALL give
"a send stalled" as its cause, and the socket SHALL be dropped so the tunnel redials. No send SHALL hold the tunnel's
single send slot — and with it the heartbeat and its silence watchdog — longer than that bound.

#### Scenario: the network stops carrying a large result frame
- **WHEN** a `refs` result frame's send never completes while the relay keeps sending frames
- **THEN** the bridge logs `relay: a <N>-byte frame did not go out within <limit>s — the connection to the relay stalls; dropping it`, the end line reads `a send stalled (…)`, the request's terminal line says `delivered=no`, and the tunnel redials

#### Scenario: a large project answers well inside the relay timeout
- **WHEN** `refs` runs over the tunnel on a project of several hundred items (measured: 854 items, SP21)
- **THEN** the terminal frame follows the last progress frame within milliseconds and the whole op answers in seconds
