using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using Volt.Engine.Format.Body;

namespace Volt.Engine.Format.Network;

/// <summary>
/// PLAIN-ST NETWORK TEXT (openspec <c>network-text-st</c> 2.1; design.md "1.4 Mapping" and its owner revision): an LD/FBD
/// body as ST, Volt adding only <c>%</c> lines for what is not code. One spelling per element the IDE's toolbox offers:
/// <b>every box is a call</b> (<c>GT(i, 3)</c>, <c>AND(a, b, c)</c>, <c>NOT(a)</c>, <c>MOVE(v)</c>), and infix
/// <c>a AND b</c>, <c>a OR b</c>, <c>NOT a</c> is only what the toolbox draws as CONTACTS (series, parallel, negated). An
/// enabled box is its own function <c>&lt;name&gt;_EN</c>: <c>EN</c> its first argument, then the box's pins as stored, and
/// its return value is its ENO (the line that leaves the box toward the next one); its data value leaves through
/// <c>OUT =&gt;</c>. A chain nests as drawn.
///
/// <code>
/// %LANGUAGE LD
/// %NETWORK "Start the motor"
/// %WIRES w3
/// // runs while auto is on
/// l1:
/// w3 := start AND NOT stop;
/// t1(IN := w3, PT := T#1S, Q => w4);
/// lamp := w4;
/// done := MOVE_EN(EN := MOVE_EN(EN := w3, 1, OUT => x), 2, OUT => y);
/// hot := GT(temp, 80);
/// IF a THEN JMP l1; END_IF;
/// </code>
///
/// <para><b>Contacts.</b> An AND/OR box is a contact when the IDE stores it with no output (its <c>OutputParam.Names</c>
/// empty; a drawn box stores one unnamed output, 1.3). A model with no stored names (a text read) is contacts in LD and
/// boxes in FBD, whose toolbox has no contacts. An unbracketed chain of one contact operator is one box
/// (<c>a AND b AND c</c>); brackets nest (<c>(a AND b) AND c</c>).</para>
///
/// <para><b>An enabled box read by its value</b> (CODESYS's enabled comparisons, which show no ENO) is a call statement
/// whose <c>OUT =&gt;</c> defines a wire, standing where the wire is read: the call's return is its ENO, so its value
/// leaves through <c>OUT</c>.</para>
///
/// <para><b>Wires.</b> A Demux is a wire <c>w&lt;n&gt;</c>, defined once and read by its name any number of times, before its
/// definition too (the value it held); a box that has no expression form (an FB call, an Execute box, an enabled box read
/// by its value) and is read once is a call statement defining a wire, standing where it is read. Every wire is named on
/// its network's <c>%WIRES</c> line, so the text alone says what is a wire.</para>
///
/// <para><b>The other elements</b> (3.0): the parallel branch <c>BRANCH(FEED := f, b1, b2)</c> /
/// <c>BRANCH_SHORTCIRCUIT(…)</c>; the edge <c>R_EDGE(x)</c> / <c>F_EDGE(x)</c> on a contact or a box; a box showing ENO
/// and no EN <c>X_ENO(…)</c>; the vendor's unnamed instance (<c>???</c>) as the box called by its FB type; the empty item
/// <c>;</c>.</para>
///
/// <para><b>Stored members</b> (design "Stored members, not spelled") are written as their spelling, and read back as it:
/// a negation on a pin, a coil, an EN or a box output as <c>NOT</c> on the value; an edge on a pin or an EN as the edge on
/// its value; the rail (Terminator) as <c>TRUE</c>, and as the empty item; an edge flag on a coil dropped; an extra output
/// slot to <c>???</c> dropped; an operand holding an ST expression as that expression; TwinCAT's unconditional jump (its
/// empty operand) as <c>JMP l;</c>. A shape with no spelling throws <see cref="StNetworkUnspellableException"/>, naming
/// it; a pull shows such a network as <c>%UNSUPPORTED "&lt;shape&gt;" #&lt;hash&gt;</c> (<see cref="WritePulled"/>).</para>
/// </summary>
public static class StNetworkWriter
{
    /// <summary>Render <paramref name="body"/>, refusing any network it cannot spell.</summary>
    /// <param name="scope">The declarations the body can see: the FB instances a call head may name, and the names a wire
    /// may not take.</param>
    public static string Write(NetworkBody body, NetworkScope scope) => Write(body, scope, perNetwork: false);

    /// <summary>Render <paramref name="body"/> AS A PULL SHOWS IT: a network whose TREES the text cannot spell keeps its
    /// header and comment, its code the one line <c>%UNSUPPORTED "&lt;shape&gt;" #&lt;hash&gt;</c>. A header the text cannot
    /// carry throws, and the pull shows the whole body as its UNSUPPORTED line (<see cref="NetworkText.Pulled"/>).</summary>
    public static string WritePulled(NetworkBody body, NetworkScope scope) => Write(body, scope, perNetwork: true);

    private static string Write(NetworkBody body, NetworkScope scope, bool perNetwork)
    {
        if (body is null) throw new ArgumentNullException(nameof(body));
        if (scope is null) throw new ArgumentNullException(nameof(scope));
        var sb = new StringBuilder();
        sb.Append(St.PropertyLines.LanguageLine(NetworkText.Spelling(body.Language))).Append('\n');
        var wires = new BodyWires(body, scope);
        foreach (var net in body.Networks)
        {
            string text;
            var mark = wires.Next;
            try { text = new Emitter(net, scope, body.Language, wires).Emit(); }
            catch (StNetworkUnspellableException e)
                when (perNetwork && !e.OnHeader && net.Unsupported is null && NetworkSpelling.UnsupportedShape.IsMatch(e.Reason))
            {
                wires.Next = mark;
                text = new Emitter(net with { Trees = Array.Empty<Node>(), Unsupported = e.Reason, UnsupportedHash = NetworkTextWriter.Hash(net) }, scope, body.Language, wires).Emit();
            }
            catch (StNetworkUnspellableException e) when (e.Network is null)
            {
                e.Network = net.Order;
                throw;
            }
            sb.Append(text);
        }
        return sb.ToString();
    }

