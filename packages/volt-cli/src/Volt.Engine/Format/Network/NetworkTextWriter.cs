using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Volt.Engine.Format.Body;

namespace Volt.Engine.Format.Network;

/// <summary>
/// Network text v2: renders a <see cref="NetworkBody"/> as a literal transcript of the vendor's network model —
/// one statement per top-level NWL item, every owned subtree nested where the vendor holds it, and a name only
/// where the vendor names something (a <see cref="Demux"/>'s VarId). Specified by
/// <c>docs/network-text.html</c> and <c>openspec/changes/network-text-literal-nwl</c>. It replaced v1's writer,
/// whose hoists (<c>LET i</c>/<c>m</c>/<c>en</c>), prelude and <c>Unspellable</c> pre-pass are gone: a fact with
/// no spelling is this writer's own refusal, the pull's one marker route.
///
/// <para><b>One fold, one arm per model node class.</b> There is no hoisting, no minted name and no pass over the
/// produced text: each arm decides its spelling from the node in hand. The per-network state is the VarId→name
/// map (fixed before the fold, so a rename can never depend on the order things are rendered in) and the set of
/// wires already defined, which is what lets a reference stored before its definition be refused instead of
/// silently reordered. Two things look beyond the node in hand, both over the MODEL and never over text: the
/// constructor collects the network's names and VarIds before the fold (the reserved set a wire name must avoid),
/// and a wire fed by a leaf counts that wire's uses across the network (<see cref="NetworkSpelling.ProducerType"/>),
/// because a leaf's type is decided by how it is used — the one fact of a wire below its definition.</para>
///
/// <para><b>A fact with no spelling throws <see cref="UnrepresentableBodyException"/>, naming it.</b> That is the
/// one exception this writer raises, and the pull path turns it into the body marker — the POU still appears and
/// says what it holds. Dropping the fact instead would write a different machine into the engineer's file, and
/// the text round trip could never notice: a fact absent from the text is absent from both sides of it.</para>
/// </summary>
public static class NetworkTextWriter
{
    /// <summary>Render <paramref name="body"/>.</summary>
    /// <param name="scope">The declarations the body can see — the SAME <see cref="NetworkScope"/> the reader
    /// reads the text back against, so the two sides reserve one set of names and resolve one set of FB instances.
    /// REQUIRED rather than defaulted: a wire named like a name in scope would read back as that variable, and an
    /// FB instance the declarations do not name would read back as a function; a caller that does not know the
    /// scope must say so by passing <see cref="NetworkScope.Empty"/>, not by leaving it out.</param>
    public static string Write(NetworkBody body, NetworkScope scope)
    {
        if (body is null) throw new ArgumentNullException(nameof(body));
        if (scope is null) throw new ArgumentNullException(nameof(scope));

        var sb = new StringBuilder();
        // The body's language rides on its one IMPLEMENTATION line (openspec implementation-keyword). v1 printed it on every network header, which invited a per-network edit nothing applied.
        sb.Append(St.ImplementationMarker.For(NetworkText.Spelling(body.Language))).Append('\n');

        for (var i = 0; i < body.Networks.Count; i++)
        {
            try
            {
                new Emitter(body.Networks[i], body.Language, scope).Emit(sb);
            }
            catch (NetworkUnrepresentableException e) when (e.Network is null)
            {
                e.Network = i;
                throw;
            }
        }
        return sb.ToString();
    }

    private sealed class Emitter
    {
        private readonly Network _net;
        private readonly BodyLanguage _lang;
        private readonly NetworkScope _scope;

        // VarId → the wire's written name. Decided once, before any statement is rendered.
        private readonly Dictionary<int, string> _names = new();

        // Wires whose definition has been written, with the type read off each producer. A reference to a wire
        // not in here is a reference stored before its definition — the vendor's order, which is never changed.
        private readonly Dictionary<int, string> _defined = new();
        private readonly List<int> _definitionOrder = new();

