using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using Volt.Contracts;

namespace Volt.Relay
{
    /// <summary>What arrived from the relay. One of: a request, a pong/unknown we ignore, or a frame we could
    /// not understand.</summary>
    public enum RelayInboundKind
    {
        /// <summary>A request to serve. <see cref="RelayInbound.Id"/> and <see cref="RelayInbound.Op"/> are set.</summary>
        Request,
        /// <summary>Anything else well-formed — a pong, a keepalive, a field we do not know. Ignored, but it
        /// counts as traffic for the watchdog: the relay is alive.</summary>
        Ignorable,
        /// <summary>Not parseable, a request missing `id`, or an announcement or ack that breaks its shape.
        /// <see cref="RelayInbound.Reason"/> says why.</summary>
        Malformed,
        /// <summary>The relay's announcement that this connection may carry chunks (openspec relay-chunked-results).
        /// <see cref="RelayInbound.MaxBytes"/> is set.</summary>
        Announcement,
        /// <summary>The relay acked one chunk. <see cref="RelayInbound.Id"/> and <see cref="RelayInbound.Seq"/> are set.</summary>
        Ack,
    }

    public sealed class RelayInbound
    {
        public RelayInboundKind Kind { get; set; }
        /// <summary>Set only when <see cref="Kind"/> is <see cref="RelayInboundKind.Request"/>.</summary>
        public string? Id { get; set; }
        /// <summary>Set only when <see cref="Kind"/> is <see cref="RelayInboundKind.Request"/>.</summary>
        public string? Op { get; set; }
        public JsonElement? Body { get; set; }
        /// <summary>The wire protocol the remote client stated (<c>protocol</c>), null when it stated none or not as an
        /// integer. Forwarded as stated, so the bridge refuses a client of another protocol itself.</summary>
        public int? Protocol { get; set; }
        /// <summary>Set only when <see cref="Kind"/> is <see cref="RelayInboundKind.Malformed"/>.</summary>
        public string? Reason { get; set; }
        /// <summary>Set only when <see cref="Kind"/> is <see cref="RelayInboundKind.Announcement"/>: the largest binary
        /// message the relay takes.</summary>
        public int? MaxBytes { get; set; }
        /// <summary>Set only when <see cref="Kind"/> is <see cref="RelayInboundKind.Ack"/>: the chunk acked.</summary>
        public int? Seq { get; set; }
    }

    /// <summary>Reading and writing the tunnel's frames.
    ///
    /// <para>Separated from the socket on purpose: the frame shapes are the part of this protocol a test should
    /// pin, and standing up a WebSocket to assert on a JSON string is a slow way to test a string.</para></summary>
    public static class RelayFrames
    {
        /// <summary>The ops a tunneled request may name.
        ///
        /// <para>Built from <see cref="Ops"/> rather than string literals, so the vocabulary guard sees it and
        /// an op cannot be spelled a second way here. <c>connect</c> and <c>disconnect</c> are deliberately
        /// absent: a remote party does not get to rebind which project an engineer's IDE serves.</para></summary>
        public static readonly HashSet<string> Allowed = new HashSet<string>(StringComparer.Ordinal)
        {
            Ops.Health, Ops.Refs, Ops.Fetch, Ops.Push, Ops.Build, Ops.Grep,
        };

        public static string Hello(string? voltVersion, string vendor, string pipe)
        {
            using (var stream = new System.IO.MemoryStream())
            {
                using (var w = new Utf8JsonWriter(stream))
                {
                    w.WriteStartObject();
                    w.WriteStartObject("hello");
                    // The one wire number (WireProtocol). No negotiation — a relay that does not speak it closes the socket.
                    w.WriteNumber("protocol", WireProtocol.Version);
                    w.WriteString("volt", voltVersion ?? "");
                    w.WriteString("vendor", vendor ?? "");
                    w.WriteString("pipe", pipe ?? "");
                    w.WriteEndObject();
                    w.WriteEndObject();
                }
                return System.Text.Encoding.UTF8.GetString(stream.ToArray());
            }
        }

        /// <summary>The heartbeat, and it is a CONSTANT string on purpose.
        ///
        /// <para>A hosted relay can answer an exact, unchanging payload at its edge without waking the object
        /// that owns this connection (Cloudflare calls this a WebSocket auto-response). An incrementing
        /// <c>{"ping":1}</c>, <c>{"ping":2}</c> matches nothing, so every heartbeat from every connected bridge
        /// wakes and bills a Durable Object, for ever, to say nothing.</para>
        ///
        /// <para>The counter it replaced bought nothing either: nothing correlates a pong to its ping. The
        /// watchdog below measures SILENCE, not round-trips.</para></summary>
        public const string Ping = "{\"volt\":\"ping\"}";

        /// <summary>What a relay answers <see cref="Ping"/> with. Recognised and ignored — it exists only to
        /// prove the flow is alive, which arriving at all already does.</summary>
        public const string Pong = "{\"volt\":\"pong\"}";

        /// <summary>A progress frame, tagged with the request it belongs to. The pipe's own frame is forwarded
        /// VERBATIM — the relay does not need to understand it, and a client reads it against the wire docs.</summary>
        public static string Progress(string id, JsonElement progress) =>
            "{\"id\":" + JsonEncode(id) + ",\"progress\":" + progress.GetRawText() + "}";

        public static string Result(string id, JsonElement result) =>
            "{\"id\":" + JsonEncode(id) + ",\"result\":" + result.GetRawText() + "}";