    // ── the vocabulary the reader shares ─────────────────────────────────────────────────────────────────────────

    /// <summary>The suffix of an enabled box's function: <c>MOVE_EN</c>, <c>ADD_EN</c>, <c>t1_EN</c>.</summary>
    public const string EnabledSuffix = "_EN";

    /// <summary>The suffix of a box that shows its ENO and no EN (its call returns its ENO): <c>f_ENO</c>, <c>d1_ENO</c>.</summary>
    public const string EnoSuffix = "_ENO";

    /// <summary>The formal through which a call's data value leaves when its return value is its ENO; each <c>OUT =&gt;</c>
    /// names the next unnamed output slot.</summary>
    public const string ResultPin = "OUT";

    /// <summary>The LD parallel branch (the vendor's <c>BoxTreeParallel</c>), one function per mode:
    /// <c>BRANCH(FEED := f, b1, b2)</c> runs every branch (<c>Sequential</c>), <c>BRANCH_SHORTCIRCUIT(…)</c> the branches
    /// that hold a box only while no box-free branch carries the feed (<c>BoxShortCircuit</c>, measured 1.4). The feed is
    /// the formal <c>FEED</c>, absent on a branch at the rail.</summary>
    public const string BranchHead = "BRANCH";

    public const string ShortCircuitHead = "BRANCH_SHORTCIRCUIT";

    public const string FeedPin = "FEED";

    /// <summary>The edge on a contact or on a box's output (the vendor's <c>Rtrig</c>/<c>Ftrig</c> flag): <c>R_EDGE(x)</c>,
    /// <c>F_EDGE(x)</c>; <c>R_EDGE(NOT x)</c> the edge of the negated contact (the IDE negates first, N17).</summary>
    public const string RisingHead = "R_EDGE";

    public const string FallingHead = "F_EDGE";

    /// <summary>The function names the text gives an element of its own (a branch, an edge): declared in reach, the text
    /// would mean two things, and the writer refuses it by name.</summary>
    internal static readonly string[] ElementHeads = { BranchHead, ShortCircuitHead, RisingHead, FallingHead };

    internal const string True = "TRUE";

    internal const string NetworkLine = "%NETWORK";
    internal const string DisabledLine = "%DISABLED";
    internal const string WiresLine = "%WIRES";
    internal const string ExecuteLine = "%EXECUTE";
    internal const string EndExecuteLine = "%END_EXECUTE";
    internal static string UnsupportedLine => "%" + NetworkSpelling.UnsupportedWord;

    /// <summary>The contact operators: infix <c>AND</c> / <c>OR</c>, an unbracketed chain of one being ONE box.</summary>
    internal static readonly HashSet<string> Contacts = new(StringComparer.Ordinal) { "AND", "OR" };

    /// <summary>The 14 keyword operators. Each is a call in the text (<c>GT(i, 3)</c>), as every box is; only a contact
    /// AND/OR is infix. CODESYS ST has no call form for them (1.2), so the exec twin writes them infix.</summary>
    internal static readonly HashSet<string> Symbol = new(StringComparer.Ordinal)
        { "AND", "OR", "XOR", "ADD", "SUB", "MUL", "DIV", "MOD", "GT", "GE", "LT", "LE", "EQ", "NE" };

    /// <summary>The operators of the table and the NOT box, by their stored name (any case: the IDE stores it as typed).</summary>
    private static bool IsKeywordOperator(string type) =>
        Symbol.Contains(type.ToUpperInvariant()) || string.Equals(type, NetworkSpelling.NotBox, StringComparison.OrdinalIgnoreCase);

    /// <summary>THE TOOLBOX ELEMENT AN AND/OR IS, as the text spells it and the IDE stores it (1.3): a contact (infix) stores
    /// no output name, a drawn box (the call) one unnamed output. A text read states it, so the element survives a read; null
    /// for any other box, whose spelling says nothing more than its derivation.</summary>
    public static NwlMembers? ElementMembers(string type, bool contact) =>
        Contacts.Contains(type)
            ? NwlMembers.Of((NetworkMembers.OutputNames, MemberValue.Texts(contact ? Array.Empty<string>() : new[] { "" })))
            : null;

    /// <summary>ST's precedence of the contact operators: OR below AND.</summary>
    internal static int Precedence(string type) => type switch { "OR" => 1, "AND" => 3, _ => 100 };

    // ── the stored members, in the form the text spells them ───────────────────────────────────────────────────────

    // The round-trip oracle (test/shared/StNetworkOracle.cs) states each of these stored members by the same RULE, in its own
    // code: a canonical form shared by code would make the oracle agree with the writer by construction.

    /// <summary>The NOT a negation is written as: a plain leaf negated, anything else under a NOT box.</summary>
    private static Node Negate(Node n) => n switch
    {
        Terminator t => Negate(new Leaf(new Operand(True), t.Flags)),
        Leaf { Flags: { Negated: false, Rising: false, Falling: false } } l => l with { Flags = l.Flags with { Negated = true } },
        _ => NotBox(n),
    };

    public static Box NotBox(Node n) =>
        new(NetworkSpelling.NotBox, null, CallKind.Operator, new[] { new Input(null, n, Flags.None) }, Array.Empty<Output>(), null, null, Flags.None);

    /// <summary>An edge flag carried onto the node it is spelled on (<c>R_EDGE(x)</c>): a leaf, a box read where it stands,
    /// the rail as <c>TRUE</c>; an edge on a pin or on EN is a stored member spelled as the edge of its value. Any other node
    /// (a wire, a branch, a node already carrying an edge) has no spelling.</summary>
    private static Node Edge(Node n, Flags edge, string where)
    {
        var bits = Flags.None with { Rising = edge.Rising, Falling = edge.Falling };
        return n switch
        {
            Terminator t => Edge(new Leaf(new Operand(True), t.Flags), edge, where),
            Leaf { Flags: { Rising: false, Falling: false } } l => l with { Flags = l.Flags with { Rising = bits.Rising, Falling = bits.Falling } },
            Box { Flags: { Rising: false, Falling: false } } b => b with { Flags = b.Flags with { Rising = bits.Rising, Falling = bits.Falling } },
            _ => throw Unspellable("an edge on a wire, a branch or an edge", $"{where} carries {Describe(bits)} over a {n.GetType().Name}."),
        };
    }

