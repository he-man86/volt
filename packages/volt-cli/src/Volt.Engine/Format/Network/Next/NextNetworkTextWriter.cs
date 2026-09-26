using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Volt.Engine.Format.Body;

namespace Volt.Engine.Format.Network.Next;

/// <summary>
/// Network text v2: renders a <see cref="NetworkBody"/> as a literal transcript of the vendor's network model —
/// one statement per top-level NWL item, every owned subtree nested where the vendor holds it, and a name only
/// where the vendor names something (a <see cref="Demux"/>'s VarId). Specified by
/// <c>docs/network-text-next.html</c> and <c>openspec/changes/network-text-literal-nwl</c>; built BESIDE the v1
/// <see cref="NetworkTextWriter"/>, which keeps serving every caller until the swap.
///
/// <para><b>One fold, one arm per model node class.</b> There is no hoisting, no minted name, no use count and no
/// pass over the produced text: each arm decides its spelling from the node in hand. The per-network state is the
/// VarId→name map (fixed before the fold, so a rename can never depend on the order things are rendered in) and
/// the set of wires already defined, which is what lets a reference stored before its definition be refused
/// instead of silently reordered.</para>
///
/// <para><b>A fact with no spelling throws <see cref="UnrepresentableBodyException"/>, naming it.</b> That is the
/// one exception this writer raises, and the pull path turns it into the body marker — the POU still appears and
/// says what it holds. Dropping the fact instead would write a different machine into the engineer's file, and
/// the text round trip could never notice: a fact absent from the text is absent from both sides of it.</para>
/// </summary>
public static class NextNetworkTextWriter
{
    /// <summary>Render <paramref name="body"/>.</summary>
    /// <param name="namesInScope">Every name visible to the body besides its own operands — the POU's variables,
    /// globals, the owning FB's members seen from a method or action. REQUIRED rather than defaulted: a wire named
    /// like one of them would read back as that variable (or refuse the push), so a caller that does not know the
    /// scope must say so by passing an empty set, not by leaving it out.</param>
    public static string Write(NetworkBody body, IEnumerable<string> namesInScope)
    {
        if (body is null) throw new ArgumentNullException(nameof(body));
        if (namesInScope is null) throw new ArgumentNullException(nameof(namesInScope));

        var sb = new StringBuilder();
        // The body's language rides on its one implementation marker (spec: "the body language and the v1
        // refusal"). v1 printed it on every network header, which invited a per-network edit nothing applied.
        sb.Append("(* @volt-implementation ").Append(body.Language == BodyLanguage.Ld ? "LD" : "FBD").Append(" *)\n");

        var scope = new HashSet<string>(namesInScope, StringComparer.OrdinalIgnoreCase);
        foreach (var net in body.Networks) new Emitter(net, body.Language, scope).Emit(sb);
        return sb.ToString();
    }

    private sealed class Emitter
    {
        private readonly Network _net;
        private readonly BodyLanguage _lang;

        // VarId → the wire's written name. Decided once, before any statement is rendered.
        private readonly Dictionary<int, string> _names = new();

        // Wires whose definition has been written, with the type read off each producer. A reference to a wire
        // not in here is a reference stored before its definition — the vendor's order, which is never changed.
        private readonly Dictionary<int, string> _defined = new();
        private readonly List<int> _definitionOrder = new();

