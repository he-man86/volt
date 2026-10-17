using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Volt.Engine.Format.Body;

namespace Volt.Engine.Format.Network;

/// <summary>
/// Network text (openspec <c>ld-fbd-coverage</c> 2R.3, the grammar of <c>readability.md</c>, specified by
/// <c>docs/network-text.html</c>): renders a <see cref="NetworkBody"/> as one ITEM per top-level NWL item — the item's
/// lines up to its <c>;</c> — every owned subtree nested where the vendor holds it, and a name only where the vendor names
/// something (a <see cref="Demux"/>'s VarId, <c>split&lt;VarId&gt;</c>). One rule shapes every line: a box is always its
/// NAME (<c>a ADD b</c>, <c>a GT 40</c>, <c>MOVE b =&gt; a</c>); <c>:=</c>, <c>S=</c>, <c>R=</c> are coils only; <c>EN</c>
/// is the enable after the box; a line without <c>;</c> is OPEN, and each <c>ENO</c> takes the oldest open line above it
/// (P3); a drawn parallel is <c>[feed] BRANCH (a, b, …) [SHORTCIRCUIT]</c> (B8).
///
/// <para><b>One fold, one arm per model node class.</b> Each arm decides its spelling from the node in hand and the
/// CONTEXT it stands in (<see cref="At"/> — a slot holds one box unbracketed, an operand of a box word is bracketed when it
/// is a box word or a parallel; an enabled comparison is bracketed everywhere, P4). The per-line state is the boxes the
/// line reads through <c>ENO</c>, in text order: they become the open lines above it, a level at a time (P3).</para>
///
/// <para><b>A fact with no spelling throws <see cref="UnrepresentableBodyException"/>, naming it.</b> The pull turns a
/// refusal met in a network's trees into that network's <c>UNSUPPORTED "&lt;shape&gt;";</c> line; one on its header hides
/// the body. A member the vendor stores and the text derives (B7: output names and types, a bit operator's stored slot,
/// a split's stored type, the Parallel's mode where it is the editor's) is NOT a refusal: it is written only where it
/// differs from the derivation and has a natural spelling, else it is lost on rebuild (<see cref="RebuildLoss"/>), never
/// on an unchanged push (N28).</para>
/// </summary>
public static class NetworkTextWriter
{
    /// <summary>Render <paramref name="body"/>.</summary>
    /// <param name="scope">The declarations the body can see — the SAME <see cref="NetworkScope"/> the reader reads the
    /// text back against. REQUIRED: an FB instance the declarations do not name would read back as a function.</param>
    public static string Write(NetworkBody body, NetworkScope scope) => Write(body, scope, perNetwork: false);

    /// <summary>
    /// Render <paramref name="body"/> AS A PULL SHOWS IT (ld-fbd-coverage 1b.4): a network whose TREES hold a fact the text
    /// has no spelling for keeps its header and comment, and its trees become the one line <c>UNSUPPORTED "&lt;shape&gt;";</c>.
    /// The ONE render of a live network: the pull writes the file by it, and both drivers' push pairs the live networks
    /// with the pushed ones by it (<see cref="NetworkPairing"/>).
    /// </summary>
    public static string WritePulled(NetworkBody body, NetworkScope scope) => Write(body, scope, perNetwork: true);

    private static string Write(NetworkBody body, NetworkScope scope, bool perNetwork)
    {
        if (body is null) throw new ArgumentNullException(nameof(body));
        if (scope is null) throw new ArgumentNullException(nameof(scope));

        var sb = new StringBuilder();
        sb.Append(St.ImplementationMarker.For(NetworkText.Spelling(body.Language))).Append('\n');

        for (var i = 0; i < body.Networks.Count; i++)
        {
            var net = body.Networks[i];
            try
            {
                var one = new StringBuilder();
                try
                {
                    new Emitter(net, body.Language, scope).Emit(one);
                }
                catch (NetworkUnrepresentableException e)
                    when (perNetwork && !e.OnHeader && net.Unsupported is null && NetworkSpelling.UnsupportedShape.IsMatch(e.Reason))
                {
                    one.Clear();
                    new Emitter(net with { Trees = Array.Empty<Node>(), Unsupported = e.Reason }, body.Language, scope).Emit(one);
                }
                sb.Append(one);
            }
            catch (NetworkUnrepresentableException e) when (e.Network is null)
            {
                e.Network = i;
                throw;
            }
        }
        return sb.ToString();
    }

    /// <summary>Where a value stands — what decides its brackets (B5, P4).</summary>
    private enum At
    {
        /// <summary>A SLOT — a line's whole value (a coil's, a split's, a jump's), an EN tail, a pin value, a call
        /// argument, a branch, an edge's argument: it holds one box, unbracketed; only an enabled comparison is
        /// bracketed (P4 (2)).</summary>
        Slot,
        /// <summary>An operand of a box word — a word's input, MOVE's operand, a parallel's feed before BRANCH: a box
        /// word or a parallel stands in brackets (P4 (1)), and an enabled comparison (P4 (2)).</summary>
        Operand,
    }

    /// <summary>A rendered value: whether it is a WORD (a box word, MOVE's word form, a parallel — bracketed as an operand
    /// of another word) and whether it is an ENABLED COMPARISON (bracketed in every slot, P4 (2)). Anything else — an
    /// operand, a call, an edge, ENO, a split, a nested assignment — never takes brackets.</summary>
    private readonly record struct Spelled(string Text, bool Word = false, bool EnabledComparison = false);

    /// <summary>One line's state: the boxes it reads through <c>ENO</c>, in text order — the open lines it takes (P3) —
    /// and how deep in parallels the value being written stands (the outermost parallel of a line is laid out one branch
    /// per line, P2).</summary>
    private sealed class LineState
    {
        public readonly List<Box> Reads = new();
        public int ParallelDepth;
    }

    // Layout markers inside a line under construction: an outermost parallel's branch list opens, breaks between two
    // branches, and closes. Resolved into line breaks aligned under the list's first branch by Layout; no operand text can
    // hold them (refused by name).
    private const char ListOpen = '\u0001', ListBreak = '\u0002', ListClose = '\u0003';

    private sealed class Emitter
    {
        private readonly Network _net;
        private readonly BodyLanguage _lang;
        private readonly NetworkScope _scope;

        // Splits whose definition has been written. A reference to one not in here is a reference stored before its
        // definition — the vendor's order, which is never changed.
        private readonly HashSet<int> _defined = new();
        /// <summary>The splits whose definition's value is being written — a reference to one is a split feeding itself
        /// (2R.5, unmeasured: refused as the reader refuses it).</summary>
        private readonly HashSet<int> _defining = new();
        // Every VarId a Demux of the network defines, at any depth: a reference needs one somewhere (P9).
        private readonly HashSet<int> _definitions = new();

