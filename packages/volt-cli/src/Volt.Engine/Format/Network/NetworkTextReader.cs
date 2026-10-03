using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Volt.Contracts;

namespace Volt.Engine.Format.Network;

/// <summary>
/// Network text v2: reads a body written as a literal transcript of the vendor's network model back into a
/// <see cref="NetworkBody"/>. Specified by <c>docs/network-text.html</c> and
/// <c>openspec/changes/network-text-literal-nwl</c>; the inverse of <see cref="NetworkTextWriter"/>. There is no
/// second reader: v1 text (<c>LET</c>, <c>NETWORK &lt;n&gt; &lt;LANG&gt;</c>) is refused with a "re-pull" message
/// and never translated (spec, "the body language and the v1 refusal").
///
/// <para><b>Recursive descent, one token of lookahead; the model is built as it is read and never rebuilt.</b>
/// Each statement becomes exactly one NWL item as it is read; nothing is hoisted, re-inlined or resolved
/// afterwards. The only state that crosses statements is the network's wire set, and it is decided by the
/// <c>VAR_TEMP</c> declaration alone: a declared name's assignment DEFINES a Demux, every other use of it
/// REFERENCES one, and any other assignment is an Assign. v1 decided the same thing by use count and name prefix,
/// which is how a coil on a real variable could silently become a wire.</para>
///
/// <para><b>What looks further, and why.</b> After an operator word the lexer scans the pair that follows for an
/// operator (parentheses decide group vs argument list). At END_NETWORK two checks run over what the network
/// read, each because its fact lies below the point it is about: a declared wire never defined; and each wire's
/// declared type against its producer — a leaf's type is decided by its uses, which
/// <see cref="NetworkSpelling.ProducerType"/> counts across the network. Neither changes the model — each only
/// reports.</para>
///
/// <para><b>Bad input is a diagnostic, never an exception.</b> Every finding carries a <c>NETWORK_*</c> code and a
/// span, and a failed network does not hide the next one's findings. What the reader cannot know from the text —
/// whether a call head is an FB instance, its type, the names a wire must not collide with — it takes from the
/// declarations (<see cref="NetworkScope"/>), never from a guess.</para>
/// </summary>
public static class NetworkTextReader
{
    /// <summary>Read <paramref name="text"/>, a whole graphical body starting with its <c>IMPLEMENTATION LD|FBD</c> line —
    /// which states the body's language. A line stating another language than the IDE's view is a view change, which the
    /// drivers write (openspec bridge-refusal-review 2.22, 2.31).</summary>
    /// <param name="scope">The declarations the body can see; see <see cref="NetworkScope"/>.</param>
    public static NetworkReadResult Read(string text, NetworkScope scope) =>
        ReadTokens(text, scope).Result;

    /// <summary>The read plus what the gate needs of it: where each model node and each network header was read (where
    /// it reports a finding the writer raises).</summary>
    internal static (NetworkReadResult Result, ReadTrace Trace) ReadTokens(string text, NetworkScope scope)
    {
        if (text is null) throw new ArgumentNullException(nameof(text));
        if (scope is null) throw new ArgumentNullException(nameof(scope));
        var p = new Parser(text, scope);
        var body = p.ParseBody();
        return (new NetworkReadResult(p.Diagnostics.Count == 0 ? body : null, p.Diagnostics),
                new ReadTrace(p.Lexer, p.Spans, p.Headers));
    }

    /// <summary>What a read leaves behind for the gate. <see cref="Spans"/> is keyed by node IDENTITY: two equal
    /// leaves at two places are two keys.</summary>
    internal sealed record ReadTrace(NetworkLexer? Lexer,
                                     IReadOnlyDictionary<Node, (int Offset, int Length)> Spans, IReadOnlyList<Tok> Headers);

    private sealed class ByIdentity : IEqualityComparer<Node>
    {
        public static readonly ByIdentity Instance = new();
        public bool Equals(Node? x, Node? y) => ReferenceEquals(x, y);
        public int GetHashCode(Node n) => System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(n);
    }

    private sealed class ParseError : Exception
    {
        public ParseError(string code, string message, int offset, int length) : base(message)
        {
            Code = code; Offset = offset; Length = length;
        }
        public string Code { get; }
        public int Offset { get; }
        public int Length { get; }
    }

    /// <summary>A value as parsed, before it is known what it is for. A bare token (<see cref="Bare"/>) is kept
    /// unresolved because the SAME token is a target when <c>:=</c> follows it and an operand otherwise — and
    /// resolving a declared wire's name as an operand would call its own definition a reference.</summary>
    private readonly record struct PVal(Node? Node, Tok? Bare, bool Empty, Tok Start)
    {
        public static PVal Of(Node n, Tok start) => new(n, null, false, start);
        public static PVal Token(Tok t) => new(null, t, false, t);
        public static PVal Nothing(Tok at) => new(null, null, true, at);
    }

    private sealed class Wire
    {
        public Wire(string name, int varId, string type, Tok decl) { Name = name; VarId = varId; Type = type; Decl = decl; }
        public string Name { get; }
        public int VarId { get; }
        public string Type { get; }
        public Tok Decl { get; }
        public bool Defined { get; set; }
    }

    private sealed class Parser
    {
        private readonly string _text;
        private readonly NetworkScope _scope;
        private NetworkLexer? _lx;
        private Tok? _la;
        private BodyLanguage _lang;

        public readonly List<Tok> Consumed = new();
        public readonly List<NetworkTextDiagnostic> Diagnostics = new();
        public readonly Dictionary<Node, (int Offset, int Length)> Spans = new(ByIdentity.Instance);
        public readonly List<Tok> Headers = new();
        public NetworkLexer? Lexer => _lx;

        /// <summary>Record that <paramref name="node"/> was read from <paramref name="start"/> through the last
        /// token consumed.</summary>
        private T Mark<T>(T node, int start) where T : Node
        {
            var end = Consumed.Count > 0 ? Consumed[Consumed.Count - 1].Offset + Consumed[Consumed.Count - 1].Length : start;
            Spans[node] = (start, Math.Max(1, end - start));
            return node;
        }

        // Per network: the declared wires, by name and by VarId.
        private Dictionary<string, Wire> _wires = new(StringComparer.OrdinalIgnoreCase);
        private Dictionary<int, Wire> _byId = new();
        // Per network: every bare word read as a VARIABLE so far (an operand or a target), with where — so a late
        // VAR_TEMP block cannot turn a name the network already read as a variable into a wire (Declare).
        private Dictionary<string, Tok> _readAsVariable = new(StringComparer.OrdinalIgnoreCase);

        public Parser(string text, NetworkScope scope)
        {
            _text = text;
            _scope = scope;
        }

        // ── the body ────────────────────────────────────────────────────────────────────────────────