        public Emitter(Network net, BodyLanguage lang, HashSet<string> scope)
        {
            _net = net;
            _lang = lang;

            // THE RESERVED SET: every name in scope plus every identifier this network spells, compared
            // case-insensitively, because IEC identifiers are. A wire `g3` beside a variable `G3` is the same
            // name to the compiler and to the reader.
            var reserved = new HashSet<string>(scope, StringComparer.OrdinalIgnoreCase);
            var ids = new List<int>();
            foreach (var t in net.Trees) Collect(t, reserved, ids);

            // g<VarId> whenever it is free — the wire keeps the vendor's id across a round trip (C9). A taken one
            // is renamed to the lowest free g<n>, and the push then writes VarId n. Defaults are placed FIRST so a
            // rename can never land on a name another wire was going to keep.
            var taken = new HashSet<string>(reserved, StringComparer.OrdinalIgnoreCase);
            foreach (var id in ids.Distinct())
            {
                if (id < 0)
                    throw Unrepresentable("a wire with a negative VarId",
                        $"a Demux carries VarId {id}, and a wire is spelled g<digits>.");
                if (!reserved.Contains("g" + id)) { _names[id] = "g" + id; taken.Add("g" + id); }
            }
            foreach (var id in ids.Distinct())
            {
                if (_names.ContainsKey(id)) continue;
                var n = 0;
                while (taken.Contains("g" + n)) n++;
                _names[id] = "g" + n;
                taken.Add("g" + n);
            }
        }

        public void Emit(StringBuilder sb)
        {
            // Statements first, into their own buffer: the VAR_TEMP block that precedes them lists the types read
            // off each definition's producer, which are known once the definitions are rendered. This is ordering
            // the output, not a pass over it — no statement is revisited.
            var statements = new List<string>();
            foreach (var tree in _net.Trees) statements.Add(Statement(tree));

            sb.Append(Header()).Append('\n');

            if (_net.Comment is { } comment)
                foreach (var line in comment.Replace("\r", "").Split('\n'))
                    // `//` and ONE space are syntax; everything after them is text, leading indentation and a
                    // leading `//` included. An empty line is `//` alone, so a trailing space means nothing.
                    sb.Append("  //").Append(line.Length == 0 ? "" : " " + line).Append('\n');

            if (_definitionOrder.Count > 0)
            {
                // One line, one declaration per type in the order the types first appear, wires in vendor
                // order within it: `VAR_TEMP g22, g23 : BOOL; END_VAR`.
                sb.Append("  VAR_TEMP");
                foreach (var type in _definitionOrder.Select(id => _defined[id]).Distinct(StringComparer.Ordinal))
                    sb.Append(' ')
                      .Append(string.Join(", ", _definitionOrder.Where(id => _defined[id] == type).Select(id => _names[id])))
                      .Append(" : ").Append(type).Append(';');
                sb.Append(" END_VAR\n");
            }

            foreach (var s in statements) sb.Append(s).Append('\n');
            sb.Append("END_NETWORK\n");
        }

        private string Header()
        {
            var h = new StringBuilder("NETWORK");
            if (_net.Label is { } label)
            {
                if (!NextSpelling.Identifier.IsMatch(label))
                    throw Unrepresentable("a label that is not an identifier",
                        $"network {_net.Order} carries the label '{label}', and a LABEL is one identifier.");
                h.Append(" LABEL: ").Append(label);
            }
            if (_net.Title is { } title) h.Append(" TITLE: ").Append(Quote(title));
            if (_net.Disabled) h.Append(" DISABLED");
            return h.ToString();
        }

        /// <summary>The TITLE string, with ST's own string escapes: <c>$N</c> newline, <c>$R</c> carriage return,
        /// <c>$"</c> a quote, <c>$$</c> the dollar itself. Owner decision 2026-09-26: 7 Lenze titles hold a
        /// newline, so a title needs a spelling for it — the marker would lose seven networks' text for a
        /// character. The header ends at its newline, so a raw one cannot stay.</summary>
        private static string Quote(string s)
        {
            var q = new StringBuilder("\"");
            foreach (var c in s)
                q.Append(c switch { '$' => "$$", '"' => "$\"", '\n' => "$N", '\r' => "$R", _ => c.ToString() });
            return q.Append('"').ToString();
        }

        // ── statements: one per top-level item ──────────────────────────────────────────────────────

