using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Volt.Engine.Format.Network;
// `Parallel` is also System.Threading.Tasks.Parallel; this file means the LD branch.
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Ide.Twincat;

/// <summary>
/// THE NATIVE WRITER'S BUILDER (openspec twincat-inproc-host 3): a <see cref="NetworkBody"/> — the model CODESYS's
/// <c>CodesysNetworkWriter</c> builds from — as TwinCAT's own <c>&lt;NWL&gt;&lt;XmlArchive&gt;</c> object graph, which
/// <see cref="TcArchiveWriter"/> turns into the text TwinCAT writes: no scratch POU and no importer to reshape the body.
///
/// <para><b>Nothing here is guessed.</b> Every element is built from a member list TwinCAT itself serialized — the native
/// corpus (<c>test/fixtures/tc-native-corpus</c>, 130 networks TwinCAT built through its importer) and the hand-drawn
/// fixtures (an Execute box, an output pin wired to a variable, a terminator) — in that member order, with the list typing
/// TwinCAT uses (<see cref="List"/>), and <c>TcArchiveBuilderTests</c> holds every element this builds to a member
/// signature a vendor archive holds. What the builder WRITES per node is what CODESYS's writer sets on the same object
/// (the two vendors ship one NWL model, DIALECT N1): the box's output names and types come from the engine's one
/// derivation (<see cref="NetworkMembers.Buildable"/>), its output slots are laid out as CODESYS lays them out, and the
/// enable is input slot 0 named <c>EN</c>.</para>
///
/// <para><b>The ids are TwinCAT's importer's order</b>, measured on the corpus: the network, then each item depth-first —
/// an assignment after its value and its targets, a box after its instance and before its outputs and inputs, a leaf and
/// a wire before what they hold. Only uniqueness in the body is load-bearing (TcNetworkWriter.MintFreshIds renumbers a
/// network spliced into a live body), but the order is what lets a test compare a built body with an imported one.</para>
///
/// <para><b>What it refuses</b>, by name: a parallel branch (<c>BRANCH</c>) (TwinCAT never wrote one: its importer lowers parallel
/// contacts to an OR box, corpus <c>Vn_ld_parallel*</c>, so no template exists); a flag on a box input pin (this vendor's
/// reader cannot read a populated <c>InputFlags</c> back); a consumed call whose named output pins leave no slot for its
/// consumer; and, as on CODESYS, a pushed <c>UNSUPPORTED</c> line and a box read through a named main output (S4).</para>
/// </summary>
internal sealed class TcArchiveBuilder
{
    private long _id = 1;            // the implementation object is 1; the importer's first network is 2
    private int _maxVarId;
    private readonly NetworkScope _scope;   // the declarations the body was read against: a call's callee (2R.4)

    private TcArchiveBuilder(NetworkScope scope) { _scope = scope; }

    private long Next() => ++_id;

    // ── entry points ──────────────────────────────────────────────────────────────────────────────

    /// <summary>The whole body as the <c>ImplementationText</c> TwinCAT stores.</summary>
    public static string Body(NetworkBody body, NetworkScope scope) => TcArchiveWriter.WriteBody(BodyGraph(body, scope));

    /// <summary>The whole body's archive object graph.</summary>
    private static XElement BodyGraph(NetworkBody body, NetworkScope scope)
    {
        var b = new TcArchiveBuilder(scope);
        var networks = body.Networks.Select(b.Network).ToList();
        return new XElement("o",
            new XAttribute(XNamespace.Xml + "space", "preserve"), new XAttribute("t", "NWLImplementationObject"),
            Str("NetworkListComment", ""),
            Str("DefaultViewMode", body.Language == BodyLanguage.Ld ? "Ld" : "Fbd"),
            List("NetworkList", networks.Select(n => ("Network", n))),
            // The VarId allocator (it trails the highest VarId in every CODESYS body measured, census 2026-10-16); an
            // empty body TwinCAT creates holds 1.
            Raw("BranchCounter", Math.Max(1, b._maxVarId).ToString(CultureInfo.InvariantCulture)),
            Raw("ValidIds", "true"));
    }