        public Emitter(Network net, BodyLanguage lang, NetworkScope scope)
        {
            _net = net;
            _lang = lang;
            _scope = scope;
            var ids = new List<int>();
            foreach (var t in net.Trees) Collect(t, ids);
            foreach (var t in net.Trees) CollectDefinitions(t, _definitions);
            foreach (var id in ids.Distinct())
                if (id < 0)
                    throw Unrepresentable("a split with a negative VarId",
                        $"a Demux carries VarId {id}, and a split is spelled split<digits>.");
        }

        public void Emit(StringBuilder sb)
        {
            var items = new List<string>();
            if (_net.Unsupported is { } shape)
            {
                if (_net.Trees.Count > 0)
                    throw new ArgumentException(
                        $"network {_net.Order} is UNSUPPORTED ('{shape}') and holds {_net.Trees.Count} tree(s): such a " +
                        "network holds none, because what it holds is what the text cannot say.");
                if (!NetworkSpelling.UnsupportedShape.IsMatch(shape))
                    throw Unrepresentable("an unsupported network whose shape is no phrase",
                        $"network {_net.Order} is UNSUPPORTED for '{shape}', and its line spells the shape as words.");
                items.Add("  " + NetworkSpelling.UnsupportedWord + " \"" + shape + "\";");
            }
            foreach (var tree in _net.Trees) items.AddRange(Item(tree));

            try { EmitHeader(sb); }
            catch (NetworkUnrepresentableException e) { e.OnHeader = true; throw; }

            foreach (var s in items) sb.Append(s).Append('\n');
            sb.Append("END_NETWORK\n");
        }

        /// <summary>The header line (P10: <c>NETWORK [LABEL: x] [DISABLED] [TITLE: "…"]</c>, in that order) and the
        /// comment lines under it — both exactly as the IDE stores them (2R.2 S: the trims went).</summary>
        private void EmitHeader(StringBuilder sb)
        {
            var h = new StringBuilder("NETWORK");
            if (_net.Label is { } label)
            {
                if (!NetworkSpelling.Identifier.IsMatch(label))
                    throw Unrepresentable("a label that is not an identifier",
                        $"network {_net.Order} carries the label '{label}', and a LABEL is one identifier.");
                h.Append(" LABEL: ").Append(label);
            }
            if (_net.Disabled) h.Append(" DISABLED");
            if (_net.Title is { } title)
            {
                // An empty title is no title (P10: `TITLE: ""` is refused), and the drivers read one as none.
                if (title.Length == 0)
                    throw Unrepresentable("an empty title", $"network {_net.Order} carries an empty title, which the drivers read as none.");
                h.Append(" TITLE: ").Append(Quote(title));
            }
            sb.Append(h).Append('\n');

            if (_net.Comment is { } comment)
            {
                if (comment.Length == 0)
                    throw Unrepresentable("an empty comment", $"network {_net.Order} carries an empty comment, which the drivers read as none.");
                // P10: the stored comment's lines are separated by CR LF, each one `//` line; a trailing CR LF is a final
                // bare `//` line; everything after `// ` is text, trailing spaces included. A LF or CR on its own has no
                // spelling: the file's line ends are CR LF or LF, and both read back as the IDE's CR LF.
                foreach (var line in comment.Split(new[] { "\r\n" }, StringSplitOptions.None))
                {
                    if (line.IndexOf('\n') >= 0)
                        throw Unrepresentable("a comment line ending in a bare line feed",
                            $"network {_net.Order}'s comment separates lines by a LF alone, and the text reads every line break as CR LF.");
                    if (line.IndexOf('\r') >= 0)
                        throw Unrepresentable("a comment line ending in a carriage return",
                            $"network {_net.Order}'s comment holds a line ending in a lone carriage return.");
                    sb.Append("  //").Append(line.Length == 0 ? "" : " " + line).Append('\n');
                }
            }
        }

        /// <summary>The TITLE string, with ST's own string escapes: <c>$N</c>, <c>$R</c>, <c>$"</c>, <c>$$</c>.</summary>
        private static string Quote(string s)
        {
            var q = new StringBuilder("\"");
            foreach (var c in s)
                q.Append(c switch { '$' => "$$", '"' => "$\"", '\n' => "$N", '\r' => "$R", _ => c.ToString() });
            return q.Append('"').ToString();
        }

        // ── items: one per top-level NWL item ───────────────────────────────────────────────────────

        /// <summary>
        /// A top-level item as its lines, ending in <c>;</c>. P3: every box the item reads through <c>ENO</c> is an OPEN
        /// line above it, and each <c>ENO</c> takes the oldest open line not yet taken — so the order is forced: the
        /// <c>;</c> line's ENOs are the last open lines, in its order; the lines THOSE read come before them, in theirs;
        /// and so on, a level at a time. A refusal met anywhere below records this item as where it was met, unless a
        /// node below it did.
        /// </summary>
        private IEnumerable<string> Item(Node n)
        {
            try
            {
                var st = new LineState();
                var text = ItemLine(n, st);
                var levels = new List<List<string>>();
                var frontier = st.Reads;
                while (frontier.Count > 0)
                {
                    var lines = new List<string>();
                    var next = new List<Box>();
                    foreach (var b in frontier)
                    {
                        var sub = new LineState();
                        lines.Add(Layout("  " + RootBox(b, sub, consumed: true).Text));
                        next.AddRange(sub.Reads);
                    }
                    levels.Add(lines);
                    frontier = next;
                }
                levels.Reverse();
                return levels.SelectMany(l => l).Concat(new[] { Layout("  " + text + ";") }).ToList();
            }
            catch (NetworkUnrepresentableException e) when (e.At is null) { e.At = n; throw; }
        }

        /// <summary>P2: an outermost parallel's branches one per line, each aligned under the first.</summary>
        private static string Layout(string line)
        {
            if (line.IndexOf(ListOpen) < 0) return line;
            var sb = new StringBuilder();
            var col = 0;
            var stack = new Stack<int>();
            foreach (var c in line)
            {
                switch (c)
                {
                    case ListOpen: sb.Append('('); col++; stack.Push(col); break;
                    case ListClose: sb.Append(')'); col++; stack.Pop(); break;
                    case ListBreak: sb.Append('\n').Append(' ', stack.Peek()); col = stack.Peek(); break;
                    default: sb.Append(c); col = c == '\n' ? 0 : col + 1; break;
                }
            }
            return sb.ToString();
        }