        private string Statement(Node n)
        {
            switch (n)
            {
                case Assign a when a.Flags.Jump || a.Flags.Return ||
                                   a.Targets.Any(t => t.Flags is { } f && (f.Jump || f.Return)):
                    return "  " + ControlFlow(a) + ";";

                case Assign a:
                {
                    RefuseItemFlags(a.Flags, "an Assign item");
                    if (a.Targets.Count == 0)
                        // `value;` is the item with no target — a box, leaf, wire or PARALLEL standing alone. An
                        // Assign with an empty target list would write the same text and read back as its value.
                        throw Unrepresentable("an assign with no target",
                            "an Assign item drives no target, and `value;` spells the value item itself.");
                    if (a.Value is null)
                        // Census 1.2: the vendor spells "unconnected" Terminator(null) (3) and never a null RValue
                        // (0). A null here is not a vendor shape, and `coil := ;` already belongs to the other.
                        throw Unrepresentable("an assign with a null value",
                            "an Assign item has a null value; the vendor's unconnected value is an empty Terminator.");

                    // One target per line, the value on the last: `x :=` / `y S= v;` — ONE item.
                    var lines = new List<string>();
                    for (var i = 0; i < a.Targets.Count; i++)
                    {
                        var t = a.Targets[i];
                        var head = "  " + LValue(t, "an assignment target") + " " + StorageOp(t);
                        lines.Add(i < a.Targets.Count - 1 ? head : head + " " + Value(a.Value) + ";");
                    }
                    return string.Join("\n", lines);
                }

                case Demux d when d.Input is not null:
                {
                    RefuseItemFlags(d.Flags, "a Demux item");
                    if (_defined.ContainsKey(d.VarId))
                        throw Unrepresentable("a wire defined twice",
                            $"two Demux items define VarId {d.VarId} in network {_net.Order}.");
                    var value = Value(d.Input);
                    // Defined AFTER its own value is rendered: a wire fed by a reference to itself is a reference
                    // before its definition, not a definition.
                    _defined[d.VarId] = WireType(d);
                    _definitionOrder.Add(d.VarId);
                    return "  " + _names[d.VarId] + " := " + value + ";";
                }

                // The empty item: a `;` that closes no statement.
                case Terminator { Input: null } t:
                    if (!t.Flags.IsNone)
                        throw Unrepresentable("a flag on an empty item",
                            $"an unconnected top-level terminator in network {_net.Order} carries {Describe(t.Flags)}.");
                    return "  ;";

                // A box, leaf, wire reference or PARALLEL whose output goes nowhere: `value;`. A top-level box's
                // own result pin is `=> v` inside the call, which is what keeps it apart from `v := box;`.
                default:
                    if (n is Box { ConnectedSlot: { } slot } b)
                        throw Unrepresentable("a top-level box with a connection slot",
                            $"the top-level '{b.Type}' box records output slot {slot} as connected, and nothing consumes it.");
                    return "  " + (n is Box top ? Modified(BoxCore(top, consumed: false), top.Flags, $"the '{top.Type}' box") : Value(n)) + ";";
            }
        }

        /// <summary><c>JMP l</c> / <c>RETURN</c>, bare when nothing drives it, else inside
        /// <c>IF c THEN … ; END_IF</c> with the condition — the assign's value — inline.</summary>
        private string ControlFlow(Assign a)
        {
            // Marker-only (spec: "marker-only shapes"): one rung driving a coil and a jump, or two jumps. Spelling
            // it needs JMP as an assign target, which is not ST, and it occurs in no corpus.
            if (a.Targets.Count > 1)
                throw Unrepresentable(
                    a.Targets.All(t => t.Flags is { } f && (f.Jump || f.Return))
                        ? "a rung driving several jumps"
                        : "a rung driving a coil and a jump together",
                    $"one Assign in network {_net.Order} drives {a.Targets.Count} targets, one of them control flow.");

            RefuseItemFlags(a.Flags with { Jump = false, Return = false }, "a jump or return item");
            // The bit lives on the target as well as the item (DIALECT C13); either names the kind.
            var target = a.Targets.Count == 1 ? a.Targets[0] : null;
            var jump = a.Flags.Jump || target?.Flags?.Jump == true;
            var ret = a.Flags.Return || target?.Flags?.Return == true;
            if (jump && ret)
                throw Unrepresentable("an item that both jumps and returns",
                    $"an Assign in network {_net.Order} carries both the Jump and the Return bit.");

            string action;
            if (jump)
            {
                if (target is null || !NextSpelling.Identifier.IsMatch(target.Text))
                    throw Unrepresentable("a jump with no label",
                        $"a jump in network {_net.Order} names '{target?.Text}', and JMP takes one label.");
                action = "JMP " + target.Text;
            }
            else action = "RETURN";   // RETURN's `???` target is measured constant; the reader rebuilds it.

            // Unconditional when nothing drives it. Both a null value and the empty Terminator are read as
            // unconnected here, as v1 did — 0 jumps and 1 conditional RETURN in every corpus leave the vendor's
            // unconditional shape unmeasured (NetworkModel.Assign).
            if (a.Value is null or Terminator { Input: null, Flags.IsNone: true }) return action;
            return "IF " + Value(a.Value) + " THEN " + action + "; END_IF";
        }

