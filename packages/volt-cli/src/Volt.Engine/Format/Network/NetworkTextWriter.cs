using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Volt.Contracts;
using Volt.Engine.Format.Body;

namespace Volt.Engine.Format.Network;

/// <summary>
/// Network text v2.1 (openspec <c>ld-fbd-coverage</c> 2R.6b, <c>v2-spec.md</c>; the page is <c>docs/network-text.html</c>):
/// ONE WALK of the model. Each network's items are written in stored order, each item's tree root first, every node by the
/// one template of its kind with its children where NWL holds them. Nothing is reordered, hoisted or reconstructed: a box
/// fed through its EN is written where the consumer holds it, <c>MOVE 2 =&gt; b ENO EN MOVE 1 =&gt; a ENO EN start</c>.
///
/// <para><b>Layout is the writer's alone</b> (the reader ignores it): one buffer, the column passed down. A box in an EN
/// slot that is itself enabled goes on the next line one step deeper — the staircase — and a parallel whose branches hold
/// one is written one branch per line.</para>
///
/// <para><b>Refusals.</b> The model is validated first (<see cref="NetworkValidator"/>: vendor facts, X17, C13, the MEASURE
/// list); what is left here is a fact with no spelling at all (a label that is no identifier, a jump to no label). Either
/// throws <see cref="NetworkUnrepresentableException"/>, naming it; a pull shows a network refused in its trees as
/// <c>UNSUPPORTED "&lt;shape&gt;" #&lt;hash&gt;;</c>.</para>
/// </summary>
public static class NetworkTextWriter
{
    /// <summary>Render <paramref name="body"/>, refusing any network it cannot spell.</summary>
    /// <param name="scope">The declarations the body can see — the SAME <see cref="NetworkScope"/> the reader reads the text
    /// back against.</param>
    public static string Write(NetworkBody body, NetworkScope scope) => Write(body, scope, perNetwork: false);

    /// <summary>Render <paramref name="body"/> AS A PULL SHOWS IT: a network whose TREES the text cannot spell keeps its
    /// header and comment, its trees the one line <c>UNSUPPORTED "&lt;shape&gt;" #&lt;hash&gt;;</c>. The ONE render of a
    /// live network: the pull writes the file by it, and both drivers pair live networks with pushed ones by it
    /// (<see cref="NetworkPairing"/>).</summary>
    public static string WritePulled(NetworkBody body, NetworkScope scope) => Write(body, scope, perNetwork: true);

    private static string Write(NetworkBody body, NetworkScope scope, bool perNetwork)
    {
        if (body is null) throw new ArgumentNullException(nameof(body));
        if (scope is null) throw new ArgumentNullException(nameof(scope));

        var sb = new StringBuilder();
        sb.Append(St.PropertyLines.LanguageLine(NetworkText.Spelling(body.Language))).Append('\n');
        for (var i = 0; i < body.Networks.Count; i++)
        {
            var net = body.Networks[i];
            try
            {
                string text;
                try { text = new Emitter(net, scope).Emit(); }
                catch (NetworkUnrepresentableException e)
                    when (perNetwork && !e.OnHeader && net.Unsupported is null && NetworkSpelling.UnsupportedShape.IsMatch(e.Reason))
                {
                    text = new Emitter(net with { Trees = Array.Empty<Node>(), Unsupported = e.Reason, UnsupportedHash = Hash(net) }, scope).Emit();
                }
                sb.Append(text);
            }
            catch (NetworkUnrepresentableException e) when (e.Network is null)
            {
                e.Network = i;
                throw;
            }
        }
        return sb.ToString();
    }