        public NetworkBody? ParseBody()
        {
            var start = 0;
            while (start < _text.Length && char.IsWhiteSpace(_text[start])) start++;
            var eol = _text.IndexOf('\n', start);
            if (eol < 0) eol = _text.Length;
            var first = _text.Substring(start, eol - start).TrimEnd('\r');

            // The body's language is the one its first line STATES, and this reader reads only LD and FBD. Anything
            // else is a diagnostic naming what the line says, never a guess: a body stating ST is the ST path's, and
            // a line stating no language, or one no body can state, has no reader at all.
            var marked = NetworkText.LanguageOf(first);
            if (marked is null)
            {
                string message;
                if (Volt.Engine.Format.St.ImplementationMarker.Stated(first) is { } stated)
                    message = $"the body states '{first.Trim()}' — a network-text body opens with IMPLEMENTATION FBD or " +
                              "IMPLEMENTATION LD" + (stated.Length == 0 ? "; this line states no language." : ".");
                else if (NetworkText.IsV1Header(first))
                    message = NetworkText.V1Refusal("`NETWORK <n> <LANG>` headers");
                else
                    message = "a graphical body opens with the line stating its language, IMPLEMENTATION FBD or " +
                              "IMPLEMENTATION LD, on its first line.";
                Diagnostics.Add(Diag(ConflictCodes.NetworkParse, message, start, Math.Max(1, first.Length)));
                return null;
            }

            _lang = NetworkText.LanguageNamed(marked)
                    ?? throw new InvalidOperationException($"the line states '{marked}', which is no body language.");
            Consumed.Add(new Tok(TokKind.Marker, marked, start, first.Length, true));
            _lx = new NetworkLexer(_text, eol);

            // v1 is refused as a whole, before any statement is parsed, by the one rule the pull's note asks too
            // (NetworkText.V1Constructs): there is no translator, so nothing else said about a v1 body is actionable —
            // and a construct judged where the parse happens to reach it hid behind every error in front of it.
            var v1 = NetworkText.V1Constructs(_text, eol);
            if (v1.Count > 0)
            {
                foreach (var (at, what) in v1)
                    Diagnostics.Add(Diag(ConflictCodes.NetworkParse, NetworkText.V1Refusal(what), at.Offset, Math.Max(1, at.Length)));
                return null;
            }

            var networks = new List<Network>();
            while (true)
            {
                try
                {
                    var t = Peek();
                    if (t.Kind == TokKind.Eof) break;
                    if (t.Is("NETWORK") && t.AtLineStart)
                    {
                        if (ParseNetwork(networks.Count) is { } n) networks.Add(n);
                        continue;
                    }
                    throw Err(t, ConflictCodes.NetworkParse,
                        $"'{t.Text}' outside a network: a body is a sequence of NETWORK … END_NETWORK blocks, each NETWORK at a line start.");
                }
                catch (ParseError e)
                {
                    Diagnostics.Add(Diag(e.Code, e.Message, e.Offset, e.Length));
                    Recover();
                }
            }
            return new NetworkBody(_lang, networks);
        }

        /// <summary>After an error: skip to the end of the network it is in, so the next one is still read.</summary>
        private void Recover()
        {
            if (_la is { } la)
            {
                if (la.Kind == TokKind.Eof || (la.Is("NETWORK") && la.AtLineStart)) return;
                _la = null;
                if (la.Is("END_NETWORK")) return;
            }
            while (true)
            {
                var t = _lx!.Next();
                if (t.Kind == TokKind.Eof || (t.Is("NETWORK") && t.AtLineStart)) { _la = t; return; }
                if (t.Is("END_NETWORK")) return;
            }
        }

        // ── one network ─────────────────────────────────────────────────────────────────────────────

        private Network? ParseNetwork(int index)
        {
            _wires = new Dictionary<string, Wire>(StringComparer.OrdinalIgnoreCase);
            _byId = new Dictionary<int, Wire>();
            _readAsVariable = new Dictionary<string, Tok>(StringComparer.OrdinalIgnoreCase);

            var hdr = Next();
            Headers.Add(hdr);
            var hdrLine = Line(hdr);
            string? label = null, title = null;
            var disabled = false;

            // The header ends at its newline: a line after it that starts DISABLED, TITLE or LABEL is a statement.
            // Fields are read in any order so a misordered header reaches the gate, which names the canonical one.
            while (Peek() is var t && t.Kind != TokKind.Eof && Line(t) == hdrLine)
            {
                if (t.Is("LABEL"))
                {
                    Next();
                    if (label is not null) throw Err(t, ConflictCodes.NetworkParse, "a NETWORK header carries LABEL twice.");
                    ExpectOnLine(":", hdrLine, "LABEL: name");
                    var name = Next();
                    if (Line(name) != hdrLine || name.Kind != TokKind.Word || !NetworkSpelling.Identifier.IsMatch(name.Text))
                        throw Err(name, ConflictCodes.NetworkParse, "a LABEL is one identifier, on the header's line.");
                    label = name.Text;
                }
                else if (t.Is("TITLE"))
                {
                    Next();
                    if (title is not null) throw Err(t, ConflictCodes.NetworkParse, "a NETWORK header carries TITLE twice.");
                    ExpectOnLine(":", hdrLine, "TITLE: \"…\"");
                    var s = Next();
                    if (Line(s) != hdrLine || s.Kind != TokKind.String)
                        throw Err(s, ConflictCodes.NetworkParse, "a TITLE is a double-quoted string, on the header's line.");
                    title = s.Text;
                }
                else if (t.Is("DISABLED"))
                {
                    Next();
                    if (disabled) throw Err(t, ConflictCodes.NetworkParse, "a NETWORK header carries DISABLED twice.");
                    disabled = true;
                }
                else
                    throw Err(t, ConflictCodes.NetworkParse,
                        $"'{t.Text}' in a NETWORK header: the header is NETWORK [LABEL: x] [TITLE: \"…\"] [DISABLED], and it ends at its newline.");
            }

            // The network's comment: the `//` lines between the header and the wire block or first statement.
            var comment = new List<string>();
            while (Peek().Kind == TokKind.Comment) comment.Add(Next().Text);

            var trees = new List<Node>();
            while (true)
            {
                var t = Peek();
                if (t.Is("END_NETWORK")) { Next(); break; }
                if (t.Kind == TokKind.Eof || (t.Is("NETWORK") && t.AtLineStart))
                    throw Err(hdr, ConflictCodes.NetworkNotClosed, "this NETWORK has no END_NETWORK.");
                if (t.Kind == TokKind.Comment)
                    throw Err(t, ConflictCodes.NetworkParse,
                        "a // comment after a statement: the network's one comment is the // lines between its header and " +
                        "its wire block or first statement, and NWL has no per-item comment to move this one to.");
                // A VAR_TEMP block is read wherever it stands, and a second one adds to the first (openspec
                // bridge-refusal-review 2.7): the model is the same, and the writer puts the one canonical block before
                // the first statement on the next pull. Text order still rules — a wire is a wire from its declaration on.
                if (t.Is("VAR_TEMP")) { ParseWires(); continue; }
                trees.Add(ParseStatement());
            }

            // A wire declared and never defined carries no Demux, so the model is complete without it and the writer
            // drops its declaration (2.8). A REFERENCE to one is refused where it stands (Resolve): it has no producer.
            CheckWireTypes(trees);

            // Title and comment as the drivers store them (NetworkText.Stored): a trailing space, an empty title or a
            // closing empty `//` line reads as what the IDE would hold, so the gate finds the text not canonical.
            return new Network(index, NetworkText.Stored(title), label,
                NetworkText.Stored(comment.Count > 0 ? string.Join("\n", comment) : null), disabled, trees);
        }