        // ── values: one arm per node class ──────────────────────────────────────────────────────────

        private string Value(Node n)
        {
            switch (n)
            {
                case Leaf l:
                    if (l.Operand.Flags is { IsNone: false } of && of != l.Flags)
                        throw Unrepresentable("an operand whose flags disagree with its item",
                            $"the operand '{l.Operand.Text}' carries {Describe(of)} and its item {Describe(l.Flags)}.");
                    return Modified(Operand(l.Operand.Text, "an operand"), l.Flags, $"the operand '{l.Operand.Text}'");

                case Demux { Input: not null } d:
                    // Census 1.8: 139 definitions, all top level. A nested one has no position the text can give
                    // it without moving it, and moving it would change the vendor's item order.
                    throw Unrepresentable("a Demux definition below the top level",
                        $"a Demux defining VarId {d.VarId} in network {_net.Order} is nested inside another item.");

                case Demux d:
                    if (!_defined.ContainsKey(d.VarId))
                        throw Unrepresentable("a wire referenced before its definition",
                            $"network {_net.Order} references VarId {d.VarId} before (or without) the item defining it.");
                    return Modified(_names[d.VarId], d.Flags, "the wire " + _names[d.VarId]);

                case Box b:
                    return Modified(BoxCore(b, consumed: true), b.Flags, $"the '{b.Type}' box");

                case Parallel p:
                {
                    if (p.Branches.Count == 0)
                        throw Unrepresentable("a Parallel with no branch",
                            $"a Parallel in network {_net.Order} has no branch.");
                    var pins = new List<string>();
                    // Owner decision 2026-09-26: the mode is carried, and written only off its default. Census 1.3:
                    // BoxShortCircuit 16, Sequential 1 — rebuilding that one in the default mode would be silent.
                    if (p.Mode != ParallelMode.BoxShortCircuit) pins.Add("MODE := " + p.Mode);
                    if (p.Input is not null) pins.Add("IN := " + Value(p.Input));   // `IN := ,` is a feed wired to nothing
                    pins.AddRange(p.Branches.Select(Value));
                    return Modified("PARALLEL(" + string.Join(", ", pins) + ")", p.Flags, "a Parallel");
                }

                case Terminator { Input: null } t:
                    if (!t.Flags.IsNone)
                        throw Unrepresentable("a flag on an empty slot",
                            $"an unconnected slot in network {_net.Order} carries {Describe(t.Flags)}, and an empty slot has no text to modify.");
                    return "";   // the empty slot: a position, never a token

                case Terminator:
                    // Census 1.4: 0 occurrences — refused by name, like Mux.
                    throw Unrepresentable("a terminator with an input",
                        $"a Terminator in network {_net.Order} carries an input.");

                case Assign:
                    throw Unrepresentable("an assign below the top level",
                        $"an Assign item in network {_net.Order} is nested inside another item.");

                default:
                    throw Unrepresentable("an unknown network item",
                        $"network text has no form for the node '{n.GetType().Name}'.");
            }
        }