    /// <summary>
    /// THE HASH AN <c>UNSUPPORTED</c> LINE CARRIES: 8 hex digits of the network as stored, so two networks shown as the same
    /// shape are two lines, and an edited line pairs with no live network. FNV-1a over a structural walk of the trees — every
    /// node kind and every fact the model holds of it — so the same stored network hashes alike on both vendors. A network
    /// the vendor reader could not read at all (no trees) hashes its shape, so two of them under one header show the same
    /// line; a push that deletes or moves one of the two is refused (<see cref="NetworkPairing.RefuseUnseenLoss"/>).
    /// </summary>
    public static string Hash(Network net)
    {
        var sb = new StringBuilder();
        if (net.Trees.Count == 0) sb.Append("unsupported:").Append(net.Unsupported);
        foreach (var t in net.Trees) Serialize(t, sb);
        uint h = 2166136261;
        foreach (var c in sb.ToString())
        {
            h ^= c;
            h *= 16777619;
        }
        return h.ToString("x8", System.Globalization.CultureInfo.InvariantCulture);
    }

    private static void Serialize(Node? n, StringBuilder sb)
    {
        static void F(Flags? f, StringBuilder s) => s.Append(f is null ? "-" : $"{(f.Negated ? 1 : 0)}{(f.Set ? 1 : 0)}{(f.Reset ? 1 : 0)}{(f.Jump ? 1 : 0)}{(f.Return ? 1 : 0)}{(f.Rising ? 1 : 0)}{(f.Falling ? 1 : 0)}");
        static void O(Operand? o, StringBuilder s)
        {
            if (o is null) { s.Append("~"); return; }
            s.Append('<').Append(o.Text.Length).Append(':').Append(o.Text);
            F(o.Flags, s);
            s.Append('>');
        }
        switch (n)
        {
            case null: sb.Append('~'); return;
            case Leaf l: sb.Append("(L"); O(l.Operand, sb); F(l.Flags, sb); break;
            case Terminator t: sb.Append("(T"); F(t.Flags, sb); break;
            case Assign a:
                sb.Append("(A"); F(a.Flags, sb);
                foreach (var t in a.Targets) O(t, sb);
                Serialize(a.Value, sb);
                break;
            case Demux d: sb.Append("(D").Append(d.VarId); Serialize(d.Input, sb); break;
            case Parallel p:
                sb.Append("(P").Append((int)p.Mode);
                Serialize(p.Input, sb);
                foreach (var b in p.Branches) Serialize(b, sb);
                break;
            case Box b:
                sb.Append("(B<").Append(b.Type.Length).Append(':').Append(b.Type).Append('>');
                O(b.Instance, sb); F(b.Flags, sb); F(b.EnableFlags, sb);
                sb.Append(b.StCode is null ? "~" : "<" + b.StCode.Length + ":" + b.StCode + ">");
                Serialize(b.Enable, sb);
                foreach (var p in b.Inputs) { sb.Append('i').Append(p.Formal ?? "~").Append(';'); F(p.Flags, sb); Serialize(p.Value, sb); }
                foreach (var o in b.Outputs) { sb.Append('o').Append(o.Formal ?? "~").Append(';').Append(o.Slot?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "~"); O(o.Value, sb); }
                sb.Append('c').Append(b.ConnectedSlot?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "~")
                  .Append('e').Append(b.HasEnoOutput ? 1 : 0).Append('n').Append(b.MainOutputName ?? "~");
                break;
            default: sb.Append("(?").Append(n.GetType().Name); break;
        }
        sb.Append(')');
    }

    /// <summary>The text under construction and its column — the one buffer the walk writes into.</summary>
    private sealed class Out
    {
        private readonly StringBuilder _sb = new();
        public Out(int column) => Column = column;
        public int Column { get; private set; }
        public bool MultiLine { get; private set; }

        public Out Add(string s)
        {
            _sb.Append(s);
            var nl = s.LastIndexOf('\n');
            if (nl < 0) Column += s.Length;
            else { Column = s.Length - nl - 1; MultiLine = true; }
            return this;
        }

        public Out Line(int column) => Add("\n" + new string(' ', column));
        public Out Append(Out other) => Add(other.ToString());
        public override string ToString() => _sb.ToString();
    }