    /// <summary>One network's archive object (the <c>&lt;o&gt;</c> a <c>NetworkList</c> holds), its ids TwinCAT's
    /// order from 2 — for a splice, which renumbers them above the live body's.</summary>
    public static XElement NetworkGraph(Network network, NetworkScope scope) => new TcArchiveBuilder(scope).Network(network);

    /// <summary>A network graph as TwinCAT would write it at <paramref name="indent"/> — the whitespace-carrying element a
    /// splice puts into a live document, so the body keeps the vendor's layout around and inside it.</summary>
    public static XElement Formatted(XElement graph, int indent) =>
        XElement.Parse(TcArchiveWriter.WriteObject(graph, indent, TcArchiveWriter.Newline), LoadOptions.PreserveWhitespace);

    // ── networks ─────────────────────────────────────────────────────────────────────────────────

    private XElement Network(Network n)
    {
        // A pushed UNSUPPORTED line has nothing to build from, and an FB read through a named output whose slot no
        // declaration in reach states is no box Volt builds: the slot is the null's position (v2-measurements #12), never
        // a guess.
        NetworkPairing.RefuseUnpairedUnsupported(Volt.Contracts.Vendors.TwincatDisplay, n);
        TcUnmeasured.RefuseUnbuilt(n);
        foreach (var (box, output) in NetworkPairing.NamedMainOutputs(n))
            throw new NotSupportedException(
                $"TwinCAT: network {n.Order + 1}'s '{box.Type}' box is read through its output '{output}', which neither the " +
                $"project's declarations nor the libraries' signatures name an output of '{box.Type}', so the slot the " +
                "consumer reads is unknown. The IDE can draw it.");
        var id = Next();
        var items = n.Trees.Select(t => Node(t, consumed: false)).ToList();
        return new XElement("o",
            Raw("ILActive", "false"),
            Raw("FBDValid", "false"),
            Raw("ILValid", "false"),
            List("ILLines", Array.Empty<(string, XElement)>()),
            Str("Comment", n.Comment ?? ""),
            Str("Title", n.Title ?? ""),
            Str("Label", n.Label ?? ""),
            Raw("OutCommented", n.Disabled ? "true" : "false"),
            List("NetworkItems", items),
            List("Connectors", Array.Empty<(string, XElement)>()),
            Id(id));
    }

    // ── nodes ────────────────────────────────────────────────────────────────────────────────────