        /// <summary><c>VAR_TEMP g1, g2 : BOOL; … END_VAR</c> — on one line canonically, across lines as ST allows.</summary>
        private void ParseWires()
        {
            var kw = Next();
            while (!Peek().Is("END_VAR"))
            {
                if (Peek().Kind == TokKind.Eof) throw Err(kw, ConflictCodes.NetworkParse, "a VAR_TEMP block with no END_VAR.");
                var names = new List<Tok> { WireNameTok() };
                while (Peek().IsSym(",")) { Next(); names.Add(WireNameTok()); }
                ExpectSym(":", "a wire declaration is `g1 : BOOL;`");
                if (Peek().IsSym(";")) throw Err(Peek(), ConflictCodes.NetworkBadExpression, "a wire declaration with no type.");
                int from = Peek().Offset, to = from;
                while (!Peek().IsSym(";"))
                {
                    var t = Next();
                    if (t.Kind == TokKind.Eof || t.Is("END_VAR"))
                        throw Err(t, ConflictCodes.NetworkParse, "a wire declaration ends with `;`.");
                    to = t.Offset + t.Length;
                }
                Next();
                var type = NetworkSpelling.WireType(_text.Substring(from, to - from));
                foreach (var n in names) Declare(n, type);
            }
            Next();   // END_VAR
            // An empty block declares nothing: layout, read as no block (2.9).
            // END_VAR takes no `;` of its own: a `;` after it is the empty statement — the empty item — and taking it
            // into the block would drop that item from the network without a word, on pull and on push alike.
        }

        private Tok WireNameTok()
        {
            var t = Next();
            if (t.Kind != TokKind.Word || !NetworkSpelling.WireName.IsMatch(t.Text))
                throw Err(t, ConflictCodes.NetworkBadExpression,
                    $"the wire '{t.Text}' is not named g<digits>: a wire's name carries the vendor's VarId, and the declaration alone makes it a wire.");
            return t;
        }

        private void Declare(Tok name, string type)
        {
            if (!int.TryParse(name.Text.Substring(1), System.Globalization.NumberStyles.None,
                    System.Globalization.CultureInfo.InvariantCulture, out var id))
                throw Err(name, ConflictCodes.NetworkBadExpression, $"the wire {name.Text} carries a VarId out of range.");
            if (_wires.ContainsKey(name.Text))
                throw Err(name, ConflictCodes.NetworkDuplicateName, $"the wire {name.Text} is declared twice.");
            if (_byId.TryGetValue(id, out var other))
                throw Err(name, ConflictCodes.NetworkDuplicateName,
                    $"the wires {other.Name} and {name.Text} carry the same VarId {id}.");
            // A wire spelled like a variable in scope is no conflict (2.10): wires are VarIds in the IDE, and in the text
            // the network's own wires resolve first. Which name the writer picks is its own choice, made on the next pull.
            // But a LATE block (2.7) may not take a name this network already read as a variable: text order would make the
            // one spelling two things — the variable before the block, the wire after it — which the canonical rewrite
            // shows only once the push has landed (bridge-refusal-review 1+2d review).
            if (_readAsVariable.TryGetValue(name.Text, out var used))
                throw Err(name, ConflictCodes.NetworkDuplicateName,
                    $"the wire {name.Text} is declared after line {Line(used)} read {used.Text} as a " +
                    "variable: one name would mean the variable before this block and the wire after it. Declare the wire " +
                    "before its first use, or give it another name.");
            var w = new Wire(name.Text, id, type, name);
            _wires[name.Text] = w;
            _byId[id] = w;
        }

        // ── statements: one per NWL item ────────────────────────────────────────────────────────────

        private Node ParseStatement()
        {
            var t = Peek();

            // The empty statement IS the empty item — a `;` that closes no statement.
            if (t.IsSym(";")) { Next(); return Mark(new Terminator(Flags.None), t.Offset); }

            if (t.Is("IF"))
            {
                Next();
                var condTok = Peek();
                var cond = Resolve(ParseValue(consumed: true), consumed: true);
                if (cond is Terminator)
                    throw Err(condTok, ConflictCodes.NetworkBadExpression, "IF with no condition: an unconditional jump is `JMP l;`.");
                ExpectWord("THEN", "IF c THEN JMP l; END_IF;");
                var (target, flags) = ParseJump();
                ExpectSym(";", "IF c THEN JMP l; END_IF;");
                ExpectWord("END_IF", "IF c THEN JMP l; END_IF;");
                ExpectSym(";", "every statement ends with `;`, END_IF; included");
                return Mark(new Assign(cond, new[] { target }, flags), t.Offset);
            }

            if (t.Is("JMP") || t.Is("RETURN"))
            {
                var (target, flags) = ParseJump();
                ExpectSym(";", "every statement ends with `;`");
                // Unconditional: the vendor's "nothing drives it" is an empty Terminator (census 1.2, DIALECT C11).
                return Mark(new Assign(new Terminator(Flags.None), new[] { target }, flags), t.Offset);
            }

            var first = ParseValue(consumed: false, defer: true);
            if (AtStorage())
            {
                var targets = new List<(Tok Target, Tok Op)>();
                var cur = first;
                Node value;
                while (true)
                {
                    if (cur.Bare is not { } bare)
                        throw Err(cur.Start, ConflictCodes.NetworkBadExpression,
                            "an assignment target is one variable: a token, or text between backticks.");
                    targets.Add((bare, TakeStorage()));
                    var v = ParseValue(consumed: true, defer: true);
                    if (AtStorage()) { cur = v; continue; }
                    value = Resolve(v, consumed: true);
                    break;
                }
                ExpectSym(";", "every statement ends with `;`");
                return Mark(BuildAssign(targets, value), t.Offset);
            }

            var node = Resolve(first, consumed: false);
            ExpectSym(";", "every statement ends with `;`");
            return node;
        }

        /// <summary>Whether a storage operator is next after a target: <c>:=</c>, or ExST's <c>S=</c> / <c>R=</c>
        /// — a word <c>S</c> or <c>R</c> and <c>=</c>, however spaced. After a target nothing else can follow in
        /// that shape, while inside a group <c>(R = x)</c> is a comparison; so the position decides, never the
        /// spacing (spec: whitespace is significant only inside backticks, TITLE, comments and EXECUTE).</summary>
        private bool AtStorage()
        {
            var t = Peek();
            return t.IsSym(":=") || ((t.Is("S") || t.Is("R")) && _lx!.EqualsFollows());
        }

        /// <summary>Consume the storage operator <see cref="AtStorage"/> found, as one token <c>:=</c>, <c>S=</c> or
        /// <c>R=</c> with the span of both parts.</summary>
        private Tok TakeStorage()
        {
            var t = Next();
            if (t.IsSym(":=")) return t;
            var eq = Next();
            return new Tok(TokKind.Sym, t.Text.ToUpperInvariant() + "=", t.Offset, eq.Offset + eq.Length - t.Offset, t.AtLineStart);
        }