    /// <summary>Where a value stands — what decides its brackets: a SLOT holds a box or a parallel bare; an OPERAND (a word's
    /// input, MOVE's, a parallel's feed, a positional pin) holds a term bare and brackets any other compound.</summary>
    private enum At { Slot, Operand }

    private sealed class Emitter
    {
        private const int ItemIndent = 2;
        private readonly Network _net;
        private readonly NetworkScope _scope;

        public Emitter(Network net, NetworkScope scope)
        {
            _net = net;
            _scope = scope;
        }

        public string Emit()
        {
            var body = new StringBuilder();
            if (_net.Unsupported is { } shape)
            {
                if (_net.Trees.Count > 0)
                    throw new ArgumentException(
                        $"network {_net.Order} is UNSUPPORTED ('{shape}') and holds {_net.Trees.Count} tree(s): such a network holds none.");
                if (!NetworkSpelling.UnsupportedShape.IsMatch(shape))
                    throw Unrepresentable("an unsupported network whose shape is no phrase",
                        $"network {_net.Order + 1} is UNSUPPORTED for '{shape}', and its line spells the shape as words.");
                var hash = _net.UnsupportedHash ?? Hash(_net);
                if (!NetworkSpelling.UnsupportedHash.IsMatch(hash))
                    throw new ArgumentException($"network {_net.Order}'s UNSUPPORTED hash '{hash}' is not 8 lower-case hex digits.");
                body.Append("  ").Append(NetworkSpelling.UnsupportedWord).Append(" \"").Append(shape).Append("\" #").Append(hash).Append(";\n");
            }
            else
            {
                NetworkValidator.Refuse(_net);
                foreach (var tree in _net.Trees)
                {
                    try
                    {
                        var o = new Out(ItemIndent);
                        Item(tree, o);
                        body.Append("  ").Append(o).Append(";\n");
                    }
                    catch (NetworkUnrepresentableException e) when (e.At is null) { e.At = tree; throw; }
                }
            }

            var sb = new StringBuilder();
            try { Header(sb); }
            catch (NetworkUnrepresentableException e) { e.OnHeader = true; throw; }
            sb.Append(body).Append("END_NETWORK\n");
            return sb.ToString();
        }

        /// <summary><c>NETWORK [LABEL: x] [DISABLED] [TITLE: "…"]</c> and the comment's <c>//</c> lines, one per stored CR LF
        /// line. An empty title or comment is none (the two stored values have one text, B7 L).</summary>
        private void Header(StringBuilder sb)
        {
            sb.Append("NETWORK");
            if (_net.Label is { } label)
            {
                if (!NetworkSpelling.Identifier.IsMatch(label))
                    throw Unrepresentable("a label that is not an identifier",
                        $"network {_net.Order + 1} carries the label '{label}', and a LABEL is one identifier.");
                sb.Append(" LABEL: ").Append(label);
            }
            if (_net.Disabled) sb.Append(" DISABLED");
            if (_net.Title is { Length: > 0 } title) sb.Append(" TITLE: \"").Append(NetworkSpelling.Escape(title, '"')).Append('"');
            sb.Append('\n');
            if (_net.Comment is { Length: > 0 } comment)
                foreach (var line in comment.Split(new[] { "\r\n" }, StringSplitOptions.None))
                    sb.Append("  //").Append(line.Length == 0 ? "" : " " + NetworkSpelling.Escape(line, null)).Append('\n');
        }

        // ── items ───────────────────────────────────────────────────────────────────────────────────

        private void Item(Node n, Out o)
        {
            switch (n)
            {
                case Terminator:
                    return;   // the empty item: `;` alone
                case Assign a:
                    AssignText(a, o);
                    return;
                case Demux { Input: not null } d:
                    SplitDefinition(d, o);
                    return;
                default:
                    Value(n, o, At.Slot, consumed: false);
                    return;
            }
        }

