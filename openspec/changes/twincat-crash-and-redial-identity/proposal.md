> From PLC Assist, 2026-10-26 (re-enactment on 0.1.18029). Spec only; Volt source untouched.

## Why

Two findings from one afternoon on this machine, both on the shipped 0.1.18029 bridges.

### 1. TwinCAT XAE crashed during a `refs` walk

Application log, 18:06:33: `TcXaeShell.exe` faulted in `TwinCAT System Manager.dll` 3.1.0.4384, `0xc0000005`
(access violation), offset `0x00bcc7e8`; WER APPCRASH at 18:06:48; Restart Manager relaunched it as a new pid.
The worker (`twincat-2026-10-26.log`) just before:

```
18:05:50 relay: connected to relay.plc-assist.com           (after a drop at 18:05:14 and four 409s)
18:06:32.442 relay: <- health  ok 68ms
18:06:32.637 relay: <- refs (r-3d87c5c3)
18:06:32.810 twincat: Untitled2 Project holds POUs the IDE does not read as POUs - not opened (DIALECT C2i)
18:06:47.913 walk: ChildAt(1) faulted at folder='TwinCAT Project14/PLC/Untitled2/Untitled2 Project/DUTs':
             Kan RPC niet uitvoeren. (0x800706BE)
18:06:47.914 walk: ChildAt(2..11) faulted ... De RPC-server is niet beschikbaar. (0x800706BA)
18:06:47.926 refs: failed after 15281 ms while walking ... COMException 0x800706BA
18:06:48.015 reattach: no running TwinCAT/VS instance to bind
```

So the XAE died inside the walk of `Untitled2 Project/DUTs` (the MultiProject fixture's TwinCAT Project14), the
first `refs` after a relay reconnect. It happened once; hundreds of identical walks the same day were fine, and a
fresh XAE afterwards did not repeat it. Whether a Volt COM call pattern triggers it (e.g. the walk right after the
C2i "not opened" handling of the same project) or it is Beckhoff's alone is not known. A customer's XAE dying under
a read is the case to rule out.

### 2. A redialing bridge is refused by its own dead socket

After a drop without a close frame the relay cannot tell the same bridge redialing from a second IDE on the same
token, so it refuses (409) until the old socket has been silent for 55 s (`SILENT_AFTER_MS`; 25 s for a bridge that
advertises a 10 s ping). Measured: 18:05:14 drop, 409 at :16, :19, :24, :33, connected :50 — 36 s; 18:27:23 drop,
connected 18:27:57 — 34 s. Every chat call in that window is "bridge offline". 12 CODESYS and 9 TwinCAT drops on
2026-10-26 (0–5 per day before).

## What Changes

- Crash: Volt's own reading of the walk at `…/Untitled2 Project/DUTs` after the C2i handling; a soak of `refs` on
  the MultiProject fixture (incl. right after a reconnect) to see whether it repeats; the worker logs the last COM
  call it made before an RPC_E_DISCONNECTED/0x800706BA, so the next crash names its trigger.
- Redial: the bridge sends a stable instance id when it dials (a query parameter or header on the upgrade, e.g. a
  GUID made at worker start). PLC Assist's relay then replaces an incumbent with the SAME instance id at once
  (its own dead socket), and keeps refusing a different one (the two-IDEs case stays a visible 409).
- Optional: advertise the 10 s ping (`pingMs`) so the silent limit is 25 s even before the instance id lands.

## Impact

TwinCAT worker (walk logging; possibly the walk), the bridge's dial (one parameter). PLC Assist: relay
`acceptBridge` reads the id (its own OpenSpec `relay-redial-same-instance`).