    /// <summary>A node as (its archive type, its object). The holder names it and types it.</summary>
    private (string Type, XElement Object) Node(Node n, bool consumed)
    {
        switch (n)
        {
            // A leaf's modifiers ride its OPERAND (DIALECT N4: BoxTreeOperand has no Flags member).
            case Leaf l:
            {
                var id = Next();
                var operand = Operand(l.Operand, Bits(Merge(l.Flags, l.Operand.Flags)), isInstance: false, fixedFlags: true);
                return ("BoxTreeOperand", new XElement("o", Member("Operand", "Operand", operand), Id(id)));
            }

            case Assign a:
            {
                UnheldFlags.RefuseOnAssignItem(Volt.Contracts.Vendors.TwincatDisplay, a.Flags);
                var value = Node(a.Value, consumed: true);
                // Coil storage is the TARGET's (Flags.VendorCoilBits); a jump or return bit rides the target AND the item,
                // as TwinCAT's own importer writes them (corpus Vn_jump_*, Vn_return_*).
                // A target that states its own control-flow bit keeps exactly its own (a rung driving a coil and a jump holds
                // the bit on the label only, drawn-refused-shapes.TcPOU); a text-read jump states it on the item alone.
                var perTarget = a.Targets.Any(t => t.Flags is { Jump: true } or { Return: true });
                var targets = a.Targets.Select(t =>
                {
                    var own = t.Flags ?? Flags.None;
                    var (negation, set) = own.VendorCoilBits();
                    var bits = Bits(Flags.None with
                    {
                        Negated = negation, Set = set,
                        Jump = perTarget ? own.Jump : a.Flags.Jump,
                        Return = perTarget ? own.Return : a.Flags.Return,
                    });
                    return ("Operand", Operand(t, bits, isInstance: false, fixedFlags: true));
                }).ToList();
                var id = Next();
                return ("BoxTreeAssign", new XElement("o",
                    Member("OutputItems", "OutputItemList", new XElement("o", List("OutputItems", targets))),
                    FlagsMember(Bits(Flags.None with { Jump = a.Flags.Jump, Return = a.Flags.Return }), fixedFlags: false),
                    Member("RValue", value.Type, value.Object),
                    Id(id)));
            }

            case Box b:
                return ("BoxTreeBox", Box(b, consumed));

            // A wire: with an Input it DEFINES the VarId, without one it REFERENCES it. The VarId is the model's, as
            // CODESYS writes it (ids are network-scoped there; TwinCAT's importer mints a random one, attempt 2 loaded with 1).
            case Demux d:
            {
                var id = Next();
                _maxVarId = Math.Max(_maxVarId, d.VarId);
                XElement input;
                if (d.Input is { } src)
                {
                    var built = Node(src, consumed: true);
                    input = Member("Input", built.Type, built.Object);
                }
                else input = Null("Input");
                return ("BoxTreeDemux", new XElement("o",
                    Raw("VarId", d.VarId.ToString(CultureInfo.InvariantCulture)), input, Id(id)));
            }

            // The empty terminator: nothing drives this (drawn-refused-shapes.TcPOU, the hand-drawn template).
            case Terminator t:
            {
                var id = Next();
                return ("BoxTreeTerminator", new XElement("o", Null("Input"), FlagsMember(Bits(t.Flags), fixedFlags: false), Id(id)));
            }

            case Parallel:
                throw Unbuildable(
                    "this network holds a parallel branch (`feed BRANCH (a, b)`), and TwinCAT has never been seen to write one: its own " +
                    "importer lowers parallel contacts to an OR box (the native corpus, Vn_ld_parallel*), and the editor cannot " +
                    "be driven to draw one, so there is no TwinCAT-written BoxTreeParallel to build it from. Draw it in the IDE.");

            default:
                throw new NotSupportedException($"TwinCAT: no archive form for the graphical node '{n.GetType().Name}'.");
        }
    }

