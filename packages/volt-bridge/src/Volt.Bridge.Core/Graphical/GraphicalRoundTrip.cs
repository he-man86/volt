using System;
using Volt.Bridge.Core.Graphical.Vg;

namespace Volt.Bridge.Core.Graphical
{
    /// <summary>
    /// The body's journey through the PLCopen transport, in ONE place: graph → <see cref="PlcOpenWriter"/> →
    /// <see cref="PlcOpenReader"/> → graph, and back to VG. This is the IDE-facing leg of the round-trip — what
    /// the IDE would store and hand back. Shared by the convergence gate (<see cref="GraphicalCode.Validate"/>)
    /// and the fixed-point tests so the pattern has a single home (it used to be copy-pasted into every test).
    /// </summary>
    public static class GraphicalRoundTrip
    {
        /// <summary>One pass through PLCopen: graph → XML → graph. <paramref name="resolveType"/> maps an FB
        /// instance to its type (VG carries the call, not the type, so the writer restores it) — null is fine
        /// for type-agnostic checks, since VgWriter renders an FB call from its instance name alone.</summary>
        public static GraphBody Once(GraphBody graph, Func<string, string?>? resolveType = null)
            => PlcOpenReader.ReadBody(PlcOpenWriter.WriteBody(graph, resolveType));

        /// <summary>The VG the IDE would hand back after one PLCopen round-trip.</summary>
        public static string ToVg(GraphBody graph, Func<string, string?>? resolveType = null)
            => VgWriter.Write(Once(graph, resolveType));

        /// <summary>Parse a VG body, take it once through PLCopen, and render it back to VG.</summary>
        public static string ToVg(string vgText, Func<string, string?>? resolveType = null)
            => ToVg(VgParser.Parse(vgText), resolveType);
    }
}