        public Emitter(Network net, BodyLanguage lang, NetworkScope scope)
        {
            _net = net;
            _lang = lang;
            _scope = scope;

            // THE RESERVED SET: every name in scope plus every identifier this network spells, compared
            // case-insensitively, because IEC identifiers are. A wire `g3` beside a variable `G3` is the same
            // name to the compiler and to the reader.
            // The scope is asked, not listed: it is built from declarations, some of them read lazily (a GVL's).
            var spelled = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var ids = new List<int>();
            foreach (var t in net.Trees) Collect(t, spelled, ids);
            bool Reserved(string n) => spelled.Contains(n) || scope.Contains(n);

            // g<VarId> whenever it is free — the wire keeps the vendor's id across a round trip (C9). A taken one
            // is renamed to the lowest free g<n>, and the push then writes VarId n. Defaults are placed FIRST so a
            // rename can never land on a name another wire was going to keep.
            var taken = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var id in ids.Distinct())
            {
                if (id < 0)
                    throw Unrepresentable("a wire with a negative VarId",
                        $"a Demux carries VarId {id}, and a wire is spelled g<digits>.");
                if (!Reserved("g" + id)) { _names[id] = "g" + id; taken.Add("g" + id); }
            }
            foreach (var id in ids.Distinct())
            {
                if (_names.ContainsKey(id)) continue;
                var n = 0;
                while (taken.Contains("g" + n) || Reserved("g" + n)) n++;
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
            {
                // A CR LF line ending is the file's layout, not the comment's text (spec, "the network header and
                // its comment"); every other character is text and is carried.
                foreach (var line in comment.Replace("\r\n", "\n").Split('\n'))
                {
                    if (line.IndexOf('\r') >= 0)
                        // A CR left after the CR LFs is a lone one, and a lone CR ends a line wherever it stands (an
                        // editor breaks the line there): at a line's end the reader would drop it as layout, inside
                        // one it would carry what follows as comment the engineer sees as a statement.
                        throw Unrepresentable("a comment line ending in a carriage return",
                            $"network {_net.Order}'s comment holds a line ending in a lone carriage return.");
                    // `//` and ONE space are syntax; everything after them is text, leading indentation and a
                    // leading `//` included. An empty line is `//` alone, so a trailing space means nothing.
                    sb.Append("  //").Append(line.Length == 0 ? "" : " " + line).Append('\n');
                }
                // What the drivers store (NetworkText.Stored): an empty comment or one ending in whitespace would read
                // back trimmed. Asked after the lines, so a lone CR is refused by its own name.
                if (NetworkText.Stored(comment) != comment)
                    throw Unrepresentable("a comment the IDE does not store",
                        $"network {_net.Order}'s comment is empty or ends in whitespace, which the drivers trim.");
            }

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
                if (!NetworkSpelling.Identifier.IsMatch(label))
                    throw Unrepresentable("a label that is not an identifier",
                        $"network {_net.Order} carries the label '{label}', and a LABEL is one identifier.");
                h.Append(" LABEL: ").Append(label);
            }
            if (_net.Title is { } title)
            {
                if (NetworkText.Stored(title) != title)
                    throw Unrepresentable("a title the IDE does not store",
                        $"network {_net.Order}'s title is empty or ends in whitespace, which the drivers trim.");
                h.Append(" TITLE: ").Append(Quote(title));
            }
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

        /// <summary>A top-level item as its statement. A refusal met anywhere below records this item as where it
        /// was met, unless a node below it already did.</summary>
        private string Statement(Node n)
        {
            try { return StatementCore(n); }
            catch (NetworkUnrepresentableException e) when (e.At is null) { e.At = n; throw; }
        }

        private string StatementCore(Node n)
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
                case Terminator t:
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
            if (target?.Flags is { } tf && !(tf with { Jump = false, Return = false }).IsNone)
                // Spec, "marker-only shapes": `JMP l` and `RETURN` have no position for a negation, an edge or a
                // storage bit on their target (census 1.7: 0 negation-only or edge targets), so it cannot ride along.
                throw Unrepresentable("a flag on a jump or return target",
                    $"the jump or return target '{target.Text}' in network {_net.Order} carries {Describe(tf with { Jump = false, Return = false })}.");
            var jump = a.Flags.Jump || target?.Flags?.Jump == true;
            var ret = a.Flags.Return || target?.Flags?.Return == true;
            if (jump && ret)
                throw Unrepresentable("an item that both jumps and returns",
                    $"an Assign in network {_net.Order} carries both the Jump and the Return bit.");