    internal static string Describe(Flags f) =>
        string.Join("+", new[] { f.Negated ? "negation" : null, f.Set ? "set" : null, f.Reset ? "reset" : null, f.Jump ? "jump" : null,
            f.Return ? "return" : null, f.Rising ? "rising edge" : null, f.Falling ? "falling edge" : null }.Where(x => x is not null));

    private static StNetworkUnspellableException Unspellable(string reason, string detail) => new(reason, detail);

    private static StNetworkUnspellableException HeaderUnspellable(string reason, string detail) => new(reason, detail) { OnHeader = true };

    /// <summary>THE WIRE NAMES OF ONE BODY (design.md 1.4): <c>w1</c>, <c>w2</c>, … in the order the text defines them,
    /// across the body, skipping every name the body's operands, targets and instances use and every name in scope, so a
    /// name is one wire of one network and never a variable. The vendor's Demux VarId is not spelled: the reader numbers a
    /// network's Demux nodes in the order their definitions stand (<see cref="StNetworkReader"/>).</summary>
    private sealed class BodyWires
    {
        private readonly HashSet<string> _taken = new(StringComparer.OrdinalIgnoreCase);
        private readonly NetworkScope _scope;

        public BodyWires(NetworkBody body, NetworkScope scope)
        {
            _scope = scope;
            foreach (var net in body.Networks) foreach (var t in net.Trees) Words(t);
        }

        public int Next { get; set; } = 1;

        public string New()
        {
            string name;
            do name = "w" + (Next++).ToString(CultureInfo.InvariantCulture);
            while (_taken.Contains(name) || _scope.Contains(name) || _scope.InstanceType(name) is not null);
            return name;
        }

        private void Words(Node? n)
        {
            switch (n)
            {
                case null: return;
                case Leaf l: Add(l.Operand.Text); return;
                case Assign a: foreach (var t in a.Targets) Add(t.Text); break;
                case Box b:
                    foreach (var o in b.Outputs) Add(o.Value.Text);
                    if (b.Instance is { } i) Add(i.Text);
                    break;
            }
            foreach (var c in n.Children()) Words(c);
        }

        private void Add(string text)
        {
            foreach (var w in NetworkSpelling.Words(text)) _taken.Add(w);
        }
    }

    // ── one network ──────────────────────────────────────────────────────────────────────────────────────────────

    private sealed class Emitter
    {
        private readonly Network _net;
        private readonly NetworkScope _scope;
        private readonly BodyLanguage _language;
        private readonly BodyWires _bodyWires;
        private readonly List<string> _wires = new();
        private readonly Dictionary<int, int> _reads = new();
        private readonly Dictionary<int, string> _names = new();

        /// <summary>The Demux definitions written so far (a wire may be read before its definition, by its name).</summary>
        private readonly HashSet<int> _defined = new();

        /// <summary>Every Demux definition of the network.</summary>
        private readonly HashSet<int> _definitions = new();

        /// <summary>The Demux definitions over a box that is a call statement (an FB, an Execute box, an enabled box read by
        /// its value): read once, such a wire is the box itself, so a Demux over one is read twice or more.</summary>
        private readonly HashSet<int> _overStatementBox = new();

        /// <summary>The wires an enabled box other than a comparison defines by its value (read twice or more).</summary>
        private readonly HashSet<string> _enabledValueWires = new(StringComparer.OrdinalIgnoreCase);

        /// <summary>The value of the coil being written: the one place an enabled box other than a comparison is read by its
        /// value (1.4).</summary>
        private Node? _coilValue;

        private const string EnabledValueReason = "an enabled box read by its value outside a coil";

        /// <summary>An enabled function box other than a comparison, read by its value (its value leaves through <c>OUT</c>).</summary>
        private static bool IsEnabledValueBox(Box b) =>
            b.Enable is not null && b.Instance is null && b.StCode is null && !NetworkSpelling.ConnectedByEno(b) &&
            !NetworkSpelling.Comparisons.Contains(b.Type);

        /// <summary>CODESYS: "A box with EN can be used for comparison operators only." Any other enabled box is read by its
        /// value only as a coil's value: inside a box, as a jump's condition or as a wire's definition it does not build, and
        /// the reader refuses the text.</summary>
        private void RequireCoilValue(Node read, string what)
        {
            if (!ReferenceEquals(read, _coilValue))
                throw Unspellable(EnabledValueReason, $"{what} carries an enabled box's value where it is no coil's value: a box with EN can be used for comparison operators only.");
        }

        public Emitter(Network net, NetworkScope scope, BodyLanguage language, BodyWires wires)
        {
            _net = net;
            _scope = scope;
            _language = language;
            _bodyWires = wires;
        }

