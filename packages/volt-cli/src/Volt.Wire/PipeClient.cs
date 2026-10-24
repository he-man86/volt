using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using Volt.Contracts;

namespace Volt.Wire;

/// <summary>The single C# client for <see cref="PipeServer"/> (the TS e2e harness is a second, independent client —
/// see <see cref="Ops"/>): connect, send one request, forward progress frames to a
/// callback, return the terminal result (or throw <see cref="PipeCallException"/> on an error frame). The CLI and the
/// connector both drive it.</summary>
public sealed class PipeClient
{
    /// <summary>Client-local codes for a SERVER protocol violation — the server never sends these, so they are not
    /// wire vocabulary (<see cref="BridgeErrorCodes"/>); they are pinned here so the throw-sites and anything
    /// matching on them share one spelling.</summary>
    public const string MalformedError = "MALFORMED_ERROR";
    public const string NoResult = "NO_RESULT";

    private readonly string _pipeName;
    public PipeClient(string pipeName) => _pipeName = pipeName;

    /// <summary>Call one op. Progress frames go to <paramref name="onProgress"/>; the terminal result is returned.</summary>
    // connectTimeoutMs caps the wait when no bridge answers. `Connect` POLLS for the pipe to appear, which tolerates
    // the launch-IDE-then-run race — so keep polling, just cap it at 2s (snappy for a `volt status` with the IDE
    // closed, still race-safe).
    public JsonElement Call(string op, object? body = null, Action<JsonElement>? onProgress = null, int connectTimeoutMs = 2000) =>
        Send(op, WireProtocol.Version, body, onProgress, connectTimeoutMs);

    /// <summary>Call one op FOR ANOTHER CLIENT (the relay): the request states the protocol THAT client stated
    /// (<paramref name="protocol"/>, null when it stated none), never this build's, so the bridge itself refuses a client of
    /// another protocol <c>PROTOCOL_MISMATCH</c> — the one place that rule lives.</summary>
    public JsonElement Forward(string op, int? protocol, object? body, Action<JsonElement>? onProgress = null) =>
        Send(op, protocol, body, onProgress, 2000);

    private JsonElement Send(string op, int? protocol, object? body, Action<JsonElement>? onProgress, int connectTimeoutMs)
    {
        using var client = new NamedPipeClientStream(".", _pipeName, PipeDirection.InOut);
        try { client.Connect(connectTimeoutMs); }
        catch (UnauthorizedAccessException e) { throw new PipeAccessDeniedException(_pipeName, e); }

        var reqBytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new PipeRequest
        {
            Op = op,
            Protocol = protocol,
            Body = body is null ? (JsonElement?)null : JsonSerializer.SerializeToElement(body, WireJson.Write),
        }, WireJson.Write) + "\n");
        client.Write(reqBytes, 0, reqBytes.Length);
        client.Flush();

        JsonElement? result = null;
        foreach (var frame in ReadFrames(client))
        {
            if (frame.TryGetProperty("progress", out var p)) onProgress?.Invoke(p);
            else if (frame.TryGetProperty("result", out var r)) result = r.Clone();
            else if (frame.TryGetProperty("error", out var e))
            {
                // PipeServer always writes both fields, so a frame missing either is a protocol violation — say so
                // rather than invent a code/message and hide it.
                var code = e.TryGetProperty("code", out var c) ? c.GetString() : null;
                var message = e.TryGetProperty("message", out var m) ? m.GetString() : null;
                if (code is null || message is null)
                    // Carry the raw frame: if this ever fires, the operator needs the server's actual text, not a
                    // summary of its absence.
                    throw new PipeCallException(MalformedError, $"op '{op}' returned a malformed error frame: {e.GetRawText()}");
                throw new PipeCallException(code, message, e.TryGetProperty("data", out var d) ? d.Clone() : null);
            }
        }
        if (result is null) throw new PipeCallException(NoResult, $"op '{op}' produced no result frame");
        return result.Value;
    }

    /// <summary>Frames, yielded AS THEY ARRIVE.
    /// <para>Not a <c>List</c>: reading the socket to EOF first would deliver every progress frame after the
    /// operation finished. The server streams progress so a long pull can report while it runs.</para>
    /// <para>Iterator, not a callback: the consuming loop above already distinguishes progress / result / error,
    /// and this keeps that one place in charge of interpreting a frame.</para></summary>
    private static IEnumerable<JsonElement> ReadFrames(Stream s)
    {
        using var buf = new MemoryStream();
        var chunk = new byte[8192];
        int n;
        while ((n = s.Read(chunk, 0, chunk.Length)) > 0)
        {
            for (int i = 0; i < n; i++)
            {
                if (chunk[i] != (byte)'\n') { buf.WriteByte(chunk[i]); continue; }
                if (Emit(buf) is { } frame) yield return frame;
            }
        }
        if (Emit(buf) is { } tail) yield return tail;
    }

    private static JsonElement? Emit(MemoryStream buf)
    {
        if (buf.Length == 0) return null;
        using var doc = JsonDocument.Parse(Encoding.UTF8.GetString(buf.ToArray()));
        var frame = doc.RootElement.Clone();
        buf.SetLength(0);
        return frame;
    }
}
