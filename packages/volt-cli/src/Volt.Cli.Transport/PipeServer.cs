using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;

namespace Volt.Cli.Transport;

/// <summary>The host-side dispatcher: given a request + a progress emitter, produce the terminal result object
/// (or throw → an <c>error</c> frame). The op runs to completion before returning; progress frames are emitted
/// meanwhile.</summary>
public delegate object PipeDispatch(PipeRequest request, Action<object> emitProgress);

/// <summary>
/// A newline-delimited-JSON RPC server over a Windows named pipe — the transport that replaces the HTTP server.
/// One request per connection: the client writes a <see cref="PipeRequest"/> line; the server streams zero or
/// more <c>{"progress":…}</c> frames then exactly one <c>{"result":…}</c> or <c>{"error":…}</c>, and closes.
/// Connections are served CONCURRENTLY (a fresh pipe instance is armed the moment one is accepted), so a health
/// call is never blocked behind a long fetch — the property the cache-served ambient poll relies on.
/// </summary>
public sealed class PipeServer : IDisposable
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly string _pipeName;
    private readonly PipeDispatch _dispatch;
    private volatile bool _running;
    private Thread? _acceptThread;

    public PipeServer(string pipeName, PipeDispatch dispatch)
    {
        _pipeName = pipeName;
        _dispatch = dispatch;
    }

    public void Start()
    {
        if (_running) return;
        _running = true;
        _acceptThread = new Thread(AcceptLoop) { IsBackground = true, Name = "volt-pipe-accept" };
        _acceptThread.Start();
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

    private void AcceptLoop()
    {
        while (_running)
        {
            NamedPipeServerStream server;
            try
            {
                server = new NamedPipeServerStream(_pipeName, PipeDirection.InOut,
                    NamedPipeServerStream.MaxAllowedServerInstances, PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
            }
            catch { break; }

            try { server.WaitForConnection(); }
            catch { server.Dispose(); if (!_running) break; continue; }

            if (!_running) { try { server.Dispose(); } catch { } break; }
            ThreadPool.QueueUserWorkItem(_ => Handle(server));
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
                var req = JsonSerializer.Deserialize<PipeRequest>(line, Json) ?? new PipeRequest();
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
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(frame, Json) + "\n");
        s.Write(bytes, 0, bytes.Length);
        s.Flush();
    }
}
