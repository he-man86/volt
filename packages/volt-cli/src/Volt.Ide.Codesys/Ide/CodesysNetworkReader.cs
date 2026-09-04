using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.Network;
// `Parallel` is also System.Threading.Tasks.Parallel; this file means the LD branch.
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Ide.Codesys
{
    /// <summary>
    /// A CODESYS graphical body as a <see cref="NetworkBody"/> — read from the LIVE typed objects, with no
    /// serialization anywhere in the path.
    ///
    /// <para>The dispatch below is not a guess at a vendor format: it is the vendor's own
    /// <c>IBoxTreeVisitor</c> closed set (<c>VisitOperand</c> / <c>VisitBox</c> / <c>VisitAssign</c>) plus the
    /// three LD structures, and every arm was measured against a real ladder project
    /// (<c>nwl-object-model.md</c>, 36 POUs / 356 networks / 773 trees).</para>
    /// </summary>
    internal static class CodesysNetworkReader
    {
        /// <summary>Read the whole body. <paramref name="impl"/> is the item's <c>Implementation</c> aspect,
        /// already known to be an <c>NWLImplementationObject</c>.</summary>
        public static NetworkBody Read(object impl, BodyLanguage language)
        {
            var networks = new List<Network>();
            var list = NwlInterop.Items(NwlInterop.Require(impl, "NetworkList"), listMember: "");
            for (int i = 0; i < list.Count; i++) networks.Add(ReadNetwork(list[i], i));
            return new NetworkBody(language, networks);
        }

        /// <summary>One live network, read back into the model. INTERNAL rather than private because the WRITER
        /// needs it: its change gate renders the live network and compares, and it must compare through exactly
        /// the reader a pull would use — a second, nearly-identical read here is how the two would drift.</summary>
        internal static Network ReadNetwork(object net, int order)
        {
            var trees = new List<Node>();
            var count = NwlInterop.RequireInt(net, "NetworkItemCount");
            for (int i = 0; i < count; i++)
            {
                // NetworkItemCount can EXCEED the number of real trees — measured: a network reported 2 with
                // one tree, the second slot being an item the IDE had dropped. A null here is normal, not a
                // failure, and must be skipped rather than treated as an empty body.
                        if (Tree(NwlInterop.TryCall(net, "GetTree", i)) is { } tree) trees.Add(ReadNode(tree));
            }

            // The vendor's own per-network SPLIT-POINT list, which is NOT fan-out - fan-out is `Demux`, and
            // this list measured ZERO across all 356 networks of the one real project surveyed. Volt has no
            // text form for it, so a body that does carry one is REFUSED rather than silently rendered without
            // it. (It had a field on the model for a while, which then collided with the text reader's own
            // fan-out encoding and produced two incompatible spellings of the same idea; the model now carries
            // exactly one, the vendor's.)
            if (NwlInterop.TryCall(net, "GetSplitPoint", 0) is { } sp)
                throw new NotSupportedException(
                    $"CODESYS: network {order} carries a vendor split point ('{ReadOperand(sp).Text}'), which " +
                    "network text has no form for. Volt refuses to materialize a body it cannot represent " +
                    "rather than render one silently missing it.");

            return new Network(
                order,
                Clean(NwlInterop.Text(net, "Title")),
                Clean(NwlInterop.Text(net, "Label")),
                Clean(NwlInterop.Text(net, "Comment")),
                NwlInterop.Flag(net, "OutCommented"),
                trees);
        }

        /// <summary>The value if it is really an NWL TREE NODE, else null — because "not wired" does not come
        /// back as null on this vendor.
        ///
        /// <para><b>An unwired EN pin reads as <c>System.Boolean false</c>, not null.</b> Measured on an
        /// IDE-authored ladder: a plain <c>AND</c> box reports <c>En = False</c>. The reader took any non-null
        /// <c>En</c> as a wired enable and handed it to <see cref="ReadNode"/>, which dispatches on the type name,
        /// found <c>Boolean</c>, and threw "the graphical item 'Boolean' has no network-text form yet".</para>
        ///
        /// <para>The cost of that was far past a missing enable: the throw makes the BODY unreadable, and an
        /// unreadable body makes the whole item UNREADABLE, so <c>FetchService</c> skipped it — the POU vanished
        /// from the workspace entirely, with no error at the wire and no file in git. It reached a user before a
        /// test did because every fixture body Volt had was one Volt itself created, and those carry a null
        /// <c>En</c>; only a body an ENGINEER drew in the IDE has the boolean.</para>
        ///
        /// <para>Applied to every node-valued member, not just <c>En</c>: they are read the same way and there is
        /// no reason to believe the vendor is consistent about which of them answers <c>false</c>.</para></summary>
        private static object? Tree(object? o) =>
            o is not null && NwlInterop.TypeName(o).StartsWith("BoxTree", StringComparison.Ordinal) ? o : null;

        private static Node ReadNode(object n)
        {
            var flags = ReadFlags(NwlInterop.Get(n, "Flags"));
            switch (NwlInterop.TypeName(n))
            {
                // A CONTACT'S MODIFIERS LIVE ON ITS OPERAND, not on the item holding it. DIALECT N4 measured the
                // vendor shape — `BoxTreeOperand carries Operand, Id and NO Flags` — so taking `flags` from the
                // ITEM always yielded None here, and a negated contact reached the workspace as a PLAIN one:
                // the wrong logic, committed to git, with nothing downstream to show it. TwinCAT's reader has
                // always used the operand's; this is the same fact through the other vendor's spelling.
                case "BoxTreeOperand":
                {
                    var operand = ReadOperand(NwlInterop.Require(n, "Operand"));
                    return new Leaf(operand, operand.Flags ?? flags);
                }

                case "BoxTreeAssign":
                {
                    var targets = NwlInterop.RequireItems(n, "Outputs").Select(ReadTarget).ToList();
                    var value = Tree(NwlInterop.Get(n, "RValue")) is { } rv ? ReadNode(rv) : null;

                    // COIL STORAGE STAYS ON THE TARGET, where both vendors keep it, because the FORMAT now
                    // spells it there too — `out S= v;` / `out R= v;`, ExST's own assignment operators. It used
                    // to be moved onto the VALUE (`out := v SET;`) and moved back on write, which needed a
                    // whole translation layer (`CoilStorage`, deleted) whose own doc comments record the two
                    // bugs it existed to paper over. A modifier that belongs to the coil now lives on the coil.
                    // CONTROL FLOW IS READ OFF THE TARGET OPERAND, for the same reason storage is: that is
                    // where this vendor keeps it. Reading it from the ITEM only ever worked for jumps VOLT
                    // had written, because Volt was the only thing that put it there — a jump an engineer
                    // drew in the IDE has the bit on the operand alone, and came back as a plain coil
                    // assigning to the label, silently turning their control flow into an assignment.
                    // JUMP AND RETURN TOGETHER, in one call both drivers share: this was fixed for `Jump`
                    // alone, and `Return` sits in the same bit-field on the same operand, so a RETURN coil
                    // kept the bug for another release. See `Flags.WithControlFlowFrom`.
                    return new Assign(value, targets, flags.WithControlFlowFrom(targets));
                }

                case "BoxTreeBox":
                    return ReadBox(n, flags);

                // Fan-out. With an Input this DEFINES the wire; without one it REFERENCES the definition
                // carrying the same VarId. 573 of these in the surveyed project, against zero split points.
                case "BoxTreeDemux":
                    return new Demux(
                        NwlInterop.RequireInt(n, "VarId"),
                        Tree(NwlInterop.Get(n, "Input")) is { } di ? ReadNode(di) : null,
                        flags);

                case "BoxTreeParallel":
                    return new Parallel(
                        Tree(NwlInterop.Get(n, "Input")) is { } pi ? ReadNode(pi) : null,
                        NwlInterop.RequireItems(n, "Trees", listMember: "").Select(ReadNode).ToList(),
                        flags);

                case "BoxTreeTerminator":
                    return new Terminator(
                        Tree(NwlInterop.Get(n, "Input")) is { } ti ? ReadNode(ti) : null,
                        flags);

                default:
                    // BoxTreeMux is the known member of this set and was unused in the surveyed project, so it
                    // has no measured shape and no network-text spelling. Refusing is the only honest answer:
                    // rendering it as anything else would put logic in the workspace that is not in the IDE.
                    throw new NotSupportedException(
                        $"CODESYS: the graphical item '{NwlInterop.TypeName(n)}' has no network-text form yet. " +
                        "Volt refuses to materialize a body it cannot represent, rather than rendering an " +
                        "approximation an engineer would then push back.");
            }
        }

        /// <summary>The <c>Names</c> array of an <c>IParamList</c>, or empty when there is none.</summary>
        private static List<string?> Names(object? paramList)
        {
            if (paramList == null) return new List<string?>();
            if (NwlInterop.Get(paramList, "Names") is not System.Collections.IEnumerable names)
                return new List<string?>();
            return names.Cast<object?>().Select(x => x?.ToString()).ToList();
        }

        private static Box ReadBox(object n, Flags flags)
        {
            var items = NwlInterop.RequireItems(n, "InputItemList", listMember: "").ToList();

            // Formal pin names, where the vendor supplies them. Operator boxes are positional; an FB call names
            // its pins, and network text needs those names to write `inst(IN := x, PT := y)`.
            //
            // READ OFF `Names`, NOT by enumerating objects. `InputParams` is an `IParamList`, whose whole surface
            // is two STRING ARRAYS - `Names` and `Types` - plus AppendParam/InsertParam/RemoveParam/SetType.
            // This asked `Items(...)` for a `List` of objects each carrying a `Name`, which an IParamList has
            // never had: the lookup found nothing, `formals` came back EMPTY every time, and a count guard
            // then quietly left every pin unnamed. So an FB call pulled as `t1( := a,  := pt)` - text that
            // does not parse, which means such a POU could be pulled and never pushed back.
            var formals = Names(NwlInterop.Get(n, "InputParams"));

            // THE ENABLE IS INPUT SLOT 0, not the `En` member. `Box.HasEnableSlot` holds the measurement and
            // what reading it as a data pin cost; here it is two lines, and they must run BEFORE the pins are
            // paired with their names so the remaining slots line up with the remaining names.
            Node? enable = null;
            if (Box.HasEnableSlot(formals) && items.Count > 0)
            {
                enable = ReadNode(items[0]);
                items.RemoveAt(0);
                formals.RemoveAt(0);
            }

            // INDEX-ALIGNED, never length-equal: `Names` may be shorter than the item list (see Box.FormalAt).
            var inputs = items
                .Select((x, i) => new Input(Clean(Box.FormalAt(formals, i)), ReadNode(x), Flags.None))
                .ToList();

            // AN INSTANCE THAT NAMES NOTHING IS NOT AN INSTANCE. The member is PRESENT on every box —
            // the serializer writes `<o n="Instance" t="Operand">` with an empty `Operand` inside on every
            // plain AND/OR in every fixture — so testing presence made a default-constructed Operand("")
            // look like a function-block call. For an operator that is harmless (the writer renders it from
            // the box type), but a stateless FUNCTION box — MAX, SEL, LIMIT, MOVE, any user FUNCTION —
            // misses the operator table and renders as `( := a, := b)`: no callee, unparseable, pulled and
            // never pushable. TwinCAT tests the inner scalar for exactly this reason, with the same
            // failure recorded; this is that guard through the live spelling.
            var instanceObj = NwlInterop.Get(n, "Instance");
            var instance = instanceObj != null && !string.IsNullOrEmpty(NwlInterop.Text(instanceObj, "OperandExpr"))
                ? ReadOperand(instanceObj)
                : null;

            return new Box(
                NwlInterop.Text(n, "BoxType") ?? "",
                instance,
                ReadCallKind(NwlInterop.Get(n, "CallType"), instance),
                inputs,
                ReadBoxOutputs(n),
                // From INPUT SLOT 0 (above), never from `En` and never from `EnEno`. `EnEno` is a CAPABILITY
                // marker, true on every box in a real project including every plain AND and OR, so keying on it
                // would wrap the whole project in `IF en THEN … END_IF`. `En` is the "EN/ENO is shown" flag —
                // a Boolean on 468 boxes, null on 814, a tree on none. Reading the enable from it therefore
                // never produced one, which is why this used to read `Tree(Get(n, "En"))` and always answer
                // null: dead code that read as a guarantee.
                enable,
                ReadStCode(n),
                flags);
        }

        /// <summary>A CODESYS Execute box: a box whose call is raw ST, carried on the box itself.</summary>
        private static string? ReadStCode(object n)
        {
            if (!NwlInterop.Flag(n, "ProvidesSTSnippet")) return null;
            var snippet = NwlInterop.Get(n, "STSnippet");
            if (snippet == null) return null;
            var impl = NwlInterop.Get(snippet, "Snippet") ?? snippet;
            return CodesysObjectModel.ReadAspectText(impl, "Implementation") is { Length: > 0 } t ? t : null;
        }

        private static Operand ReadOperand(object o) =>
            new Operand(
                NwlInterop.Text(o, "OperandExpr") ?? "",
                Clean(NwlInterop.Text(o, "Type")),
                CleanOperandField(NwlInterop.Text(o, "SymbolComment")),
                NwlInterop.Flag(o, "IsInstance"),
                NwlInterop.Flag(o, "IsLValue"),
                ReadFlags(NwlInterop.Get(o, "Flags")));

        /// <summary>A box's OUTPUT PINS — the ones actually wired to something.
        ///
        /// <para>The vendor's <c>OutputParams.Names</c> is index-aligned with <c>Outputs</c>, exactly like the
        /// input side, and slot 0 is the <c>ENO</c> ECHO when the vendor names it so (<c>Box.HasEnoSlot</c>).
        /// Measured across 373 networks: the ENO slot is null in every case — the rung's continuation is the
        /// enclosing <c>Assign</c>, not a variable — so it carries nothing and is dropped here rather than
        /// pretending to be a data pin.</para>
        ///
        /// <para><b>An UNWIRED pin is an EMPTY OPERAND, not a null.</b> A resolved FB box carries one slot per
        /// declared output whether or not the engineer wired it — 29 empty slots on one 30-pin box — so the
        /// non-empty ones are the connections, and emitting the rest would fabricate assignments to nothing.
        /// Nulls occur too (the ENO slot), so both are skipped.</para></summary>
        private static List<Output> ReadBoxOutputs(object n)
        {
            // RAW, nulls and all. `NwlInterop.Items` drops nulls — right for a list read for its CONTENT, and
            // wrong here, because the ENO slot IS a null and dropping it shifts every later slot one place
            // against `OutputParams.Names`. The pin names would then belong to the wrong pins.
            var holder = NwlInterop.Require(n, "Outputs");
            var slots = (NwlInterop.Get(holder, "List") as IEnumerable)?.Cast<object?>().ToList()
                        ?? new List<object?>();
            var names = Names(NwlInterop.Get(n, "OutputParams"));
            var eno = Box.HasEnoSlot(names) ? 1 : 0;

            var outputs = new List<Output>();
            for (var i = eno; i < slots.Count; i++)
            {
                if (slots[i] is not { } slot) continue;
                var operand = ReadOperand(slot);
                if (operand.Text.Length == 0) continue;
                outputs.Add(new Output(Clean(Box.FormalAt(names, i)), operand));
            }
            return outputs;
        }

        /// <summary>An assignment TARGET — an operand whose <c>Negation</c>/<c>Set</c> bits spell a COIL KIND
        /// rather than two independent modifiers. <see cref="Flags.CoilFromVendor"/> holds the measured
        /// mapping; reading a target through <see cref="ReadOperand"/> instead is what made every reset coil
        /// in a project read as a negated SET coil, and materialize as a plain <c>SET</c>.</summary>
        private static Operand ReadTarget(object o)
        {
            var op = ReadOperand(o);
            var f = NwlInterop.Get(o, "Flags");
            var coil = Flags.CoilFromVendor(NwlInterop.Flag(f, "Negation"), NwlInterop.Flag(f, "Set"));
            return op with
            {
                Flags = (op.Flags ?? Flags.None) with { Negated = coil.Negated, Set = coil.Set, Reset = coil.Reset },
            };
        }

        /// <summary>The vendor bit-field, read by NAME rather than by bit position.
        ///
        /// <para><see cref="Flags.Reset"/> is left false here ON PURPOSE: this reads an item or a CONTACT,
        /// where <c>Negation</c> means negation. Only an assignment TARGET spells a coil kind with those bits,
        /// and only <see cref="ReadTarget"/> decodes them.</para></summary>
        private static Flags ReadFlags(object? f) =>
            f == null
                ? Flags.None
                : new Flags(
                    Negated: NwlInterop.Flag(f, "Negation"),
                    Set: NwlInterop.Flag(f, "Set"),
                    Reset: false,          // see ReadTarget — a coil kind is decoded, never read bit-for-bit
                    Jump: NwlInterop.Flag(f, "Jump"),
                    Return: NwlInterop.Flag(f, "Return"),
                    Rising: NwlInterop.Flag(f, "Rtrig"),
                    Falling: NwlInterop.Flag(f, "Ftrig"));

        private static CallKind ReadCallKind(object? callType, Operand? instance)
        {
            // The vendor derives CallType itself from the box's type name (measured: setting BoxType="AND"
            // produced CallType=Operator.And unasked), so it is read, never computed. `None` on a box with an
            // instance is a function-block call.
            var name = callType?.ToString();
            if (!string.IsNullOrEmpty(name) && !string.Equals(name, "None", StringComparison.OrdinalIgnoreCase))
                return CallKind.Operator;
            return instance is null ? CallKind.Function : CallKind.FunctionBlock;
        }


        /// <summary>Empty and the vendor's serialization placeholders both mean "not set".
        /// <para>A freshly constructed operand reports <c>Address='Constant_Address_Serialization_Value'</c> and
        /// <c>SymbolComment='Constant_SymbolComment_Serialization_Value'</c> — sentinels of the archive layer,
        /// not values. Carrying one into the workspace would write a vendor internal into an engineer's file.</para></summary>
        ///
        /// <para><b>Trailing whitespace goes too, and that is not cosmetic.</b> CODESYS stores a network title
        /// as the engineer typed it, INCLUDING the newline that ended it - measured on a user's project, the
        /// title came back as "testlabel" followed by CR LF. Network text puts the title in a QUOTED STRING on
        /// the header line, so an untrimmed title emitted a quote that SPANNED TWO LINES: not parseable network
        /// text, which means such a POU could be pulled and never pushed back. The same trailing newline turned
        /// a one-line network comment into that comment plus an empty <c>//</c> line.</para>
        ///
        /// <para>The vendor keeps its own bytes: the writers compare with trailing whitespace ignored, so a push
        /// that changed nothing still writes nothing.</para></summary>
        private static string? Clean(string? s) =>
            string.IsNullOrEmpty(s) ? null : (s!.TrimEnd() is { Length: > 0 } t ? t : null);

        /// <summary>As <see cref="Clean"/>, and additionally drops the archive layer's placeholder.
        ///
        /// <para><b>Applied to the member the sentinels were MEASURED on, and to nothing else.</b> The test used
        /// to live in <see cref="Clean"/> itself, which is applied to a network's Title, Label and Comment and to
        /// an operand's Type and formal parameter name as well — so ANY of those beginning with
        /// <c>Constant_</c> was erased. An engineer's network titled <c>Constant_Torque</c> read back as null,
        /// and <c>SetIfChanged(net, "Title", model.Title ?? "")</c> then wrote <c>""</c> into the live project:
        /// a title deleted from the IDE by a pull, with nothing in git to show it. The documented evidence names
        /// exactly two sentinels (<c>Constant_Address_Serialization_Value</c>,
        /// <c>Constant_SymbolComment_Serialization_Value</c>) and both are OPERAND members, so a network title
        /// was never in scope.</para>
        ///
        /// <para>Still a PREFIX test rather than the two exact strings: the placeholders are generated per member
        /// by the archive layer, so a third would follow the same shape and matching whole strings would let it
        /// through into an engineer's file. The narrowing that matters is WHICH members are tested.</para></summary>
        private static string? CleanOperandField(string? s) =>
            s != null && s.StartsWith("Constant_", StringComparison.Ordinal) ? null : Clean(s);
    }
}