        private Node BuildAssign(List<(Tok Target, Tok Op)> targets, Node value)
        {
            foreach (var (tok, _) in targets)
            {
                if (tok.Kind != TokKind.Word || !_wires.TryGetValue(tok.Text, out var w)) continue;
                if (targets.Count > 1)
                    throw Err(tok, ConflictCodes.NetworkBadExpression,
                        $"the wire {w.Name} is defined inside a chain; a wire's definition is its own statement `{w.Name} := value;`.");
                if (targets[0].Op.Text != ":=")
                    throw Err(targets[0].Op, ConflictCodes.NetworkBadExpression,
                        $"the wire {w.Name} is defined with {targets[0].Op.Text}; a wire is defined with `:=`, and S=/R= are coils.");
                if (w.Defined)
                    throw Err(tok, ConflictCodes.NetworkDuplicateName, $"the wire {w.Name} is defined twice.");
                // The declared type is checked against the producer once the network is read
                // (CheckWireTypes): a leaf's type depends on how the wire is USED, which the statements below say.
                w.Defined = true;
                return new Demux(w.VarId, value, w.Type);
            }

            var operands = new List<Operand>();
            foreach (var (tok, op) in targets)
            {
                var storage = op.Text.ToUpperInvariant() switch
                {
                    "S=" => Flags.None with { Set = true },
                    "R=" => Flags.None with { Reset = true },
                    _ => null,
                };
                operands.Add(new Operand(LValueText(tok), IsLValue: true, Flags: storage));
            }
            return new Assign(value, operands, Flags.None);
        }

        /// <summary><c>JMP label</c> / <c>RETURN</c>. The bit rides on the target operand and on the item, as the
        /// vendor holds a drawn jump (DIALECT C13); a return's target is the vendor's constant <c>???</c>.</summary>
        private (Operand Target, Flags Flags) ParseJump()
        {
            var t = Next();
            if (t.Is("JMP"))
            {
                // After JMP a word can be nothing but the label, so a label spelled like a word of the text
                // (`Execute`, `Parallel` — legal IEC labels the header's LABEL: takes too) is read as one.
                var l = Next();
                if (l.Kind != TokKind.Word || !NetworkSpelling.Identifier.IsMatch(l.Text))
                    throw Err(l, ConflictCodes.NetworkBadExpression, "JMP takes one label, an identifier.");
                var jump = Flags.None with { Jump = true };
                return (new Operand(l.Text, IsLValue: true, Flags: jump), jump);
            }
            if (t.Is("RETURN"))
            {
                var ret = Flags.None with { Return = true };
                return (new Operand(Box.UnnamedInstance, IsLValue: true, Flags: ret), ret);
            }
            throw Err(t, ConflictCodes.NetworkParse, "IF c THEN takes `JMP label;` or `RETURN;`.");
        }

        // ── values ──────────────────────────────────────────────────────────────────────────────────

        /// <param name="consumed">Whether something consumes this value (an assign, a pin, a wire, a group) — as
        /// opposed to a top-level item whose output goes nowhere. It decides the <c>.ENO</c> rule.</param>
        /// <param name="defer">Keep a bare token unresolved: it may turn out to be a target or a pin's name.</param>
        private PVal ParseValue(bool consumed, bool defer = false)
        {
            var t = Peek();
            if (IsEmptyHere(t)) return PVal.Nothing(t);   // an empty position: f(a, ), coil := ;

            if (t.Is("NOT"))
            {
                Next();
                var n = Peek();
                if (IsEmptyHere(n))
                    throw Err(t, ConflictCodes.NetworkUnsupported, "a flag on an empty slot: an unconnected position has no text to modify.");
                if (n.IsSym("("))
                    // Parentheses are structural. After NOT, a pair holding an operator is a group under the
                    // negation modifier; any other pair is the NOT box's argument list. Spacing plays no part.
                    return PVal.Of(Mark(ParseAfterNotParen(t, consumed), t.Offset), t);
                // The vendor negates BEFORE it detects the edge (DIALECT N17, run in simulation), so a negation of
                // an edge's result is logic no operand or box holds; the one spelling is R_EDGE(NOT x).
                if (n.Is("R_EDGE") || n.Is("F_EDGE"))
                    throw Err(t, ConflictCodes.NetworkBadExpression,
                        $"NOT outside {n.Text.ToUpperInvariant()}(…): the IDE negates before it detects the edge, so the one spelling is {n.Text.ToUpperInvariant()}(NOT x).");
                var core = Resolve(ParseCore(consumed, defer: false), consumed);
                return PVal.Of(Mark(WithFlags(Held(core, t), f => f with { Negated = true }), t.Offset), t);
            }

            if (t.Is("R_EDGE") || t.Is("F_EDGE")) return PVal.Of(ParseEdge(consumed), t);

            var v = ParseCore(consumed, defer);
            return defer || v.Node is not null ? v : PVal.Of(Resolve(v, consumed), t);
        }

        /// <summary><c>R_EDGE(x)</c> / <c>F_EDGE(x)</c>: a flag on <c>x</c>, never a box — an R_TRIG box would be
        /// an FB with an instance the IDE never held.</summary>
        private Node ParseEdge(bool consumed)
        {
            var kw = Next();
            var rising = kw.Is("R_EDGE");
            if (NetworkSpelling.ConstructTaken(kw.Text, _scope))
                throw Err(kw, ConflictCodes.NetworkUnsupported,
                    $"a POU or instance named {kw.Text.ToUpperInvariant()}: the text reads {kw.Text.ToUpperInvariant()}(…) as the edge flag, so the call has no spelling.");
            ExpectSym("(", $"{kw.Text.ToUpperInvariant()}(x)");
            var n = Peek();
            // Parentheses are structural here too: `NOT(a)` — NOT with a pair holding no operator — is the NOT BOX,
            // an argument like any other. Any other NOT is the negation MODIFIER, and inside the edge is where it
            // belongs: the vendor negates before it detects the edge (DIALECT N17), so `R_EDGE(NOT x)` is
            // Negation+Rtrig on x. That one NOT is the only modifier an edge's argument carries.
            Tok? not = null;
            if (n.Is("NOT") && !(_lx!.PeekChar() == '(' && !_lx.PairAheadHoldsOperator()))
            {
                not = Next();
                n = Peek();
                if (n.Is("NOT") && !(_lx.PeekChar() == '(' && !_lx.PairAheadHoldsOperator()))
                    throw Err(n, ConflictCodes.NetworkBadExpression,
                        $"a second modifier inside {kw.Text.ToUpperInvariant()}(…): the one modifier an edge's argument carries is one NOT.");
            }
            if (n.Is("R_EDGE") || n.Is("F_EDGE"))
                throw Err(n, ConflictCodes.NetworkUnsupported, "nested edges: one operand carries one edge flag, and rising with falling has no spelling.");
            if (IsEmptyHere(n))
                throw Err(not ?? kw, ConflictCodes.NetworkUnsupported, "a flag on an empty slot: an unconnected position has no text to modify.");
            var core = not is not { } nt
                ? Resolve(ParseCore(consumed, defer: false), consumed)
                : n.IsSym("(")
                    // The pair after the modifier holds an operator (the NOT-box case was taken above): a group
                    // under the negation.
                    ? ParseAfterNotParen(nt, consumed)
                    : WithFlags(Held(Resolve(ParseCore(consumed, defer: false), consumed), nt), f => f with { Negated = true });
            ExpectSym(")", $"{kw.Text.ToUpperInvariant()}(x)");
            return Mark(WithFlags(Held(core, kw), f => rising ? f with { Rising = true } : f with { Falling = true }), kw.Offset);
        }