        /// <summary><c>coil coil … value</c>: the coils in stored order, the value after the last; a value the empty
        /// terminator is nothing, a negated one <c>NOT</c>.</summary>
        private void AssignText(Assign a, Out o)
        {
            var targets = a.Targets.Count == 0
                ? new List<Operand> { new(Box.UnnamedInstance, IsLValue: true, Flags: Flags.None with { Return = true }) }
                : a.Targets.ToList();
            if (targets.Count == 1 && (a.Flags.Jump || a.Flags.Return))
            {
                var f = targets[0].Flags ?? Flags.None;
                targets[0] = targets[0] with { Flags = f with { Jump = f.Jump || a.Flags.Jump, Return = f.Return || a.Flags.Return } };
            }
            for (var i = 0; i < targets.Count; i++)
            {
                if (i > 0) o.Add(" ");
                o.Add(Coil(targets[i]));
            }
            if (a.Value is Terminator { Flags.IsNone: true }) { o.Add(" "); return; }
            if (a.Value is Terminator { Flags.Negated: true }) { o.Add(" NOT"); return; }
            o.Add(" ");
            Value(a.Value, o, At.Slot, consumed: true);
        }

        /// <summary><c>[R_EDGE|F_EDGE] [NOT] head :=</c> or <c>[edge] head S=|R=</c>; the head a target, <c>JMP label</c> or
        /// <c>RETURN</c>.</summary>
        private static string Coil(Operand t)
        {
            var f = t.Flags ?? Flags.None;
            var head = f.Jump ? JumpHead(t) : f.Return ? ReturnHead(t) : Name(t.Text);
            var edge = f.Rising ? "R_EDGE " : f.Falling ? "F_EDGE " : "";
            var op = f.Reset ? "R=" : f.Set ? "S=" : ":=";
            return edge + (f.Negated ? "NOT " : "") + head + " " + op;
        }

        private static string JumpHead(Operand t)
        {
            if (!NetworkSpelling.Identifier.IsMatch(t.Text))
                throw Unrepresentable("a jump with no label", $"a jump names '{t.Text}', and JMP takes one label, an identifier.");
            return "JMP " + t.Text;
        }

        private static string ReturnHead(Operand t)
        {
            if (t.Text != Box.UnnamedInstance)
                throw Unrepresentable("a return with a named target", $"a return names the target '{t.Text}', and RETURN takes none.");
            return "RETURN";
        }

        private void SplitDefinition(Demux d, Out o)
        {
            o.Add(NetworkSpelling.SplitName(d.VarId) + " := ");
            Value(d.Input!, o, At.Slot, consumed: true);
        }

        // ── values ──────────────────────────────────────────────────────────────────────────────────

        private void Value(Node n, Out o, At at, bool consumed)
        {
            try { ValueCore(n, o, at, consumed); }
            catch (NetworkUnrepresentableException e) when (e.At is null) { e.At = n; throw; }
        }

        private void ValueCore(Node n, Out o, At at, bool consumed)
        {
            switch (n)
            {
                case Leaf l:
                    o.Add(Mods(l.Flags) + Atom(l.Operand.Text));
                    return;

                case Terminator:
                    return;   // an empty slot: a position, never a token

                case Demux { Input: null } d:
                    o.Add(NetworkSpelling.SplitName(d.VarId));
                    return;

                case Demux d:
                    o.Add("(");
                    SplitDefinition(d, o);
                    o.Add(")");
                    return;

                case Assign a:
                    o.Add("(");
                    AssignText(a, o);
                    o.Add(")");
                    return;

                case Parallel p:
                    if (at == At.Operand) o.Add("(");
                    ParallelText(p, o);
                    if (at == At.Operand) o.Add(")");
                    return;

                case Box b:
                {
                    var plainCall = IsCallForm(b) && !HasPinState(b);
                    var mods = Mods(b.Flags);
                    // A call with no pin state is a term (`NOT f(x)`); any other box after a modifier, or as an operand, is
                    // bracketed.
                    var bracket = !plainCall && (mods.Length > 0 || at == At.Operand);
                    o.Add(mods);
                    if (bracket) o.Add("(");
                    BoxText(b, o, consumed);
                    if (bracket) o.Add(")");
                    return;
                }

                default:
                    throw Unrepresentable("an unknown network item", $"network text has no form for the node '{n.GetType().Name}'.");
            }
        }

