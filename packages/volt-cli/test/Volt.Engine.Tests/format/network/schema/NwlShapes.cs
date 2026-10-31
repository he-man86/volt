using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Volt.Tests.Shared;
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Engine.Tests.Format.Network.Schema;

/// <summary>One generated NWL shape: a schema <see cref="Class"/> in a schema <see cref="Slot"/>, with <see cref="Bits"/> set on
/// one flag <see cref="Holder"/>, in a body of <see cref="Language"/>. Either a model (<see cref="Body"/>) or, where the CODESYS
/// reader refuses the stored shape before any model exists, the refusal's marker (<see cref="VendorRefusal"/>).</summary>
public sealed record NwlShape(string Class, string Slot, string Holder, int Bits, int Depth, BodyLanguage Language,
                              NetworkBody? Body, string? VendorRefusal)
{
    public string Flags => NwlShapes.IsComment(Holder) ? "'" + NwlShapes.Comment + "'" : NwlShapes.BitsName(Bits);

    /// <summary>The shape's stable id: language, depth, slot, class, holder, flags.</summary>
    public string Id => $"{(Language == BodyLanguage.Ld ? "LD" : "FBD")}/d{Depth}/{Slot}/{Class}" +
                        (Holder.Length == 0 ? "" : $"/{Holder}={Flags}");
}

/// <summary>
/// THE SHAPE GENERATOR (openspec <c>nwl-schema-completeness-gate</c> 2.1), driven by the census
/// (<c>test/fixtures/nwl-schema/census.3.5.21.40.json</c>): every IBoxTree class of the schema × every slot it can occupy ×
/// every flag holder it carries × no flag, every single flag value and every pairwise stack of flag bits, at depth 1; then
/// every class in every slot of every class in every slot (depth 2), with no flags. Each in an LD and an FBD body.
///
/// <para>A shape is a MODEL built as the CODESYS reader builds one: the containers (a slot's owner) are read from small
/// texts with a placeholder leaf, the class instances likewise, and the flags are set on the model the way
/// <c>CodesysNetworkReader</c> decodes the vendor's bits (a coil target's Negation/Set through <c>Flags.CoilFromVendor</c>,
/// every other holder bit for bit). A stored shape the CODESYS reader refuses before any model exists (a Mux, a terminator
/// with an input, a parallel fed by the empty terminator, a negation or edge on an assignment item) is the refusal's
/// marker instead — the name that reader gives it.</para>
///
/// <para>The operand comment (<c>Operand.Comment</c>) is generated as a holder of its own on every operand a class carries
/// (a leaf, a coil target, an output, an FB instance), set to one comment.</para>
///
/// <para>What is CUT is listed in <see cref="Cuts"/>, so the gate states its coverage exactly.</para>
/// </summary>
public static class NwlShapes
{
    /// <summary>The comment an operand-comment shape sets.</summary>
    public const string Comment = "why";

    public static bool IsComment(string holder) => holder.StartsWith("Operand.Comment", StringComparison.Ordinal);

    /// <summary>The fixed scope every shape is read and written against, in the case-set's scope-line form (the export
    /// carries it, so the LSP and Sim-Assist read the texts against the same declarations).</summary>
    public static readonly IReadOnlyList<string> ScopeLines = new[]
    {
        "instance fb1 FB1",
        "fb FB1 IN1 IN2 => Q1 Q2",
        "function F1 IN1 IN2 =>",
        "name a b c go start n q y z HOLE",
    };

    public static NetworkScope Scope() => ScopeCase("").ScopeOf();

    public static NetworkTextCase ScopeCase(string text) =>
        new("nwl-shapes", "shape", text, null, null, null, null, ScopeLines);

    // ── the census's vocabulary ───────────────────────────────────────────────────────────────────────────────────

    /// <summary>The flag bits the census reads (<c>Flags._ci*</c>), Reset (3) being the value Negation|Set.</summary>
    public static readonly IReadOnlyList<(string Name, int Value)> FlagValues = new[]
    {
        ("Negation", 1), ("Set", 2), ("Reset", 3), ("Jump", 4), ("Return", 8), ("Rtrig", 16), ("Ftrig", 32),
    };