        public string Emit()
        {
            var sb = new StringBuilder();
            sb.Append(NetworkLine);
            if (_net.Title is { Length: > 0 } title)
            {
                sb.Append(" \"").Append(NetworkSpelling.Escape(title, '"')).Append('"');
            }
            sb.Append('\n');
            if (_net.Disabled) sb.Append(DisabledLine).Append('\n');
            if (_net.Unsupported is { } shape)
            {
                Comment(sb);
                // A network a VENDOR reader refused carries no hash yet: it is the network's own (its shape), as a writer
                // refusal's is its trees'.
                var hash = _net.UnsupportedHash ?? NetworkTextWriter.Hash(_net);
                if (!NetworkSpelling.UnsupportedShape.IsMatch(shape))
                    throw HeaderUnspellable("an unsupported network whose shape is no phrase", $"network {_net.Order + 1} is UNSUPPORTED for '{shape}'.");
                sb.Append(UnsupportedLine).Append(" \"").Append(shape).Append("\" #").Append(hash).Append('\n');
                // Its label is still the jump target it is: the label line stands under the UNSUPPORTED line.
                if (_net.Label is { } unsupportedLabel)
                {
                    if (!NetworkSpelling.Identifier.IsMatch(unsupportedLabel))
                        throw HeaderUnspellable("a label that is not an identifier", $"the label '{unsupportedLabel}'.");
                    sb.Append(unsupportedLabel).Append(":\n");
                }
                return sb.ToString();
            }
            if (_net.Label is { } label && !NetworkSpelling.Identifier.IsMatch(label))
                throw HeaderUnspellable("a label that is not an identifier", $"the label '{label}'.");
            var comment = new StringBuilder();
            Comment(comment);

            foreach (var t in _net.Trees) Scan(t);
            foreach (var kv in _reads)
            {
                if (!_definitions.Contains(kv.Key))
                    throw Unspellable("a wire read and never defined", $"the wire (Demux) {kv.Key} is read and has no definition in its network.");
                if (kv.Value == 1 && _overStatementBox.Contains(kv.Key))
                    throw Unspellable("a wire over a call statement read once",
                        $"the wire (Demux) {kv.Key} over a box written as a call statement is read once: a wire read once is the box itself.");
            }

            var code = new StringBuilder();
            if (_net.Label is { } l) code.Append(l).Append(":\n");
            foreach (var tree in _net.Trees)
            {
                var pre = new List<string>();
                var item = Item(tree, pre);
                foreach (var p in pre) code.Append(p).Append('\n');
                code.Append(item).Append('\n');
            }

            if (_wires.Count > 0) sb.Append(WiresLine).Append(' ').Append(string.Join(", ", _wires)).Append('\n');
            sb.Append(comment);
            sb.Append(code);
            return sb.ToString();
        }

        private void Comment(StringBuilder sb)
        {
            if (_net.Comment is not { Length: > 0 } comment) return;
            // One `//` line per stored line (the IDE's CR LF), each in IEC's escape: a lone CR or LF is `$R` / `$L`, a `$` is `$$`.
            foreach (var line in comment.Split(new[] { "\r\n" }, StringSplitOptions.None))
                sb.Append("//").Append(line.Length == 0 ? "" : " " + NetworkSpelling.Escape(line, null)).Append('\n');
        }

        /// <summary>How often each Demux is read.</summary>
        private void Scan(Node? n)
        {
            if (n is null) return;
            if (n is Demux { Input: null } d) _reads[d.VarId] = (_reads.TryGetValue(d.VarId, out var r) ? r : 0) + 1;
            else if (n is Demux def)
            {
                _definitions.Add(def.VarId);
                if (!_reads.ContainsKey(def.VarId)) _reads[def.VarId] = 0;
                if (def.Input is Box b && IsStatementBox(b)) _overStatementBox.Add(def.VarId);
            }
            foreach (var c in n.Children()) Scan(c);
        }

        /// <summary>The wire a Demux's definition names: the name a read before it gave it, else the body's next wire name.</summary>
        private string Define(int varId)
        {
            if (!_defined.Add(varId)) throw Unspellable("a wire defined twice", $"the Demux {varId.ToString(CultureInfo.InvariantCulture)} has two definitions.");
            return WireName(varId);
        }

        /// <summary>The name of the Demux <paramref name="varId"/>, given the first time the text names it.</summary>
        private string WireName(int varId) => _names.TryGetValue(varId, out var name) ? name : _names[varId] = NewTemp();

        private string NewTemp()
        {
            var name = _bodyWires.New();
            _wires.Add(name);
            return name;
        }

        // ── items ────────────────────────────────────────────────────────────────────────────────

        private string Item(Node n, List<string> pre)
        {
            switch (n)
            {
                case Assign a: return AssignItem(a, pre);
                case Demux { Input: Box b } d when IsStatementBox(b):
                {
                    var wire = Define(d.VarId);
                    if (IsEnabledValueBox(b)) _enabledValueWires.Add(wire);
                    return StatementBox(b, pre, consumedInto: wire);
                }
                case Demux { Input: not null } d:
                {
                    var wire = Define(d.VarId);
                    return wire + " := " + Expr(d.Input!, 0, pre) + ";";
                }
                case Box b when IsStatementBox(b):
                    return StatementBox(b, pre, consumedInto: null);
                case Box b:
                    if (!b.Flags.IsNone)
                        throw Unspellable("a modifier on a box at the root", $"the '{b.Type}' box at the root carries {Describe(b.Flags)}.");
                    return Call(b, pre, consumed: false) + ";";
                // The empty item is ST's empty statement: the empty operand CODESYS stores, and the rail a stored member.
                case Leaf { Operand.Text.Length: 0, Flags.IsNone: true }:
                case Terminator { Flags.IsNone: true }:
                    return ";";
                case Terminator:
                    throw Unspellable("a modifier on an empty item", "an item holding only the rail carries a modifier.");
                case Leaf:
                    throw Unspellable("a lone leaf item", "an item that is a lone operand: ST has no expression statement.");
                case Parallel:
                    throw Unspellable("a Parallel at the root", "an item that is a Parallel with no coil.");
                default:
                    throw Unspellable("an unknown item", n.GetType().Name);
            }
        }

