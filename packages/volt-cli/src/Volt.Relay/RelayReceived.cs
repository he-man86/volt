using System;
using System.Globalization;

namespace Volt.Relay
{
    /// <summary>One receive from an <see cref="IRelaySocket"/>: a text frame, or the relay's close. Exactly one of
    /// <see cref="Text"/> and <see cref="Close"/> is set.
    ///
    /// <para>Part of the socket contract, so it lives beside neither implementation: the real adapter and the
    /// tests' in-memory relay both build it.</para></summary>
    public sealed class RelayReceived
    {
        private RelayReceived(string? text, RelayClose? close) { Text = text; Close = close; }

        public string? Text { get; }
        public RelayClose? Close { get; }

        public static RelayReceived Frame(string text) =>
            new RelayReceived(text ?? throw new ArgumentNullException(nameof(text)), null);

        public static RelayReceived Closed(int? status, string? description) =>
            new RelayReceived(null, new RelayClose(status, description));
    }

    /// <summary>The close handshake the relay sent.</summary>
    public sealed class RelayClose
    {
        /// <summary>WebSocket 1008 (policy violation): the relay will not serve this bridge.</summary>
        public const int PolicyViolation = 1008;

        public RelayClose(int? status, string? description)
        {
            Status = status;
            // A close handshake may carry a status and no reason text, and ClientWebSocket reports that as null.
            // An absent reason and an empty one say the same thing, so they are one value here.
            Description = description ?? "";
        }

        /// <summary>Null only when the close frame carried no status, which the WebSocket API can report; the log
        /// then says so in words rather than inventing a number.</summary>
        public int? Status { get; }
        public string Description { get; }

        public bool IsPolicyRefusal => Status == PolicyViolation;

        public override string ToString() =>
            (Status.HasValue ? Status.Value.ToString(CultureInfo.InvariantCulture) : "no status")
            + " \"" + Description + "\"";
    }
}