        private string ItemLine(Node n, LineState st)
        {
            switch (n)
            {
                case Assign a when LoneControlFlow(a):
                    return ControlFlow(a, st);

                case Assign a:
                {
                    // `t1 := JMP l := t2 S= value` — ONE item, its targets in order and the value on the right. A jump and a
                    // return are coils (B4b, 2R.5): a target like any other, beside other coils, set or modified.
                    var heads = Heads(a);
                    if (a.Value is Terminator { Flags.IsNone: true }) return heads + " ";
                    // `x := NOT ;`: a negated empty slot is the value of one plain coil (2R.5 #6a), measured nowhere else.
                    if (a.Value is Terminator { Flags: { Negated: true } nf } && (nf with { Negated = false }).IsNone &&
                        FlowTargets(a) is { Count: 1 } one && (one[0].Flags ?? Flags.None).IsNone)
                        return heads + " NOT ";
                    return heads + " " + Value(a.Value, st, At.Slot).Text;
                }

                case Demux d when d.Input is not null:
                    return SplitDefinition(d, st);

                // The empty item: a `;` that closes no statement.
                case Terminator t:
                    if (!t.Flags.IsNone)
                        throw Unrepresentable("a flag on an empty item",
                            $"an unconnected top-level terminator in network {_net.Order} carries {Describe(t.Flags)}.");
                    return "";

                default:
                    if (n is Box { ConnectedSlot: { } slot } b)
                        throw Unrepresentable("a top-level box with a connection slot",
                            $"the top-level '{b.Type}' box records output slot {slot} as connected, and nothing consumes it.");
                    return n is Box top
                        ? Modified(RootBox(top, st, consumed: false), top.Flags, $"the '{top.Type}' box").Text
                        : Value(n, st, At.Slot).Text;
            }
        }

        /// <summary>The item's targets with the control-flow bits they carry (DIALECT C13: the bit rides on the target and
        /// on the item — the item's is a cache, 2R.4). One target takes the item's bit; with several, an item bit no target
        /// carries names none of them, and is refused by name.</summary>
        private List<Operand> FlowTargets(Assign a)
        {
            RefuseItemFlags(a.Flags with { Jump = false, Return = false }, "an Assign item");
            if (a.Targets.Count == 1 && (a.Flags.Jump || a.Flags.Return))
            {
                var t = a.Targets[0];
                var f = t.Flags ?? Flags.None;
                return new List<Operand> { t with { Flags = f with { Jump = f.Jump || a.Flags.Jump, Return = f.Return || a.Flags.Return } } };
            }
            if ((a.Flags.Jump && !a.Targets.Any(t => t.Flags?.Jump == true)) ||
                (a.Flags.Return && !a.Targets.Any(t => t.Flags?.Return == true)))
                throw Unrepresentable("a jump bit on an item no target carries",
                    $"an Assign in network {_net.Order} carries the {(a.Flags.Jump ? "Jump" : "Return")} bit on the item and on none of its {a.Targets.Count} targets.");
            return a.Targets.ToList();
        }

        private static bool IsFlow(Operand t) => t.Flags is { } f && (f.Jump || f.Return);

        /// <summary>The ONE jump or return of its rung, a plain coil (P7): <c>JMP l</c> / <c>RETURN</c> on the rail, else
        /// <c>JMP l := c</c>. A jump beside another coil, set or modified is written by <see cref="Heads"/>.</summary>
        private bool LoneControlFlow(Assign a)
        {
            if (a.Targets.Count == 0) return a.Flags.Return;
            if (a.Targets.Count != 1) return false;
            var t = FlowTargets(a)[0];
            return IsFlow(t) && (t.Flags! with { Jump = false, Return = false }).IsNone;
        }

        /// <summary>The coils of an item, in order: <c>[R_EDGE|F_EDGE] [NOT] (target | JMP l | RETURN) (:= | S= | R=)</c>
        /// each (2R.5) — a modifier stands before the coil it modifies, as on a pin.</summary>
        private string Heads(Assign a)
        {
            if (a.Targets.Count == 0)
                throw Unrepresentable("an assign with no target",
                    "an Assign item drives no target, and `value;` spells the value item itself.");
            var targets = FlowTargets(a);
            // Measured per row before its spelling ships (2R.5): a negated or edge coil alone on its item.
            if (targets.Count > 1 && targets.FirstOrDefault(t => t.Flags is { } f && (f.Negated || f.Rising || f.Falling)) is { } m)
                throw Unrepresentable("a modified coil beside another coil",
                    $"the coil '{m.Text}' in network {_net.Order} carries {Describe(m.Flags!)}. {NetworkSpelling.UnmeasuredModifiedFanOut}");
            return string.Join(" ", targets.Select(t => CoilHead(t) + " " + StorageOp(t)));
        }

        private string CoilHead(Operand t)
        {
            var f = t.Flags ?? Flags.None;
            if (f.Rising && f.Falling)
                throw Unrepresentable("rising and falling on one coil", $"the coil '{t.Text}' carries both a rising and a falling edge.");
            if (f.Jump && f.Return)
                throw Unrepresentable("an item that both jumps and returns",
                    $"the target '{t.Text}' in network {_net.Order} carries both the Jump and the Return bit.");
            // Measured per row before its spelling ships (2R.5): a jump or a return takes `S=` alone, a coil one edge alone.
            if ((f.Jump || f.Return) && (f.Negated || f.Rising || f.Falling || f.Reset))
                throw Unrepresentable("a modified jump or return", $"the target '{t.Text}' in network {_net.Order} carries {Describe(f)}. {NetworkSpelling.UnmeasuredFlow}");
            if ((f.Rising || f.Falling) && (f.Negated || f.Set || f.Reset))
                throw Unrepresentable("an edge on a negated set or reset coil", $"the coil '{t.Text}' carries {Describe(f)}. {NetworkSpelling.UnmeasuredEdgeCoil}");
            var mods = PinModifiers(f with { Set = false, Reset = false, Jump = false, Return = false });
            if (f.Jump)
            {
                if (!NetworkSpelling.Identifier.IsMatch(t.Text))
                    throw Unrepresentable("a jump with no label",
                        $"a jump in network {_net.Order} names '{t.Text}', and JMP takes one label.");
                return mods + "JMP " + t.Text;
            }
            if (f.Return)
            {
                if (t.Text != Box.UnnamedInstance)
                    throw Unrepresentable("a return with a named target",
                        $"a return in network {_net.Order} names the target '{t.Text}', and RETURN takes none.");
                return mods + "RETURN";
            }
            return mods + LValue(t, "an assignment target");
        }

        /// <summary>B4b: <c>JMP l</c> / <c>RETURN</c> on the rail when nothing drives it, else a coil:
        /// <c>JMP l := c</c>, <c>RETURN := c</c> (P7).</summary>
        private string ControlFlow(Assign a, LineState st)
        {
            RefuseItemFlags(a.Flags with { Jump = false, Return = false }, "a jump or return item");
            var target = a.Targets.Count == 1 ? FlowTargets(a)[0] : null;
            var jump = target?.Flags?.Jump == true;
            var ret = a.Flags.Return || target?.Flags?.Return == true;
            if (jump && ret)
                throw Unrepresentable("an item that both jumps and returns",
                    $"an Assign in network {_net.Order} carries both the Jump and the Return bit.");

            string action;
            if (jump)
            {
                if (target is null || !NetworkSpelling.Identifier.IsMatch(target.Text))
                    throw Unrepresentable("a jump with no label",
                        $"a jump in network {_net.Order} names '{target?.Text}', and JMP takes one label.");
                action = "JMP " + target.Text;
            }
            else
            {
                if (target is not null && target.Text != Box.UnnamedInstance)
                    throw Unrepresentable("a return with a named target",
                        $"a return in network {_net.Order} names the target '{target.Text}', and RETURN takes none.");
                action = "RETURN";
            }

            // On the rail when nothing drives it: the empty Terminator (DIALECT C11).
            if (a.Value is Terminator { Flags.IsNone: true }) return action;
            return action + " := " + Value(a.Value, st, At.Slot).Text;
        }

