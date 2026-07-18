using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Volt.Cli.Transport;

/// <summary>Client for <see cref="PipeServer"/>: connect, send one request, forward progress frames to a callback,
/// return the terminal result (or throw <see cref="PipeCallException"/> on an error frame). Mirrors the old
/// NDJSON-over-HTTP client — the CLI and the connector both drive it.</summary>
public sealed class PipeClient
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly string _pipeName;
    public PipeClient(string pipeName) => _pipeName = pipeName;

    /// <summary>Call one op. Progress frames go to <paramref name="onProgress"/>; the terminal result is returned.</summary>
    public JsonElement Call(string op, object? body = null, Action<JsonElement>? onProgress = null, int connectTimeoutMs = 5000)
    {
        using var client = new NamedPipeClientStream(".", _pipeName, PipeDirection.InOut);
        client.Connect(connectTimeoutMs);

        var reqBytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new PipeRequest
        {
            Op = op,
            Body = body is null ? (JsonElement?)null : JsonSerializer.SerializeToElement(body, Json),
        }, Json) + "\n");
        client.Write(reqBytes, 0, reqBytes.Length);
        client.Flush();

        JsonElement? result = null;
        foreach (var frame in ReadFrames(client))
        {
            if (frame.TryGetProperty("progress", out var p)) onProgress?.Invoke(p);
            else if (frame.TryGetProperty("result", out var r)) result = r.Clone();
            else if (frame.TryGetProperty("error", out var e))
                throw new PipeCallException(
                    e.TryGetProperty("code", out var c) ? c.GetString() ?? "ERROR" : "ERROR",
                    e.TryGetProperty("message", out var m) ? m.GetString() ?? "" : "");
        }
        if (result is null) throw new PipeCallException("NO_RESULT", $"op '{op}' produced no result frame");
        return result.Value;
    }

    private static List<JsonElement> ReadFrames(Stream s)
    {
        var frames = new List<JsonElement>();
        using var buf = new MemoryStream();
        var chunk = new byte[8192];
        int n;
        while ((n = s.Read(chunk, 0, chunk.Length)) > 0)
        {
            for (int i = 0; i < n; i++)
            {
                if (chunk[i] == (byte)'\n') Emit(frames, buf);
                else buf.WriteByte(chunk[i]);
            }
        }
        Emit(frames, buf);
        return frames;
    }

    private static void Emit(List<JsonElement> frames, MemoryStream buf)
    {
        if (buf.Length == 0) return;
        using (var doc = JsonDocument.Parse(Encoding.UTF8.GetString(buf.ToArray())))
            frames.Add(doc.RootElement.Clone());
        buf.SetLength(0);
    }
}
