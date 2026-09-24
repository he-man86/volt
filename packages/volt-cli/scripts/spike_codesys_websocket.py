# -*- coding: utf-8 -*-
"""
SPIKE (go/no-go): can a .NET ClientWebSocket dial out from inside a live CODESYS?

Run this in CODESYS: Tools -> Scripting -> Execute Script File...

WHY THIS EXISTS
---------------
`openspec/changes/relay-tunnel` puts `Volt.Relay` inside the CODESYS host, which
is IronPython 2.7 driving net48 in the IDE's own AppDomain. The whole design
rests on one unverified assumption: that `System.Net.WebSockets.ClientWebSocket`
loads and works there. It exists in the framework (Windows 8+), but "exists in
the framework" and "loads in THIS host" are different claims — the IDE's
AppDomain has its own assembly bindings, and `ClientWebSocket` pulls in
`System.dll` internals plus SChannel.

If this fails, `Volt.Relay` cannot live in-process on CODESYS and the change
needs a different shape (a sidecar process next to the IDE, most likely). That
is worth ten minutes now and not after the client is written.

WHAT IT CHECKS, in order — each step is a separate way to fail
--------------------------------------------------------------
  1. the type LOADS at all
  2. an instance can be constructed and headers set (the Bearer handshake)
  3. TLS + WebSocket upgrade to a real wss:// endpoint completes
  4. a text frame round-trips (send, then receive the echo)
  5. a clean close

Uses wss://echo.websocket.org, which echoes text frames back. It is a public
endpoint: run this on a machine whose network policy allows it, and if outbound
wss is blocked in your environment that is itself a finding worth writing down.

WHAT IT DOES NOT TOUCH
----------------------
No Volt assembly, no pipe, no project. It only asks whether the primitive is
available. Nothing is written to the IDE and nothing is left running.

OUTPUT
------
Lines to the CODESYS scripting console AND to
%LOCALAPPDATA%\\Volt\\logs\\spike-websocket.txt, because the console is easy to
lose and this result wants pasting into the change.
"""
from __future__ import print_function
import os
import sys
import traceback

ECHO_URL = os.environ.get("VOLT_SPIKE_WS_URL", "wss://echo.websocket.org")
TIMEOUT_SECONDS = 20

_lines = []


def say(line):
    text = "[spike] " + str(line)
    print(text)
    _lines.append(text)


def flush_report():
    local = os.environ.get("LOCALAPPDATA")
    if not local:
        return
    try:
        folder = os.path.join(local, "Volt", "logs")
        if not os.path.isdir(folder):
            os.makedirs(folder)
        path = os.path.join(folder, "spike-websocket.txt")
        handle = open(path, "w")
        try:
            handle.write("\n".join(_lines) + "\n")
        finally:
            handle.close()
        print("[spike] report written to " + path)
    except Exception:
        print("[spike] (could not write the report file; the console output above is the result)")


def main():
    say("host: " + sys.version.replace("\n", " "))

    # ── 1. does the type load ────────────────────────────────────
    try:
        import clr
        clr.AddReference("System")
        from System import Uri, Array, Byte, TimeSpan
        from System.Net.WebSockets import ClientWebSocket, WebSocketMessageType, WebSocketCloseStatus
        from System.Threading import CancellationTokenSource
        from System.Text import Encoding
        say("STEP 1 OK  — ClientWebSocket type loaded")
    except Exception:
        say("STEP 1 FAIL — the type does not load in this host")
        say(traceback.format_exc())
        say("VERDICT: NO-GO. Volt.Relay cannot run in-process on CODESYS.")
        return

    # ── 2. construct + set the handshake header ──────────────────
    try:
        socket = ClientWebSocket()
        socket.Options.SetRequestHeader("Authorization", "Bearer spike-not-a-real-token")
        # The tunnel pings every 25s itself; this only proves the option exists.
        socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(25)
        say("STEP 2 OK  — instance constructed, Authorization header set")
    except Exception:
        say("STEP 2 FAIL — constructed or header failed")
        say(traceback.format_exc())
        say("VERDICT: NO-GO.")
        return

    # ── 3. TLS + upgrade ─────────────────────────────────────────
    try:
        cts = CancellationTokenSource()
        cts.CancelAfter(TIMEOUT_SECONDS * 1000)
        say("connecting to " + ECHO_URL + " ...")
        task = socket.ConnectAsync(Uri(ECHO_URL), cts.Token)
        task.Wait()
        say("STEP 3 OK  — upgrade completed, state=" + str(socket.State))
    except Exception:
        say("STEP 3 FAIL — could not connect")
        say(traceback.format_exc())
        say("Distinguish before concluding: a TLS/handshake failure is a NO-GO;")
        say("a blocked-by-network failure is an environment finding, so re-run")
        say("elsewhere or point VOLT_SPIKE_WS_URL at a reachable wss endpoint.")
        return

    # ── 4. round-trip a text frame ───────────────────────────────
    try:
        payload = '{"hello":{"protocol":1,"volt":"spike","vendor":"codesys","pipe":"spike"}}'
        data = Encoding.UTF8.GetBytes(payload)
        segment = Array[Byte](data)
        from System import ArraySegment
        socket.SendAsync(ArraySegment[Byte](segment), WebSocketMessageType.Text, True, cts.Token).Wait()
        say("sent " + str(len(data)) + " bytes")

        buffer = Array.CreateInstance(Byte, 8192)
        result = socket.ReceiveAsync(ArraySegment[Byte](buffer), cts.Token)
        result.Wait()
        received = Encoding.UTF8.GetString(buffer, 0, result.Result.Count)
        say("received: " + received[:200])
        say("STEP 4 OK  — a text frame round-tripped")
    except Exception:
        say("STEP 4 FAIL — connected but could not exchange a frame")
        say(traceback.format_exc())
        say("VERDICT: NO-GO (a tunnel that cannot carry a frame is not a tunnel).")
        return

    # ── 5. clean close ───────────────────────────────────────────
    try:
        socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "spike done", cts.Token).Wait()
        say("STEP 5 OK  — closed cleanly, state=" + str(socket.State))
    except Exception:
        say("STEP 5 WARN — close threw; not fatal, the tunnel reconnects anyway")
        say(traceback.format_exc())

    say("")
    say("VERDICT: GO. ClientWebSocket works in this host — Volt.Relay can be in-process.")
    say("Paste this into openspec/changes/relay-tunnel and tick the spike task.")


try:
    main()
finally:
    flush_report()