            string action;
            if (jump)
            {
                // Any identifier, words of the text included: after `JMP` a word is always the label (the reader
                // reads it so), and the header's `LABEL:` takes the same names.
                if (target is null || !NetworkSpelling.Identifier.IsMatch(target.Text))
                    throw Unrepresentable("a jump with no label",
                        $"a jump in network {_net.Order} names '{target?.Text}', and JMP takes one label.");
                action = "JMP " + target.Text;
            }
            else
            {
                // RETURN's `???` target is measured constant, and the reader rebuilds it; any other target text
                // is a fact `RETURN` has no place for, and writing RETURN would drop it.
                if (target is not null && target.Text != Box.UnnamedInstance)
                    throw Unrepresentable("a return with a named target",
                        $"a return in network {_net.Order} names the target '{target.Text}', and RETURN takes none.");
                action = "RETURN";
            }

            // Unconditional when nothing drives it: the empty Terminator (DIALECT C11).
            if (a.Value is Terminator { Flags.IsNone: true }) return action;
            return "IF " + Value(a.Value) + " THEN " + action + "; END_IF";
        }

        // ── values: one arm per node class ──────────────────────────────────────────────────────────

        /// <summary>A value. A refusal met while writing it records the node as where it was met, unless a node
        /// below it already did — so a push reports the innermost construct holding the fact.</summary>
        private string Value(Node n)
        {
            try { return ValueCore(n); }
            catch (NetworkUnrepresentableException e) when (e.At is null) { e.At = n; throw; }
        }

        private string ValueCore(Node n)
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
                    return _names[d.VarId];

                case Box b:
                    return Modified(BoxCore(b, consumed: true), b.Flags, $"the '{b.Type}' box");

                case Parallel p:
                {
                    if (p.Branches.Count == 0)
                        throw Unrepresentable("a Parallel with no branch",
                            $"a Parallel in network {_net.Order} has no branch.");
                    // Census 1.2: the unfed Parallel is the null feed; a feed that is the empty terminator occurs in no
                    // project, so it has no spelling of its own (`IN := ,` would be a second "no feed").
                    if (p.Input is Terminator)
                        throw Unrepresentable("a Parallel fed by the empty terminator",
                            $"a Parallel in network {_net.Order} is fed by an unconnected terminator; an unfed Parallel has no feed.");
                    RefuseTakenConstruct("PARALLEL");
                    if (!NetworkSpelling.IsMeasuredMode(p.Mode))
                        // Spec: an unmeasured mode is refused. Written by its number it would be text the reader
                        // refuses — a pull producing an unpushable body where the marker belongs.
                        throw Unrepresentable("an unmeasured Parallel mode",
                            $"a Parallel in network {_net.Order} has the mode '{p.Mode}'; the measured modes are BoxShortCircuit and Sequential.");
                    var pins = new List<string>();
                    // Owner decision 2026-09-26: the mode is carried, and written only off its default. Census 1.3:
                    // BoxShortCircuit 16, Sequential 1 — rebuilding that one in the default mode would be silent.
                    if (p.Mode != ParallelMode.BoxShortCircuit) pins.Add("MODE := " + p.Mode);
                    if (p.Input is not null) pins.Add("IN := " + Value(p.Input));
                    pins.AddRange(p.Branches.Select(Value));
                    // The same ambiguity a call's lone unconnected slot has: `PARALLEL()` is a Parallel with no
                    // branch, which the reader refuses. Beside a mode or a feed the empty branch is its own position.
                    if (pins.Count == 1 && pins[0].Length == 0)
                        throw Unrepresentable("a lone unconnected Parallel branch",
                            $"a Parallel in network {_net.Order} has one branch, wired to nothing, and no feed; `PARALLEL()` is a Parallel with none.");
                    return "PARALLEL(" + string.Join(", ", pins) + ")";
                }

                case Terminator t:
                    if (!t.Flags.IsNone)
                        throw Unrepresentable("a flag on an empty slot",
                            $"an unconnected slot in network {_net.Order} carries {Describe(t.Flags)}, and an empty slot has no text to modify.");
                    return "";   // the empty slot: a position, never a token

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
            for (var i = 0; i < b.Inputs.Count; i++)
                if (b.Inputs[i] is { Flags.IsNone: false } p)
                    // Phase-1 decision: a modifier on the PIN (vendor InputFlags) has no spelling yet, so the fact
                    // reaches the marker instead of the floor. The message names the pin by what feeds it where it can:
                    // an engineer finds `xIsWarningInfo` in the diagram, not "input 1".
                    throw Unrepresentable(BoxRefusals.PinFlagMarker,
                        $"the '{b.Type}' box has {Describe(p.Flags)} on its pin {p.Formal ?? $"input {i}"}" +
                        (p.Value is Leaf feed ? $" fed by '{feed.Operand.Text}'." : "."));