        /// <summary>B6, P9: <c>split&lt;VarId&gt; := value</c> — its one definition, top level or nested (2R.5). A declaration of
        /// that name is no second meaning: P1 reserves the pattern, so the bare word is the split and the variable is written
        /// backticked (both IDEs build the shape clean, rcc_network_wire_named_like_variable). No type is ever written (B6):
        /// the Demux holds none.</summary>
        private string SplitDefinition(Demux d, LineState st)
        {
            if (!_defined.Add(d.VarId))
                throw Unrepresentable("a split defined twice",
                    $"two Demux items define VarId {d.VarId} in network {_net.Order}.");
            _defining.Add(d.VarId);
            try { return NetworkSpelling.SplitName(d.VarId) + " := " + Value(d.Input!, st, At.Slot).Text; }
            finally { _defining.Remove(d.VarId); }
        }

        // ── values: one arm per node class ──────────────────────────────────────────────────────────

        private Spelled Value(Node n, LineState st, At at)
        {
            try { return Bracketed(ValueCore(n, st), at); }
            catch (NetworkUnrepresentableException e) when (e.At is null) { e.At = n; throw; }
        }

        /// <summary>P4: brackets on exactly three things — a box word or a parallel that is an operand of another word, an
        /// enabled comparison wherever it stands as a value, and a nested assignment (its own arm).</summary>
        private static Spelled Bracketed(Spelled s, At at) =>
            s.EnabledComparison || (at == At.Operand && s.Word) ? new Spelled("(" + s.Text + ")") : s;

        private Spelled ValueCore(Node n, LineState st)
        {
            switch (n)
            {
                case Leaf l:
                    if (l.Operand.Flags is { IsNone: false } of && of != l.Flags)
                        throw Unrepresentable("an operand whose flags disagree with its item",
                            $"the operand '{l.Operand.Text}' carries {Describe(of)} and its item {Describe(l.Flags)}.");
                    return Modified(new Spelled(Operand(l.Operand.Text, "an operand")), l.Flags, $"the operand '{l.Operand.Text}'");

                // 2R.5 (#20): a split defined below the top level stores, builds and runs — written where it stands, in
                // brackets like a nested assignment (P4 (3)): `x := (split1 := a AND b);`.
                case Demux { Input: not null } d:
                    return new Spelled("(" + SplitDefinition(d, st) + ")");

                // 2R.5 (#19): a reference stored above its definition is written where it stands (it reads the previous
                // scan); the vendor's item order is never changed.
                case Demux d:
                    if (!_definitions.Contains(d.VarId))
                        throw Unrepresentable("a split referenced and never defined",
                            $"network {_net.Order} references VarId {d.VarId}, and no item of it defines that split.");
                    if (_defining.Contains(d.VarId))
                        throw Unrepresentable("a split read inside its own definition",
                            $"network {_net.Order} reads VarId {d.VarId} inside the value that defines it. {NetworkSpelling.SplitName(d.VarId)} read inside its own definition: a split that feeds itself is not measured (2R.5).");
                    return new Spelled(NetworkSpelling.SplitName(d.VarId));

                // Whether a consumer reads the box through its ENO is the box's ENO output: unread, it decides nothing
                // else first.
                case Box b when b.StCode is null && b.HasEnoOutput is null && NetworkSpelling.EnoCarried(b, consumed: true):
                    throw Unrepresentable("a box whose ENO output was not read",
                        $"the '{b.Type}' box does not record whether it has an ENO output, and its text depends on it.");

                case Box b when NetworkSpelling.ConnectedByEno(b):
                    return EnoRead(b, st);

                case Box b:
                    return Modified(BoxValue(b, st), b.Flags, $"the '{b.Type}' box");

                case Parallel p:
                    return ParallelValue(p, st);

                case Terminator t:
                    // 2R.5 (#6a): a negated empty slot is measured as a plain coil's value only (`ItemLine`); an edge on one
                    // nowhere.
                    if (!(t.Flags with { Negated = false }).IsNone)
                        throw Unrepresentable("a flag on an empty slot",
                            $"an unconnected slot in network {_net.Order} carries {Describe(t.Flags)}, and an empty slot has no text to modify but its negation.");
                    if (t.Flags.Negated)
                        throw Unrepresentable("a negated empty slot outside a coil value",
                            $"an unconnected slot in network {_net.Order} is negated. {NetworkSpelling.UnmeasuredNegatedEmpty}");
                    return new Spelled("");   // the empty slot: a position, never a token

                // S2: an assignment below the top level, `(t1 := t2 S= value)` — its brackets never dropped (P4 (3)). A
                // jump is a coil, and a coil nests (2R.5).
                case Assign a:
                {
                    var heads = Heads(a);
                    var value = Value(a.Value, st, At.Slot).Text;
                    return new Spelled("(" + heads + (value.Length == 0 ? "" : " " + value) + ")");
                }

                default:
                    throw Unrepresentable("an unknown network item",
                        $"network text has no form for the node '{n.GetType().Name}'.");
            }
        }

        /// <summary>B4, P3: a box a consumer reads through its ENO is an OPEN line above the line that reads it — the word
        /// <c>ENO</c> here, carrying the box's modifiers (a consumed box carries none of its own). Recorded in text order:
        /// the item lays the open lines out from it (<see cref="Item"/>).</summary>
        private Spelled EnoRead(Box b, LineState st)
        {
            if (b.HasEnoOutput is null && b.StCode is null)
                throw Unrepresentable("a box whose ENO output was not read",
                    $"the '{b.Type}' box does not record whether it has an ENO output, and its text depends on it.");
            if (b.Flags.Set || b.Flags.Reset || b.Flags.Jump || b.Flags.Return)
                throw Unrepresentable("a coil flag on a value", $"the '{b.Type}' box carries {Describe(b.Flags)}, which a value has no spelling for.");
            st.Reads.Add(b);
            return Modified(new Spelled("ENO"), b.Flags, $"the '{b.Type}' box");
        }