        /// <summary>A box, without its own modifiers: infix group, call, or EXECUTE — plus <c>.ENO</c> when a
        /// consumer is connected to its ENO.</summary>
        private string BoxCore(Box b, bool consumed)
        {
            foreach (var p in b.Inputs)
                if (!p.Flags.IsNone)
                    // Phase-1 decision: a modifier on the PIN (vendor InputFlags) has no spelling yet — the same
                    // refusal the v1 drivers raise, so the fact reaches the marker instead of the floor.
                    throw Unrepresentable("a flag on a box input pin",
                        $"the '{b.Type}' box has {Describe(p.Flags)} on its pin {p.Formal ?? "(positional)"}.");

            var isExecute = b.StCode is not null;
            // The ENO slot: output slot 0 of a box that shows EN/ENO (Box.HasEnoSlot, measured), and the ONLY
            // output of an Execute box.
            int? eno = isExecute || b.Enable is not null ? 0 : null;
            var suffix = consumed ? Suffix(b, eno) : "";

            if (isExecute) return Execute(b) + suffix;

            if (NextSpelling.IsInfix(b)) return "(" + string.Join(" " + FbdOperators.TypeToSymbol[b.Type] + " ", b.Inputs.Select(p => Value(p.Value))) + ")";

            var pins = new List<string>();
            if (b.Enable is not null) pins.Add("EN := " + Value(b.Enable));
            foreach (var p in b.Inputs)
            {
                if (p.Formal is { } f)
                {
                    if (string.Equals(f, Box.EnablePin, StringComparison.OrdinalIgnoreCase))
                        throw Unrepresentable("a data pin named EN",
                            $"the '{b.Type}' box has a data pin named EN, which the text reads as its enable.");
                    pins.Add(Formal(f, b) + " := " + Value(p.Value));
                }
                else pins.Add(Value(p.Value));
            }
            // A LONE unconnected slot needs its formal: `MOVE()` is a box with no input slot, `MOVE(IN := )` one
            // unwired slot. A positional one has no name to give it.
            if (b.Enable is null && b.Inputs.Count == 1 && b.Inputs[0].Formal is null && pins[0].Length == 0)
                throw Unrepresentable("a lone unconnected input slot with no formal",
                    $"the '{b.Type}' box has one input slot, wired to nothing and unnamed, and `{b.Type}()` is a box with none.");

            pins.AddRange(OutputPins(b, eno));
            return Head(b) + "(" + string.Join(", ", pins) + ")" + suffix;
        }

        /// <summary>The slot rule on a CONSUMED box: connected by ENO → <c>.ENO</c>; by its main output → no
        /// suffix; anything else has no spelling. The stored slot is compared as stored: the vendor keeps no main
        /// output index on an AND/OR box (census 1.6, None on 823), and a consumer of one records none either, so
        /// null matching null is the main output — a null against a stored index is a slot nobody read.</summary>
        private string Suffix(Box b, int? eno)
        {
            var slot = b.ConnectedSlot;
            if (eno is not null && slot == eno) return ".ENO";
            // Until census 1.6 shows an enabled box connected by its main output, `.ENO`-less is refused on push
            // for an enabled box, so the text could not carry the connection back.
            if (eno is not null)
                throw Unrepresentable("an enabled box connected by a slot other than ENO",
                    $"a consumer of the '{b.Type}' box is connected to its output slot {slot?.ToString() ?? "(not stored)"}; an enabled box is spelled only by `.ENO`.");
            if (slot != b.MainOutputIndex)
                throw Unrepresentable("a connection by an unspellable output slot",
                    $"a consumer of the '{b.Type}' box is connected to its output slot {slot?.ToString() ?? "(not stored)"}, which is neither its main output ({b.MainOutputIndex?.ToString() ?? "none"}) nor ENO.");
            return "";
        }