    private XElement Box(Box b, bool consumed)
    {
        if (b.Kind == CallKind.FunctionBlock && b.Instance is null)
            throw new InvalidOperationException(
                $"network model invariant: the function-block call '{b.Type}' carries no instance; the reader builds every FB call with one.");
        if (b.Inputs.FirstOrDefault(p => !p.Flags.IsNone) is { } flagged)
            throw Unbuildable(
                $"the '{b.Type}' box carries a modifier on its input pin {flagged.Formal ?? "(positional)"}, which " +
                "TwinCAT keeps in the box's InputFlags — a member this vendor's reader cannot read back (TcNetworkReader " +
                "refuses a populated InputFlags), so the next pull could not show it. Put the modifier on what feeds the pin.");
        // THE CALL TYPE OF A FUNCTION OR METHOD CALL, from the callee's declaration (ld-fbd-coverage 2R.4, B7 D) — what
        // CODESYS's writer gives the same box (one NWL model, DIALECT N1): measured there, a FUNCTION's box compiles only
        // with `Function` and its input names (the push's gate derived those, NetworkDerivation.Derive), a METHOD's only
        // with `Method` (DIALECT N40). Any other call keeps what TwinCAT's own import stored for it (CallTypeOf).
        var callee = b.Instance is null && b.StCode is null ? _scope.Callee(b.Type) : null;
        var callType = callee?.CallType ?? CallTypeOf(b);

        // The box's instance operand first, then the box (the importer's order).
        var instance = b.Instance is { } inst
            ? Operand(inst, Bits(inst.Flags), isInstance: true, fixedFlags: false)
            : Operand(null, 0, isInstance: true, fixedFlags: false);
        var id = Next();

        // OUTPUTS — the names and stored types are the engine's derivation (a box read from text states no member, B7;
        // a FUNCTION's drawn list below), and the slots are laid out from them as CODESYS lays them out: the main output null, each pin in the
        // slot its name holds, any other slot an empty operand.
        // AN ENABLED BIT OPERATOR (AND/OR/XOR/NOT with EN) IS NOT BUILT. The text's derivation gives it one output, its
        // ENO (a bit operator stores no result slot, census 1.6), and TwinCAT does not compile that box: measured live
        // 2026-10-16 (`a AND b EN go` then `out := ENO;`, native-writer.test.ts) — stored, reloaded and pulled back as
        // pushed, and the build answered "Identifier '__<POU>__ImpVar4' not defined". The box TwinCAT's editor draws holds
        // a result slot beside the ENO (fbd.TcPOU: Names [ENO, ''], Types [BOOL, BOOL]), which the text has no position
        // for.
        var eno = NetworkText.HasEnoOutput(b, consumed);
        var (names, types) = NetworkMembers.Buildable(b, new BoxSite(consumed));
        // A FUNCTION's whole output list, as the editor draws it and CODESYS's writer builds it (2R.4): its result pin
        // '   ' (or the ENO echo) and every VAR_OUTPUT, wired or not.
        if (callee is not null && NetworkDerivation.OutputNames(b, callee, eno) is { } drawn)
        {
            names = drawn;
            types = drawn.Select(n => n == Volt.Engine.Format.Network.Box.EnoPin ? "BOOL" : "").ToList();
        }
        if (b.Enable is not null && NetworkText.IsBitOperator(b.Type) && !names.Contains(""))
            throw Unbuildable(
                $"the '{b.Type}' box has an EN pin, and TwinCAT does not compile an enabled {b.Type} built with only its ENO " +
                "output (measured: \"__ImpVar not defined\"); the box its editor draws keeps a result slot the text has no " +
                "position for. Draw it in the IDE, or feed the rung into the box as an input.");
        var slots = OutputSlots(b, eno, names);
        // AN OPERATOR READ THROUGH ITS ENO WITH ITS RESULT WIRED NOWHERE holds null in the result slot, not an empty
        // operand: TwinCAT compiles an empty operand on an operator's result as an assignment to nothing — measured live
        // 2026-10-16, `MOVE b EN go` then `out := ENO;` built "Assignment target not specified" (CODESYS's N21 finding, on
        // this vendor). The reader reads such a box through its ENO and skips a null slot, so the text is unchanged.
        if (eno && b.Instance is null && b.StCode is null)
            for (var i = 0; i < slots.Count && i < names.Count; i++)
                if (names[i].Length == 0 && slots[i] is { Text.Length: 0 }) slots[i] = null;
        // THE CONSUMER'S SLOT IS THE ONE NULL OUTPUT ITEM — the archive stores no MainOutputIndex (TcNetworkReader.
        // ConnectedSlot). A consumed call whose text names its pins but not its result (`out := t1(…, ET => el)`) lays its
        // slots out from those names alone, so no item is null and the next pull could not say what `out` reads.
        if (consumed && !eno && !NetworkText.IsBitOperator(b.Type) && slots.Count > 0 && slots.Count(s => s is null) != 1)
            throw Unbuildable(
                $"the '{b.Type}' box is read by its consumer and wires output pins by name, and the text does not say " +
                "which of the box's outputs the consumer reads (its output list holds only the named pins) — the archive " +
                "would hold no slot for it. Assign the result in its own network (`t1(…, ET => el); out := t1.Q;`).");
        var outputItems = slots.Select(s => s is null
            ? ("", Null(null))
            // Every output slot is an l-value, wired or not, as the drawn box stores it (2.3 D: true exactly for an assign
            // target or a box output slot; POUexecute's TON stores it on its unwired ET slot too).
            : ("Operand", Operand(s with { IsLValue = true }, Bits(s.Flags), isInstance: false, fixedFlags: true))).ToList();

        // INPUTS — the enable is slot 0, named EN; an unwired pin is the empty operand TwinCAT's importer writes for one
        // (Vn_ton_unwired), which the reader reads as the empty terminator.
        var pins = new List<Node>();
        if (b.Enable is { } en) pins.Add(en);
        pins.AddRange(b.Inputs.Select(p => p.Value));
        var inputs = pins.Select(p => p is Terminator { Flags.IsNone: true }
            ? ("BoxTreeOperand", Unwired())
            : Node(p, consumed: true)).ToList();

        var inNames = new List<string>();
        if (b.Enable is not null || b.Inputs.Any(i => !string.IsNullOrEmpty(i.Formal)))
        {
            if (b.Enable is not null) inNames.Add(Volt.Engine.Format.Network.Box.EnablePin);
            inNames.AddRange(b.Inputs.Select(i => i.Formal ?? ""));
        }
        var inTypes = inNames.Select(_ => "").ToList();
        // An Execute box's EN pin is BOOL, as the drawn one stores it (execute-box.TcPOU).
        if (b.StCode is not null && b.Enable is not null) inTypes[0] = "BOOL";

        var outNames = names.ToList();
        var outTypes = Enumerable.Range(0, Math.Max(names.Count, types.Count)).Select(i => i < types.Count ? types[i] : "").ToList();
        while (outNames.Count < outTypes.Count) outNames.Add("");

        var shown = b.Enable is not null || b.StCode is not null;   // EN/ENO shown, as the drawn Execute box and an enabled box
        return new XElement("o",
            Str("BoxType", b.Type),
            Member("Instance", "Operand", instance),
            Member("OutputItems", "OutputItemList", new XElement("o", List("OutputItems", outputItems))),
            FlagsMember(Bits(b.Flags), fixedFlags: false),
            Null("InputFlags"),
            List("InputItems", inputs),
            Member("InputParam", "ParamList", Params(inNames, inTypes)),
            Member("OutputParam", "ParamList", Params(outNames, outTypes)),
            new XElement("v", new XAttribute("n", "CallType"), new XAttribute("t", "Operator"), callType),
            shown ? Raw("EN", "true") : Null("EN"),
            // ENO SHOWN ONLY WHERE THE BOX HAS ONE: an enabled comparison read as a value is built EN, no ENO, as
            // CODESYS builds it (2R.5 #26), and with ENO shown beside an output list holding none TwinCAT does not compile
            // it — measured live 2026-10-17, `x := a AND (v GT 40 EN c);` built "Identifier '__<POU>__ImpVar8' not
            // defined" (stored-shapes.test.ts).
            shown && (eno || b.StCode is not null) ? Raw("ENO", "true") : Null("ENO"),
            b.StCode is { } st ? Member("STSnippet", "STSnippet", Snippet(st)) : Null("STSnippet"),
            Raw("ContainsExtensibleInputs", "false"),
            Raw("ProvidesSTSnippet", b.StCode is not null ? "true" : "false"),
            Id(id));
    }