        /// <summary>A box at a LINE'S ROOT: a top-level item (<paramref name="consumed"/> false) or an open line a later
        /// <c>ENO</c> takes. It is the one place an EXECUTE stands, and the one place an enabled non-comparison box stands
        /// (B4: an enabled box's value leaves only through <c>=&gt;</c> or <c>ENO</c>).</summary>
        private Spelled RootBox(Box b, LineState st, bool consumed)
        {
            if (b.StCode is not null) return new Spelled(Execute(b, st));
            if (consumed)
            {
                // P3: an open line's root has an ENO — an operator box (MOVE and the comparisons included: 2R.5, #22)
                // shows ENO only with EN (N16, N21).
                if (b.Enable is null && IsOperatorBox(b))
                    throw Unrepresentable("an operator box without EN read through its ENO",
                        $"a consumer reads the '{b.Type}' box through its ENO, and an operator box shows ENO only with EN (N21).");
            }
            return BoxCore(b, st, consumed: consumed, root: true);
        }

        private static bool IsOperatorBox(Box b) =>
            NetworkSpelling.OperatorWords.Contains(b.Type) ||
            string.Equals(b.Type, NetworkSpelling.Move, StringComparison.OrdinalIgnoreCase) ||
            string.Equals(b.Type, NetworkSpelling.NotBox, StringComparison.OrdinalIgnoreCase);

        /// <summary>A box consumed by its main output — a value inside a line. B4: an enabled box there reads its ENO, not
        /// its data, so only a comparison (no ENO) is an enabled VALUE, <c>(a GT 40 EN c)</c>.</summary>
        private Spelled BoxValue(Box b, LineState st)
        {
            if (b.StCode is not null)
                throw Unrepresentable("an EXECUTE box read as a value",
                    $"an EXECUTE box in network {_net.Order} is read by a consumer other than through its ENO, its only output.");
            if (b.Enable is not null && !NetworkSpelling.Comparisons.Contains(b.Type))
                throw Unrepresentable("an enabled box read as a value",
                    $"a consumer reads the enabled '{b.Type}' box by its data output, and a consumer of an enabled box reads its ENO (B4, N21).");
            return BoxCore(b, st, consumed: true, root: false);
        }

        /// <summary>A box, without its own modifiers: its word form (B1, B2) or its call (P5), with its EN tail (B3).</summary>
        private Spelled BoxCore(Box b, LineState st, bool consumed, bool root)
        {
            for (var i = 0; i < b.Inputs.Count; i++)
                if (b.Inputs[i] is { Flags.IsNone: false } p && !PinModifiable(p.Flags))
                    // S6 spells a NEGATED pin (census 1.13: 6 of 6), 2R.5 an edge on one (#15); a coil bit stays refused.
                    throw Unrepresentable(BoxRefusals.PinFlagMarker,
                        $"the '{b.Type}' box has {Describe(p.Flags)} on its pin {p.Formal ?? $"input {i}"}" +
                        (p.Value is Leaf feed ? $" fed by '{feed.Operand.Text}'." : "."));
            // 2R.5 (#16): the EN pin's own modifier, `NOT EN c`.
            if (!PinModifiable(b.EnableFlags) || b.EnableFlags.Rising || b.EnableFlags.Falling)
                throw Unrepresentable(BoxRefusals.PinFlagMarker, $"the '{b.Type}' box has {Describe(b.EnableFlags)} on its EN pin.");
            if (b.Enable is null && !b.EnableFlags.IsNone)
                throw Unrepresentable(BoxRefusals.PinFlagMarker, $"the '{b.Type}' box has {Describe(b.EnableFlags)} on an EN pin it does not have.");

            // C3, B1's guard: the compiler refuses a third input on these ("'-' needs exactly '2' operands").
            if (NetworkSpelling.TwoInputOperators.Contains(b.Type) && b.Inputs.Count > 2)
                throw Unrepresentable("a two input operator box with more inputs",
                    $"the '{b.Type}' box holds {b.Inputs.Count} inputs, and {b.Type.ToUpperInvariant()} takes two (C3: the build refuses it).");
            // 2R.5 (awkward-sweep #4): fewer than two stores and does not build, on both vendors.
            if (NetworkSpelling.OperatorWords.Contains(b.Type) && b.Instance is null && b.StCode is null && b.Inputs.Count < 2)
                throw Unrepresentable("an operator box with fewer than two inputs",
                    $"the '{b.Type}' box holds {b.Inputs.Count} input(s), and {b.Type.ToUpperInvariant()} takes at least two (the build refuses it: \"needs at least '2' operands\").");


            // The text's reading of ENO (NetworkSpelling.TextHasEno): a line root with EN, or an open line read by ENO,
            // has one; a value has none. Where it decides the text, an unread fact is refused first, by its own name.
            var byEno = NetworkSpelling.ConnectedByEno(b);
            if (NetworkSpelling.EnoCarried(b, consumed))
            {
                if (b.HasEnoOutput is not { } has)
                    throw Unrepresentable("a box whose ENO output was not read",
                        $"the '{b.Type}' box does not record whether it has an ENO output, and its text depends on it.");
                if (has != NetworkSpelling.TextHasEno(isExecute: false, b.Enable is not null, byEno, consumed))
                    throw Unrepresentable("an ENO output the text reads otherwise",
                        has
                            ? $"the '{b.Type}' box has an ENO output and no EN, and the text reads a box with neither EN nor a reader of ENO as having none."
                            : $"the '{b.Type}' box has EN and no ENO output, and the text reads a top-level box with EN as having one.");
            }

            var suffix = consumed && !root ? Suffix(b) : "";
            var enabledComparison = b.Enable is not null && NetworkSpelling.Comparisons.Contains(b.Type);

            if (NetworkSpelling.IsWordForm(b) || NetworkSpelling.IsMoveWordForm(b))
            {
                if (suffix.Length > 0)
                    throw Unrepresentable("a main output other than slot 0 with no output name",
                        $"the '{b.Type}' operator is read through a named output, and an operator's word has no position for it.");
                // In text order: the operands, the `=>` pins, the EN tail (P3 numbers the ENOs left to right).
                var operands = b.Inputs.Select(p => Value(p.Value, st, At.Operand).Text).ToList();
                var core = NetworkSpelling.IsMoveWordForm(b)
                    ? NetworkSpelling.Move + " " + operands.Single()
                    : string.Join(" " + b.Type + " ", operands);
                var outputs = OutputsAfter(b);
                var en = b.Enable is null ? "" : EnTail(b.Enable, b.EnableFlags, st);
                return new Spelled(core + outputs + en, Word: true, EnabledComparison: enabledComparison);
            }

            // The call form: a POU's call, and an operator the word form cannot carry (P5). Every call keeps its output
            // pins inside its brackets, MOVE's included (`MOVE(IN := , => x)`).
            var isNot = string.Equals(b.Type, NetworkSpelling.NotBox, StringComparison.OrdinalIgnoreCase);
            var head = Head(b);
            var pins = new List<string>();
            for (var i = 0; i < b.Inputs.Count; i++)
            {
                var p = b.Inputs[i];
                var dflt = NetworkSpelling.DefaultFormal(b.Type, i);
                // A formal is written where the tree needs one: the stored non-default one, a negated pin's (S6), the NOT
                // box's always (P5: `NOT(IN := a)`), and a lone empty slot's (`MOVE(IN := )`: `MOVE()` has no slot).
                var formal = p.Formal is { } stored && !NetworkSpelling.IsDefaultFormal(b.Type, i, stored) ? stored
                    : !p.Flags.IsNone || isNot || (p.Value is Terminator && b.Inputs.Count == 1) ? dflt ?? p.Formal
                    : null;
                if (!p.Flags.IsNone && formal is null)
                    throw Unrepresentable("a modified unnamed pin of a call",
                        $"the '{b.Type}' box has {Describe(p.Flags)} on its unnamed input {i}, and the text spells a pin's modifier on its formal.");
                var value = Value(p.Value, st, At.Slot).Text;
                if (formal is { } f)
                {
                    if (string.Equals(f, Box.EnablePin, StringComparison.OrdinalIgnoreCase))
                        throw Unrepresentable("a data pin named EN",
                            $"the '{b.Type}' box has a data pin named EN, which the text reads as its enable.");
                    pins.Add(PinModifiers(p.Flags) + Formal(f, b) + " := " + value);
                }
                else pins.Add(value);
            }
            pins.AddRange(OutputPins(b));
            if (pins.Count == 1 && pins[0].Length == 0)
                throw Unrepresentable("a lone unconnected input slot with no formal",
                    $"the '{b.Type}' box has one input slot, wired to nothing and unnamed, and `{b.Type}()` is a box with none.");
            var call = head + "(" + string.Join(", ", pins) + ")" + suffix;
            return new Spelled(call + (b.Enable is null ? "" : EnTail(b.Enable, b.EnableFlags, st)), EnabledComparison: enabledComparison);
        }

