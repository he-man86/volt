## Analyse first: PLCAssist may have misread this

This is a request from PLCAssist (a client of the bridge) written from the OUTSIDE: what our logs observed, and our
reading of volt's code to explain it. The observations are recorded facts. The explanation is our interpretation and
may be wrong — about the cause, about whether it is a volt gap at all, or about the relay (ours) being the culprit.

Before any work: verify the observation, then confirm or refute our reading. If the cause is outside volt (our relay,
the customer's machine, their IDE), record that here with the reason and stop — that answer is as useful to us as a
fix. Only a confirmed real gap goes on to the tasks.

DRAFT — PLCAssist is reproducing it on SP21 in parallel (project grown to 50/200/400/800 items, `refs` timed and sized
over the local pipe). Its numbers will be added under "What PLCAssist measured" before this is handed over.

## Why

**On one customer's project, `refs` reported the whole walk done and then never answered.** Every PLC tool call in the
chat failed, the customer pressed Retry three times and left. It was their first session (download → bridge connected
in 3 minutes), so this is the first impression of the product on a real 375-item project.

What PLCAssist saw (2026-10-11 13:14–13:38Z, CODESYS bridge from the 2026-10-07 release = volt 0.1.17413, IDE
**CODESYS 3.5.17.20** as `health` reported it (platform 3.5.17.0), Windows, relay `relay.plc-assist.com`). SP17 is
below the SP21 we call fully supported; another SP17 user (3.5.17.20, chat `5998954f`) worked a 6.5 h session on its
project without a `refs` timeout, so SP17 alone does not produce it:
- 8 `refs` requests (`r-a4982632`, `r-da70b3c5`, `r-d8786ea8`, `r-ab410a41`, `r-09f3091e`, `r-6dbb3206`,
  `r-a98200af`, `r-c79a5188`). Each streamed 16 progress frames ending in `{"operation":"refs","done":375,"total":375}`
  and then nothing: our relay answered its caller `RELAY_TIMEOUT` after 60 000 ms (7 of 8). One ended
  `BRIDGE_DISCONNECTED` after 56 s.
- In the same minutes our status poll saw the bridge go away twice for ~30 s (`RELAY_UNREACHABLE`, 13:22:21 and
  13:25:53) and come back on its own.
- `health`/status calls between the `refs` calls answered, so the bridge was not simply down.

Our reading of the code (volt `4942b1dba5`), to be checked:
- The progress frames come from `ProjectSnapshot.Walk` (`Volt.Engine/Sync/RefsService.cs:26`); `done == total` means the
  walk itself finished. What is left after it in `RefsService.Handle` (`RefsService.cs:28-45`) is building the
  response, which is a name→version map plus folders — for 375 items we expect tens of KB, not megabytes. So we do
  NOT think the reply size is the cause, but we have not measured a real one.
- After `Handle` returns, the reply goes pipe → `RelayTunnel` (`Volt.Relay/RelayTunnel.cs:347-358`) → `SendAsync`
  (`RelayTunnel.cs:389-394`, `467-478`), which shares `_sendLock` with pings (`RelayTunnel.cs:463`). If anything after
  the walk blocks — the IDE's primary thread, the pipe, the send — the relay sees silence, and if it lasts long enough
  the whole connection looks dead, which would also explain the two ~30 s "unreachable" windows. That is a guess about
  the mechanism, not something we can see from outside.
- Every relayed request ends in exactly one terminal frame or the socket closes (`RelayTunnel.cs:373-376`), and the
  tunnel logs `relay: -> refs (<id>) <outcome>` per id. The customer's bridge log for these ids would settle where the
  time went; we do not have it.

## What we ask

1. Find where a `refs` that has walked all items can spend 60 s+ before its terminal frame reaches the relay, on a
   project of this size. Our measurements (below, when added) say whether it reproduces on SP21.
2. If it is a volt cause: fix it so `refs` on a few hundred items answers well inside the relay's 60 s, and so a slow
   op cannot make the bridge look disconnected (pings starved behind a send or the IDE thread).
3. If it is not volt's (our relay, a frame limit on our side, the customer's IDE): say so with the evidence and stop.

## What PLCAssist measured (2026-10-12)

Shipped bridge 0.1.17413 over the local pipe, no relay:

| IDE | items | `refs` total | last progress → reply | reply |
|---|---|---|---|---|
| SP21 | 50 / 200 / 350 / 470 | 0.02–6.9 s | 0–2 ms | 6.4 / 30 / 55 / 70 KB |
| SP21, real machine project | 881 | 1.6–2.9 s | 2–25 ms | 125 KB |
| SP18, same project | 727 | 9.5 s cold, 0.8 s warm | 2–26 ms | 102 KB |

Did not reproduce: every call completed. ~145 B per item, so the field's 375 items ≈ 55 KB — far under Cloudflare's
32 MiB WebSocket message limit; our relay adds no size limit of its own. No SP17 install here.

Relay production logs for the field window say the failure is in DELIVERY, not in the IDE: every timed-out request has
`bridgeSilentForMs` ≈ 59.3–59.8 s, i.e. the relay heard nothing — not even the 25 s pings — from ~0.5 s after sending
the request; no close frame ever arrived (10 × `bridge_replaced_zombie`, 40 × 409 on the bridge's redials, which are
the two ~30 s "unreachable" windows). `health` replies (~300 B) passed 19 times; no `refs` reply ever arrived.

The connection: country RU, ASN 56361, colo FRA. The other SP17 user (3.5.17.20, 6.5 h session, many `refs`/`fetch`
replies of 50 KB–MB that arrived) also connects from RU via FRA, but from ASN 197535. Same IDE version, same release,
same relay, different ISP: it works on one, the first frame over ~16 KB dies on the other. That matches Cloudflare's
own report that Russian ISPs cut connections to Cloudflare after ~16 KB
(https://blog.cloudflare.com/russian-internet-users-are-unable-to-access-the-open-internet/) — with the open point that
it is described for traffic toward the user, and this is an upload.

**Our current reading: not a volt bug, and not SP17.** We are NOT handing this over as a fix request. Kept as a record;
the one volt-side question left is whether a bridge send that stalls (here: pings starved behind the stuck reply on
the shared `_sendLock`) should be detected and named in the bridge log/console, so a user on such a network sees "the
connection to the relay stalls on large messages" instead of a silent hang.

## Impact

- `Volt.Engine/Sync/RefsService.cs`, `ProjectSnapshot.cs` (if the time is after the walk), `Volt.Relay/RelayTunnel.cs`
  (if the send or the ping path is involved). No wire change expected.