    /// <summary>The Execute box's ST, four objects deep as the drawn box holds it (execute-box.TcPOU): one
    /// <c>TextLine</c> per line, its text quoted.</summary>
    private XElement Snippet(string st)
    {
        var lines = st.Split('\n').Select(line => ("TextLine", new XElement("o",
            Id(Next()), Null("Tag"), Str("Text", line.TrimEnd('\r'))))).ToList();
        var doc = new XElement("o", new XElement("a", new XAttribute("n", "TextLines"), new XAttribute("cet", "TextLine"),
            lines.Select(l => l.Item2)));
        var impl = new XElement("o", Member("TextDocument", "TextDocument", doc));
        return new XElement("o", Member("STSnippet", "STImplementationObject", impl), Id(Next()));
    }

    /// <summary>An input pin wired to nothing: the empty operand (TwinCAT's importer's spelling, Vn_ton_unwired).</summary>
    private XElement Unwired()
    {
        var id = Next();
        return new XElement("o", Member("Operand", "Operand", Operand(new Operand(""), 0, isInstance: false, fixedFlags: true)), Id(id));
    }

    /// <summary>The output items as CODESYS lays them out (CodesysNetworkWriter.OutputSlots): one per name, the main
    /// output null, each wired pin in the slot its name (or its stated slot) holds, any other slot an empty operand.</summary>
    private static List<Operand?> OutputSlots(Box b, bool eno, IReadOnlyList<string> names)
    {
        var slots = new List<(bool Set, Operand? Value)>();
        void At(int at, Operand? value, string what)
        {
            while (slots.Count <= at) slots.Add((false, null));
            if (slots[at].Set)
                throw new NotSupportedException(
                    $"TwinCAT: the '{b.Type}' box wires output slot {at} to {what}, a slot " +
                    (eno && at == 0 ? "its ENO echo holds" : "another pin already holds") + ".");
            slots[at] = (true, value);
        }
        if (eno) At(0, null, "ENO");
        foreach (var o in b.Outputs)
        {
            int at;
            // The named ENO pin (P5, 2R.5 #23): the variable stored on the ENO slot, in place of its null — as
            // CodesysNetworkWriter.OutputSlots builds it.
            if (string.Equals(o.Formal, Volt.Engine.Format.Network.Box.EnoPin, StringComparison.OrdinalIgnoreCase))
            {
                if (!eno)
                    throw new InvalidOperationException(
                        $"network model invariant: the '{b.Type}' box wires its ENO to '{o.Value.Text}' and is built with no ENO output; the reader refuses that text (P5).");
                slots[0] = (true, o.Value);
                continue;
            }
            if (o.Formal is { } formal)
            {
                var named = Enumerable.Range(0, names.Count)
                    .Where(i => string.Equals(names[i], formal, StringComparison.OrdinalIgnoreCase) && (i >= slots.Count || !slots[i].Set))
                    .ToList();
                if (named.Count == 0)
                    throw new NotSupportedException(
                        $"TwinCAT: the '{b.Type}' box's output names ({string.Join(", ", names.Select(n => "'" + n + "'"))}) " +
                        $"hold no '{formal}' for the pin wired to '{o.Value.Text}'.");
                at = named[0];
            }
            else
                at = o.Slot ?? throw new InvalidOperationException(
                    $"network model invariant: the '{b.Type}' box's positional output to '{o.Value.Text}' has no slot.");
            At(at, o.Value, "'" + o.Value.Text + "'");
        }
        // THE CONNECTION IS THE NULL'S POSITION (v2-measurements #12): an FB's named output (`.name`, its slot derived from
        // the declaration) holds it, else slot 0.
        if (b.ConnectedSlot is { } connected && connected > 0) At(connected, null, "its consumer");
        while (slots.Count < names.Count) slots.Add((false, null));
        if (slots.Count > 0 && !slots[0].Set && !(b.ConnectedSlot is > 0)) slots[0] = (true, null);
        return slots.Select(s => s.Set ? s.Value : new Operand("")).ToList();
    }