        /// <summary>Output pins after the inputs: <c>F =&gt; v</c> when named; positional <c>=&gt; v</c> filling
        /// the slots that remain after ENO and the connected one, in order, with a bare <c>=&gt;</c> for a slot
        /// skipped over.</summary>
        private IEnumerable<string> OutputPins(Box b, int? eno)
        {
            var next = 0;   // the next free output slot a positional pin fills
            int? last = null;
            foreach (var o in b.Outputs)
            {
                if (o.Value.Flags is { IsNone: false } f)
                    throw Unrepresentable("a flag on an output pin",
                        $"the '{b.Type}' box's output to '{o.Value.Text}' carries {Describe(f)}.");
                var target = LValue(o.Value, "an output target");

                if (o.Formal is { } formal)
                {
                    if (string.Equals(formal, Box.EnoPin, StringComparison.OrdinalIgnoreCase))
                        throw Unrepresentable("an ENO output pin",
                            $"the '{b.Type}' box wires ENO to '{o.Value.Text}'; ENO is only ever `.ENO`, never an `=>` pin.");
                    yield return Formal(formal, b) + " => " + target;
                    continue;
                }

                if (o.Slot is not { } slot)
                    throw Unrepresentable("an output pin with no stored slot",
                        $"the '{b.Type}' box's unnamed output to '{o.Value.Text}' has no slot index, and a positional `=>` is spelled by its slot.");
                if (slot <= last)
                    throw Unrepresentable("output pins out of slot order",
                        $"the '{b.Type}' box lists its unnamed output slot {slot} after slot {last}.");
                last = slot;

                while (true)
                {
                    if (next == eno || next == b.ConnectedSlot) { next++; continue; }
                    if (next > slot)
                        throw Unrepresentable("a connection by an unspellable output slot",
                            $"the '{b.Type}' box wires output slot {slot} to '{o.Value.Text}', which is its ENO or its connected slot.");
                    if (next == slot) break;
                    yield return "=>";   // a slot connected to nothing, passed over
                    next++;
                }
                yield return "=> " + target;
                next++;
            }
        }

        /// <summary>The call's head: the FB instance, <c>??? : TYPE</c> for the vendor's unnamed instance, or the
        /// BoxType verbatim, keywords included.</summary>
        private static string Head(Box b)
        {
            if (b.Instance is { } inst)
            {
                if (inst.Text == Box.UnnamedInstance)
                {
                    if (!NextSpelling.Identifier.IsMatch(b.Type))
                        throw Unrepresentable("an unnamed instance of an unspellable type",
                            $"a '???' instance box has the type '{b.Type}', which is not an identifier.");
                    return Box.UnnamedInstance + " : " + b.Type;
                }
                RefuseEdgeWord(inst.Text, "an FB instance");
                return Operand(inst.Text, "an FB instance");
            }
            RefuseEdgeWord(b.Type, "a box type");
            if (string.Equals(b.Type, "EXECUTE", StringComparison.OrdinalIgnoreCase))
                throw Unrepresentable("a box type that is a keyword of the text",
                    $"a box of type '{b.Type}' has no ST snippet and would read back as an Execute box.");
            // VERBATIM, keywords included (NOT, AND, MOVE): a word followed by `(` is a head, so the operand
            // rule's keyword backticks do not apply here — only a type that is not one name is backticked.
            if (b.Type.IndexOf('`') >= 0)
                throw Unrepresentable("operand text containing a backtick", $"the box type '{b.Type}' contains a backtick.");
            return NextSpelling.Identifier.IsMatch(b.Type) || NextSpelling.Path.IsMatch(b.Type) ? b.Type : "`" + b.Type + "`";
        }