    static readonly int[] SingleBits = { 1, 2, 4, 8, 16, 32 };

    /// <summary>No flag, every single flag value, every pairwise stack of single bits — distinct values.</summary>
    public static IReadOnlyList<int> BitValues() =>
        new[] { 0 }.Concat(FlagValues.Select(f => f.Value))
            .Concat(SingleBits.SelectMany((a, i) => SingleBits.Skip(i + 1).Select(b => a | b)))
            .Distinct().OrderBy(v => v).ToList();

    public static string BitsName(int bits)
    {
        if (bits == 0) return "none";
        if (FlagValues.FirstOrDefault(f => f.Value == bits) is { Name: { } exact }) return exact;
        return string.Join("+", SingleBits.Where(b => (bits & b) != 0).Select(b => FlagValues.First(f => f.Value == b).Name));
    }

    /// <summary>The model flags of vendor <paramref name="bits"/> on an ordinary holder (bit for bit, as
    /// <c>CodesysNetworkReader.ReadFlags</c>), or on a coil target (Negation/Set decoded, as <c>ReadTarget</c>).</summary>
    public static Flags ModelFlags(int bits, bool target)
    {
        bool neg = (bits & 1) != 0, set = (bits & 2) != 0;
        var f = new Flags(Negated: neg, Set: set, Jump: (bits & 4) != 0, Return: (bits & 8) != 0,
                          Rising: (bits & 16) != 0, Falling: (bits & 32) != 0);
        if (!target) return f;
        var coil = Flags.CoilFromVendor(neg, set);
        return f with { Negated = coil.Negated, Set = coil.Set, Reset = coil.Reset };
    }

    // ── classes and slots ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The IBoxTree classes the census lets fill a slot, each with the variants a member VALUE makes (a box's
    /// CallType, EN/ENO shown, an ST snippet; a parallel's Mode). The text that builds each instance (consumed form).</summary>
    static readonly (string Class, string? Text)[] Classes =
    {
        ("BoxTreeOperand", "a"),
        ("BoxTreeBox[operator]", "AND(a, b)"),
        ("BoxTreeBox[function]", "F1(IN1 := a, IN2 := b)"),
        ("BoxTreeBox[fb]", "fb1(IN1 := a, IN2 := b).Q1"),
        ("BoxTreeBox[en-eno]", "MOVE(EN := c, a, OUT => n).ENO"),
        ("BoxTreeBox[execute]", "EXECUTE(EN := go, 'n := TRUE;').ENO"),
        ("BoxTreeAssign", null),                     // a mid-rung coil, taken from `y := (z := a) AND b;`
        ("BoxTreeDemux", null),                      // built: a wire defined here, read by another tree
        ("BoxTreeParallel[Sequential]", "BRANCH(FEED := start, a, b)"),
        ("BoxTreeParallel[BoxShortCircuit]", "BRANCH_SHORTCIRCUIT(FEED := start, a, b)"),
        ("BoxTreeTerminator", "RAIL()"),
        ("BoxTreeMux", null),                        // no model: the CODESYS reader refuses it
    };

    /// <summary>The census's IBoxTree slots, each as a text holding the placeholder <c>HOLE</c> (a box's InputItems once per
    /// kind of input it has), or null where the model has no field and the CODESYS reader refuses a filled one.</summary>
    static readonly (string Slot, string? Text)[] Slots =
    {
        ("Network.NetworkItems", null),              // the root: the class itself is the tree
        ("BoxTreeAssign.RValue", "y := HOLE;"),
        ("BoxTreeBox.InputItems[operator]", "y := AND(HOLE, b);"),
        ("BoxTreeBox.InputItems[function]", "y := F1(IN1 := HOLE, IN2 := b);"),
        ("BoxTreeBox.InputItems[fb]", "y := fb1(IN1 := HOLE, IN2 := b).Q1;"),
        ("BoxTreeBox.InputItems[EN]", "y := MOVE(EN := HOLE, a, OUT => n).ENO;"),
        ("BoxTreeDemux.Input", "VAR w1 : ANY; END_VAR\nw1 := HOLE;\ny := w1;\nz := w1;"),
        ("BoxTreeParallel.Input", "y := BRANCH(FEED := HOLE, a, b);"),
        ("BoxTreeParallel.Trees", "y := BRANCH(FEED := start, HOLE, b);"),
        ("BoxTreeTerminator.Input", null),
        ("BoxTreeMux.Merger", null),
    };