        private PVal ParseCore(bool consumed, bool defer)
        {
            var t = Peek();
            switch (t.Kind)
            {
                case TokKind.Sym when t.Text == "(":
                    Next();
                    return PVal.Of(Mark(ParseGroupRest(t, Resolve(ParseValue(consumed: true), consumed: true), consumed), t.Offset), t);

                case TokKind.Unnamed:
                    Next();
                    if (Peek().IsSym(":"))
                    {
                        // `??? : TYPE(…)` — the vendor's unnamed instance, which carries its type because no
                        // declaration can.
                        Next();
                        var ty = Next();
                        if (ty.Kind != TokKind.Word || !NetworkSpelling.Identifier.IsMatch(ty.Text))
                            throw Err(ty, ConflictCodes.NetworkBadExpression, "`??? : TYPE(…)` names the FB type, an identifier.");
                        ExpectSym("(", "??? : TYPE(pins)");
                        return PVal.Of(ParseCall(t, Box.UnnamedInstance, ty.Text, consumed, null), t);
                    }
                    if (Peek().IsSym("("))
                        throw Err(t, ConflictCodes.NetworkBadExpression, "??? is no call head; an unnamed instance is written `??? : TYPE(…)`.");
                    return Bare(t, defer, consumed);

                case TokKind.Word:
                    if (t.Is("PARALLEL")) return PVal.Of(Mark(ParseParallel(), t.Offset), t);
                    if (t.Is("EXECUTE")) return PVal.Of(Mark(ParseExecute(consumed), t.Offset), t);
                    Next();
                    if (Peek().IsSym("("))
                    {
                        if (!NetworkSpelling.IsBareHead(t.Text))
                            throw Err(t, ConflictCodes.NetworkBadExpression, $"'{t.Text}' is a keyword of the text and no call head.");
                        Next();
                        return PVal.Of(ParseCall(t, null, null, consumed, null), t);
                    }
                    if (NetworkSpelling.TextWords.Contains(t.Text))
                        throw Err(t, ConflictCodes.NetworkBadExpression,
                            $"'{t.Text}' at operand position: an operand spelled like a keyword of the text is written between backticks.");
                    return Bare(t, defer, consumed);

                case TokKind.Backtick:
                    Next();
                    if (Peek().IsSym("(")) { Next(); return PVal.Of(ParseCall(t, null, null, consumed, null), t); }
                    return Bare(t, defer, consumed);

                case TokKind.Number:
                case TokKind.Typed:
                case TokKind.Address:
                    Next();
                    if (Peek().IsSym("(")) throw Err(t, ConflictCodes.NetworkBadExpression, $"'{t.Text}' is a literal and no call head.");
                    return Bare(t, defer, consumed);

                default:
                    throw Err(t, ConflictCodes.NetworkParse, t.Kind == TokKind.Eof
                        ? "the body ends inside a statement."
                        : $"'{t.Text}' where a value is expected: an operand that is not one token is written between backticks.");
            }
        }

        private PVal Bare(Tok t, bool defer, bool consumed) => defer ? PVal.Token(t) : PVal.Of(Resolve(PVal.Token(t), consumed), t);

        /// <summary>A group's remainder, after <c>(</c> and its first operand: one operator kind, then <c>)</c>.
        /// Every pair of parentheses is exactly one box, so a pair holding no operator is refused, not read as
        /// grouping. A consumed group is connected by its main output, read by the one slot rule a call's is
        /// (<see cref="NetworkSpelling.MainSlotOfCall"/>) — the group and the call form of one box are one model.</summary>
        private Box ParseGroupRest(Tok open, Node first, bool consumed)
        {
            var op = Peek();
            if (!IsOperator(op))
            {
                if (op.IsSym(")"))
                    throw Err(open, ConflictCodes.NetworkBadExpression,
                        "a pair of parentheses that is no box: a group holds an infix operator, and a call's pair follows its head.");
                throw NotAnOperator(op);
            }
            var sym = OperatorSymbol(op);
            var inputs = new List<Input> { new(null, first, Flags.None) };
            while (IsOperator(Peek()))
            {
                var o = Next();
                if (!string.Equals(OperatorSymbol(o), sym, StringComparison.OrdinalIgnoreCase))
                    throw Err(o, ConflictCodes.NetworkBadExpression,
                        $"'{sym}' and '{o.Text}' in one group: a group is one operator box, so it holds one operator kind.");
                inputs.Add(new Input(null, Resolve(ParseValue(consumed: true), consumed: true), Flags.None));
            }
            if (!Peek().IsSym(")")) throw NotAnOperator(Peek());
            Next();
            var type = FbdOperators.SymbolToType[sym];
            var connected = consumed ? NetworkSpelling.MainSlotOfCall(type) : null;
            var box = new Box(type, null, CallKind.Operator, inputs, new List<Output>(), null, null, Flags.None,
                MainOutputIndex: connected, ConnectedSlot: connected);
            // A group has no suffix and no EN (a box consumed by ENO is a call — NetworkSpelling.IsInfix), so where the
            // text carries ENO at all the one rule answers "none". Asked rather than written `false`: a literal here
            // would be a second copy of TextHasEno, free to drift from the writer's.
            return box with
            {
                HasEnoOutput = NetworkSpelling.EnoCarried(box, consumed)
                    ? NetworkSpelling.TextHasEno(isExecute: false, hasEnable: false, enoSuffix: false, consumed) : null,
            };
        }

        private ParseError NotAnOperator(Tok t) =>
            t.Kind == TokKind.Word && NetworkSpelling.TextWords.Contains(t.Text)
                ? Err(t, ConflictCodes.NetworkBadExpression,
                    $"'{t.Text}' at operand position: an operand spelled like a keyword of the text is written between backticks.")
            : t.Kind == TokKind.Word || (t.Kind == TokKind.Sym && !Structural.Contains(t.Text))
                ? Err(t, ConflictCodes.NetworkUnknownOperator,
                    $"'{t.Text}' is not an operator of the table (AND OR XOR + - * / MOD > < >= <= = <>).")
                : Err(t, ConflictCodes.NetworkBadExpression, $"'{t.Text}' inside a group: a group is `(a OP b …)`.");

        /// <summary>After <c>NOT</c> and <c>(</c>: a group under the negation modifier if the pair holds an
        /// operator, else the NOT box's argument list.</summary>
        private Node ParseAfterNotParen(Tok not, bool consumed)
        {
            var open = Next();
            if (Peek().IsSym(")") || Peek().IsSym("=>") || IsPinName(Peek())) return ParseCall(not, null, null, consumed, null);
            var v = ParseValue(consumed: true, defer: true);
            if (v.Bare is not null && (Peek().IsSym(":=") || Peek().IsSym("=>"))) return ParseCall(not, null, null, consumed, v);
            if (IsOperator(Peek()))
                return WithFlags(ParseGroupRest(open, Resolve(v, consumed: true), consumed), f => f with { Negated = true });
            return ParseCall(not, null, null, consumed, v);
        }