        private string AssignItem(Assign a, List<string> pre)
        {
            var jump = a.Flags.Jump || a.Targets.Any(t => t.Flags?.Jump == true);
            var ret = a.Flags.Return || a.Targets.Any(t => t.Flags?.Return == true);
            if (jump || ret)
            {
                if (a.Targets.Count > 1) throw Unspellable("a jump with several targets", "a jump or return item with more than one target.");
                string stmt;
                if (jump)
                {
                    var l = a.Targets.Count == 1 ? a.Targets[0].Text : "";
                    if (!NetworkSpelling.Identifier.IsMatch(l)) throw Unspellable("a jump with no label", $"a jump to '{l}'.");
                    if (a.Targets[0].Flags is { Set: true } or { Reset: true } or { Negated: true } or { Rising: true } or { Falling: true })
                        throw Unspellable("a coil modifier on a jump", $"the jump to '{l}' carries {Describe(a.Targets[0].Flags!)}.");
                    stmt = "JMP " + l + ";";
                }
                else
                {
                    if (a.Targets.Count == 1 && a.Targets[0].Text != Box.UnnamedInstance)
                        throw Unspellable("a return with a named target", a.Targets[0].Text);
                    stmt = "RETURN;";
                }
                // Unconditional: the rail CODESYS stores, or the empty operand TwinCAT stores (a stored member).
                if (a.Value is Terminator { Flags.IsNone: true } or Leaf { Operand.Text.Length: 0, Flags.IsNone: true }) return stmt;
                return "IF " + Expr(a.Value, 0, pre) + " THEN " + stmt + " END_IF;";
            }
            return AssignText(a, pre) + ";";
        }

        /// <summary><c>t1 := t2 S= value</c>; a negated coil negates its value, an edge coil is a plain coil (stored members).</summary>
        private string AssignText(Assign a, List<string> pre)
        {
            if (a.Targets.Count == 0) throw Unspellable("an assignment with no target", "an Assign item holding no target.");
            var value = a.Value;
            if (a.Targets.Any(t => t.Flags is { Negated: true, Reset: false }))
            {
                if (a.Targets.Count > 1) throw Unspellable("a negated coil among several", "a negated coil beside other coils on one value.");
                value = Negate(value);
            }
            var sb = new StringBuilder();
            foreach (var t in a.Targets)
            {
                var f = t.Flags ?? Flags.None;
                if (f.Jump || f.Return) throw Unspellable("a jump among coils", "a jump or return target beside a coil.");
                sb.Append(Target(t.Text)).Append(f.Reset ? " R= " : f.Set ? " S= " : " := ");
            }
            if (value is Leaf { Operand.Text.Length: 0 })
                throw Unspellable("an empty operand as a coil value", "a coil is driven by an operand holding no text.");
            var outer = _coilValue;
            _coilValue = value;
            sb.Append(Expr(value, 0, pre));
            _coilValue = outer;
            return sb.ToString();
        }

        // ── expressions ──────────────────────────────────────────────────────────────────────────

        /// <summary>An expression, bracketed where its precedence is not above <paramref name="parent"/>.</summary>
        private string Expr(Node n, int parent, List<string> pre)
        {
            switch (n)
            {
                case Terminator t: return Expr(new Leaf(new Operand(True), t.Flags), parent, pre);
                case Leaf { Flags: { Rising: true } or { Falling: true } } edged:
                    return EdgeCall(edged.Flags, Expr(edged with { Flags = edged.Flags with { Rising = false, Falling = false } }, 0, pre));
                case Leaf l:
                {
                    if (l.Flags.Jump || l.Flags.Return || l.Flags.Set || l.Flags.Reset)
                        throw Unspellable("a coil flag on an operand", $"the operand '{l.Operand.Text}' carries {Describe(l.Flags)}.");
                    // An operand holding an ST expression an engineer typed into it is written as the boxes it reads as (a
                    // stored member: it runs the same, gap probe 911876691e), so the text is one text whichever it came from.
                    if (OperandExpression(l.Operand.Text) is { } tree) return Expr(l.Flags.Negated ? Negate(tree) : tree, parent, pre);
                    var atom = Operand(l.Operand.Text);
                    return l.Flags.Negated ? Bracket("NOT " + atom, 9, parent) : atom;
                }
                case Demux { Input: null } d:
                {
                    // A wire read before its definition is read by its name: the value it held (the previous scan's).
                    var read = WireName(d.VarId);
                    if (_enabledValueWires.Contains(read)) RequireCoilValue(n, $"the wire {read}");
                    return read;
                }
                case Demux d when d.Input is Box b && IsStatementBox(b):
                {
                    if (IsEnabledValueBox(b))
                        throw Unspellable(EnabledValueReason, $"the enabled '{b.Type}' box is read by its value through a wire defined inside a tree.");
                    var wire = Define(d.VarId);
                    var tmp = NewTemp();
                    pre.Add(PreStatement(b, pre, tmp));
                    return "(" + wire + " := " + tmp + ")";
                }
                case Demux d:
                {
                    var wire = Define(d.VarId);
                    return "(" + wire + " := " + Expr(d.Input!, 0, pre) + ")";
                }
                case Assign a:
                    if (a.Flags.Jump || a.Flags.Return) throw Unspellable("a jump inside a tree", "a jump or return nested in a tree.");
                    return "(" + AssignText(a, pre) + ")";
                case Parallel p:
                {
                    var head = p.Mode == ParallelMode.Sequential ? BranchHead : ShortCircuitHead;
                    RequireElementHead(head);
                    var args = new List<string>();
                    if (p.Input is { } feed) args.Add(FeedPin + " := " + Expr(feed, 0, pre));
                    foreach (var branch in p.Branches) args.Add(Expr(branch, 0, pre));
                    return head + "(" + string.Join(", ", args) + ")";
                }
                case Box b when IsStatementBox(b):
                {
                    if (!b.Flags.IsNone) throw Unspellable("a modifier on an FB or Execute box output", $"the '{b.Type}' box carries {Describe(b.Flags)}.");
                    if (IsEnabledValueBox(b)) RequireCoilValue(n, $"the '{b.Type}' box");
                    var tmp = NewTemp();
                    pre.Add(PreStatement(b, pre, tmp));
                    return tmp;
                }
                case Box b:
                {
                    // A negated output is a NOT box over the box (a stored member); the IDE negates before the edge (N17).
                    if (b.Flags.Negated)
                        return Expr(NotBox(b with { Flags = Flags.None }) with { Flags = b.Flags with { Negated = false } }, parent, pre);
                    if (b.Flags.Rising || b.Flags.Falling)
                        return EdgeCall(b.Flags, Expr(b with { Flags = b.Flags with { Rising = false, Falling = false } }, 0, pre));
                    if (IsContact(b))
                    {
                        var prec = Precedence(b.Type);
                        var parts = b.Inputs.Select(p => Expr(PinValue(b, p), prec, pre));
                        return Bracket(string.Join(" " + b.Type + " ", parts), prec, parent);
                    }
                    return Call(b, pre, consumed: true);
                }
                default: throw Unspellable("an unknown node", n.GetType().Name);
            }
        }

