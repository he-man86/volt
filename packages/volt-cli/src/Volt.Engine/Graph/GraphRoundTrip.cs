using System;
using Volt.Engine.Model;

namespace Volt.Engine.Graph
{
    /// <summary>
    /// The body's journey through the PLCopen transport, in ONE place: graph → <see cref="GraphWriter"/> →
    /// <see cref="GraphReader"/> → graph, and back to network text. This is the IDE-facing leg of the round-trip — what
    /// the IDE would store and hand back. Shared by the convergence gate (<see cref="NetworkCode.Validate"/>)
    /// and the fixed-point tests so the pattern has a single home (it used to be copy-pasted into every test).
    /// </summary>
    public static class GraphRoundTrip
    {
        /// <summary>One pass through PLCopen: graph → XML → graph. <paramref name="resolveType"/> maps an FB
        /// instance to its type (network text carries the call, not the type, so the writer restores it) — null is fine
        /// for type-agnostic checks, since NetworkTextWriter renders an FB call from its instance name alone.</summary>
        public static GraphBody Once(GraphBody graph, Func<string, string?>? resolveType = null)
            => GraphReader.ReadBody(GraphWriter.WriteBody(graph, resolveType));

        /// <summary>The network text the IDE would hand back after one PLCopen round-trip.</summary>
        public static string ToNetworkText(GraphBody graph, Func<string, string?>? resolveType = null)
            => NetworkTextWriter.Write(Once(graph, resolveType));

        /// <summary>Parse a network-text body, take it once through PLCopen, and render it back to network text.</summary>
        public static string ToNetworkText(string networkText, Func<string, string?>? resolveType = null)
            => ToNetworkText(NetworkTextReader.Parse(networkText), resolveType);
    }
}