        private string Execute(Box b)
        {
            if (b.Inputs.Count > 0 || b.Outputs.Count > 0 || b.Instance is not null)
                throw Unrepresentable("an Execute box with pins",
                    $"an Execute box in network {_net.Order} carries pins or an instance beside its ST.");
            var st = b.StCode!.Replace("\r", "").TrimEnd('\n');
            foreach (var line in st.Split('\n'))
                // The body ends at the first line whose first word is END_EXECUTE; a snippet holding one would end
                // early on the way back.
                if (Regex.IsMatch(line, @"^\s*END_EXECUTE\b", RegexOptions.IgnoreCase))
                    throw Unrepresentable("a snippet line starting with END_EXECUTE",
                        $"an Execute box in network {_net.Order} holds the line '{line.Trim()}'.");
            // An empty snippet is exactly one empty line between the two keyword lines.
            var head = b.Enable is null ? "EXECUTE" : "EXECUTE(EN := " + Value(b.Enable) + ")";
            return head + "\n" + st + "\n  END_EXECUTE";
        }

        /// <summary>A value's modifiers, in the one order: <c>NOT</c>, then the edge around the core.</summary>
        private static string Modified(string core, Flags f, string what)
        {
            if (f.Set || f.Reset || f.Jump || f.Return)
                throw Unrepresentable("a coil flag on a value",
                    $"{what} carries {Describe(f)}, which a value has no spelling for.");
            if (f.Rising && f.Falling)
                throw Unrepresentable("rising and falling on one operand",
                    $"{what} carries both a rising and a falling edge.");
            if (f.Rising) core = "R_EDGE(" + core + ")";
            else if (f.Falling) core = "F_EDGE(" + core + ")";
            return f.Negated ? "NOT " + core : core;
        }

        /// <summary>A coil's storage — ExST's <c>:=</c>, <c>S=</c>, <c>R=</c>. Negated and edge coils are
        /// marker-only: 0 of 576 measured targets carry one.</summary>
        private static string StorageOp(Operand target)
        {
            var f = target.Flags ?? Flags.None;
            if (f.Negated) throw Unrepresentable("negated coil", $"the coil '{target.Text}' is negated.");
            if (f.Rising) throw Unrepresentable("rising-edge coil", $"the coil '{target.Text}' is a rising-edge coil.");
            if (f.Falling) throw Unrepresentable("falling-edge coil", $"the coil '{target.Text}' is a falling-edge coil.");
            return f.Reset ? "R=" : f.Set ? "S=" : ":=";
        }

        private static void RefuseItemFlags(Flags f, string what)
        {
            // Census 1.1: 0 item-level flags on Demux/Assign items. No position is decided for one.
            if (!f.IsNone)
                throw Unrepresentable("a flag on " + what, $"{what} carries {Describe(f)} on the item itself.");
        }

        // ── wire types ──────────────────────────────────────────────────────────────────────────────

        /// <summary>The type a wire is declared with, read off its producer: BOOL when the producer is boolean by
        /// itself, a box's stored output type otherwise. Where the producer says nothing, the type the TEXT declared
        /// (<see cref="Demux.Type"/> — a body read from the engineer's file) is the type; a pulled wire has none
        /// and is never guessed. A text-declared type that disagrees with a producer that does say is refused.</summary>
        private string WireType(Demux d)
        {
            var producer = ProducerType(d.Input!);
            var type = producer ?? d.Type;
            if (type is null)
                throw Unrepresentable("a wire of unknown type",
                    $"the wire {_names[d.VarId]} in network {_net.Order} is fed by a {d.Input!.GetType().Name} whose type the model does not carry.");
            if (producer is not null && d.Type is not null && !string.Equals(producer, d.Type, StringComparison.OrdinalIgnoreCase))
                throw Unrepresentable("a wire typed unlike its producer",
                    $"the wire {_names[d.VarId]} in network {_net.Order} is declared {d.Type} and its producer is {producer}.");
            if (type.IndexOfAny(new[] { ';', '\n', '\r' }) >= 0 || type.Trim().Length == 0)
                throw Unrepresentable("a wire of unspellable type",
                    $"the wire {_names[d.VarId]} in network {_net.Order} has the type '{type}'.");
            return type;
        }