    /// <summary>
    /// THE <c>CallType</c> TWINCAT STORES FOR A BOX — learned, not derived: what its own importer wrote for each box type in
    /// the native corpus (<c>TcArchiveBuilderTests</c> holds this table to it). An Execute box is <c>None</c> (the drawn one),
    /// an FB call <c>FunctionBlock</c>, a function POU or library function <c>Function</c>, a type conversion
    /// <c>Conversion</c>, and each IEC operator its own member, spelled as the vendor spells it (<c>ACos</c>, <c>SizeOf</c>).
    /// </summary>
    internal static readonly IReadOnlyDictionary<string, string> Operators = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["ABS"] = "Abs", ["ACOS"] = "ACos", ["ADD"] = "Add", ["ADR"] = "Adr", ["AND"] = "And", ["ASIN"] = "ASin",
        ["ATAN"] = "ATan", ["COS"] = "Cos", ["DIV"] = "Div", ["EQ"] = "Eq", ["EXP"] = "Exp", ["EXPT"] = "Expt", ["GE"] = "Ge",
        ["GT"] = "Gt", ["LE"] = "Le", ["LIMIT"] = "Limit", ["LN"] = "Ln", ["LOG"] = "Log", ["LT"] = "Lt", ["MAX"] = "Max",
        ["MIN"] = "Min", ["MOD"] = "Mod", ["MOVE"] = "Move", ["MUL"] = "Mul", ["MUX"] = "Mux", ["NE"] = "Ne", ["NOT"] = "Not",
        ["OR"] = "Or", ["ROL"] = "Rol", ["ROR"] = "Ror", ["SEL"] = "Sel", ["SHL"] = "Shl", ["SHR"] = "Shr", ["SIN"] = "Sin",
        ["SIZEOF"] = "SizeOf", ["SQRT"] = "Sqrt", ["SUB"] = "Sub", ["TAN"] = "Tan", ["TRUNC"] = "Trunc", ["XOR"] = "Xor",
    };

    private static readonly Regex Conversion = new(@"^([A-Za-z]+_)?TO_[A-Za-z]+$", RegexOptions.CultureInvariant);

    private static string CallTypeOf(Box b)
    {
        if (b.StCode is not null) return "None";
        if (b.Instance is not null) return "FunctionBlock";
        if (Operators.TryGetValue(b.Type, out var op)) return op;
        if (Conversion.IsMatch(b.Type)) return "Conversion";
        // Any other call the scope names no callee for (a project FUNCTION's and a METHOD's come from the callee, Box
        // above) is a function's: every non-operator, non-FB box TwinCAT's importer built stores `Function` — a
        // library function (CONCAT, LEN, LEFT) and a user one (F_Custom) alike, named positionally or by pin. (The
        // reader models that member as an operator, CallKinds.FromVendor, so the call kind cannot decide it here.)
        return "Function";
    }

    // ── operands and members ─────────────────────────────────────────────────────────────────────

    /// <summary>An <c>Operand</c> object, member for member as TwinCAT writes one. <paramref name="fixedFlags"/> is the
    /// flag set's <c>Fixed</c>: true on a pin's, a target's and an output's operand, false on a box's instance (corpus).</summary>
    private XElement Operand(Operand? o, int bits, bool isInstance, bool fixedFlags)
    {
        var id = Next();
        return new XElement("o",
            o is null ? Null("Operand") : Str("Operand", o.Text),
            Str("Type", o?.Type ?? ""),
            Str("Comment", ""),
            Str("SymbolComment", o?.Comment ?? ""),
            Str("Address", ""),
            FlagsMember(bits, fixedFlags),
            Raw("LValue", o?.IsLValue == true ? "true" : "false"),
            Raw("Boolean", "false"),
            Raw("IsInstance", isInstance || o?.IsInstance == true ? "true" : "false"),
            Id(id));
    }

    private static XElement Params(IReadOnlyList<string> names, IReadOnlyList<string> types) =>
        new("o",
            new XElement("l2", new XAttribute("n", "Names"), names.Count > 0 ? new XAttribute("cet", "String") : null,
                names.Select(n => new XElement("v", n))),
            new XElement("l2", new XAttribute("n", "Types"), types.Count > 0 ? new XAttribute("cet", "String") : null,
                types.Select(t => new XElement("v", t))));

    private static XElement FlagsMember(int bits, bool fixedFlags) =>
        Member("Flags", "Flags", new XElement("o",
            Raw("Flags", bits.ToString(CultureInfo.InvariantCulture)),
            Raw("Fixed", fixedFlags ? "true" : "false"),
            Raw("Extensible", "false")));

    private static Flags Merge(Flags a, Flags? b) =>
        b is not { } f ? a : new Flags(a.Negated || f.Negated, a.Set || f.Set, a.Reset || f.Reset, a.Jump || f.Jump,
                                       a.Return || f.Return, a.Rising || f.Rising, a.Falling || f.Falling);

    /// <summary>The vendor's <c>IFlags</c> bit-field (TcArchive's constants). A Reset is a coil kind, encoded on a target
    /// through <see cref="Flags.VendorCoilBits"/> before it gets here.</summary>
    private static int Bits(Flags? flags)
    {
        if (flags is not { } f || f.IsNone) return 0;
        if (f.Reset) throw new InvalidOperationException("TwinCAT: a RESET reached the generic flag write; it is a coil kind, encoded per target.");
        var bits = 0;
        if (f.Negated) bits |= TcArchive.FlagNegation;
        if (f.Set) bits |= TcArchive.FlagSet;
        if (f.Jump) bits |= TcArchive.FlagJump;
        if (f.Return) bits |= TcArchive.FlagReturn;
        if (f.Rising) bits |= TcArchive.FlagRtrig;
        if (f.Falling) bits |= TcArchive.FlagFtrig;
        return bits;
    }

    /// <summary>A shape the builder has no TwinCAT form for: <c>NETWORK_UNSUPPORTED</c>, the code every network the push
    /// cannot write is refused under, before anything is written.</summary>
    private static Volt.Engine.Format.Network.NetworkTextException Unbuildable(string what) =>
        new("TwinCAT: " + what, Volt.Contracts.ConflictCodes.NetworkUnsupported);

    // ── the archive's element vocabulary ─────────────────────────────────────────────────────────

    private static XElement Raw(string name, string raw) => new("v", new XAttribute("n", name), raw);

    /// <summary>A string member: the archive writes the value inside double quotes, verbatim.</summary>
    private static XElement Str(string name, string text) => Raw(name, "\"" + text + "\"");

    private static XElement Id(long id) => Raw("Id", id.ToString(CultureInfo.InvariantCulture) + "L");

    private static XElement Null(string? name) => name is null ? new XElement("n") : new XElement("n", new XAttribute("n", name));

    private static XElement Member(string name, string type, XElement obj)
    {
        var e = new XElement("o", new XAttribute("n", name), new XAttribute("t", type));
        e.Add(obj.Nodes());
        return e;
    }

    /// <summary>
    /// A list, TYPED AS TWINCAT TYPES ONE (measured on every list of every vendor archive, census 2026-10-16): empty is
    /// <c>&lt;l2 n="X" /&gt;</c> with no element type; when every object in it is one type the list states it once
    /// (<c>cet</c>) and no object repeats it, nulls (<c>&lt;n /&gt;</c>) included; a MIXED list states none and every
    /// object carries its own <c>t</c> — the rule attempt 1 broke (a <c>cet</c> on a mixed list), which TwinCAT stored
    /// and then could not load.
    /// </summary>
    private static XElement List(string name, IEnumerable<(string Type, XElement Object)> items)
    {
        var all = items.ToList();
        var types = all.Where(i => i.Object.Name.LocalName == "o").Select(i => i.Type).Distinct(StringComparer.Ordinal).ToList();
        var list = new XElement("l2", new XAttribute("n", name));
        if (types.Count == 1) list.SetAttributeValue("cet", types[0]);
        foreach (var (type, obj) in all)
        {
            if (obj.Name.LocalName == "o" && types.Count > 1) obj.SetAttributeValue("t", type);
            list.Add(obj);
        }
        return list;
    }
}