            // The text spells the ENO output only by `.ENO`, and reads every other box by one rule
            // (NetworkSpelling.TextHasEno). Where the answer decides the text — the suffix, and the slots positional
            // `=>` pins fill — a missing fact is refused FIRST, by its own name: the suffix and the slot rule below
            // read HasEnoOutput, and asked with it unread they would refuse the box as unspellable when the one
            // thing wrong is that nobody read whether it has an ENO.
            var carried = NetworkSpelling.EnoCarried(b, consumed);
            if (carried && b.HasEnoOutput is null)
                throw Unrepresentable("a box whose ENO output was not read",
                    $"the '{b.Type}' box does not record whether it has an ENO output, and its text depends on it.");

            var eno = NetworkSpelling.EnoSlot(b);
            var infix = NetworkSpelling.IsInfix(b);
            var suffix = consumed ? Suffix(b) : "";

            if (b.StCode is not null) return Execute(b) + suffix;

            if (carried && b.HasEnoOutput is { } has)
            {
                // A box the rule would read otherwise has no spelling: its pins would come back one slot over, or its
                // consumer on another output.
                if (has != NetworkSpelling.TextHasEno(isExecute: false, b.Enable is not null, suffix.Length > 0, consumed))
                    throw Unrepresentable("an ENO output the text reads otherwise",
                        has
                            ? $"the '{b.Type}' box has an ENO output and no EN, and the text reads a box that says neither `EN :=` nor `.ENO` as having none."
                            : $"the '{b.Type}' box has EN and no ENO output, and the text reads a top-level box with EN as having one.");
            }