        /// <summary><c>R_EDGE(x)</c> / <c>F_EDGE(x)</c> over the text of the node the edge is on.</summary>
        private string EdgeCall(Flags f, string inner)
        {
            if (f.Rising && f.Falling) throw Unspellable("a rising and falling edge on one node", "a node carries both edges.");
            var head = f.Rising ? RisingHead : FallingHead;
            RequireElementHead(head);
            return head + "(" + inner + ")";
        }

        /// <summary>The text's own function name must name nothing in reach, or the text would mean two things.</summary>
        private void RequireElementHead(string head)
        {
            if (InReach(head)) throw Unspellable("an element whose function name is declared in reach", $"'{head}' is itself declared in reach.");
        }

        /// <summary>A box written as a statement before its item, defining <paramref name="wire"/>.</summary>
        private string PreStatement(Box b, List<string> pre, string wire) => StatementBox(b, pre, consumedInto: wire);

        private static string Bracket(string s, int prec, int parent) => prec > parent ? s : "(" + s + ")";

        /// <summary>A pin's value with its own negation and edge (stored members: the negation, then the edge, on the value,
        /// as the IDE applies them, N17).</summary>
        private static Node PinValue(Box b, Input p)
        {
            if (p.Flags.Set || p.Flags.Reset || p.Flags.Jump || p.Flags.Return)
                throw Unspellable("a coil flag on a pin", $"the '{b.Type}' box's pin '{p.Formal}' carries {Describe(p.Flags)}.");
            var v = p.Flags.Negated ? Negate(p.Value) : p.Value;
            return p.Flags.Rising || p.Flags.Falling ? Edge(v, p.Flags, $"the '{b.Type}' box's pin '{p.Formal}'") : v;
        }

        /// <summary>A box that is a statement: an FB call and an Execute box, which have no expression form, and an enabled box
        /// that is not read by its return (its ENO): at the root, or read by its value through <c>OUT =&gt;</c> a wire.</summary>
        private static bool IsStatementBox(Box b) =>
            b.Instance is not null || b.StCode is not null || b.Enable is not null && !NetworkSpelling.ConnectedByEno(b);

        /// <summary>A contact: an AND/OR box the IDE stores with no output (its <c>OutputParam.Names</c> empty, 1.3), with
        /// no pin of its own; with no stored names, any AND/OR in LD (FBD's toolbox has no contacts).</summary>
        private bool IsContact(Box b) =>
            Contacts.Contains(b.Type) && b.Instance is null && b.Enable is null && b.StCode is null && b.Outputs.Count == 0 &&
            b.Inputs.Count >= 2 && b.Inputs.All(p => p.Flags.IsNone || p.Flags.Negated) &&
            b.Inputs.Select((p, i) => NetworkSpelling.IsDefaultFormal(b.Type, i, p.Formal)).All(x => x) &&
            (b.Members?[NetworkMembers.OutputNames] is { } names ? names.AsTexts.Count == 0 : _language == BodyLanguage.Ld);

        /// <summary>The suffix of a box's call head, by the EN and ENO it shows (the box's stored flags): <c>X_EN</c> shows EN and
        /// ENO — its return — except where it is read by its value (then its ENO is no line out of the box: CODESYS's enabled
        /// comparisons, 1.3); <c>X_ENO</c> shows ENO and no EN; a plain call shows neither. An Execute box has its ENO by type.</summary>
        private static string Suffix(Box b, bool byValue)
        {
            if (b.StCode is not null) return "";
            if (b.Enable is null) return b.HasEnoOutput ? EnoSuffix : "";
            var spelled = !byValue;
            if (b.HasEnoOutput == spelled) return EnabledSuffix;
            throw b.HasEnoOutput
                ? Unspellable("an enabled box read by its value showing ENO", $"the enabled '{b.Type}' box is read by its value and shows ENO: `{b.Type}{EnabledSuffix}` returns its ENO.")
                : Unspellable("an enabled box without ENO", $"the enabled '{b.Type}' box shows no ENO: `{b.Type}{EnabledSuffix}` returns its ENO.");
        }

        /// <summary>A call expression: <c>T(pins…, outputs…)</c> returning the box's value, or <c>T_EN(EN := e, pins…,
        /// OUT =&gt; x)</c> / <c>T_ENO(pins…)</c> returning its ENO (a box read by its ENO, or standing at the root).</summary>
        private string Call(Box b, List<string> pre, bool consumed)
        {
            var suffix = Suffix(b, byValue: false);
            if (b.Enable is not null && !NetworkSpelling.ConnectedByEno(b))
                throw Unspellable("an enabled box read by its value", $"the enabled '{b.Type}' box is read by its value, and its call returns ENO.");
            if (suffix == EnoSuffix && consumed && !NetworkSpelling.ConnectedByEno(b))
                throw Unspellable("a box showing ENO without EN read by its value", $"the '{b.Type}' box shows ENO and is read by its value, and its call returns ENO.");
            if (string.Equals(b.Type, NetworkSpelling.NotBox, StringComparison.OrdinalIgnoreCase) && b.Enable is null &&
                (b.Inputs.Count != 1 || b.Outputs.Count > 0 || !NetworkSpelling.IsDefaultFormal(b.Type, 0, b.Inputs[0].Formal)))
                throw Unspellable("a NOT box with pins", "a NOT box with outputs, a named pin or several inputs.");
            var head = CallHead(b.Type, suffix);
            return head + "(" + string.Join(", ", Args(b, pre, wireOut: null)) + ")";
        }