        /// <summary><c>[feed] BRANCH (b1, b2, …) [SHORTCIRCUIT]</c> — the branches on one line, or one per line where one
        /// of them spans lines.</summary>
        private void ParallelText(Parallel p, Out o)
        {
            if (p.Input is not null)
            {
                Value(p.Input, o, At.Operand, consumed: true);
                o.Add(" ");
            }
            o.Add(NetworkSpelling.BranchWord + " (");
            var col = o.Column;
            var branches = p.Branches.Select(br =>
            {
                var b = new Out(col);
                Value(br, b, At.Slot, consumed: true);
                return b;
            }).ToList();
            var perLine = branches.Any(b => b.MultiLine);
            for (var i = 0; i < branches.Count; i++)
            {
                if (i > 0)
                {
                    o.Add(",");
                    if (perLine) o.Line(col);
                    else o.Add(" ");
                }
                o.Append(branches[i]);
            }
            o.Add(")");
            if (p.Mode != NetworkSpelling.DerivedMode) o.Add(" " + NetworkSpelling.ShortCircuitWord);
        }

        // ── boxes ───────────────────────────────────────────────────────────────────────────────────

        private void BoxText(Box b, Out o, bool consumed)
        {
            var start = o.Column;
            if (b.StCode is not null) ExecuteText(b, o);
            else if (IsWordForm(b))
            {
                // The word between the inputs, an empty input written as nothing: `a ADD b ADD c`, `MUL a MUL 6`.
                var wrote = false;
                for (var i = 0; i < b.Inputs.Count; i++)
                {
                    if (i > 0)
                    {
                        if (wrote) o.Add(" ");
                        o.Add(b.Type);
                        wrote = true;
                    }
                    if (b.Inputs[i].Value is Terminator { Flags.IsNone: true }) continue;
                    if (wrote) o.Add(" ");
                    Value(b.Inputs[i].Value, o, At.Operand, consumed: true);
                    wrote = true;
                }
                OutputArrows(b, o);
            }
            else if (IsMoveForm(b))
            {
                o.Add(NetworkSpelling.Move);
                if (b.Inputs[0].Value is not Terminator { Flags.IsNone: true })
                {
                    o.Add(" ");
                    Value(b.Inputs[0].Value, o, At.Operand, consumed: true);
                }
                OutputArrows(b, o);
            }
            else CallText(b, o, consumed);

            PinState(b, o, start);
        }

        /// <summary>A word form's outputs, <c> =&gt; v</c> each in slot order.</summary>
        private static void OutputArrows(Box b, Out o)
        {
            foreach (var x in DataOutputs(b)) o.Add(" => " + Name(x.Value.Text));
        }

        /// <summary><c>[ENO [=&gt; v]] [[mods] EN [src]]</c> — ENO where the enabled box has the pin, EN last; a box in the EN
        /// slot that is itself enabled goes on the next line, one step deeper than its consumer (the staircase).</summary>
        private void PinState(Box b, Out o, int boxColumn)
        {
            if (NetworkSpelling.EnoShown(b))
            {
                o.Add(" ENO");
                if (b.Outputs.FirstOrDefault(IsEnoPin) is { } wired) o.Add(" => " + Name(wired.Value.Text));
            }
            if (b.Enable is null) return;
            o.Add(" " + Mods(b.EnableFlags) + "EN");
            if (b.Enable is Terminator { Flags.IsNone: true }) return;
            if (b.Enable is Box { Enable: not null } || b.Enable is Box { StCode: not null }) o.Line(boxColumn + 2);
            else o.Add(" ");
            Value(b.Enable, o, At.Slot, consumed: true);
        }

