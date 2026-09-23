using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Threading;
using Volt.Contracts;

namespace Volt.Wire;

/// <summary>The host-side dispatcher: given a request + a progress emitter, produce the terminal result object
/// (or throw → an <c>error</c> frame). The op runs to completion before returning; progress frames are emitted
/// meanwhile.</summary>
public delegate object PipeDispatch(PipeRequest request, Action<object> emitProgress);

/// <summary>
/// A newline-delimited-JSON RPC server over a Windows named pipe.
/// One request per connection: the client writes a <see cref="PipeRequest"/> line; the server streams zero or
/// more <c>{"progress":…}</c> frames then exactly one <c>{"result":…}</c> or <c>{"error":…}</c>, and closes.
/// Connections are served CONCURRENTLY (a fresh pipe instance is armed the moment one is accepted), so a health
/// call is never blocked behind a long fetch — the property the cache-served ambient poll relies on.
/// </summary>
public sealed class PipeServer : IDisposable
{
    private readonly string _pipeName;
    private readonly PipeDispatch _dispatch;
    private volatile bool _running;
    /// <summary>Held for as long as this process serves <see cref="_pipeName"/> — see <see cref="Start"/>.</summary>
    private Mutex? _single;

    /// <summary>The names served by THIS process. The cross-process mutex cannot cover them: mutex ownership is
    /// re-entrant for the owning THREAD, so two hosts started on one thread both acquire it and the second
    /// sails through. Caught by the test that pins this, which necessarily runs both in one process.</summary>
    private static readonly HashSet<string> Served = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    public PipeServer(string pipeName, PipeDispatch dispatch)
    {
        _pipeName = pipeName;
        _dispatch = dispatch;
    }

