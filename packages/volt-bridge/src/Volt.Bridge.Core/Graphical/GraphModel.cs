using System.Collections.Generic;
using System.Linq;

namespace Volt.Bridge.Core.Graphical
{
    /// <summary>Network index is encoded in the high digits of every <c>localId</c> as
    /// <c>network index = localId / 10^10</c>. Shared by every component in the graphical pipeline.</summary>
    public static class GraphConstants
    {
        public const long NetworkStride = 10_000_000_000L;
    }

    /// <summary>
    /// A faithful, position-free projection of a PLCopenXML FBD/LD body. Every node maps 1:1 to a
    /// PLCopenXML element; wiring is by <c>localId</c> / <c>refLocalId</c> / <c>formalParameter</c>
    /// taken verbatim from the XML — nothing is inferred. This is the lossless pivot between
    /// PLCopenXML and the VG text language; it sits ALONGSIDE the lossy <see cref="FbdBody"/>
    /// (which stays the one-way ST-oracle), never replacing it.
    /// </summary>
    public sealed record GraphBody(string Language, IReadOnlyList<GraphNetwork> Networks);

    public sealed record GraphNetwork(
        int? Order, string? Label, string? Comment, bool Disabled,
        IReadOnlyList<GraphNode> Nodes);

    public enum EdgeMod { None, Rising, Falling }
    public enum StorageMod { None, Set, Reset }

    /// <summary>Per-pin / per-element modifiers (negation, edge detection, set/reset storage).</summary>
    public sealed record Mods(bool Negated, EdgeMod Edge, StorageMod Storage)
    {
        public static readonly Mods None = new(false, EdgeMod.None, StorageMod.None);
        public bool IsNone => !Negated && Edge == EdgeMod.None && Storage == StorageMod.None;
    }

    /// <summary>A directed wire: the producer element's <c>localId</c> and, for multi-output
    /// producers, which output pin (<c>formalParameter</c>). Null formal = the sole/first output.</summary>
    public sealed record Conn(long RefLocalId, string? FormalParameter);

    /// <summary>One input pin of a block: its formal name, the wire feeding it (or null if
    /// unconnected), any modifiers on that pin, and (when the IDE supplies it) the pin's declared
    /// type from the block's <c>inputparamtypes</c> addData. <see cref="Type"/> is read-only metadata
    /// — VgWriter uses it to declare a leaf temp; it is NOT load-bearing for round-trip.</summary>
    public sealed record Pin(string FormalParameter, Conn? Source, Mods Mods, string? Type = null);

    public abstract record GraphNode(long LocalId, int? ExecOrder);

    /// <summary>inVariable — a value producer (literal / variable / expression).</summary>
    public sealed record InVar(long LocalId, int? ExecOrder, string Expression, Mods Mods)
        : GraphNode(LocalId, ExecOrder);

    /// <summary>outVariable — a value consumer (l-value); <paramref name="Source"/> is the wire feeding it.</summary>
    public sealed record OutVar(long LocalId, int? ExecOrder, string Expression, Mods Mods, Conn? Source)
        : GraphNode(LocalId, ExecOrder);

    /// <summary>block — an FB instance call, function call, or operator. <paramref name="CallType"/>
    /// is the CODESYS hint (functionblock / function / operator) when present. <paramref name="OutputTypes"/>
    /// is the positional output-type list (from <c>outputparamtypes</c>) — read-only IDE metadata used
    /// to declare the result temp (the result type is <c>OutputTypes[0]</c>); not load-bearing for round-trip.</summary>
    public sealed record Block(long LocalId, int? ExecOrder, string TypeName, string? InstanceName,
        IReadOnlyList<Pin> Inputs, IReadOnlyList<string> OutputPins, string? CallType,
        IReadOnlyList<string>? OutputTypes = null)
        : GraphNode(LocalId, ExecOrder);

    /// <summary>A jump target — PLCopen <c>&lt;label&gt;</c>. Renders as the ST label <c>name:</c>.</summary>
    public sealed record Label(long LocalId, int? ExecOrder, string Name)
        : GraphNode(LocalId, ExecOrder);

    /// <summary>A jump to a <see cref="Label"/> — PLCopen <c>&lt;jump&gt;</c>. <paramref name="Condition"/>
    /// is the (optional) wired condition; null = unconditional. <paramref name="Mods"/> carries the
    /// condition's negation. Renders as <c>JMP name;</c> or <c>IF cond THEN JMP name; END_IF</c>.</summary>
    public sealed record Jump(long LocalId, int? ExecOrder, string Target, Conn? Condition, Mods Mods)
        : GraphNode(LocalId, ExecOrder);

    /// <summary>An early return — PLCopen <c>&lt;return&gt;</c>. <paramref name="Condition"/> optional.
    /// Renders as <c>RETURN;</c> or <c>IF cond THEN RETURN; END_IF</c>.</summary>
    public sealed record Return(long LocalId, int? ExecOrder, Conn? Condition, Mods Mods)
        : GraphNode(LocalId, ExecOrder);

    /// <summary>A node kind the FBD reader recognises but does not model yet (contact, coil,
    /// connector, continuation, power rails, comment, vendorElement). Preserved opaquely so the
    /// reader stays TOTAL over the XSD and the writer can round-trip it.</summary>
    public sealed record OpaqueNode(long LocalId, int? ExecOrder, string Kind, string RawXml)
        : GraphNode(LocalId, ExecOrder);

    public static class GraphNodeExtensions
    {
        public static GraphNode? ById(this IReadOnlyList<GraphNode> nodes, long id)
            => nodes.FirstOrDefault(n => n.LocalId == id);
    }
}