        /// <summary><c>EXECUTE</c> ⏎ the ST verbatim ⏎ <c>END_EXECUTE</c>, aligned under its <c>EXECUTE</c>.</summary>
        private static void ExecuteText(Box b, Out o)
        {
            if (!string.Equals(b.Type, NetworkSpelling.ExecuteType, StringComparison.Ordinal))
                throw Unrepresentable("an Execute box of another type",
                    $"an Execute box has the type '{b.Type}', and the text reads every Execute box as '{NetworkSpelling.ExecuteType}'.");
            if (b.Inputs.Count > 0 || b.Outputs.Count > 0 || b.Instance is not null)
                throw Unrepresentable("an Execute box with pins", "an Execute box carries pins or an instance beside its ST.");
            var col = o.Column;
            var st = b.StCode!.Replace("\r\n", "\n");
            foreach (var line in st.Split('\n'))
            {
                if (EndExecute.IsMatch(line))
                    throw Unrepresentable("a snippet line starting with END_EXECUTE",
                        $"an Execute box holds the ST line '{line.Trim()}', which the text reads as the end of its body.");
                if (line.IndexOf('\r') >= 0)
                    throw Unrepresentable("a snippet line ending in a carriage return", "an Execute box holds a line ending in a lone carriage return.");
            }
            o.Add("EXECUTE\n" + st);
            o.Line(col);
            o.Add("END_EXECUTE");
        }

