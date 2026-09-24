using System;
using System.Collections.Generic;
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
        /// <summary>Not parseable, or a request missing `id`. <see cref="RelayInbound.Reason"/> says why.</summary>
        Malformed,
    }

    public sealed class RelayInbound
    {
        public RelayInboundKind Kind { get; set; }
        /// <summary>Set only when <see cref="Kind"/> is <see cref="RelayInboundKind.Request"/>.</summary>
        public string? Id { get; set; }
        /// <summary>Set only when <see cref="Kind"/> is <see cref="RelayInboundKind.Request"/>.</summary>
        public string? Op { get; set; }
        public JsonElement? Body { get; set; }
        /// <summary>Set only when <see cref="Kind"/> is <see cref="RelayInboundKind.Malformed"/>.</summary>
        public string? Reason { get; set; }
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
            Ops.Health, Ops.Logs, Ops.Refs, Ops.Fetch, Ops.Push, Ops.Build,
        };

        /// <summary>This document's version. No negotiation — a relay that does not speak it closes the socket.</summary>
        public const int Protocol = 1;

        public static string Hello(string voltVersion, string vendor, string pipe)
        {
            using (var stream = new System.IO.MemoryStream())
            {
                using (var w = new Utf8JsonWriter(stream))
                {
                    w.WriteStartObject();
                    w.WriteStartObject("hello");
                    w.WriteNumber("protocol", Protocol);
                    w.WriteString("volt", voltVersion ?? "");
                    w.WriteString("vendor", vendor ?? "");
                    w.WriteString("pipe", pipe ?? "");
                    w.WriteEndObject();
                    w.WriteEndObject();
                }
                return System.Text.Encoding.UTF8.GetString(stream.ToArray());
            }
        }

        public static string Ping(long n) => "{\"ping\":" + n.ToString(System.Globalization.CultureInfo.InvariantCulture) + "}";

        /// <summary>A progress frame, tagged with the request it belongs to. The pipe's own frame is forwarded
        /// VERBATIM — the relay does not need to understand it, and a client reads it against the wire docs.</summary>
        public static string Progress(string id, JsonElement progress) =>
            "{\"id\":" + JsonEncode(id) + ",\"progress\":" + progress.GetRawText() + "}";

        public static string Result(string id, JsonElement result) =>
            "{\"id\":" + JsonEncode(id) + ",\"result\":" + result.GetRawText() + "}";

        public static string Error(string id, string code, string message) =>
            "{\"id\":" + JsonEncode(id) + ",\"error\":{\"code\":" + JsonEncode(code) +
            ",\"message\":" + JsonEncode(message) + "}}";

        private static string JsonEncode(string value) =>
            JsonSerializer.Serialize(value ?? "");

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
                    // A pong, a keepalive, something from a newer relay. Not ours to act on, and NOT an error:
                    // it still proves the relay is alive, which is what the watchdog cares about.
                    return new RelayInbound { Kind = RelayInboundKind.Ignorable };

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

                return new RelayInbound
                {
                    Kind = RelayInboundKind.Request,
                    // Non-null: the ValueKind check above already established it is a JSON string.
                    Id = idElement.GetString()!,
                    Op = opElement.GetString()!,
                    // Cloned: the JsonDocument is disposed on the way out of this method, and a body that
                    // outlives its document reads freed memory.
                    Body = hasBody ? body.Clone() : (JsonElement?)null,
                };
            }
        }
    }
}
