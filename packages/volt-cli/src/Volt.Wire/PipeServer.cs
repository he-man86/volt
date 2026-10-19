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
    /// <summary>Held for as long as this server serves <see cref="_pipeName"/> — see <see cref="TakeName"/>.</summary>
    private PipeNameClaim? _claim;

    public PipeServer(string pipeName, PipeDispatch dispatch)
    {
        _pipeName = pipeName;
        _dispatch = dispatch;
    }

    /// <summary>A server that serves under a claim its caller took first (<see cref="TakeName"/>): the TwinCAT
    /// double-click start claims an XAE's name before it attaches to that XAE. The server owns the claim from here,
    /// and releases it as it would one it took itself.</summary>
    public PipeServer(PipeNameClaim claim, PipeDispatch dispatch) : this(claim.PipeName, dispatch) => _claim = claim;

    public void Start()
    {
        if (_running) return;
        _claim ??= TakeName(_pipeName);

        // Bind the FIRST pipe instance HERE, synchronously, and let the failure reach the caller. Created inside the
        // accept thread instead (as it was), an ACL denial killed the loop with nobody watching while the caller
        // reported success — CODESYS's PipeHost.Start returned "Volt bridge started on pipe …" into the IDE message
        // window and wrote "bridge ready" to the log, over a pipe nothing was listening on. Both hosts already have
        // a catch arm around this call; the reason now reaches it.
        var first = PipeAcl.CreateServer(_pipeName);
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

    /// <summary>
    /// Claim <paramref name="pipeName"/> for this process, before or without a server. Throws
    /// <see cref="PipeNameTakenException"/> when another server — in this process or another — holds it.
    ///
    /// <para>ONE SERVER PER NAME, AND WINDOWS WILL NOT ENFORCE IT. A second <c>NamedPipeServerStream</c> on a live name
    /// is another INSTANCE of the same pipe (we pass <c>MaxAllowedServerInstances</c>, and must — the accept loop arms
    /// a fresh instance per connection). Both processes then "serve" the name and the OS hands each client to
    /// whichever instance happens to be waiting, so calls from ONE client are split across two bridges at random.
    /// Measured 2026-09-20 on TwinCAT: `ide.ps1` and the connector tray each launched a worker on
    /// `volt.bridge.twincat.46264` from different builds; `connect` answered ok from one and the next `refs` answered
    /// PLC_DISCONNECTED from the other.</para>
    ///
    /// <para>A MUTEX, not a probe-then-bind: two workers starting together would both probe an unserved pipe and both
    /// proceed. <c>WaitOne(0)</c> is atomic, which is the whole point. In-process first: mutex ownership is
    /// re-entrant for the owning THREAD, so two claims on one thread would both acquire it.</para>
    ///
    /// <para>The mutex is THREAD-AFFINE: the claim is released by <see cref="PipeNameClaim.Dispose"/> on the thread
    /// that took it. Released from another thread, the release is swallowed and the OS drops the handle when the
    /// process exits; the next claim sees it ABANDONED and takes over, the crashed-bridge-restarts case.</para>
    /// </summary>
    public static PipeNameClaim TakeName(string pipeName)
    {
        lock (Served)
        {
            if (!Served.Add(pipeName))
                throw new PipeNameTakenException(pipeName,
                    $"pipe '{pipeName}' is already served by this process — refusing a second server on the same name.");
        }
        var mutex = new Mutex(initiallyOwned: false, MutexName(pipeName));
        bool owned;
        try { owned = mutex.WaitOne(TimeSpan.Zero, exitContext: false); }
        catch (AbandonedMutexException) { owned = true; }
        catch { mutex.Dispose(); lock (Served) { Served.Remove(pipeName); } throw; }
        if (owned) return new PipeNameClaim(pipeName, mutex);
        mutex.Dispose();
        lock (Served) { Served.Remove(pipeName); }
        throw new PipeNameTakenException(pipeName,
            $"pipe '{pipeName}' is already served by another process — refusing to start a second server on " +
            "the same name, because the OS would split clients between them at random. Stop the other bridge " +
            "(the connector tray spawns one per IDE) and retry.");
    }

    /// <summary>The names claimed in THIS process (see <see cref="TakeName"/>).</summary>
    internal static readonly HashSet<string> Served = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    /// <summary>The single-instance name for a pipe. `Local\` — per logon session, which is the scope the
    /// collision happens in: the connector tray and a dev script run as the same user, in the same session.</summary>
    public static string MutexName(string pipe) => $@"Local\volt-pipe-{pipe}";

    /// <summary>Give the name back. Idempotent: a server that never claimed (or already released) does nothing.</summary>
    private void ReleaseName() => Interlocked.Exchange(ref _claim, null)?.Dispose();

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
                        server = PipeAcl.CreateServer(_pipeName);
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
                // THE NEXT INSTANCE IS ARMED BEFORE THIS ONE IS SERVED: served first, a short request can finish and
                // dispose its instance before the loop comes round to arm another, and in that gap the NAME does not
                // exist — a client connecting then is told ENOENT, the pipe gone (seen 2026-10-13: the completeness
                // oracle lost one subject's pull to `connect ENOENT` mid-run, the IDE alive; pinned by
                // `PipeServeThreadTests.Back_to_back_calls_never_find_the_pipe_gone`). A failure to arm ends the loop as
                // above, and the connection already accepted is still served.
                try
                {
                    pending = PipeAcl.CreateServer(_pipeName);
                }
                catch (Exception ex)
                {
                    VoltLog.Warn($"pipe {_pipeName}: accept loop stopped — could not arm another instance: {ex.Message}");
                    _running = false;
                }
                // A THREAD OF ITS OWN per connection, never the thread pool's (gate review of bridge-one-to-one step 4b,
                // finding 7): the pool is the HOST's — CODESYS runs this bridge in-proc — and when its threads are all
                // blocked a queued request waits for the pool to inject one, about one per half second. `health` must
                // answer from cache even while the IDE is busy; served on a starved pool it did not, so a live bridge
                // read as lost, and a suite run under load timed out on it. Connections are few (a poll every few
                // seconds, one per CLI verb), so a thread each costs nothing that matters.
                new Thread(() => Serve(server)) { IsBackground = true, Name = "volt-pipe-serve" }.Start();
            }
        }
        finally
        {
            // A Stop() landing between the synchronous bind and this thread's first iteration would otherwise leak
            // the bound instance — and hold the NAME — until finalization.
            if (pending != null) { try { pending.Dispose(); } catch { } }
        }
    }

    // Handle's own JIT binds the wire (WireJson.Read): if THAT fails — the 3.5.21.50 MissingFieldException shape —
    // the exception is thrown here, at the call, on the serve thread, where an unhandled one takes the whole
    // process down (CODESYS itself, in-proc). Caught and logged instead; the connection is dropped.
    private void Serve(NamedPipeServerStream server)
    {
        try { Handle(server); }
        catch (Exception ex)
        {
            VoltLog.Error($"pipe {_pipeName}: a request could not be served — " + CallFailure.LogText(ex));
            try { server.Dispose(); } catch { }
        }
    }

    private void Handle(NamedPipeServerStream server)
    {
        using (server)
        {
            string? op = null;
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
                op = req.Op;
                var result = _dispatch(req, frame => WriteFrame(server, new PipeFrame { Progress = frame }));
                WriteFrame(server, new PipeFrame { Result = result });
            }
            catch (Exception ex)
            {
                // Carry a real code when the op threw one (Engine's BridgeException implements ICodedError);
                // anything else is a genuine INTERNAL_ERROR.
                // An uncoded failure is a bug or a binding failure, never an answer: it is LOGGED (the whole exception —
                // openspec ide-identity-report 3.1) BEFORE the error frame, whose write uses the very WireJson.Write a
                // binding failure can take away. The client
                // gets the exception's TYPE beside its message: the message is OS-localized (the 3.5.17 one was), the
                // type name is not. A coded refusal is the caller's ordinary answer: unchanged, and not logged here.
                string code, message;
                if (ex is ICodedError coded) { code = coded.ErrorCode; message = ex.Message; }
                else
                {
                    code = BridgeErrorCodes.InternalError;
                    message = CallFailure.Message(ex);
                    VoltLog.Error($"pipe {_pipeName}: '{op ?? "(no op read)"}' failed — " + CallFailure.LogText(ex));
                }
                try { WriteFrame(server, new PipeFrame { Error = new PipeError { Code = code, Message = message } }); }
                catch (Exception writeEx)
                {
                    // Client gone (ordinary), or the frame itself cannot be written — said, for the second.
                    if (!(writeEx is IOException || writeEx is ObjectDisposedException))
                        VoltLog.Error($"pipe {_pipeName}: the error frame could not be written — " + CallFailure.LogText(writeEx));
                }
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
