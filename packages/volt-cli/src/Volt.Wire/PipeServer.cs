using System;
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

    public PipeServer(string pipeName, PipeDispatch dispatch)
    {
        _pipeName = pipeName;
        _dispatch = dispatch;
    }

    public void Start()
    {
        if (_running) return;
        // Bind the FIRST pipe instance HERE, synchronously, and let the failure reach the caller. Created inside the
        // accept thread instead (as it was), a name collision or an ACL denial killed the loop with nobody watching
        // while the caller reported success — CODESYS's PipeHost.Start returned "Volt bridge started on pipe …" into
        // the IDE message window and wrote "bridge ready" to the log, over a pipe nothing was listening on. Both hosts
        // already have a catch arm around this call; the reason now reaches it.
        var first = new NamedPipeServerStream(_pipeName, PipeDirection.InOut,
            NamedPipeServerStream.MaxAllowedServerInstances, PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
        _running = true;
        new Thread(() => AcceptLoop(first)) { IsBackground = true, Name = "volt-pipe-accept" }.Start();
    }

    public void Stop()
    {
        if (!_running) return;
        _running = false;
        // Wake the blocking WaitForConnection so the loop sees !_running and exits.
        try { using var nudge = new NamedPipeClientStream(".", _pipeName, PipeDirection.InOut); nudge.Connect(200); }
        catch { /* nothing listening / already gone */ }
    }

    public void Dispose() => Stop();

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
                var req = JsonSerializer.Deserialize<PipeRequest>(line, WireJson.Read) ?? new PipeRequest();
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