        private static readonly Regex EndExecute = new(@"^\s*END_EXECUTE\b", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

        /// <summary>A call: <c>inst : TYPE(pins)</c>, <c>f(pins)</c>, an operator's backticked word with positional pins
        /// (named where one is flagged); inputs <c>formal := v</c> in slot order, then the outputs; <c>.name</c> where a
        /// consumer reads an FB by a data output.</summary>
        private void CallText(Box b, Out o, bool consumed)
        {
            var op = NetworkSpelling.IsOperatorBox(b.Type) && b.Instance is null;
            o.Add(Head(b) + "(");
            var first = true;
            void Sep() { if (!first) o.Add(", "); first = false; }

            // An operator's pins are positional, named where one is flagged or stored under another name — and where its
            // one input is empty (`f()` is a box with none).
            var named = op && (b.Inputs.Select((p, i) => !p.Flags.IsNone || !NetworkSpelling.IsDefaultFormal(b.Type, i, p.Formal)).Any(x => x) ||
                               (b.Inputs.Count == 1 && b.Inputs[0].Value is Terminator));
            if (!op && b.Inputs.Count == 1 && b.Inputs[0].Formal is null && b.Inputs[0].Value is Terminator && !DataOutputs(b).Any())
                throw Unrepresentable("a lone unconnected input slot with no formal",
                    $"the '{b.Type}' box has one input slot, wired to nothing and unnamed, and `{b.Type}()` is a box with none.");
            for (var i = 0; i < b.Inputs.Count; i++)
            {
                var p = b.Inputs[i];
                Sep();
                var formal = op ? (named ? p.Formal ?? NetworkSpelling.DefaultFormal(b.Type, i) : null) : p.Formal;
                if (formal is null)
                {
                    if (!p.Flags.IsNone)
                        throw Unrepresentable("a modified unnamed pin of a call",
                            $"the '{b.Type}' box has {NetworkValidator.Describe(p.Flags)} on its unnamed input {i + 1}, and a pin's modifier stands before its name.");
                    Value(p.Value, o, At.Operand, consumed: true);
                    continue;
                }
                o.Add(Mods(p.Flags) + Name(formal) + " := ");
                Value(p.Value, o, At.Slot, consumed: true);
            }

            // Positional outputs fill the free slots in order (a bare `=>` passes one over); named ones name their pin.
            var next = 0;
            int? last = null;
            foreach (var x in DataOutputs(b))
            {
                if (x.Formal is { } f)
                {
                    Sep();
                    o.Add(Name(f) + " => " + Name(x.Value.Text));
                    continue;
                }
                if (x.Slot is not { } slot)
                    throw Unrepresentable("an output pin with no stored slot",
                        $"the '{b.Type}' box's unnamed output to '{x.Value.Text}' has no slot, and a positional `=>` is spelled by its slot.");
                if (slot <= last)
                    throw Unrepresentable("output pins out of slot order", $"the '{b.Type}' box lists its output slot {slot} after slot {last}.");
                last = slot;
                while (true)
                {
                    next = NetworkSpelling.NextFreeSlot(next, NetworkSpelling.EnoSlot(b), b.ConnectedSlot);
                    if (next > slot)
                        throw Unrepresentable("a connection by an unspellable output slot",
                            $"the '{b.Type}' box wires output slot {slot} to '{x.Value.Text}', which is its ENO or its connected slot.");
                    if (next == slot) break;
                    Sep();
                    o.Add("=>");
                    next++;
                }
                Sep();
                o.Add("=> " + Name(x.Value.Text));
                next++;
            }
            o.Add(")");

            if (consumed && b.Instance is not null && !NetworkSpelling.ConnectedByEno(b) && b.MainOutputName is { } name)
                o.Add("." + Name(name));
        }

        /// <summary>The call's head: <c>inst : TYPE</c> for an FB, the BoxType for any other call — bare where it is one name
        /// that is not reserved, else between backticks (an operator's word, <c>`NOT`</c>).</summary>
        private string Head(Box b)
        {
            if (b.Instance is { } inst)
            {
                if (inst.Flags is { IsNone: false } f)
                    throw Unrepresentable("a flag on an FB instance", $"the '{b.Type}' instance '{inst.Text}' carries {NetworkValidator.Describe(f)}.");
                if (inst.Text != Box.UnnamedInstance && _scope.InstanceType(inst.Text) is { } declared && !St.StDeclaration.SameType(declared, b.Type))
                    throw Unrepresentable("an FB instance declared with another type",
                        $"the instance '{inst.Text}' is a '{b.Type}' box and its declaration says '{declared}'.");
                return Name(inst.Text) + " : " + Name(b.Type);
            }
            if (_scope.InstanceType(b.Type) is { } instanceType)
                throw Unrepresentable("a function named like an FB instance in scope",
                    $"the function box '{b.Type}' has the name of the '{instanceType}' instance '{b.Type}', and its call would read back as that instance's.");
            return Name(b.Type);
        }

        // ── spelling ────────────────────────────────────────────────────────────────────────────────

        /// <summary>A value's modifiers: <c>[R_EDGE|F_EDGE] [NOT]</c> — the edge around the negated value (N17).</summary>
        private static string Mods(Flags f) => (f.Rising ? "R_EDGE " : f.Falling ? "F_EDGE " : "") + (f.Negated ? "NOT " : "");
    }

    /// <summary>A box is its word (<c>a ADD b</c>, <c>MOVE b</c>) where the word can hold it, else its call; an Execute
    /// box its ST between <c>EXECUTE</c> and <c>END_EXECUTE</c>.</summary>
    private static bool IsCallForm(Box b) => b.StCode is null && !IsWordForm(b) && !IsMoveForm(b);

    private static bool HasPinState(Box b) => b.Enable is not null;

    /// <summary>The word holds an operator box with two or more inputs, none of them a flagged pin, every formal its
    /// default or none, and only positional outputs filling the free slots in order.</summary>
    private static bool IsWordForm(Box b) =>
        b.Instance is null && b.StCode is null && NetworkSpelling.OperatorWords.Contains(b.Type) && b.Inputs.Count >= 2 &&
        WordPins(b);