        /// <summary>A call's pins after its <c>(</c>, the <c>)</c>, and an optional <c>.ENO</c>. The head is the
        /// FB instance when the scope declares it one, else the BoxType verbatim.</summary>
        private Box ParseCall(Tok head, string? unnamedInstance, string? unnamedType, bool consumed, PVal? first)
        {
            Node? en = null;
            var hadEn = false;
            var inputs = new List<Input>();
            // Output pins in source order; a positional one carries its ordinal among positional slots, a bare `=>`
            // (a slot connected to nothing) holds a position and produces no output.
            var outputs = new List<(string? Formal, Tok? Target, bool Positional)>();

            if (first is null && Peek().IsSym(")")) Next();   // `f()` — a box with no input slot
            else
            {
                var pre = first;
                while (true)
                {
                    Pin(pre, ref en, ref hadEn, inputs, outputs, consumed);
                    pre = null;
                    var sep = Peek();
                    if (sep.IsSym(",")) { Next(); continue; }
                    if (sep.IsSym(")")) { Next(); break; }
                    if (IsOperator(sep))
                        throw Err(sep, ConflictCodes.NetworkBadExpression,
                            "an infix operator inside a call's argument list: a group is its own pair of parentheses.");
                    throw Err(sep, ConflictCodes.NetworkParse, $"'{sep.Text}' in a call: pins are separated by `,` and closed by `)`.");
                }
            }

            var eno = false;
            if (Peek().IsSym("."))
            {
                Next();
                var e = Next();
                if (!e.Is("ENO")) throw Err(e, ConflictCodes.NetworkParse, "after a call, the one suffix is `.ENO`.");
                eno = true;
            }

            Operand? instance = null;
            string type;
            if (unnamedInstance is not null)
            {
                instance = new Operand(unnamedInstance, IsInstance: true);
                type = unnamedType!;
            }
            else if (_scope.InstanceType(head.Text) is { } fbType)
            {
                if (NetworkSpelling.ConstructWords.Contains(head.Text))
                    throw Err(head, ConflictCodes.NetworkUnsupported, $"an instance named {head.Text.ToUpperInvariant()}: the text reads it as its own construct.");
                instance = new Operand(head.Text, IsInstance: true);
                type = fbType;
            }
            else
            {
                if (!NetworkSpelling.IsName(head.Text))
                    // A function is a POU and has a name. A head that is none (`fbs[1]`, `SUPER^`) is an FB instance
                    // whose declaration the scope does not name, and read as a function it would push a box of a type
                    // no POU has in place of the instance call.
                    throw Err(head, ConflictCodes.NetworkUnsupported,
                        $"an FB instance the declarations do not name: '{head.Text}' is no POU name, and no declaration names it an instance, so its type is unknown.");
                type = head.Text;
            }
            // Spec, "a POU named like an edge word": refused by name, at the call. A backticked head is still the
            // POU's name, and an instance's FB type is a POU too — the writer could spell none of them back.
            if (NetworkSpelling.ConstructWords.Contains(type))
                throw Err(head, ConflictCodes.NetworkUnsupported,
                    $"a POU named {type.ToUpperInvariant()}: the text reads {type.ToUpperInvariant()}(…) as its own construct, so a call of it has no spelling.");

            // The slot rule: ENO is never an `=>` slot, nor is the slot a consumer is connected to; positional pins
            // fill the rest in order. Whether the box HAS an ENO output is read by the one rule the writer refuses
            // against (NetworkSpelling.TextHasEno): `.ENO` says so, a consumer without it reads a main output that is
            // not ENO, and a top-level box is read by its EN. A box consumed WITHOUT `.ENO` is connected by its
            // main output, which the text reads by NetworkSpelling.MainSlotOfCall — slot 0, or no stored slot for a
            // bit operator — and the writer refuses every box that reading would get wrong.
            var hasEno = NetworkSpelling.TextHasEno(isExecute: false, hadEn, eno, consumed);
            int? enoSlot = NetworkSpelling.EnoSlot(isExecute: false, hasEnoOutput: hasEno);
            int? connected = eno ? enoSlot : consumed ? NetworkSpelling.MainSlotOfCall(type) : null;
            var next = 0;
            var built = new List<Output>();
            foreach (var (formal, target, positional) in outputs)
            {
                if (!positional) { built.Add(new Output(formal, new Operand(LValueText(target!.Value), IsLValue: true), null)); continue; }
                var slot = NetworkSpelling.NextFreeSlot(next, enoSlot, connected);
                next = slot + 1;
                if (target is { } tt) built.Add(new Output(null, new Operand(LValueText(tt), IsLValue: true), slot));
            }

            // `.ENO` on a box without EN is NOT refused here: `.ENO` means "connected to the ENO output", and a box
            // may have one without EN (census 1.6: Lenze `Dryer`). Whether the IDE's box has it is the push's to
            // check against the box it builds, as is a suffix-less consumer of a box whose main output is ENO.
            if (eno && !consumed)
                throw Err(head, ConflictCodes.NetworkBadExpression,
                    $"`.ENO` on '{head.Text}', which nothing consumes: a top-level box's output goes nowhere.");

            var box = new Box(type, instance, NetworkSpelling.KindOf(type, instance is not null), inputs, built, en, null,
                Flags.None, MainOutputIndex: consumed && !eno ? connected : null, ConnectedSlot: connected);
            // Stated only where the text carries it; elsewhere the text says nothing about ENO, and null says so.
            box = box with { HasEnoOutput = NetworkSpelling.EnoCarried(box, consumed) ? hasEno : null };
            return Mark(box, head.Offset);
        }

        private void Pin(PVal? pre, ref Node? en, ref bool hadEn, List<Input> inputs,
                         List<(string?, Tok?, bool)> outputs, bool consumed)
        {
            if (pre is null && Peek().IsSym("=>"))
            {
                Next();
                // `=> v` fills the next output slot; a bare `=>` passes one over.
                outputs.Add((null, IsEmptyHere(Peek()) ? null : Next(), true));
                return;
            }

            // A pin name is decided by the `:=` / `=>` after it, BEFORE the word is read as a value: read first,
            // `execute := x` would open an EXECUTE body.
            Tok? pinName = pre is null
                ? IsPinName(Peek()) ? Next() : null
                : pre.Value.Bare is { Kind: TokKind.Word } b && (Peek().IsSym(":=") || Peek().IsSym("=>")) ? b : null;
            if (pinName is { } name)
            {
                if (!NetworkSpelling.Identifier.IsMatch(name.Text))
                    throw Err(name, ConflictCodes.NetworkBadExpression, $"a pin name is an identifier, not '{name.Text}'.");
                var isEn = string.Equals(name.Text, Box.EnablePin, StringComparison.OrdinalIgnoreCase);
                if (Next().Text == ":=")
                {
                    var value = Resolve(ParseValue(consumed: true), consumed: true);
                    if (isEn)
                    {
                        if (hadEn) throw Err(name, ConflictCodes.NetworkBadExpression, "a call names EN twice.");
                        en = value;
                        hadEn = true;
                    }
                    else inputs.Add(new Input(name.Text, value, Flags.None));
                    return;
                }
                if (isEn || string.Equals(name.Text, Box.EnoPin, StringComparison.OrdinalIgnoreCase))
                    throw Err(name, ConflictCodes.NetworkBadExpression,
                        $"`{name.Text} =>`: EN is an input, and ENO is never an output pin — a consumer of ENO says `.ENO`.");
                if (IsEmptyHere(Peek()))
                    throw Err(name, ConflictCodes.NetworkBadExpression,
                        $"`{name.Text} =>` wired to nothing: a named output pin holds a target, and an unwired one is not written.");
                outputs.Add((name.Text, Next(), false));
                return;
            }

            inputs.Add(new Input(null, Resolve(pre ?? ParseValue(consumed: true, defer: true), consumed: true), Flags.None));
        }