            if (infix) return "(" + string.Join(" " + FbdOperators.TypeToSymbol[b.Type] + " ", b.Inputs.Select(p => Value(p.Value))) + ")";

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
            pins.AddRange(OutputPins(b, eno));
            // A LONE unconnected slot needs its formal when it is the whole argument list: `MOVE()` is a box with no
            // input slot, `MOVE(IN := )` one unwired slot. A positional one has no name to give it. Beside an output
            // pin it is a position of its own — `f(, => x)` is not `f(=> x)` — and needs none.
            if (pins.Count == 1 && pins[0].Length == 0)
                throw Unrepresentable("a lone unconnected input slot with no formal",
                    $"the '{b.Type}' box has one input slot, wired to nothing and unnamed, and `{b.Type}()` is a box with none.");
            return Head(b) + "(" + string.Join(", ", pins) + ")" + suffix;
        }

        /// <summary>The slot rule on a CONSUMED box, group or call alike: connected by ENO → <c>.ENO</c>; by its main
        /// output → no suffix, read back by <see cref="NetworkSpelling.MainSlotOfCall"/>; anything that reading would
        /// get wrong has no spelling. The stored slots are compared as stored — a null against a stored index is a
        /// slot nobody read, never the main output by convention.</summary>
        private string Suffix(Box b)
        {
            var slot = b.ConnectedSlot;
            var hasEno = NetworkSpelling.EnoSlot(b) is not null;
            if (NetworkSpelling.ConnectedByEno(b)) return ".ENO";   // the one definition, shared with ProducerType and the oracle

            // A bit operator without ENO, group or call, reads back connected by no stored slot (the vendor keeps no
            // main output index on AND/OR — census 1.6), so that is the one connection it can carry.
            if (!hasEno && NetworkSpelling.MainSlotOfCall(b.Type) is null)
            {
                if (slot is not null)
                    throw Unrepresentable("a bit operator box connected by a stored output slot",
                        $"a consumer of the '{b.Type}' box is connected to its output slot {slot}, and the text reads a consumed bit operator as connected by none.");
                return "";
            }

            // Every other consumed box is read back connected by a stored slot, so one it never recorded has none.
            if (slot is null)
                throw Unrepresentable("a consumed box with no stored connection slot",
                    $"the '{b.Type}' box is consumed and does not record which of its output slots its consumer is connected to.");
            if (hasEno)
                // Census 1.6 (DIALECT N16): a box with an ENO output is connected by its main output, and that IS the
                // ENO. `.ENO` wins where the two coincide, so one model has one text; any other slot has none.
                throw Unrepresentable("a connection by an unspellable output slot",
                    $"a consumer of the '{b.Type}' box is connected to its output slot {slot}, and the box's main output is its ENO.");
            // The comparison below needs the main output. Census 1.6 measured None only on the AND/OR boxes, which
            // returned above, so a null here is a fact nobody read — refused under that name, as an unread ENO is in
            // BoxCore, never as a vendor shape with a main output of "none".
            if (b.MainOutputIndex is null)
                throw Unrepresentable("a consumed box whose main output was not read",
                    $"the '{b.Type}' box is consumed and does not record which of its output slots is its main output, and its text depends on it.");
            if (slot != b.MainOutputIndex)
                throw Unrepresentable("a connection by an unspellable output slot",
                    $"a consumer of the '{b.Type}' box is connected to its output slot {slot}, which is neither its main output ({b.MainOutputIndex}) nor ENO.");
            if (slot != NetworkSpelling.MainSlotOfCall(b.Type))
                // Census 1.6: 3 Lenze call boxes store main output 1. The text reads a main-output connection as
                // slot 0, so every positional `=>` pin would come back one slot over.
                throw Unrepresentable("a main output other than slot 0",
                    $"the '{b.Type}' box's main output is its slot {slot}, and the text reads a box consumed by its main output as connected by slot 0.");
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
                    if (string.Equals(formal, Box.EnablePin, StringComparison.OrdinalIgnoreCase))
                        // `EN =>` reads as the enable written the wrong way round, and is refused as such.
                        throw Unrepresentable("an output pin named EN",
                            $"the '{b.Type}' box has an output pin named EN, wired to '{o.Value.Text}'; EN is the enable input.");
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
                    next = NetworkSpelling.NextFreeSlot(next, eno, b.ConnectedSlot);
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
        /// BoxType verbatim — bare when it is one name that is no word of the text (the operators' own words
        /// included: <c>NOT</c>, <c>AND</c>), else between backticks.</summary>
        private string Head(Box b)
        {
            // A POU of that name would read back as the construct, whether it is called or instantiated.
            RefuseEdgeWord(b.Type, "a box type");
            if (b.Instance is { } inst)
            {
                if (inst.Flags is { IsNone: false } instFlags)
                    // The call head has no position for a modifier of its own: the box's flags are the call's.
                    throw Unrepresentable("a flag on an FB instance",
                        $"the '{b.Type}' instance '{inst.Text}' carries {Describe(instFlags)} on the instance operand.");
                if (inst.Text == Box.UnnamedInstance)
                {
                    if (!NetworkSpelling.Identifier.IsMatch(b.Type))
                        throw Unrepresentable("an unnamed instance of an unspellable type",
                            $"a '???' instance box has the type '{b.Type}', which is not an identifier.");
                    return Box.UnnamedInstance + " : " + b.Type;
                }
                RefuseEdgeWord(inst.Text, "an FB instance");
                // The text does not repeat the FB's type: the reader takes it from the instance's declaration, and
                // reads a head no declaration names as a FUNCTION of that name. Census 1.12: `SUPER^` (Lenze
                // ATD_TorqueControl) is declared nowhere.
                var declared = _scope.InstanceType(inst.Text);
                if (declared is null)
                    throw Unrepresentable("an FB instance the declarations do not name",
                        $"the '{b.Type}' instance '{inst.Text}' is declared by no name in scope, so its call would read back as a function named '{inst.Text}'.");
                if (!St.StDeclaration.SameType(declared, b.Type))
                    throw Unrepresentable("an FB instance declared with another type",
                        $"the instance '{inst.Text}' is a '{b.Type}' box and its declaration says '{declared}'.");
                return Operand(inst.Text, "an FB instance");
            }
            if (b.Type.IndexOf('`') >= 0)
                throw Unrepresentable("operand text containing a backtick", $"the box type '{b.Type}' contains a backtick.");
            if (!NetworkSpelling.IsName(b.Type))
                // A function is a POU, named by a name; a head that is none (`fbs[1]`, `SUPER^`) is an FB instance
                // the text lost, and the reader refuses it rather than build a function of that name.
                throw Unrepresentable("a box type that is no POU name",
                    $"the box type '{b.Type}' is not a name, and the box has no FB instance.");
            if (_scope.InstanceType(b.Type) is { } instanceType)
                // The reader takes a head the declarations name as an instance to BE that instance, so this function
                // box would read back as that instance's call, with the instance's FB type.
                throw Unrepresentable("a function named like an FB instance in scope",
                    $"the function box '{b.Type}' has the name of the '{instanceType}' instance '{b.Type}', and its call would read back as that instance's.");
            return NetworkSpelling.IsBareHead(b.Type) ? b.Type : "`" + b.Type + "`";
        }

        private string Execute(Box b)
        {
            if (!string.Equals(b.Type, NetworkSpelling.ExecuteType, StringComparison.Ordinal))
                // The text writes the keyword, not the box type, and reads every Execute box back as EXECUTE; a
                // box type spelled otherwise (unmeasured on CODESYS, which passes BoxType through) would be lost.
                throw Unrepresentable("an Execute box of another type",
                    $"an Execute box in network {_net.Order} has the type '{b.Type}', and the text reads every Execute box as '{NetworkSpelling.ExecuteType}'.");
            if (b.Inputs.Count > 0 || b.Outputs.Count > 0 || b.Instance is not null)
                throw Unrepresentable("an Execute box with pins",
                    $"an Execute box in network {_net.Order} carries pins or an instance beside its ST.");
            // Verbatim, trailing newlines included (each is the empty line it is). Only the CR of a CR LF is the
            // file's layout rather than the snippet's text; the reader drops that one CR and refuses any other, so a
            // lone one has no spelling.
            var st = b.StCode!.Replace("\r\n", "\n");
            foreach (var line in st.Split('\n'))
            {
                // The body ends at the first line whose first word is END_EXECUTE; a snippet holding one would end
                // early on the way back.
                if (Regex.IsMatch(line, @"^\s*END_EXECUTE\b", RegexOptions.IgnoreCase))
                    throw Unrepresentable("a snippet line starting with END_EXECUTE",
                        $"an Execute box in network {_net.Order} holds the line '{line.Trim()}'.");
                // A lone CR ends a line wherever it stands, as in a comment; the reader refuses one inside a line.
                if (line.IndexOf('\r') >= 0)
                    throw Unrepresentable("a snippet line ending in a carriage return",
                        $"an Execute box in network {_net.Order} holds a line ending in a lone carriage return.");
            }
            // An empty snippet is exactly one empty line between the two keyword lines.
            var head = b.Enable is null ? "EXECUTE" : "EXECUTE(EN := " + Value(b.Enable) + ")";
            return head + "\n" + st + "\n  END_EXECUTE";
        }

        /// <summary>A value's modifiers, in the vendor's one order: the edge around the NEGATED core
        /// (<c>R_EDGE(NOT x)</c>) — the IDE negates before it detects the edge (DIALECT N17, run in simulation), so
        /// <c>NOT R_EDGE(x)</c> would state logic the flags do not.</summary>
        private string Modified(string core, Flags f, string what)
        {
            if (f.Set || f.Reset || f.Jump || f.Return)
                throw Unrepresentable("a coil flag on a value",
                    $"{what} carries {Describe(f)}, which a value has no spelling for.");
            if (f.Rising && f.Falling)
                throw Unrepresentable("rising and falling on one operand",
                    $"{what} carries both a rising and a falling edge.");
            if (f.Negated) core = "NOT " + core;
            if (f.Rising) { RefuseTakenConstruct("R_EDGE"); core = "R_EDGE(" + core + ")"; }
            else if (f.Falling) { RefuseTakenConstruct("F_EDGE"); core = "F_EDGE(" + core + ")"; }
            return core;
        }

        /// <summary>A coil's storage — ExST's <c>:=</c>, <c>S=</c>, <c>R=</c>. Negated and edge coils are
        /// marker-only: 0 of 576 measured targets carry one.</summary>
        private static string StorageOp(Operand target)
        {
            var f = target.Flags ?? Flags.None;
            if (f.Negated) throw Unrepresentable("negated coil", $"the coil '{target.Text}' is negated.");
            if (f.Rising) throw Unrepresentable("rising-edge coil", $"the coil '{target.Text}' is a rising-edge coil.");
            if (f.Falling) throw Unrepresentable("falling-edge coil", $"the coil '{target.Text}' is a falling-edge coil.");
            if (f.Set && f.Reset)
                throw Unrepresentable("a coil both set and reset", $"the coil '{target.Text}' carries both the Set and the Reset bit.");
            return f.Reset ? "R=" : f.Set ? "S=" : ":=";
        }

        private static void RefuseItemFlags(Flags f, string what)
        {
            // Census 1.1: 0 item-level flags on Assign items (an Assign's Jump/Return are control flow, written
            // apart). No position is decided for one. A Demux or Parallel cannot carry one at all (DIALECT N20).
            if (!f.IsNone)
                throw Unrepresentable("a flag on " + what, $"{what} carries {Describe(f)} on the item itself.");
        }

        // ── wire types ──────────────────────────────────────────────────────────────────────────────

        /// <summary>The type a wire is declared with, read off its producer by the one rule the reader checks with
        /// (<see cref="NetworkSpelling.ProducerType"/>). Where the producer says nothing, the type the TEXT declared
        /// (<see cref="Demux.Type"/> — a body read from the engineer's file) is the type; a pulled wire has none and
        /// is never guessed. A bit operator with no stored type is BOOL (spec, "a boolean producer"), or the
        /// bit-string type the text declared. A declared type the producer contradicts is refused.</summary>
        private string WireType(Demux d)
        {
            var name = _names[d.VarId];
            var produced = NetworkSpelling.ProducerType(d.Input!, d.VarId, _net.Trees, _lang,
                id => _defined.TryGetValue(id, out var t) ? t : null);
            if (d.Type is not null && NetworkSpelling.Disagreement(produced, d.Type) is { } says)
                throw Unrepresentable("a wire typed unlike its producer",
                    $"the wire {name} in network {_net.Order} is declared {d.Type} and its producer is {says}.");
            var type = produced.Exact
                       ?? (produced.AnyBit ? d.Type ?? NetworkSpelling.Bool : null)
                       ?? d.Type
                       ?? throw Unrepresentable("a wire of unknown type",
                           $"the wire {name} in network {_net.Order} is fed by a {d.Input!.GetType().Name} whose type the model does not carry.");
            if (!NetworkSpelling.IsSpellableType(type))
                throw Unrepresentable("a wire of unspellable type",
                    $"the wire {name} in network {_net.Order} has the type '{type}', which a VAR_TEMP declaration cannot hold.");
            // Written in the text's one spelling of a type's tokens, never as a holder happened to lay it out — the
            // text's own declaration included — so the canonical form does not depend on the engineer's layout.
            type = NetworkSpelling.WireType(type);

            // The reader checks the declaration against the producer AS THE TEXT CARRIES IT — without the vendor's
            // stored output types, which the text has no position for. A stored type the text's own rule
            // contradicts (a bitwise AND stored as DINT, a comparison stored as INT) would be written into a
            // declaration the reader refuses.
            var carried = NetworkSpelling.ProducerType(WithoutStoredTypes(d.Input!), d.VarId, _net.Trees, _lang,
                id => _defined.TryGetValue(id, out var t) ? t : null);
            if (NetworkSpelling.Disagreement(carried, type) is { } rule)
                throw Unrepresentable("a stored output type the text reads otherwise",
                    $"the wire {name} in network {_net.Order} is fed by a producer the vendor stores as {type}, and the text reads that producer as {rule}.");
            return type;
        }

        private static Node WithoutStoredTypes(Node n) => n is Box b ? b with { OutputTypes = null } : n;

        // ── names and operands ──────────────────────────────────────────────────────────────────────

        /// <summary>An assignment or <c>=&gt;</c> target: bare when it is a target token, else verbatim between
        /// backticks — the same rule as an operand, except that a literal is no target token. A wire-shaped name the
        /// scope does not hold is backticked too: bare, the reader refuses it as an undeclared wire
        /// (<see cref="NetworkSpelling.ReadsAsUndeclaredWire"/>).</summary>
        private string LValue(Operand o, string what)
        {
            if (o.Text.IndexOf('`') >= 0)
                throw Unrepresentable("operand text containing a backtick", $"{what} '{o.Text}' contains a backtick.");
            return NetworkSpelling.IsBareTarget(o.Text) && !NetworkSpelling.ReadsAsUndeclaredWire(o.Text, _scope)
                ? o.Text : "`" + o.Text + "`";
        }

        private static string Formal(string f, Box b) =>
            NetworkSpelling.Identifier.IsMatch(f)
                ? f
                : throw Unrepresentable("a pin name that is not an identifier",
                    $"the '{b.Type}' box has a pin named '{f}'.");

        /// <summary>An operand as a bare token when it is exactly one, else verbatim between backticks. A backtick
        /// cannot occur in ST, so text holding one has no spelling. A wire-shaped name the scope does not hold is
        /// backticked as the target is (<see cref="LValue"/>).</summary>
        private string Operand(string text, string what)
        {
            if (text.IndexOf('`') >= 0)
                throw Unrepresentable("operand text containing a backtick", $"{what} '{text}' contains a backtick.");
            return NetworkSpelling.IsToken(text) && !NetworkSpelling.ReadsAsUndeclaredWire(text, _scope) ? text : "`" + text + "`";
        }

        /// <summary>A construct (<c>R_EDGE(x)</c>, <c>PARALLEL(…)</c>) the scope gives a POU or instance of the same
        /// name has no spelling: the reader would refuse it as that call (<see cref="NetworkSpelling.ConstructTaken"/>).
        /// A fact of the SCOPE, not of the body — which holds no box of that name — so it is named apart from
        /// <see cref="RefuseEdgeWord"/>.</summary>
        private void RefuseTakenConstruct(string word)
        {
            if (NetworkSpelling.ConstructTaken(word, _scope))
                throw Unrepresentable(word + " beside a POU or instance of that name",
                    $"network {_net.Order} spells {word}(…), and a POU or FB instance in scope is named {word}, so the text would read it as that call.");
        }

        /// <summary>A box whose own type or instance is named <c>PARALLEL</c>, <c>R_EDGE</c> or <c>F_EDGE</c> has no
        /// call the reader reads back as that box: bare, the head is read as the construct; between backticks, the
        /// reader refuses it by name (spec, "a POU named like an edge word").</summary>
        private static void RefuseEdgeWord(string name, string what)
        {
            if (NetworkSpelling.ConstructWords.Contains(name))
                throw Unrepresentable("a POU or instance named " + name.ToUpperInvariant(),
                    $"{what} is named '{name}', which the text reads as its own construct.");
        }

        /// <summary>Every identifier the network spells, into the reserved set, and every Demux VarId in item
        /// order. A node's OWN words here; its sub-trees through <see cref="Node.Children"/>, the model's one list of
        /// them, in item order — a hand-copied list per kind is how a subtree goes unvisited.</summary>
        private static void Collect(Node n, HashSet<string> names, List<int> ids)
        {
            switch (n)
            {
                case Leaf l: Words(l.Operand.Text, names); break;
                case Demux d: ids.Add(d.VarId); break;
                case Assign a:
                    foreach (var t in a.Targets) Words(t.Text, names);
                    break;
                case Box b:
                    Words(b.Type, names);
                    if (b.Instance is { } i) Words(i.Text, names);
                    foreach (var o in b.Outputs) Words(o.Value.Text, names);
                    break;
            }
            foreach (var child in n.Children()) Collect(child, names, ids);
        }

        private static void Words(string text, HashSet<string> into) => into.UnionWith(NetworkSpelling.Words(text));

        private static string Describe(Flags f) =>
            string.Join(" + ", new[]
            {
                f.Negated ? "a negation" : null, f.Set ? "a set" : null, f.Reset ? "a reset" : null,
                f.Jump ? "a jump" : null, f.Return ? "a return" : null,
                f.Rising ? "a rising edge" : null, f.Falling ? "a falling edge" : null,
            }.Where(s => s != null));

        private static NetworkUnrepresentableException Unrepresentable(string reason, string detail) => new(reason, detail);
    }
}

/// <summary>
/// The v2 writer's one refusal: the fact it has no spelling for (<see cref="Body.UnrepresentableBodyException.Marker"/>,
/// the reason a pull materializes the marker for) and WHERE it met it. A pull only needs the reason; a push needs
/// the place too, because there the model came from the engineer's text and the finding belongs at the construct
/// that holds the fact — so the writer records the innermost node it was writing and the network it was in.
/// </summary>
public sealed class NetworkUnrepresentableException : Body.UnrepresentableBodyException
{
    internal NetworkUnrepresentableException(string reason, string detail)
        : base(reason, "network text has no spelling for " + reason + ": " + detail +
                       " Volt materializes the body as a marker rather than write it without that fact.")
        => Detail = detail;

    /// <summary>What was found, without the pull's "materializes a marker" consequence.</summary>
    public string Detail { get; }

    /// <summary>The innermost model node being written when the fact was met; null for a network's own field.</summary>
    internal Node? At { get; set; }

    /// <summary>The position of the network being written, in the body.</summary>
    internal int? Network { get; set; }
}