        /// <summary>A terminal error frame; <paramref name="data"/> is the pipe frame's own <c>data</c>, forwarded
        /// verbatim when it carried one.</summary>
        public static string Error(string id, string code, string message, JsonElement? data = null) =>
            "{\"id\":" + JsonEncode(id) + ",\"error\":{\"code\":" + JsonEncode(code) +
            ",\"message\":" + JsonEncode(message) + (data is { } d ? ",\"data\":" + d.GetRawText() : "") + "}}";

        internal static string JsonEncode(string value) =>
            JsonSerializer.Serialize(value ?? "");

        /// <summary><c>{"id":"r1","ack":2}</c>: the relay accepted chunk 2 of r1.</summary>
        private static RelayInbound ReadAck(JsonElement root, JsonElement ack)
        {
            if (!root.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.String)
                return Malformed("an ack has no string `id`");
            if (ack.ValueKind != JsonValueKind.Number || !ack.TryGetInt32(out var seq) || seq < 0)
                return Malformed("an ack's `ack` is not a chunk number (a non-negative integer): " + ack.GetRawText());
            return new RelayInbound { Kind = RelayInboundKind.Ack, Id = id.GetString()!, Seq = seq };
        }

        /// <summary><c>{"volt":"relay","chunks":{"maxBytes":8192,"ack":true}}</c>. Anything short of that shape is
        /// refused by name, and the connection then sends whole frames: chunking on a guess about the relay's limit, or
        /// without acks (no flow control), is worse than not chunking.</summary>
        private static RelayInbound ReadAnnouncement(JsonElement root)
        {
            if (!root.TryGetProperty("chunks", out var chunks) || chunks.ValueKind != JsonValueKind.Object)
                return Malformed("the relay's announcement has no `chunks` object");
            if (!chunks.TryGetProperty("maxBytes", out var max) || max.ValueKind != JsonValueKind.Number ||
                !max.TryGetInt64(out var maxBytes))
                return Malformed("the relay's announcement has no integer `chunks.maxBytes`");
            if (maxBytes < 1)
                return Malformed("the relay's announcement is refused: `chunks.maxBytes` " + maxBytes.ToString(CultureInfo.InvariantCulture) +
                                 " is not a positive integer");
            if (!chunks.TryGetProperty("ack", out var ack) || ack.ValueKind != JsonValueKind.True)
                return Malformed("the relay's announcement does not state `chunks.ack: true`, and chunks without acks have no flow control");
            // Any limit over an int's range is over the window's floor too, which is what the bridge sends at most.
            return new RelayInbound { Kind = RelayInboundKind.Announcement, MaxBytes = (int)Math.Min(maxBytes, int.MaxValue) };
        }

        private static RelayInbound Malformed(string reason) =>
            new RelayInbound { Kind = RelayInboundKind.Malformed, Reason = reason };

        /// <summary>Parse one inbound frame.</summary>
        /// <remarks>Never throws. A relay that sends rubbish is a relay bug, and taking the socket down over it
        /// would abandon every request in flight — which is a far worse outcome than ignoring one frame.
        /// </remarks>
        public static RelayInbound Read(string text)
        {
            if (string.IsNullOrEmpty(text))
                return new RelayInbound { Kind = RelayInboundKind.Malformed, Reason = "empty frame" };

            JsonDocument doc;
            try { doc = JsonDocument.Parse(text); }
            catch (JsonException ex)
            {
                return new RelayInbound { Kind = RelayInboundKind.Malformed, Reason = "not JSON: " + ex.Message };
            }

            using (doc)
            {
                var root = doc.RootElement;
                if (root.ValueKind != JsonValueKind.Object)
                    return new RelayInbound { Kind = RelayInboundKind.Malformed, Reason = "not a JSON object" };

                JsonElement opElement;
                if (!root.TryGetProperty("op", out opElement))
                {
                    if (root.TryGetProperty("ack", out var ack)) return ReadAck(root, ack);
                    if (root.TryGetProperty("volt", out var volt) && volt.ValueKind == JsonValueKind.String &&
                        volt.GetString() == "relay")
                        return ReadAnnouncement(root);
                    // A pong, a keepalive, something from a newer relay. Not ours to act on, and NOT an error:
                    // it still proves the relay is alive, which is what the watchdog cares about.
                    return new RelayInbound { Kind = RelayInboundKind.Ignorable };
                }

                JsonElement idElement;
                if (!root.TryGetProperty("id", out idElement) || idElement.ValueKind != JsonValueKind.String)
                    // Without an id there is nowhere to send the answer. Refusing it is the only honest move:
                    // serving it would run an op whose result goes nowhere — a write with no receipt.
                    return new RelayInbound
                    {
                        Kind = RelayInboundKind.Malformed,
                        Reason = "request has no string `id`, so its answer would have nowhere to go",
                    };

                if (opElement.ValueKind != JsonValueKind.String)
                    return new RelayInbound
                    {
                        Kind = RelayInboundKind.Malformed,
                        Reason = "`op` is not a string",
                    };

                JsonElement body;
                var hasBody = root.TryGetProperty("body", out body);
                int? protocol = root.TryGetProperty("protocol", out var p) && p.ValueKind == JsonValueKind.Number
                                && p.TryGetInt32(out var stated) ? stated : (int?)null;

                return new RelayInbound
                {
                    Kind = RelayInboundKind.Request,
                    // Non-null: the ValueKind check above already established it is a JSON string.
                    Id = idElement.GetString()!,
                    Op = opElement.GetString()!,
                    // Cloned: the JsonDocument is disposed on the way out of this method, and a body that
                    // outlives its document reads freed memory.
                    Body = hasBody ? body.Clone() : (JsonElement?)null,
                    Protocol = protocol,
                };
            }
        }
    }
}
