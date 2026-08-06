using System.Text.Json;
using System.Threading.Tasks;
using Volt.Cli.Transport;

namespace Volt.Cli.Connector
{
    /// <summary>
    /// A thin async seam over one bridge's named-pipe wire — <c>Call(op, body)</c> returning the terminal result.
    /// Exists so <see cref="PipeProjectSource"/> (and anything else) can be unit-tested against a scripted wire
    /// with no pipe/IDE, while production uses <see cref="PipeBridgeWire"/> over the real transport.
    /// </summary>
    public interface IBridgeWire
    {
        /// <summary>Call a wire op; returns the terminal result element, or throws if the bridge is unreachable.</summary>
        Task<JsonElement> CallAsync(string op, object? body = null);
    }

    /// <summary>The production <see cref="IBridgeWire"/>: one discovered per-instance pipe
    /// (`volt.bridge.&lt;vendor&gt;.&lt;pid&gt;`). Connect is blocking, so calls run off the caller's thread; a short
    /// connect timeout maps "nothing listening" to a thrown call (which the source isolates to that one pipe — no
    /// rows from it).</summary>
    public sealed class PipeBridgeWire : IBridgeWire
    {
        private readonly string _pipeName;
        private readonly int _connectTimeoutMs;

        public PipeBridgeWire(string pipeName, int connectTimeoutMs = 2000)
        {
            _pipeName = pipeName;
            _connectTimeoutMs = connectTimeoutMs;
        }

        public Task<JsonElement> CallAsync(string op, object? body = null) =>
            Task.Run(() => new PipeClient(_pipeName).Call(op, body, connectTimeoutMs: _connectTimeoutMs));
    }
}