    public const string MuxMarker = "an item with no network-text form";
    public const string TerminatorInputMarker = "a terminator with an input";

    /// <summary>What the generator does not generate, each a line of the coverage it states.</summary>
    public static readonly IReadOnlyList<string> Cuts = new[]
    {
        "flags at depth 2: none (every holder × every flag value is generated at depth 1)",
        "stacks of three or more flag bits on one holder; flags on two holders at once",
        "a flag holder's non-first instances (a box's second input pin, a chain's second coil target): the first stands for its kind",
        "Flags.Fixed and Flags.Extensible: the model carries neither (census model-map findings), so no shape can vary them",
        "member values other than the flags, the operand comment, a box's CallType/EN/ENO/snippet and a parallel's Mode (the class variants): operand text, types, symbol comments, formal names, network header fields — the case set covers those",
        "Network.NetworkItems is typed Object: only the IBoxTree classes are placed there",
        "BoxTreeMux.Merger (an IBoxTreeBox slot) and BoxTreeTerminator.Input: no model field — every class there is the CODESYS reader's refusal",
        "the non-IBoxTree slots (OutputItems, Instance, ParamList, STSnippet, NetworkList, ILLines, Connectors): fixed by their owner, varied only through their flags",
        "IL (NWLDisplayMode IL=2): a body language the text does not read — %LANGUAGE IL UNSUPPORTED, one shape",
    };

    // ── generation ───────────────────────────────────────────────────────────────────────────────────────────────

    public static IReadOnlyList<NwlShape> All()
    {
        var shapes = new List<NwlShape>();
        foreach (var lang in new[] { BodyLanguage.Ld, BodyLanguage.Fbd })
        {
            foreach (var (slot, slotText) in Slots)
                foreach (var (cls, _) in Classes)
                    foreach (var (holder, bits) in Holders(cls).SelectMany(h => (h.Length == 0 || IsComment(h) ? new[] { 0 } : BitValues()).Select(b => (h, b))))
                        shapes.Add(Shape(lang, 1, slot, slotText, null, cls, holder, bits));

            foreach (var (outer, outerText) in Slots.Where(s => s.Text is not null))
                foreach (var (inner, innerText) in Slots.Where(s => s.Slot != "Network.NetworkItems"))
                    foreach (var (cls, _) in Classes)
                        shapes.Add(Shape(lang, 2, outer + ">" + inner, outerText, innerText ?? inner, cls, "", 0));
        }
        return shapes;
    }

    /// <summary>The flag holders of <paramref name="cls"/>, "" for "no holder" (a class with none still gets one shape).</summary>
    public static IReadOnlyList<string> Holders(string cls) => cls switch
    {
        "BoxTreeOperand" => new[] { "Operand.Flags", "Operand.Comment" },
        "BoxTreeBox[fb]" => new[] { "BoxTreeBox.Flags", "BoxTreeBox.InputFlags", "Operand.Flags[instance]", "Operand.Comment[instance]" },
        "BoxTreeBox[en-eno]" => new[] { "BoxTreeBox.Flags", "BoxTreeBox.InputFlags", "BoxTreeBox.InputFlags[EN]", "Operand.Flags[output]", "Operand.Comment[output]" },
        "BoxTreeBox[execute]" => new[] { "BoxTreeBox.Flags", "BoxTreeBox.InputFlags[EN]" },
        _ when cls.StartsWith("BoxTreeBox", StringComparison.Ordinal) => new[] { "BoxTreeBox.Flags", "BoxTreeBox.InputFlags" },
        "BoxTreeAssign" => new[] { "BoxTreeAssign.Flags", "Operand.Flags[target]", "Operand.Comment[target]" },
        "BoxTreeTerminator" => new[] { "BoxTreeTerminator.Flags" },
        _ => new[] { "" },   // Demux, Parallel: the census gives them no Flags member; Mux: refused
    };