        private string? ProducerType(Node n)
        {
            if (n.Flags.Rising || n.Flags.Falling) return NextSpelling.Bool;   // an edge is boolean
            switch (n)
            {
                case Leaf l:
                    if (string.Equals(l.Operand.Text, "TRUE", StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(l.Operand.Text, "FALSE", StringComparison.OrdinalIgnoreCase)) return NextSpelling.Bool;
                    // In ladder every leaf on a rung is a contact.
                    return _lang == BodyLanguage.Ld ? NextSpelling.Bool : null;
                case Parallel: return NextSpelling.Bool;
                case Demux d: return _defined.TryGetValue(d.VarId, out var t) ? t : null;
                case Box b:
                    if (b.StCode is not null || b.Enable is not null) return NextSpelling.Bool;   // consumed by `.ENO`
                    if (NextSpelling.BooleanBoxes.Contains(b.Type)) return NextSpelling.Bool;
                    return b.ConnectedSlot is { } s && b.OutputTypes is { } types && s < types.Count ? types[s] : null;
                default: return null;
            }
        }

        // ── names and operands ──────────────────────────────────────────────────────────────────────

        private static string LValue(Operand o, string what) => Operand(o.Text, what);

        private static string Formal(string f, Box b) =>
            NextSpelling.Identifier.IsMatch(f)
                ? f
                : throw Unrepresentable("a pin name that is not an identifier",
                    $"the '{b.Type}' box has a pin named '{f}'.");

        /// <summary>An operand as a bare token when it is exactly one, else verbatim between backticks. A backtick
        /// cannot occur in ST, so text holding one has no spelling.</summary>
        private static string Operand(string text, string what)
        {
            if (text.IndexOf('`') >= 0)
                throw Unrepresentable("operand text containing a backtick", $"{what} '{text}' contains a backtick.");
            return NextSpelling.IsToken(text) ? text : "`" + text + "`";
        }

        /// <summary>A POU or instance named like an edge word would read back as the edge flag.</summary>
        private static void RefuseEdgeWord(string name, string what)
        {
            if (NextSpelling.ConstructWords.Contains(name))
                throw Unrepresentable("a POU or instance named " + name.ToUpperInvariant(),
                    $"{what} is named '{name}', which the text reads as its own construct.");
        }

        /// <summary>Every identifier the network spells, into the reserved set, and every Demux VarId in item
        /// order.</summary>
        private static void Collect(Node? n, HashSet<string> names, List<int> ids)
        {
            switch (n)
            {
                case Leaf l: Words(l.Operand.Text, names); break;
                case Demux d: ids.Add(d.VarId); Collect(d.Input, names, ids); break;
                case Assign a:
                    foreach (var t in a.Targets) Words(t.Text, names);
                    Collect(a.Value, names, ids);
                    break;
                case Box b:
                    Words(b.Type, names);
                    if (b.Instance is { } i) Words(i.Text, names);
                    foreach (var o in b.Outputs) Words(o.Value.Text, names);
                    Collect(b.Enable, names, ids);
                    foreach (var p in b.Inputs) Collect(p.Value, names, ids);
                    break;
                case Parallel p:
                    Collect(p.Input, names, ids);
                    foreach (var br in p.Branches) Collect(br, names, ids);
                    break;
                case Terminator t: Collect(t.Input, names, ids); break;
            }
        }

        // Every identifier-shaped word in the text, not just the whole text: a backticked `g3 + 1` names g3 too.
        private static void Words(string text, HashSet<string> into)
        {
            foreach (Match m in Regex.Matches(text, @"[A-Za-z_][A-Za-z0-9_]*")) into.Add(m.Value);
        }

        private static string Describe(Flags f) =>
            string.Join(" + ", new[]
            {
                f.Negated ? "a negation" : null, f.Set ? "a set" : null, f.Reset ? "a reset" : null,
                f.Jump ? "a jump" : null, f.Return ? "a return" : null,
                f.Rising ? "a rising edge" : null, f.Falling ? "a falling edge" : null,
            }.Where(s => s != null));

        private static UnrepresentableBodyException Unrepresentable(string reason, string detail) =>
            new(reason, "network text has no spelling for " + reason + ": " + detail +
                        " Volt materializes the body as a marker rather than write it without that fact.");
    }
}