        /// <summary>B3: <c> EN c</c> after the box — <c> EN</c> alone where the enable is wired to nothing (the empty
        /// enable, 2R.1 Open item 1). The tail is a slot (P4): one box, up to <c>;</c>, <c>)</c>, <c>,</c> or the line's
        /// end.</summary>
        private string EnTail(Node enable, Flags pin, LineState st)
        {
            var en = " " + PinModifiers(pin) + "EN";
            if (enable is Terminator { Flags.IsNone: true }) return en;
            return en + " " + Value(enable, st, At.Slot).Text;
        }

        /// <summary>Whether a pin's flag set has a spelling — a negation or an edge (2R.5: an edge on a pin stores, builds and
        /// runs, #15; a negated EN pin, #16). A coil bit on a pin has none, and the two together are not measured.</summary>
        private static bool PinModifiable(Flags f) =>
            !f.Set && !f.Reset && !f.Jump && !f.Return && !(f.Rising && f.Falling) &&
            !((f.Rising || f.Falling) && f.Negated);   // each alone is measured, the two together not (2R.5)

        /// <summary>The modifier before a pin's or a coil's name — <c>R_EDGE IN := v</c>, <c>NOT EN c</c>,
        /// <c>R_EDGE xe := c</c>.</summary>
        private static string PinModifiers(Flags f) =>
            (f.Rising ? "R_EDGE " : f.Falling ? "F_EDGE " : "") + (f.Negated ? "NOT " : "");

        /// <summary>A word form's output pins: <c> =&gt; v</c> each, filling the free slots in order — the one place for an
        /// output a box word has, so a named pin or a slot passed over is the call form's (P5).</summary>
        private string OutputsAfter(Box b)
        {
            var sb = new StringBuilder();
            var next = 0;
            foreach (var o in b.Outputs)
            {
                if (o.Value.Flags is { IsNone: false } f)
                    throw Unrepresentable("a flag on an output pin",
                        $"the '{b.Type}' box's output to '{o.Value.Text}' carries {Describe(f)}.");
                if (o.Slot is not { } slot)
                    throw Unrepresentable("an output pin with no stored slot",
                        $"the '{b.Type}' box's unnamed output to '{o.Value.Text}' has no slot index, and a positional `=>` is spelled by its slot.");
                next = NetworkSpelling.NextFreeSlot(next, NetworkSpelling.EnoSlot(b), b.ConnectedSlot);
                if (slot != next)
                    throw Unrepresentable("a connection by an unspellable output slot",
                        $"the '{b.Type}' box wires output slot {slot} to '{o.Value.Text}', and its `=>` pins fill the free slots in order (the next is {next}).");
                next++;
                sb.Append(" => ").Append(LValue(o.Value, "an output target"));
            }
            return sb.ToString();
        }