    public void Start()
    {
        if (_running) return;

        // ONE SERVER PER NAME, AND WINDOWS WILL NOT ENFORCE IT. Both this comment and the one in
        // `Volt.Ide.Twincat/Program.cs` used to say a "name collision" faults at the bind below. It does not: a
        // second `NamedPipeServerStream` on a live name is another INSTANCE of the same pipe (we pass
        // `MaxAllowedServerInstances`, and must — the accept loop arms a fresh instance per connection). Both
        // processes then "serve" the name and the OS hands each client to whichever instance happens to be
        // waiting, so calls from ONE client are split across two bridges at random.
        //
        // Measured 2026-09-20 on TwinCAT: `ide.ps1` built a fresh worker and launched it, the connector tray
        // launched its own from an 11-day-old build, and both served `volt.bridge.twincat.46264`. `connect`
        // answered `{ok:true}` from one and the very next `refs` answered PLC_DISCONNECTED from the other —
        // for ten minutes that reads as a bridge bug in the vendor driver, which is where the debugging goes.
        // A recording taken in that state is served by a coin flip; `live-tc-snapshot-was-stale-bridge` is what
        // that costs when nobody notices.
        //
        // A MUTEX, not a probe-then-bind: two workers starting together would both probe an unserved pipe and
        // both proceed. `WaitOne(0)` is atomic, which is the whole point.
        // IN-PROCESS FIRST, for the reason on `Served`.
        lock (Served)
        {
            if (!Served.Add(_pipeName))
                throw new IOException(
                    $"pipe '{_pipeName}' is already served by this process — refusing a second server on the same name.");
        }
        try { TakeName(); }
        catch { lock (Served) { Served.Remove(_pipeName); } throw; }

        // Bind the FIRST pipe instance HERE, synchronously, and let the failure reach the caller. Created inside the
        // accept thread instead (as it was), an ACL denial killed the loop with nobody watching while the caller
        // reported success — CODESYS's PipeHost.Start returned "Volt bridge started on pipe …" into the IDE message
        // window and wrote "bridge ready" to the log, over a pipe nothing was listening on. Both hosts already have
        // a catch arm around this call; the reason now reaches it.
        var first = new NamedPipeServerStream(_pipeName, PipeDirection.InOut,
            NamedPipeServerStream.MaxAllowedServerInstances, PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
        _running = true;
        new Thread(() => AcceptLoop(first)) { IsBackground = true, Name = "volt-pipe-accept" }.Start();
    }

    public void Stop()
    {
        if (!_running) return;
        _running = false;
        ReleaseName();
        // Wake the blocking WaitForConnection so the loop sees !_running and exits.
        try { using var nudge = new NamedPipeClientStream(".", _pipeName, PipeDirection.InOut); nudge.Connect(200); }
        catch { /* nothing listening / already gone */ }
    }

    // Stop() early-returns when the accept loop already cleared _running (it does so when arming an instance
    // fails), so the name would stay held by a server that is no longer listening. Releasing here too makes
    // disposal the one path that always frees it; ReleaseName is idempotent.
    public void Dispose() { Stop(); ReleaseName(); }

    /// <summary>Claim the name ACROSS processes. Throws when another process already serves it.</summary>
    private void TakeName()
    {
        _single = new Mutex(initiallyOwned: false, MutexName(_pipeName));
        bool owned;
        // An ABANDONED mutex means the previous server died without releasing — we DO own it now, and taking over
        // is right: that is the crashed-worker-restarts case, which must not be mistaken for a live collision.
        try { owned = _single.WaitOne(TimeSpan.Zero, exitContext: false); }
        catch (AbandonedMutexException) { owned = true; }
        if (owned) return;
        _single.Dispose();
        _single = null;
        throw new IOException(
            $"pipe '{_pipeName}' is already served by another process — refusing to start a second server on " +
            "the same name, because the OS would split clients between them at random. Stop the other bridge " +
            "(the connector tray spawns one per IDE) and retry.");
    }

    /// <summary>The single-instance name for a pipe. `Local\` — per logon session, which is the scope the
    /// collision happens in: the connector tray and a dev script run as the same user, in the same session.</summary>
    private static string MutexName(string pipe) => $@"Local\volt-pipe-{pipe}";

    /// <summary>Give the name back. Idempotent, and tolerant of not owning it — a server that never acquired
    /// (or already released) must not turn teardown into an exception.
    /// <para>A <see cref="Mutex"/> is THREAD-AFFINE: only the thread that took it may release it, and
    /// <see cref="Stop"/> is routinely called from another one, in which case the release below throws and is
    /// swallowed. That is not a leak — the OS drops the handle when the process exits, and the next server sees
    /// it ABANDONED and takes over, which <see cref="Start"/> handles. The real guarantee is therefore
    /// PER-PROCESS, which is exactly the scope of the problem: two BRIDGES, not two threads.</para></summary>
    private void ReleaseName()
    {
        lock (Served) { Served.Remove(_pipeName); }
        var held = Interlocked.Exchange(ref _single, null);
        if (held is null) return;
        try { held.ReleaseMutex(); }
        catch (ApplicationException) { /* not the owning thread, or already released */ }
        held.Dispose();
    }

    // <paramref name="first"/> is the instance Start() already bound — its failure was the caller's to see. Every
    // later instance is armed here, and failing to arm one ENDS the loop: record it (this fires at most once per
    // Start, so it cannot spin the log) and clear _running, so the server stops claiming to listen and a later
    // Start() can bind again instead of being a permanent no-op. The WaitForConnection catch below stays UNLOGGED
    // precisely because it `continue`s — a line there would append to a file under a process-global lock once per
    // failing iteration, inside the always-on in-proc CODESYS host.
    private void AcceptLoop(NamedPipeServerStream first)
    {
        NamedPipeServerStream? pending = first;
        try
        {
            while (_running)
            {
                NamedPipeServerStream server;
                if (pending != null) { server = pending; pending = null; }
                else
                {
                    try
                    {
                        server = new NamedPipeServerStream(_pipeName, PipeDirection.InOut,
                            NamedPipeServerStream.MaxAllowedServerInstances, PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
                    }
                    catch (Exception ex)
                    {
                        VoltLog.Warn($"pipe {_pipeName}: accept loop stopped — could not arm another instance: {ex.Message}");
                        _running = false;
                        break;
                    }
                }

                try { server.WaitForConnection(); }
                catch { server.Dispose(); if (!_running) break; continue; }

                if (!_running) { try { server.Dispose(); } catch { } break; }
                ThreadPool.QueueUserWorkItem(_ => Handle(server));
            }
        }
        finally
        {
            // A Stop() landing between the synchronous bind and this thread's first iteration would otherwise leak
            // the bound instance — and hold the NAME — until finalization.
            if (pending != null) { try { pending.Dispose(); } catch { } }
        }
    }

    private void Handle(NamedPipeServerStream server)
    {
        using (server)
        {
            try
            {
                var line = ReadLine(server);
                if (line == null) return;
                // A FRAME THE CALLER MIS-SPELLED IS THE CALLER'S FAULT. This used to let the JsonException reach
                // the catch below, which stamps anything uncoded as INTERNAL_ERROR — so a client that sent a
                // truncated line, or a stray blank one, was told the BRIDGE had broken and went looking at the
                // IDE. BAD_REQUEST points at the frame that was actually wrong.
                PipeRequest req;
                try { req = JsonSerializer.Deserialize<PipeRequest>(line, WireJson.Read) ?? new PipeRequest(); }
                catch (JsonException ex)
                {
                    throw new CodedException(BridgeErrorCodes.BadRequest,
                        $"the request frame is not valid JSON ({ex.Message}). A request is ONE line of " +
                        "`{\"op\":…,\"body\":…}` — check for an unescaped newline in a string.");
                }
                // Per-connection frames are written strictly in order (progress on the op thread, then the result
                // after the op returns) — no concurrent writer on this stream, so no lock is needed.
                var result = _dispatch(req, frame => WriteFrame(server, new PipeFrame { Progress = frame }));
                WriteFrame(server, new PipeFrame { Result = result });
            }
            catch (Exception ex)
            {
                // Carry a real code when the op threw one (Engine's BridgeException implements ICodedError);
                // anything else is a genuine INTERNAL_ERROR.
                var code = ex is ICodedError coded ? coded.ErrorCode : BridgeErrorCodes.InternalError;
                try { WriteFrame(server, new PipeFrame { Error = new PipeError { Code = code, Message = ex.Message } }); }
                catch { /* client gone — best effort */ }
            }
            try { server.WaitForPipeDrain(); } catch { }
        }
    }

    private static string? ReadLine(Stream s)
    {
        using var buf = new MemoryStream();
        var chunk = new byte[8192];
        while (true)
        {
            int n = s.Read(chunk, 0, chunk.Length);
            if (n <= 0) return buf.Length == 0 ? null : Encoding.UTF8.GetString(buf.ToArray());
            for (int i = 0; i < n; i++)
            {
                if (chunk[i] == (byte)'\n') { buf.Write(chunk, 0, i); return Encoding.UTF8.GetString(buf.ToArray()); }
            }
            buf.Write(chunk, 0, n);
        }
    }

    private static void WriteFrame(Stream s, PipeFrame frame)
    {
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(frame, WireJson.Write) + "\n");
        s.Write(bytes, 0, bytes.Length);
        s.Flush();
    }
}