    static NwlShape Shape(BodyLanguage lang, int depth, string slot, string? outerText, string? innerSlot, string cls, string holder, int bits)
    {
        NwlShape Refused(string marker) => new(cls, slot, holder, bits, depth, lang, null, marker);

        if (cls == "BoxTreeMux") return Refused(MuxMarker);
        var innerSlotName = innerSlot is null ? slot : innerSlot.Contains(":=", StringComparison.Ordinal) ? slot.Split('>')[1] : innerSlot;
        if (innerSlotName is "BoxTreeMux.Merger") return Refused(MuxMarker);
        if (innerSlotName is "BoxTreeTerminator.Input") return Refused(TerminatorInputMarker);

        var extra = new List<Node>();
        var node = Instance(cls, extra, root: depth == 1 && slot == "Network.NetworkItems");
        if (holder.Length > 0 && (bits != 0 || IsComment(holder)))
        {
            try { node = WithFlags(node, holder, bits); }
            catch (UnrepresentableBodyException e) { return Refused(e.Reason); }
        }

        List<Node> trees;
        if (depth == 1 && slot == "Network.NetworkItems") trees = new List<Node> { node };
        else if (depth == 1) trees = Fill(Template(outerText!, 0), node);
        else
        {
            // the inner slot's owner, holding the class, fills the outer slot; the inner template's other trees come along
            var inner = Template(innerSlot!, 10);
            var holderTree = inner.Single(t => Contains(t, IsHole));
            var owner = OwnerOfHole(holderTree);
            extra.AddRange(inner.Where(t => !ReferenceEquals(t, holderTree)));
            trees = Fill(Template(outerText!, 0), Replace(owner, IsHole, node));
        }
        trees.AddRange(extra);

        var body = new NetworkBody(lang, new[] { new Volt.Engine.Format.Network.Network(0, null, null, null, false, trees) });
        return new NwlShape(cls, slot, holder, bits, depth, lang, body, null);
    }

    // ── building ─────────────────────────────────────────────────────────────────────────────────────────────────

    static bool IsHole(Node n) => n is Leaf { Operand.Text: "HOLE" };

    /// <summary>A slot template's trees, its wires renumbered past <paramref name="varBase"/>.</summary>
    static List<Node> Template(string text, int varBase)
    {
        var body = StNetworkReader.Read("%LANGUAGE LD\n%NETWORK\n" + text + "\n", Scope());
        return body.Networks.Single().Trees.Select(t => Renumber(t, varBase)).ToList();
    }

    static Node Renumber(Node n, int by) => by == 0 ? n : Map(n, x => x is Demux d ? new Demux(d.VarId + by, d.Input is null ? null : Renumber(d.Input, by)) : null);

    static List<Node> Fill(List<Node> template, Node node) => template.Select(t => Replace(t, IsHole, node)).ToList();

    static Node Instance(string cls, List<Node> extra, bool root)
    {
        Node Value(string expr) => ((Assign)Template("y := " + expr + ";", 0)[0]).Value;
        Node n = cls switch
        {
            "BoxTreeOperand" => new Leaf(new Operand("a", Flags: Flags.None), Flags.None),
            "BoxTreeAssign" => ((Box)Value("(z := a) AND b")).Inputs.Select(i => i.Value).OfType<Assign>().Single(),
            "BoxTreeDemux" => new Demux(20, new Leaf(new Operand("a", Flags: Flags.None), Flags.None)),
            _ => Value(Classes.Single(c => c.Class == cls).Text!),
        };
        if (cls == "BoxTreeDemux")
            extra.Add(new Assign(new Demux(20, null), new[] { new Operand("q", IsLValue: true, Flags: Flags.None) }, Flags.None));
        // a top-level box is consumed by nothing: no connected slot, no output named (CodesysNetworkReader, consumed: false)
        if (root && n is Box b) n = b with { ConnectedSlot = null, MainOutputName = null };
        if (root && n is Assign a0) n = a0;
        return n;
    }