        /// <summary><c>PARALLEL([MODE := m,] [IN := feed,] b1, b2, …)</c> — the LD <c>BoxTreeParallel</c>, never an
        /// AND/OR box. No <c>IN</c> is no feed — the one unfed form (census 1.2); <c>IN := ,</c> is refused.</summary>
        private Parallel ParseParallel()
        {
            var kw = Next();
            if (NetworkSpelling.ConstructTaken(kw.Text, _scope))
                throw Err(kw, ConflictCodes.NetworkUnsupported,
                    "a POU or instance named PARALLEL: the text reads PARALLEL(…) as the parallel branch, so the call has no spelling.");
            ExpectSym("(", "PARALLEL([IN := feed,] b1, b2, …)");
            var mode = ParallelMode.BoxShortCircuit;
            Node? input = null;
            bool sawMode = false, sawIn = false;
            var branches = new List<Node>();
            if (Peek().IsSym(")")) throw Err(kw, ConflictCodes.NetworkBadExpression, "a PARALLEL with no branch.");
            while (true)
            {
                var v = ParseValue(consumed: true, defer: true);
                if (v.Bare is { } b && b.Kind == TokKind.Word && Peek().IsSym(":="))
                {
                    Next();
                    if (b.Is("MODE"))
                    {
                        if (sawMode || sawIn || branches.Count > 0)
                            throw Err(b, ConflictCodes.NetworkBadExpression, "PARALLEL takes MODE := first, once.");
                        var m = Next();
                        // Only the measured members, by the writer's own rule; an unmeasured one is refused, never
                        // mapped onto these.
                        if (m.Kind != TokKind.Word || !Enum.TryParse<ParallelMode>(m.Text, ignoreCase: false, out mode) ||
                            !NetworkSpelling.IsMeasuredMode(mode))
                            throw Err(m, ConflictCodes.NetworkUnsupported,
                                $"the Parallel mode '{m.Text}': the measured modes are BoxShortCircuit and Sequential.");
                        sawMode = true;
                    }
                    else if (b.Is("IN"))
                    {
                        if (sawIn || branches.Count > 0)
                            throw Err(b, ConflictCodes.NetworkBadExpression, "PARALLEL takes IN := before its branches, once.");
                        if (IsEmptyHere(Peek()))
                            throw Err(b, ConflictCodes.NetworkUnsupported,
                                "a Parallel fed by the empty terminator: census 1.2 found none — an unfed Parallel is PARALLEL(a, b), with no IN.");
                        input = Resolve(ParseValue(consumed: true), consumed: true);
                        sawIn = true;
                    }
                    else throw Err(b, ConflictCodes.NetworkBadExpression, "PARALLEL takes MODE :=, IN := and its branches.");
                }
                else branches.Add(Resolve(v, consumed: true));

                var sep = Peek();
                if (sep.IsSym(",")) { Next(); continue; }
                if (sep.IsSym(")")) { Next(); break; }
                throw Err(sep, ConflictCodes.NetworkParse, $"'{sep.Text}' in PARALLEL: branches are separated by `,` and closed by `)`.");
            }
            if (branches.Count == 0) throw Err(kw, ConflictCodes.NetworkBadExpression, "a PARALLEL with no branch.");
            return new Parallel(input, branches, mode);
        }

        /// <summary><c>EXECUTE[(EN := c)]</c>, the verbatim ST lines, <c>END_EXECUTE</c>, and <c>.ENO</c> where
        /// consumed — an Execute box's only output is ENO, so its <c>.ENO</c> needs no EN.</summary>
        private Box ParseExecute(bool consumed)
        {
            var kw = Next();
            Node? en = null;
            if (_lx!.PeekOnLine() == '(')
            {
                ExpectSym("(", "EXECUTE(EN := c)");
                var e = Next();
                if (!e.Is("EN")) throw Err(e, ConflictCodes.NetworkBadExpression, "EXECUTE takes one pin, `(EN := c)`.");
                ExpectSym(":=", "EXECUTE(EN := c)");
                en = Resolve(ParseValue(consumed: true), consumed: true);
                ExpectSym(")", "EXECUTE(EN := c)");
            }
            if (_la is not null) throw new InvalidOperationException("the EXECUTE body was reached with a token already read past it.");
            var (snippet, end) = _lx.ExecuteBody();
            if (snippet.Kind == TokKind.Error) throw Err(snippet, snippet.Code!, snippet.Text);
            Consumed.Add(snippet);
            Consumed.Add(end);

            var eno = false;
            if (Peek().IsSym("."))
            {
                Next();
                var e = Next();
                if (!e.Is("ENO")) throw Err(e, ConflictCodes.NetworkParse, "after END_EXECUTE, the one suffix is `.ENO`.");
                eno = true;
            }
            if (consumed && !eno)
                throw Err(kw, ConflictCodes.NetworkBadExpression,
                    "a consumed EXECUTE box says `.ENO`: its only output is ENO.");
            if (!consumed && eno)
                throw Err(kw, ConflictCodes.NetworkBadExpression, "`.ENO` on an EXECUTE box nothing consumes.");
            // An Execute box's only output is its ENO (census 1.11); which slot that is, NetworkSpelling.EnoSlot says —
            // the one definition the writer's `.ENO` is decided by, never a second copy of the number here.
            var box = new Box(NetworkSpelling.ExecuteType, null, NetworkSpelling.KindOf(NetworkSpelling.ExecuteType, false),
                new List<Input>(), new List<Output>(), en, snippet.Text, Flags.None);
            return eno ? box with { ConnectedSlot = NetworkSpelling.EnoSlot(box) } : box;
        }

        // ── operands ────────────────────────────────────────────────────────────────────────────────

        private Node Resolve(PVal v, bool consumed)
        {
            if (v.Node is not null) return v.Node;
            if (v.Empty) return Mark(new Terminator(Flags.None), v.Start.Offset);
            var t = v.Bare!.Value;
            if (t.Kind == TokKind.Word && _wires.TryGetValue(t.Text, out var w))
            {
                if (!w.Defined)
                    throw Err(t, ConflictCodes.NetworkBadExpression,
                        $"the wire {w.Name} is referenced before its definition: a wire is defined by `{w.Name} := value;` before its first use.");
                return Mark(new Demux(w.VarId, null), t.Offset);
            }
            // A word no VAR_TEMP declares is a variable, whatever its shape: whether it is declared is the build's
            // question (openspec bridge-refusal-review 1.3), and only this network's own block makes a name a wire.
            // A wire spelled again as another name — in an operand's words, a target, a label, a call head, backticked —
            // is no refusal either (bridge-refusal-review 2.11): the writer names its wires around every other name on
            // the next pull.
            if (t.Kind == TokKind.Word && !_readAsVariable.ContainsKey(t.Text)) _readAsVariable[t.Text] = t;
            return Mark(new Leaf(new Operand(t.Text), Flags.None), t.Offset);
        }