        private List<string> Args(Box b, List<string> pre, (string Formal, string Wire)? wireOut)
        {
            var args = new List<string>();
            if (b.Enable is { } en)
            {
                // A negation or an edge on the EN pin is a stored member: spelled on the value feeding it.
                var value = b.EnableFlags.Negated ? Negate(en) : en;
                if (b.EnableFlags.Rising || b.EnableFlags.Falling) value = Edge(value, b.EnableFlags, $"the '{b.Type}' box's EN");
                args.Add(Box.EnablePin + " := " + Expr(value, 0, pre));
            }
            var op = NetworkSpelling.IsOperatorBox(b.Type);
            for (var i = 0; i < b.Inputs.Count; i++)
            {
                var p = b.Inputs[i];
                if (p.Value is Leaf { Operand.Text.Length: 0 } empty)
                {
                    // AN UNCONNECTED FB INPUT (an empty operand, lenze-mid's 10) IS THE PIN LEFT OUT: measured 2026-10-27
                    // (design.md "2.1"), the network compiles and runs as the call without the pin — the input keeps the
                    // value it holds — and not as the pin given its default. A stored member: the push restores the pin
                    // from the callee's declaration (3.1). On a function or with a flag it is unmeasured, and refused.
                    if (b.Instance is not null && p.Formal is not null && empty.Flags.IsNone && p.Flags.IsNone) continue;
                    throw Unspellable("an empty operand on a pin", $"the '{b.Type}' box's pin {p.Formal ?? "#" + i.ToString(CultureInfo.InvariantCulture)} holds an empty operand (an unconnected input), measured only on an FB's named pin.");
                }
                var value = Expr(PinValue(b, p), 0, pre);
                var positional = p.Formal is null || op && NetworkSpelling.IsDefaultFormal(b.Type, i, p.Formal);
                if (!positional && b.Enable is not null && string.Equals(p.Formal, Box.EnablePin, StringComparison.OrdinalIgnoreCase))
                    throw Unspellable("a data pin named EN on an enabled box", $"the enabled '{b.Type}' box has a data input named EN beside its enable.");
                args.Add(positional ? value : Name(p.Formal!) + " := " + value);
            }
            var eno = b.HasEnoOutput ? 0 : (int?)null;
            var connected = wireOut is null ? b.ConnectedSlot : null;
            var next = 0;
            foreach (var o in b.Outputs)
            {
                if (o.Value.Flags is { IsNone: false } of)
                    throw Unspellable("a modifier on an output pin", $"the '{b.Type}' box's output to '{o.Value.Text}' carries {Describe(of)}.");
                if (o.Formal is { } f)
                {
                    if (b.Instance is null && string.Equals(f, ResultPin, StringComparison.OrdinalIgnoreCase))
                        throw Unspellable("a named output called OUT", $"the '{b.Type}' function declares an output OUT, which the text reads as its result pin.");
                    args.Add(Name(f) + " => " + Target(o.Value.Text));
                    continue;
                }
                if (o.Value.Text == Box.UnnamedInstance) continue;   // an extra slot past the names (stored member)
                // Each `OUT =>` is the next unnamed output slot: ENO and the slot a consumer reads are skipped.
                next = NetworkSpelling.NextFreeSlot(next, eno, connected);
                if (o.Slot != next)
                    throw Unspellable("an unnamed output by an unspellable slot",
                        $"the '{b.Type}' box wires its unnamed output slot {o.Slot?.ToString(CultureInfo.InvariantCulture) ?? "(none)"} to '{o.Value.Text}'; the next OUT is slot {next}.");
                args.Add(ResultPin + " => " + Target(o.Value.Text));
                next++;
            }
            if (wireOut is { } w) args.Add(w.Formal + " => " + w.Wire);
            return args;
        }

        /// <summary>A box as a call statement (<see cref="IsStatementBox"/>), its connection, where it is consumed, an output to
        /// the wire <paramref name="consumedInto"/>: an FB's ENO or named output, an enabled box's value through <c>OUT</c>.</summary>
        private string StatementBox(Box b, List<string> pre, string? consumedInto)
        {
            if (!b.Flags.IsNone) throw Unspellable("a modifier on an FB or Execute box output", $"the '{b.Type}' box carries {Describe(b.Flags)}.");
            var function = b.Instance is null && b.StCode is null;
            var byValue = function && consumedInto is not null;
            var suffix = Suffix(b, byValue);
            (string, string)? wire = null;
            if (consumedInto is not null)
            {
                if (byValue)
                {
                    if (b.Outputs.Any(o => o.Formal is null && o.Value.Text != Box.UnnamedInstance))
                        throw Unspellable("a second unnamed output", $"the enabled '{b.Type}' box is read by its value and wires an unnamed output too.");
                    wire = (ResultPin, consumedInto);
                }
                else if (b.HasEnoOutput && b.ConnectedSlot == 0) wire = (Box.EnoPin, consumedInto);
                else if (b.Instance is not null && b.MainOutputName is { Length: > 0 } main) wire = (Name(main), consumedInto);
                else throw Unspellable("a consumed box with no named connection",
                    $"the '{b.Type}' box is consumed, neither by its ENO nor by a named output.");
            }
            if (function) return CallHead(b.Type, suffix) + "(" + string.Join(", ", Args(b, pre, wire)) + ");";
            if (b.StCode is { } st)
            {
                if (b.Inputs.Count > 0 || b.Outputs.Count > 0 || b.Instance is not null)
                    throw Unspellable("an Execute box with pins", "an Execute box carries pins or an instance beside its ST.");
                var lines = st.Replace("\r\n", "\n").Split('\n');
                foreach (var line in lines)
                {
                    if (line.TrimStart().StartsWith(EndExecuteLine, StringComparison.OrdinalIgnoreCase))
                        throw Unspellable("a snippet line that ends the snippet", line);
                    if (line.IndexOf('\r') >= 0) throw Unspellable("a snippet line ending in a carriage return", line);
                }
                var args = Args(b, pre, wire);
                return ExecuteLine + (args.Count > 0 ? "(" + string.Join(", ", args) + ")" : "") + "\n" +
                       string.Join("\n", lines) + "\n" + EndExecuteLine;
            }
            var inst = b.Instance!;
            if (inst.Flags is { IsNone: false } f) throw Unspellable("a flag on an FB instance", $"'{inst.Text}' carries {Describe(f)}.");
            string head;
            if (inst.Text == Box.UnnamedInstance)
            {
                // THE VENDOR'S UNNAMED INSTANCE (`???`): the box is called by its FB TYPE, which names no instance — what the
                // IDE draws, and the build's error ("Program name, function or function block instance expected").
                if (!_scope.IsBlockType(b.Type) || _scope.InstanceType(b.Type) is not null)
                    throw Unspellable("an FB box with no instance whose type is no FB type in reach",
                        $"the '{b.Type}' box's instance is ???, and '{b.Type}' names no function block type in reach.");
                head = b.Type;
            }
            else
            {
                if (!StNetworkReader.IsCallHead(inst.Text))
                    throw Unspellable("an FB instance that is no call head", inst.Text);
                if (_scope.InstanceType(inst.Text) is not { } declared)
                    throw Unspellable("an FB instance the scope does not declare", inst.Text);
                if (!St.StDeclaration.SameType(declared, b.Type))
                    throw Unspellable("an FB instance declared with another type", $"'{inst.Text}' is a '{b.Type}' box, declared '{declared}'.");
                head = inst.Text;
            }
            return Suffixed(head, suffix) + "(" + string.Join(", ", Args(b, pre, wire)) + ");";
        }

        /// <summary>A function's call head (a box type, or an FB type for the unnamed instance) with its suffix.</summary>
        private string CallHead(string type, string suffix)
        {
            if ((!StNetworkReader.IsCallHead(type) || StNetworkReader.IsKeyword(type)) && !IsKeywordOperator(type))
                throw Unspellable("a box type that is no call head", $"the box type '{type}'.");
            if (_scope.InstanceType(type) is not null) throw Unspellable("a function named like an FB instance", type);
            return Suffixed(type, suffix);
        }

        /// <summary><paramref name="head"/> with its suffix, refused where the text would read another box: a plain head that
        /// ends in a suffix or names an element of the text, or a suffixed name declared in reach.</summary>
        private string Suffixed(string head, string suffix)
        {
            if (suffix.Length == 0 && (head.EndsWith(EnabledSuffix, StringComparison.OrdinalIgnoreCase) || head.EndsWith(EnoSuffix, StringComparison.OrdinalIgnoreCase)))
                throw Unspellable("a box name ending in _EN or _ENO", $"'{head}' reads as a box showing EN or ENO.");
            if (suffix.Length == 0 && ElementHeads.Any(e => string.Equals(e, head, StringComparison.OrdinalIgnoreCase)))
                throw Unspellable("a box named like an element of the text", $"'{head}' reads as a branch or an edge.");
            if (suffix.Length > 0 && InReach(head + suffix))
                throw Unspellable(EnabledNameInReach, $"'{head}{suffix}' is itself declared in reach.");
            return head + suffix;
        }

        private const string EnabledNameInReach = "an enabled box whose name with _EN is declared in reach";

        /// <summary>Anything declared in reach under <paramref name="name"/>: a POU, an instance or a variable.</summary>
        private bool InReach(string name) => _scope.Contains(name) || _scope.IsCallable(name);

        private static string Name(string formal)
        {
            if (!NetworkSpelling.Identifier.IsMatch(formal) || StNetworkReader.IsKeyword(formal))
                throw Unspellable("a pin name that is no identifier", $"the pin '{formal}'.");
            return formal;
        }

        /// <summary>The boxes an operand holding an ST expression (not one primary) reads as, or null for any other operand.</summary>
        private Node? OperandExpression(string text) =>
            text.Length > 0 && !StNetworkReader.IsOperand(text) && StNetworkReader.IsExpression(text)
                ? StNetworkReader.ExpressionTree(text, _scope)
                : null;

        /// <summary>An operand: one ST primary as it stands.</summary>
        private string Operand(string text)
        {
            if (text.Length == 0) throw Unspellable("an empty operand", "an operand holding no text.");
            if (StNetworkReader.IsKeyword(text))
                throw Unspellable("an operand named like an ST keyword", text);
            if (StNetworkReader.IsOperand(text)) return text;
            throw Unspellable("an operand that is no ST expression", $"the operand '{text}' does not read as ST.");
        }

        private static string Target(string text)
        {
            // A direct address (`%QW105`) is a variable; any other literal is none.
            if (!StNetworkReader.IsOperand(text) || StNetworkReader.IsLiteral(text) && !NetworkSpelling.Address.IsMatch(text))
                throw Unspellable("a target that is no ST variable", $"the target '{text}'.");
            return text;
        }
    }
}

/// <summary>A shape plain-ST network text has no spelling for: its reason names it (a pull shows the network as
/// <c>%UNSUPPORTED "&lt;reason&gt;"</c>), <see cref="Detail"/> says where.</summary>
public sealed class StNetworkUnspellableException : UnrepresentableBodyException
{
    public StNetworkUnspellableException(string reason, string detail)
        : base(reason, "plain-ST network text has no spelling for " + reason + ": " + detail) => Detail = detail;

    public string Detail { get; }

    /// <summary>The refusal is in the network's HEADER (its title, comment or label), which no network line can show.</summary>
    public bool OnHeader { get; init; }

    /// <summary>The order of the network refused (its index in the body), once the writer knows it.</summary>
    public int? Network { get; internal set; }
}