    static Node WithFlags(Node n, string holder, int bits)
    {
        var f = ModelFlags(bits, target: holder == "Operand.Flags[target]");
        switch (n, holder)
        {
            case (Leaf l, "Operand.Comment"):
                return l with { Operand = l.Operand with { Comment = Comment } };
            case (Assign a, "Operand.Comment[target]"):
                return a with { Targets = a.Targets.Select((t, i) => i == 0 ? t with { Comment = Comment } : t).ToList() };
            case (Box b, "Operand.Comment[output]"):
                return b with { Outputs = b.Outputs.Select((o, i) => i == 0 ? o with { Value = o.Value with { Comment = Comment } } : o).ToList() };
            case (Box b, "Operand.Comment[instance]"):
                return b with { Instance = b.Instance! with { Comment = Comment } };
            case (Leaf l, "Operand.Flags"):
                return new Leaf(l.Operand with { Flags = f }, f);
            case (Box b, "BoxTreeBox.Flags"):
                return b with { Flags = f };
            case (Box b, "BoxTreeBox.InputFlags"):
                return b with { Inputs = b.Inputs.Select((p, i) => i == 0 ? p with { Flags = f } : p).ToList() };
            case (Box b, "BoxTreeBox.InputFlags[EN]"):
                return b with { EnableFlags = f };
            case (Box b, "Operand.Flags[instance]"):
                return b with { Instance = b.Instance! with { Flags = f } };
            case (Box b, "Operand.Flags[output]"):
                return b with { Outputs = b.Outputs.Select((o, i) => i == 0 ? o with { Value = o.Value with { Flags = f } } : o).ToList() };
            case (Assign a, "BoxTreeAssign.Flags"):
                return a with { Flags = f.WithControlFlowFrom(a.Targets) };
            case (Assign a, "Operand.Flags[target]"):
            {
                var targets = a.Targets.Select((t, i) => i == 0 ? t with { Flags = f } : t).ToList();
                return new Assign(a.Value, targets, a.Flags.WithControlFlowFrom(targets));
            }
            case (Terminator, "BoxTreeTerminator.Flags"):
                return new Terminator(f);
        }
        throw new InvalidOperationException($"no holder {holder} on {n.GetType().Name}");
    }

    // ── tree surgery ─────────────────────────────────────────────────────────────────────────────────────────────

    static bool Contains(Node n, Func<Node, bool> p) => p(n) || n.Children().Any(c => Contains(c, p));

    /// <summary>The node whose direct child is the placeholder.</summary>
    static Node OwnerOfHole(Node n)
    {
        if (n.Children().Any(IsHole)) return n;
        return OwnerOfHole(n.Children().First(c => Contains(c, IsHole)));
    }

    static Node Replace(Node n, Func<Node, bool> p, Node with) => Map(n, x => p(x) ? with : null);

    /// <summary>Rebuild <paramref name="n"/> bottom-up; <paramref name="f"/> answers a replacement or null to recurse.</summary>
    static Node Map(Node n, Func<Node, Node?> f)
    {
        if (f(n) is { } r) return r;
        Node M(Node x) => Map(x, f);
        return n switch
        {
            Assign a => a with { Value = M(a.Value) },
            Box b => b with { Enable = b.Enable is null ? null : M(b.Enable), Inputs = b.Inputs.Select(i => i with { Value = M(i.Value) }).ToList() },
            Demux d => new Demux(d.VarId, d.Input is null ? null : M(d.Input)),
            Parallel p => new Parallel(p.Input is null ? null : M(p.Input), p.Branches.Select(M).ToList(), p.Mode),
            _ => n,
        };
    }

    public static string Hex(int v) => v.ToString(CultureInfo.InvariantCulture);
}
