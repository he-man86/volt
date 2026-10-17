using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.Network;
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Engine.Tests;

/// <summary>
/// Model builders for the network text reader and gate tests. (The writer goldens run the model oracle
/// <c>Read(Write(m)) ≅ m</c> themselves, on every model they write — <c>NetworkTextWriterTests.Write</c>.)
/// </summary>
internal static class NetworkModels
{
    public static Leaf L(string text, Flags? f = null) => new(new Operand(text), f ?? Flags.None);
    /// <summary>A leaf as the IDE draws it, storing its declared type — what a leaf-fed wire is declared with (S3a,
    /// ld-fbd-coverage 2.3).</summary>
    public static Leaf LT(string text, string type) => new(new Operand(text, Type: type), Flags.None);
    public static Operand T(string text, Flags? f = null) => new(text, IsLValue: true, Flags: f);
    public static Terminator Empty => new(Flags.None);
    public static Input In(Node v, string? formal = null) => new(formal, v, Flags.None);
    public static Demux Ref(int id) => new(id, null);
    public static Demux Def(int id, Node v) => new(id, v);
    public static Assign Set(Node v, params Operand[] targets) => new(v, targets, Flags.None);
    public static readonly Flags Neg = Flags.None with { Negated = true };
    public static readonly Flags Rise = Flags.None with { Rising = true };
    public static readonly Flags Fall = Flags.None with { Falling = true };
    public static readonly Flags SetBit = Flags.None with { Set = true };
    public static readonly Flags ResetBit = Flags.None with { Reset = true };
    public static readonly Flags JumpBit = Flags.None with { Jump = true };
    public static readonly Flags ReturnBit = Flags.None with { Return = true };

    public static Box Op(string type, params Node[] inputs) =>
        new(type, null, CallKind.Operator, inputs.Select(i => In(i)).ToList(), new List<Output>(), null, null, Flags.None);

    public static Box Call(string type, IEnumerable<Input> inputs, IEnumerable<Output>? outputs = null, Node? en = null,
                           int? connected = null, Flags? f = null, Operand? instance = null,
                           CallKind kind = CallKind.Function, IReadOnlyList<string?>? types = null, bool eno = false,
                           string? name = null) =>
        new(type, instance, kind, inputs.ToList(), (outputs ?? Array.Empty<Output>()).ToList(), en, null, f ?? Flags.None,
            ConnectedSlot: connected, OutputTypes: types, HasEnoOutput: eno, MainOutputName: name);

    public static Box Fb(string instance, IEnumerable<Input> inputs, IEnumerable<Output>? outputs = null, string type = "FB") =>
        Call(type, inputs, outputs, instance: new Operand(instance, IsInstance: true), kind: CallKind.FunctionBlock);

    public static Box Exec(string st, Node? en = null, int? connected = null) =>
        new("EXECUTE", null, CallKind.Function, new List<Input>(), new List<Output>(), en, st, Flags.None,
            ConnectedSlot: connected, HasEnoOutput: true);

    public static Output Out(string target, int? slot, string? formal = null) => new(formal, new Operand(target, IsLValue: true), slot);

    /// <summary>A box showing EN/ENO (<c>OutputParams.Names = ['ENO', …]</c>): consumed, it is read through its ENO; at
    /// the top level it is connected by nothing. <paramref name="types"/> are its stored output types, none given = not
    /// read.</summary>
    public static Box EnEno(string type, Node en, IEnumerable<Input> inputs, IEnumerable<Output>? outputs = null,
                            bool consumed = false, params string?[] types) =>
        Call(type, inputs, outputs, en: en, connected: consumed ? 0 : null, eno: true,
            types: types.Length == 0 ? null : types, kind: NetworkSpelling.KindOf(type, hasInstance: false));

    // ── source text ─────────────────────────────────────────────────────────────────────────────

    public const string FbdMarker = "IMPLEMENTATION FBD\n";
    public const string LdMarker = "IMPLEMENTATION LD\n";

    /// <summary>A one-network FBD body holding exactly these statement lines, in the page's layout (two-space
    /// statement indentation).</summary>
    public static string Src(params string[] lines) => OneNetwork(FbdMarker, lines);

    /// <summary>A one-network LD body holding exactly these statement lines.</summary>
    public static string LdSrc(params string[] lines) => OneNetwork(LdMarker, lines);

    private static string OneNetwork(string marker, string[] lines) =>
        marker + "NETWORK\n" + string.Concat(lines.Select(l => "  " + l + "\n")) + "END_NETWORK\n";

    public static NetworkBody Fbd1(params Node[] trees) => new(BodyLanguage.Fbd, new[] { Net(trees) });
    public static NetworkBody Ld1(params Node[] trees) => new(BodyLanguage.Ld, new[] { Net(trees) });

    public static Network Net(params Node[] trees) => new(0, null, null, null, false, trees);

    public static NetworkBody Body(Network net, BodyLanguage lang = BodyLanguage.Fbd) => new(lang, new[] { net });
    public static NetworkBody Body(Node tree, BodyLanguage lang = BodyLanguage.Fbd) => Body(Net(tree), lang);

    /// <summary>The scope a model's text needs to be read back: its FB instances (the declarations would carry
    /// them) plus <paramref name="names"/>.</summary>
    public static NetworkScope ScopeOf(NetworkBody body, params string[] names) =>
        new(names, Array.Empty<string>(), NetworkModelOracle.Instances(body));

}