        /// <summary>The slot rule on a CONSUMED box read by its main output: no suffix where the text's rule reads it
        /// (<see cref="NetworkSpelling.MainSlotOfCall"/>); <c>.name</c> where the main output is another slot (S4); anything
        /// else has no spelling. A bit operator's stored slot is a member the text derives as none (B7): lost on rebuild,
        /// never refused.</summary>
        private string Suffix(Box b)
        {
            var slot = b.ConnectedSlot;
            var hasEno = NetworkSpelling.EnoSlot(b) is not null;

            if (NetworkSpelling.NamedMainOutput(b) is { } named)
            {
                if (!NetworkSpelling.Identifier.IsMatch(named) ||
                    string.Equals(named, Box.EnoPin, StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(named, Box.EnablePin, StringComparison.OrdinalIgnoreCase))
                    throw Unrepresentable("a main output other than slot 0 with no output name",
                        $"the '{b.Type}' box's main output is its slot {slot}, and the name it stores for that slot ('{named}') is no output name the text can write after the call.");
                if (NetworkSpelling.IsReserved(named))
                    throw Unrepresentable("a named main output spelled like a text word",
                        $"the '{b.Type}' box is read through its output '{named}', a word the text's own grammar gives a meaning.");
                if (b.Outputs.Any(o => o.Formal is null))
                    throw Unrepresentable("a positional output pin beside a named main output",
                        $"the '{b.Type}' box is read through its output '{named}' and also writes a positional `=>` pin, whose slot the text then cannot state.");
                if (NetworkSpelling.IsWordForm(b) || NetworkSpelling.IsMoveWordForm(b))
                    throw Unrepresentable("a main output other than slot 0 with no output name",
                        $"the '{b.Type}' operator is read through its output '{named}', and an operator's word has no position for it.");
                return "." + named;
            }

            if (!hasEno && NetworkSpelling.MainSlotOfCall(b.Type) is null) return "";

            if (slot is null)
                throw Unrepresentable("a consumed box with no stored connection slot",
                    $"the '{b.Type}' box is consumed and does not record which of its output slots its consumer is connected to.");
            if (hasEno)
                throw Unrepresentable("a connection by an unspellable output slot",
                    $"a consumer of the '{b.Type}' box is connected to its output slot {slot}, and the box's main output is its ENO.");
            if (b.MainOutputIndex is null)
                throw Unrepresentable("a consumed box whose main output was not read",
                    $"the '{b.Type}' box is consumed and does not record which of its output slots is its main output, and its text depends on it.");
            if (slot != b.MainOutputIndex)
                throw Unrepresentable("a connection by an unspellable output slot",
                    $"a consumer of the '{b.Type}' box is connected to its output slot {slot}, which is neither its main output ({b.MainOutputIndex}) nor ENO.");
            if (slot != NetworkSpelling.MainSlotOfCall(b.Type))
                throw Unrepresentable("a main output other than slot 0 with no output name",
                    $"the '{b.Type}' box's main output is its slot {slot}, which the text spells by the output's name, and the box records none.");
            return "";
        }

        /// <summary>A call's output pins, inside its brackets (B3, P5): <c>F =&gt; v</c> when named (<c>ENO =&gt; v</c>
        /// on the ENO slot); positional <c>=&gt; v</c> filling the slots that remain after ENO and the connected one, a
        /// bare <c>=&gt;</c> for a slot passed over.</summary>
        private IEnumerable<string> OutputPins(Box b)
        {
            var eno = NetworkSpelling.EnoSlot(b);
            var next = 0;
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
                    {
                        // P5: the named ENO pin — a variable stored on the box's ENO output. Only a box with an ENO has one.
                        if (b.HasEnoOutput == false || (b.HasEnoOutput is null && b.Enable is null))
                            throw Unrepresentable("an ENO output pin on a box without ENO",
                                $"the '{b.Type}' box wires an output named ENO to '{o.Value.Text}' and has no ENO output.");
                        yield return Box.EnoPin + " => " + target;
                        continue;
                    }
                    if (string.Equals(formal, Box.EnablePin, StringComparison.OrdinalIgnoreCase))
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

        /// <summary>The call's head: the FB instance, <c>??? : TYPE</c> for the vendor's unnamed instance, or the BoxType
        /// verbatim — bare when it is one name that is not reserved (or an operator's word in its call form), else between
        /// backticks.</summary>
        private string Head(Box b)
        {
            RefuseEdgeWord(b.Type, "a box type");
            if (b.Instance is { } inst)
            {
                if (inst.Flags is { IsNone: false } instFlags)
                    throw Unrepresentable("a flag on an FB instance",
                        $"the '{b.Type}' instance '{inst.Text}' carries {Describe(instFlags)} on the instance operand.");
                if (inst.Text == Box.UnnamedInstance)
                {
                    if (!NetworkSpelling.Identifier.IsMatch(b.Type) || NetworkSpelling.IsReserved(b.Type))
                        throw Unrepresentable("an unnamed instance of an unspellable type",
                            $"a '???' instance box has the type '{b.Type}', which is not an identifier the text leaves bare.");
                    return Box.UnnamedInstance + " : " + b.Type;
                }
                RefuseEdgeWord(inst.Text, "an FB instance");
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
                throw Unrepresentable("a box type that is no POU name",
                    $"the box type '{b.Type}' is not a name, and the box has no FB instance.");
            if (_scope.InstanceType(b.Type) is { } instanceType)
                throw Unrepresentable("a function named like an FB instance in scope",
                    $"the function box '{b.Type}' has the name of the '{instanceType}' instance '{b.Type}', and its call would read back as that instance's.");
            return NetworkSpelling.IsBareHead(b.Type) ? b.Type : "`" + b.Type + "`";
        }

        /// <summary>P8: <c>EXECUTE [EN [c]]</c> on its line, the ST verbatim on the lines below, <c>END_EXECUTE</c>.</summary>
        private string Execute(Box b, LineState st)
        {
            if (!string.Equals(b.Type, NetworkSpelling.ExecuteType, StringComparison.Ordinal))
                throw Unrepresentable("an Execute box of another type",
                    $"an Execute box in network {_net.Order} has the type '{b.Type}', and the text reads every Execute box as '{NetworkSpelling.ExecuteType}'.");
            if (b.Inputs.Count > 0 || b.Outputs.Count > 0 || b.Instance is not null)
                throw Unrepresentable("an Execute box with pins",
                    $"an Execute box in network {_net.Order} carries pins or an instance beside its ST.");
            if (!b.Flags.IsNone)
                throw Unrepresentable("a flag on an EXECUTE box",
                    $"an Execute box in network {_net.Order} carries {Describe(b.Flags)}, and an EXECUTE box stands at its line's root.");
            var stCode = b.StCode!.Replace("\r\n", "\n");
            foreach (var line in stCode.Split('\n'))
            {
                if (Regex.IsMatch(line, @"^\s*END_EXECUTE\b", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase))
                    throw Unrepresentable("a snippet line starting with END_EXECUTE",
                        $"an Execute box in network {_net.Order} holds the line '{line.Trim()}'.");
                if (line.IndexOf('\r') >= 0)
                    throw Unrepresentable("a snippet line ending in a carriage return",
                        $"an Execute box in network {_net.Order} holds a line ending in a lone carriage return.");
                if (line.IndexOfAny(LayoutMarkers) >= 0)
                    throw Unrepresentable("a snippet line holding a control character",
                        $"an Execute box in network {_net.Order} holds a line with the control character U+0001, U+0002 or U+0003.");
            }
            var head = "EXECUTE" + (b.Enable is null ? "" : EnTail(b.Enable, b.EnableFlags, st));
            return head + "\n" + stCode + "\n  END_EXECUTE";
        }

        // ── the parallel (B8) ───────────────────────────────────────────────────────────────────────

        /// <summary>B8, P6: <c>[feed] BRANCH (b1, b2, …) [SHORTCIRCUIT]</c> at every depth — the feed an operand of the word
        /// BRANCH (bracketed when it is a box word or a parallel), each branch a slot. The mode is written only where it is
        /// not the editor's (<c>SHORTCIRCUIT</c>, B7). The outermost parallel of a line is laid out one branch per line
        /// (P2: layout, not tree).</summary>
        private Spelled ParallelValue(Parallel p, LineState st)
        {
            if (p.Branches.Count == 0)
                throw Unrepresentable("a Parallel with no branch", $"a Parallel in network {_net.Order} has no branch.");
            if (p.Branches.Count == 1)
                throw Unrepresentable("a Parallel with one branch",
                    $"a Parallel in network {_net.Order} has one branch, which pushes and does not compile (C0023).");
            if (p.Input is Terminator)
                throw Unrepresentable("a Parallel fed by the empty terminator",
                    $"a Parallel in network {_net.Order} is fed by an unconnected terminator; an unfed Parallel has no feed.");
            // 2R.5 (readability Open c): an empty branch stores, builds and runs (a shorted branch) — written as nothing between
            // its commas, `(a, , b)`.
            if (!NetworkSpelling.IsMeasuredMode(p.Mode))
                throw Unrepresentable("an unmeasured Parallel mode",
                    $"a Parallel in network {_net.Order} has the mode '{p.Mode}'; the measured modes are BoxShortCircuit and Sequential.");
            var mode = p.Mode == NetworkSpelling.DerivedMode ? "" : " " + NetworkSpelling.ShortCircuitWord;

            var feed = p.Input is null ? null : Value(p.Input, st, At.Operand).Text;
            var outermost = st.ParallelDepth == 0;
            st.ParallelDepth++;
            List<string> branches;
            try { branches = p.Branches.Select(br => Value(br, st, At.Slot).Text).ToList(); }
            finally { st.ParallelDepth--; }
            var list = outermost
                ? ListOpen + string.Join("," + ListBreak, branches) + ListClose
                : "(" + string.Join(", ", branches) + ")";
            return new Spelled((feed is null ? "" : feed + " ") + NetworkSpelling.BranchWord + " " + list + mode, Word: true);
        }

        // ── modifiers, coils, names ─────────────────────────────────────────────────────────────────

        /// <summary>A value's modifiers, in the vendor's one order: the edge around the NEGATED core
        /// (<c>R_EDGE(NOT x)</c>, DIALECT N17). A box word or an enabled comparison under NOT stands in NOT's brackets
        /// (<c>NOT (a AND b)</c>, P5); an edge's brackets carry its argument whole.</summary>
        private Spelled Modified(Spelled core, Flags f, string what)
        {
            if (f.Set || f.Reset || f.Jump || f.Return)
                throw Unrepresentable("a coil flag on a value",
                    $"{what} carries {Describe(f)}, which a value has no spelling for.");
            if (f.Rising && f.Falling)
                throw Unrepresentable("rising and falling on one operand", $"{what} carries both a rising and a falling edge.");
            if (!f.Negated && !f.Rising && !f.Falling) return core;
            var text = core.Text;
            if (f.Negated) text = core.Word || core.EnabledComparison ? "NOT (" + text + ")" : "NOT " + text;
            if (f.Rising) { RefuseTakenConstruct("R_EDGE"); text = "R_EDGE(" + text + ")"; }
            else if (f.Falling) { RefuseTakenConstruct("F_EDGE"); text = "F_EDGE(" + text + ")"; }
            return new Spelled(text);
        }

        /// <summary>A coil's storage — ExST's <c>:=</c>, <c>S=</c>, <c>R=</c>; its negation and edge stand before the coil
        /// (<see cref="CoilHead"/>, 2R.5: a negated coil and an edge coil store and build, #13, #14).</summary>
        private static string StorageOp(Operand target)
        {
            var f = target.Flags ?? Flags.None;
            if (f.Negated && (f.Set || f.Reset))
                throw Unrepresentable("a negated set or reset coil",
                    $"the coil '{target.Text}' carries a negation beside its storage, which the vendor's two coil bits cannot hold apart.");
            if (f.Set && f.Reset)
                throw Unrepresentable("a coil both set and reset", $"the coil '{target.Text}' carries both the Set and the Reset bit.");
            return f.Reset ? "R=" : f.Set ? "S=" : ":=";
        }

        private static void RefuseItemFlags(Flags f, string what)
        {
            if (!f.IsNone)
                throw Unrepresentable("a flag on " + what, $"{what} carries {Describe(f)} on the item itself.");
        }

        private static readonly char[] LayoutMarkers = { ListOpen, ListBreak, ListClose };

        /// <summary>An assignment or <c>=&gt;</c> target: bare when it is a target token, else verbatim between backticks.</summary>
        private static string LValue(Operand o, string what)
        {
            RefuseUnwritable(o.Text, what);
            return NetworkSpelling.IsBareTarget(o.Text) ? o.Text : "`" + o.Text + "`";
        }

        private static string Formal(string f, Box b)
        {
            if (!NetworkSpelling.Identifier.IsMatch(f))
                throw Unrepresentable("a pin name that is not an identifier", $"the '{b.Type}' box has a pin named '{f}'.");
            return NetworkSpelling.IsReserved(f) ? "`" + f + "`" : f;
        }

        /// <summary>An operand as a bare token when it is exactly one (a literal included, P12), else verbatim between
        /// backticks (P1: a reserved word, the split pattern).</summary>
        private static string Operand(string text, string what)
        {
            RefuseUnwritable(text, what);
            return NetworkSpelling.IsToken(text) ? text : "`" + text + "`";
        }

        private static void RefuseUnwritable(string text, string what)
        {
            if (text.IndexOf('`') >= 0)
                throw Unrepresentable("operand text containing a backtick", $"{what} '{text}' contains a backtick.");
            if (text.IndexOfAny(new[] { '\n', '\r' }) >= 0)
                throw Unrepresentable("operand text across lines", $"{what} '{text}' holds a line break.");
            if (text.IndexOfAny(LayoutMarkers) >= 0)
                throw Unrepresentable("operand text holding a control character",
                    $"{what} '{text}' holds the control character U+0001, U+0002 or U+0003.");
        }

        private void RefuseTakenConstruct(string word)
        {
            if (NetworkSpelling.ConstructTaken(word, _scope))
                throw Unrepresentable(word + " beside a POU or instance of that name",
                    $"network {_net.Order} spells {word}(…), and a POU or FB instance in scope is named {word}, so the text would read it as that call.");
        }

        private static void RefuseEdgeWord(string name, string what)
        {
            if (NetworkSpelling.ConstructWords.Contains(name))
                throw Unrepresentable("a POU or instance named " + name.ToUpperInvariant(),
                    $"{what} is named '{name}', which the text reads as its own construct.");
        }

        /// <summary>Every identifier the network spells, and every Demux VarId in item order.</summary>
        /// <summary>Every split VarId of the tree.</summary>
        private static void Collect(Node n, List<int> ids)
        {
            if (n is Demux d) ids.Add(d.VarId);
            foreach (var child in n.Children()) Collect(child, ids);
        }

        private static void CollectDefinitions(Node n, HashSet<int> ids)
        {
            if (n is Demux { Input: not null } d) ids.Add(d.VarId);
            foreach (var child in n.Children()) CollectDefinitions(child, ids);
        }

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
/// The writer's one refusal: the fact it has no spelling for (<see cref="Body.UnrepresentableBodyException.Reason"/>,
/// the reason a pull reports for its UNSUPPORTED line) and WHERE it met it.
/// </summary>
public sealed class NetworkUnrepresentableException : Body.UnrepresentableBodyException
{
    internal NetworkUnrepresentableException(string reason, string detail)
        : base(reason, "network text has no spelling for " + reason + ": " + detail +
                       " Volt pulls the network as its UNSUPPORTED line (or, for a header, the body as IMPLEMENTATION LD|FBD UNSUPPORTED) rather than write it without that fact.")
        => Detail = detail;

    /// <summary>What was found, without the pull's "pulls it UNSUPPORTED" consequence.</summary>
    public string Detail { get; }

    /// <summary>The innermost model node being written when the fact was met; null for a network's own field.</summary>
    internal Node? At { get; set; }

    /// <summary>The position of the network being written, in the body.</summary>
    internal int? Network { get; set; }

    /// <summary>Met on the network's header or comment, not in its trees: no UNSUPPORTED line can keep such a network.</summary>
    internal bool OnHeader { get; set; }
}