    /// <summary><c>MOVE b</c>: one input that is a value, under the same pin conditions.</summary>
    private static bool IsMoveForm(Box b) =>
        b.Instance is null && b.StCode is null && string.Equals(b.Type, NetworkSpelling.Move, StringComparison.OrdinalIgnoreCase) &&
        b.Inputs.Count == 1 && WordPins(b);

    private static bool WordPins(Box b) =>
        b.Inputs.Select((p, i) => p.Flags.IsNone && NetworkSpelling.IsDefaultFormal(b.Type, i, p.Formal)).All(x => x) &&
        DataOutputs(b).All(o => o.Formal is null) && ConsecutiveOutputs(b);

    /// <summary>The box's data outputs — every output but the ENO pin of a box that shows ENO.</summary>
    private static IEnumerable<Output> DataOutputs(Box b) =>
        b.Outputs.Where(o => !(IsEnoPin(o) && NetworkSpelling.EnoShown(b)));

    private static bool IsEnoPin(Output o) => string.Equals(o.Formal, Box.EnoPin, StringComparison.OrdinalIgnoreCase);

    private static bool ConsecutiveOutputs(Box b)
    {
        var next = 0;
        foreach (var o in DataOutputs(b))
        {
            if (o.Slot is not { } slot) return false;
            next = NetworkSpelling.NextFreeSlot(next, NetworkSpelling.EnoSlot(b), b.ConnectedSlot);
            if (slot != next) return false;
            next++;
        }
        return true;
    }

    /// <summary>Whether the box is written as its word or as <c>MOVE b</c> — the reader refuses an operator's backticked
    /// call where this holds (one tree, one text).</summary>
    internal static bool IsWordOrMoveForm(Box b) => IsWordForm(b) || IsMoveForm(b);

    /// <summary>An operand: a bare token where it is exactly one (a literal included), else between backticks.</summary>
    private static string Atom(string text) => NetworkSpelling.IsToken(text) ? text : Backticked(text);

    /// <summary>A target, a call head, a pin or an output name: bare where it is a name that is not reserved, else between
    /// backticks.</summary>
    internal static string Name(string text) => NetworkSpelling.IsBareName(text) ? text : Backticked(text);

    private static string Backticked(string text) => "`" + NetworkSpelling.Escape(text, '`') + "`";

    private static NetworkUnrepresentableException Unrepresentable(string reason, string detail) => new(reason, detail);
}

/// <summary>
/// The writer's and the validator's one refusal: the fact the text has no spelling for (<see cref="UnrepresentableBodyException.Reason"/>,
/// the shape a pull's UNSUPPORTED line names) and WHERE it was met.
/// </summary>
public sealed class NetworkUnrepresentableException : UnrepresentableBodyException
{
    internal NetworkUnrepresentableException(string reason, string detail)
        : base(reason, "network text has no spelling for " + reason + ": " + detail +
                       " Volt pulls the network as its UNSUPPORTED line (or, for a header, the body as %LANGUAGE LD|FBD UNSUPPORTED) rather than write it without that fact.")
        => Detail = detail;

    /// <summary>What was found, without the pull's "pulls it UNSUPPORTED" consequence.</summary>
    public string Detail { get; }

    /// <summary>The <c>NETWORK_*</c> code a push refuses it under.</summary>
    public string Code { get; internal set; } = ConflictCodes.NetworkUnsupported;

    /// <summary>The innermost model node being written when the fact was met; null for a network's own field.</summary>
    internal Node? At { get; set; }

    /// <summary>The position of the network being written, in the body.</summary>
    internal int? Network { get; set; }

    /// <summary>Met on the network's header or comment, not in its trees: no UNSUPPORTED line can keep such a network.</summary>
    internal bool OnHeader { get; set; }
}