        /// <summary>An assignment or <c>=&gt;</c> target's text: a token or backticked text.</summary>
        private string LValueText(Tok t)
        {
            switch (t.Kind)
            {
                case TokKind.Word:
                    if (NetworkSpelling.TextWords.Contains(t.Text))
                        throw Err(t, ConflictCodes.NetworkBadExpression,
                            $"'{t.Text}' as a target: a target spelled like a keyword of the text is written between backticks.");
                    if (!_readAsVariable.ContainsKey(t.Text)) _readAsVariable[t.Text] = t;
                    return t.Text;
                case TokKind.Backtick:
                    return t.Text;
                case TokKind.Unnamed:
                case TokKind.Address:
                    return t.Text;
                default:
                    throw Err(t, ConflictCodes.NetworkBadExpression,
                        $"'{t.Text}' as a target: a target is a variable, a token or text between backticks.");
            }
        }

        /// <summary>Spec, "a hand-edited type": each wire's declared type against what its producer says, by the rule
        /// the writer declares with (<see cref="NetworkSpelling.ProducerType"/>) — the vendor's Demux has no field that
        /// would keep a type the producer contradicts. Run once the network is read, because a leaf's type is
        /// decided by how the wire is used.
        /// <para>A vendor-limit refusal, KEPT (openspec bridge-refusal-review 3.2, DIALECT N25): the one producer that takes a
        /// stored type — a comparison box — keeps a contradicting one and the build ignores it (it judges by the box's real
        /// type and never names the declaration), so written, the text would state a type the network does not
        /// compute.</para></summary>
        private void CheckWireTypes(IReadOnlyList<Node> trees)
        {
            foreach (var d in trees.OfType<Demux>().Where(d => d.Input is not null))
            {
                // BuildAssign makes a defining Demux only from a declared wire; one without is a reader defect, and
                // skipping it would drop the wire's type check without a trace.
                if (!_byId.TryGetValue(d.VarId, out var w))
                    throw new InvalidOperationException(
                        $"network text v2: a wire definition with VarId {d.VarId} that no VAR_TEMP declaration made.");
                var produced = NetworkSpelling.ProducerType(d.Input!, d.VarId, trees, _lang,
                    id => _byId.TryGetValue(id, out var o) ? o.Type : null);
                if (NetworkSpelling.Disagreement(produced, w.Type) is { } says)
                    Diagnostics.Add(Diag(ConflictCodes.NetworkBadExpression,
                        $"the wire {w.Name} is declared {w.Type} and its producer is {says}.", w.Decl.Offset, w.Decl.Length));
            }
        }

        /// <summary>DIALECT N20: the IDE holds no flag on a wire reference (<c>BoxTreeDemux</c>) or a Parallel — a bit set
        /// on either is gone before the commit — so <c>NOT g3</c>, <c>R_EDGE(g3)</c> and <c>NOT PARALLEL(…)</c> state logic
        /// the push would silently drop. Refused by name; a flag on the wire's producer or a branch is the vendor's.</summary>
        private Node Held(Node core, Tok modifier) => core switch
        {
            Demux => throw Err(modifier, ConflictCodes.NetworkUnsupported,
                $"{modifier.Text.ToUpperInvariant()} on a wire reference: the IDE holds no flag on a wire; put it on the wire's producer."),
            Parallel => throw Err(modifier, ConflictCodes.NetworkUnsupported,
                $"{modifier.Text.ToUpperInvariant()} on PARALLEL(…): the IDE holds no flag on a Parallel."),
            _ => core,
        };

        private static Node WithFlags(Node n, Func<Flags, Flags> f) => n switch
        {
            Leaf l => l with { Flags = f(l.Flags) },
            Box b => b with { Flags = f(b.Flags) },
            _ => throw new InvalidOperationException($"a modifier on a {n.GetType().Name}"),
        };

        // ── tokens ──────────────────────────────────────────────────────────────────────────────────

        private Tok Peek()
        {
            if (_la is { } la) return la;
            var t = _lx!.Next();
            if (t.Kind == TokKind.Error) throw Err(t, t.Code!, t.Text);
            _la = t;
            return t;
        }

        private Tok Next()
        {
            var t = Peek();
            _la = null;
            Consumed.Add(t);
            return t;
        }

        private void ExpectSym(string sym, string form)
        {
            var t = Peek();
            if (!t.IsSym(sym))
                throw Err(t, ConflictCodes.NetworkParse, t.Kind == TokKind.Eof
                    ? $"the body ends where `{sym}` is expected ({form})."
                    : $"expected `{sym}` and found '{t.Text}' ({form}).");
            Next();
        }

        private void ExpectOnLine(string sym, int line, string form)
        {
            var t = Peek();
            if (Line(t) != line) throw Err(t, ConflictCodes.NetworkParse, $"the NETWORK header ends at its newline; `{form}` is on one line.");
            ExpectSym(sym, form);
        }

        private void ExpectWord(string word, string form)
        {
            var t = Peek();
            if (!t.Is(word)) throw Err(t, ConflictCodes.NetworkParse, $"expected {word} and found '{t.Text}' ({form}).");
            Next();
        }

        private static bool IsOperator(Tok t) => NetworkLexer.IsOperator(t);

        private static string OperatorSymbol(Tok t) => t.Kind == TokKind.Word ? t.Text.ToUpperInvariant() : t.Text;

        /// <summary>An empty position: nothing stands where a value could. An operator word is a call head only
        /// when the pair after it is an argument list (<c>AND(EN := go, a, b)</c>); a pair holding an operator is a
        /// group, so the word was the operator after an empty slot (<c>( AND (x OR y))</c>) — parentheses decide,
        /// never spacing. Called only on the lookahead token, so the lexer stands right after it.</summary>
        private bool IsEmptyHere(Tok t) =>
            t.IsSym(",") || t.IsSym(")") || t.IsSym(";") || t.Is("THEN") ||
            (IsOperator(t) && !(t.Kind == TokKind.Word && _lx!.PeekChar() == '(' && !_lx.PairAheadHoldsOperator()));

        /// <summary>Whether the lookahead word is a pin's name: <c>:=</c> or <c>=&gt;</c> follows it. Called only
        /// on the lookahead token, so the lexer stands right after it.</summary>
        private bool IsPinName(Tok t) => t.Kind == TokKind.Word && _lx!.PinOperatorFollows();

        private int Line(Tok t) => _lx!.LineOf(t.Offset);

        private ParseError Err(Tok t, string code, string message) =>
            new(code, message, t.Offset, Math.Max(1, t.Length));

        private NetworkTextDiagnostic Diag(string code, string message, int offset, int length)
        {
            var (line, col) = (_lx ?? new NetworkLexer(_text, 0)).LineCol(offset);
            return new NetworkTextDiagnostic(code, message, line, col, length);
        }

        private static readonly HashSet<string> Structural = new() { ",", ")", "(", ";", ":=", "=>", ".", ":" };
    }
}

/// <summary>One finding against a network-text body: a <c>NETWORK_*</c> code (<see cref="ConflictCodes"/>), a
/// message that names what was found, and the 1-based span it was found at.</summary>
public sealed record NetworkTextDiagnostic(string Code, string Message, int Line, int Column, int Length);

/// <summary>What <see cref="NetworkTextReader.Read"/> returns: the model when the text is valid, else null,
/// and every diagnostic found. Bad input is never an exception — the push reports each finding at its span.</summary>
public sealed record NetworkReadResult(NetworkBody? Body, IReadOnlyList<NetworkTextDiagnostic> Diagnostics)
{
    public bool Ok => Body is not null && Diagnostics.Count == 0;
}
