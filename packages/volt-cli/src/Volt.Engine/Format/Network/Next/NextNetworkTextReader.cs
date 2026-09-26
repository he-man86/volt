using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Volt.Contracts;

namespace Volt.Engine.Format.Network.Next;

/// <summary>
/// Network text v2: reads a body written as a literal transcript of the vendor's network model back into a
/// <see cref="NetworkBody"/>. Specified by <c>docs/network-text-next.html</c> and
/// <c>openspec/changes/network-text-literal-nwl</c>; the inverse of <see cref="NextNetworkTextWriter"/>, built
/// BESIDE the v1 reader, which keeps serving every caller until the swap.
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
/// <see cref="NextSpelling.ProducerType"/> counts across the network. Neither changes the model — each only
/// reports.</para>
///
/// <para><b>Bad input is a diagnostic, never an exception.</b> Every finding carries a <c>NETWORK_*</c> code and a
/// span, and a failed network does not hide the next one's findings. What the reader cannot know from the text —
/// whether a call head is an FB instance, its type, the names a wire must not collide with — it takes from the
/// declarations (<see cref="NextNetworkScope"/>), never from a guess.</para>
/// </summary>
public static class NextNetworkTextReader
{
    /// <summary>Read <paramref name="text"/>, a whole graphical body starting with its implementation marker.</summary>
    /// <param name="language">The body's view as the IDE holds it. A marker saying the other language is a view
    /// change, which Volt cannot apply (<see cref="NetworkText.RefuseViewModeChange"/>), and is reported.</param>
    /// <param name="scope">The declarations the body can see; see <see cref="NextNetworkScope"/>.</param>
    public static NextReadResult Read(string text, BodyLanguage language, NextNetworkScope scope) =>
        ReadTokens(text, language, scope).Result;

    /// <summary>The read plus what the gate needs of it: every token consumed, in order (what it compares), and
    /// where each model node and each network header was read (where it reports a finding the writer raises).</summary>
    internal static (NextReadResult Result, ReadTrace Trace) ReadTokens(string text, BodyLanguage language, NextNetworkScope scope)
    {
        if (text is null) throw new ArgumentNullException(nameof(text));
        if (scope is null) throw new ArgumentNullException(nameof(scope));
        var p = new Parser(text, language, scope);
        var body = p.ParseBody();
        return (new NextReadResult(p.Diagnostics.Count == 0 ? body : null, p.Diagnostics),
                new ReadTrace(p.Consumed, p.Lexer, p.Spans, p.Headers));
    }

    /// <summary>What a read leaves behind for the gate. <see cref="Spans"/> is keyed by node IDENTITY: two equal
    /// leaves at two places are two keys.</summary>
    internal sealed record ReadTrace(IReadOnlyList<Tok> Tokens, NextLexer? Lexer,
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
        private readonly BodyLanguage _expected;
        private readonly NextNetworkScope _scope;
        private NextLexer? _lx;
        private Tok? _la;
        private BodyLanguage _lang;

        public readonly List<Tok> Consumed = new();
        public readonly List<NextNetworkTextDiagnostic> Diagnostics = new();
        public readonly Dictionary<Node, (int Offset, int Length)> Spans = new(ByIdentity.Instance);
        public readonly List<Tok> Headers = new();
        public NextLexer? Lexer => _lx;

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

        public Parser(string text, BodyLanguage expected, NextNetworkScope scope)
        {
            _text = text;
            _expected = expected;
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

            var m = Marker.Match(first);
            if (!m.Success)
            {
                string message;
                if (BareMarker.IsMatch(first))
                    message = "the body carries the bare ST marker (* @volt-implementation *); a graphical body carries " +
                              "(* @volt-implementation FBD *) or (* @volt-implementation LD *).";
                else if (V1Header.IsMatch(first))
                    message = V1Refusal("`NETWORK <n> <LANG>` headers");
                else
                    message = "a graphical body starts with its implementation marker, (* @volt-implementation FBD *) or " +
                              "(* @volt-implementation LD *), on its first line.";
                Diagnostics.Add(Diag(ConflictCodes.NetworkParse, message, start, Math.Max(1, first.Length)));
                return null;
            }

            _lang = m.Groups[1].Value == "LD" ? BodyLanguage.Ld : BodyLanguage.Fbd;
            Consumed.Add(new Tok(TokKind.Marker, m.Groups[1].Value, start, first.Length, true));
            _lx = new NextLexer(_text, eol);
            if (_lang != _expected)
            {
                string Name(BodyLanguage l) => l == BodyLanguage.Ld ? "LD" : "FBD";
                Diagnostics.Add(Diag(ConflictCodes.NetworkUnsupported,
                    $"the graphical body's view is {Name(_expected)} and the text's marker says {Name(_lang)}. Volt cannot " +
                    "change a body's view — it is one property of the whole body — so the push is refused rather than " +
                    "applying every other edit and reverting this one on the next pull. Switch the view in the IDE and pull.",
                    start, first.Length));
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
                    if (t.Is("LET")) throw Err(t, ConflictCodes.NetworkParse, V1Refusal("`LET` statements"));
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
                    if (Line(name) != hdrLine || name.Kind != TokKind.Word || !NextSpelling.Identifier.IsMatch(name.Text))
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
                else if (t.Kind == TokKind.Number)
                    throw Err(t, ConflictCodes.NetworkParse, V1Refusal("`NETWORK <n> <LANG>` headers"));
                else
                    throw Err(t, ConflictCodes.NetworkParse,
                        $"'{t.Text}' in a NETWORK header: the header is NETWORK [LABEL: x] [TITLE: \"…\"] [DISABLED], and it ends at its newline.");
            }

            // The network's comment: the `//` lines between the header and the wire block or first statement.
            var comment = new List<string>();
            while (Peek().Kind == TokKind.Comment) comment.Add(Next().Text);

            var sawBlock = false;
            if (Peek().Is("VAR_TEMP")) { ParseWires(); sawBlock = true; }

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
                if (t.Is("VAR_TEMP"))
                    throw Err(t, ConflictCodes.NetworkBadExpression,
                        sawBlock ? "a second VAR_TEMP block: a network declares its wires in one block."
                                 : "a VAR_TEMP block after a statement: a network's wire block comes before its first statement.");
                trees.Add(ParseStatement());
            }

            foreach (var w in _wires.Values.Where(w => !w.Defined).OrderBy(w => w.Decl.Offset))
                Diagnostics.Add(Diag(ConflictCodes.NetworkBadExpression,
                    $"the wire {w.Name} is declared and never defined: a wire's definition is the statement `{w.Name} := value;`.",
                    w.Decl.Offset, w.Decl.Length));
            CheckWireTypes(trees);

            return new Network(index, title, label, comment.Count > 0 ? string.Join("\n", comment) : null, disabled, trees);
        }

        /// <summary><c>VAR_TEMP g1, g2 : BOOL; … END_VAR</c> — on one line canonically, across lines as ST allows.</summary>
        private void ParseWires()
        {
            var first = Consumed.Count;
            var kw = Next();
            var any = false;
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
                var type = Regex.Replace(_text.Substring(from, to - from), @"\s+", " ").Trim();
                foreach (var n in names) Declare(n, type);
                any = true;
            }
            var endVar = Next();
            if (!any) throw Err(kw, ConflictCodes.NetworkBadExpression, "an empty VAR_TEMP block: a network without a wire carries none.");
            // END_VAR takes no `;` of its own: a `;` after it is the empty statement — the empty item — and taking it
            // into the block would drop that item from the network without a word, on pull and on push alike.

            // The gate compares the block by what it DECLARES, not by how the declarations are grouped: the spec
            // accepts `g1 : BOOL; g2 : BOOL;` across lines as the same block as the canonical `g1, g2 : BOOL;`.
            // Grouping and order are not an NWL fact (the vendor's Demux has no declaration at all), so the block
            // stands in the token stream as one token: each wire as written with its type, by VarId.
            Consumed.RemoveRange(first, Consumed.Count - first);
            Consumed.Add(new Tok(TokKind.Wires,
                string.Join(", ", _byId.OrderBy(kv => kv.Key).Select(kv => kv.Value.Name + " : " + kv.Value.Type)),
                kw.Offset, endVar.Offset + endVar.Length - kw.Offset, kw.AtLineStart));
        }

        private Tok WireNameTok()
        {
            var t = Next();
            if (t.Kind != TokKind.Word || !NextSpelling.WireName.IsMatch(t.Text))
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
            if (_scope.Contains(name.Text))
                throw Err(name, ConflictCodes.NetworkDuplicateName,
                    $"the wire {name.Text} names a variable in scope (case-insensitively); the writer would have named it the lowest free g<n>.");
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

            if (t.Is("LET")) throw Err(t, ConflictCodes.NetworkParse, V1Refusal("`LET` statements"));

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
                if (l.Kind != TokKind.Word || !NextSpelling.Identifier.IsMatch(l.Text))
                    throw Err(l, ConflictCodes.NetworkBadExpression, "JMP takes one label, an identifier.");
                AddOtherWords(l, l.Text);
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
                var core = n.Is("R_EDGE") || n.Is("F_EDGE")
                    ? ParseEdge(consumed)
                    : Resolve(ParseCore(consumed, defer: false), consumed);
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
            if (NextSpelling.ConstructTaken(kw.Text, _scope))
                throw Err(kw, ConflictCodes.NetworkUnsupported,
                    $"a POU or instance named {kw.Text.ToUpperInvariant()}: the text reads {kw.Text.ToUpperInvariant()}(…) as the edge flag, so the call has no spelling.");
            ExpectSym("(", $"{kw.Text.ToUpperInvariant()}(x)");
            var n = Peek();
            // Parentheses are structural here too: `NOT(a)` — NOT with a pair holding no operator — is the NOT BOX,
            // an argument like any other, and the writer spells an edge on a NOT box so. Only the modifier (`NOT a`,
            // `NOT (a AND b)`) is refused inside an edge.
            if (n.Is("NOT") && !(_lx!.PeekChar() == '(' && !_lx.PairAheadHoldsOperator()))
                throw Err(n, ConflictCodes.NetworkBadExpression,
                    $"a modifier inside {kw.Text.ToUpperInvariant()}(…): the one order is NOT {kw.Text.ToUpperInvariant()}(x).");
            if (n.Is("R_EDGE") || n.Is("F_EDGE"))
                throw Err(n, ConflictCodes.NetworkUnsupported, "nested edges: one operand carries one edge flag, and rising with falling has no spelling.");
            if (IsEmptyHere(n))
                throw Err(kw, ConflictCodes.NetworkUnsupported, "a flag on an empty slot: an unconnected position has no text to modify.");
            var core = Resolve(ParseCore(consumed, defer: false), consumed);
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
                        if (ty.Kind != TokKind.Word || !NextSpelling.Identifier.IsMatch(ty.Text))
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
                        if (!NextSpelling.IsBareHead(t.Text))
                            throw Err(t, ConflictCodes.NetworkBadExpression, $"'{t.Text}' is a keyword of the text and no call head.");
                        Next();
                        return PVal.Of(ParseCall(t, null, null, consumed, null), t);
                    }
                    if (NextSpelling.TextWords.Contains(t.Text))
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
        /// (<see cref="NextSpelling.MainSlotOfCall"/>) — the group and the call form of one box are one model.</summary>
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
            var connected = consumed ? NextSpelling.MainSlotOfCall(type) : null;
            return new Box(type, null, CallKind.Operator, inputs, new List<Output>(), null, null, Flags.None,
                MainOutputIndex: connected, ConnectedSlot: connected);
        }

        private ParseError NotAnOperator(Tok t) =>
            t.Kind == TokKind.Word && NextSpelling.TextWords.Contains(t.Text)
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
                AddOtherWords(head, type);
            }
            else if (_scope.InstanceType(head.Text) is { } fbType)
            {
                if (NextSpelling.ConstructWords.Contains(head.Text))
                    throw Err(head, ConflictCodes.NetworkUnsupported, $"an instance named {head.Text.ToUpperInvariant()}: the text reads it as its own construct.");
                instance = new Operand(head.Text, IsInstance: true);
                type = fbType;
                AddOtherWords(head, head.Text);
                AddOtherWords(head, fbType);
            }
            else
            {
                if (!NextSpelling.IsName(head.Text))
                    // A function is a POU and has a name. A head that is none (`fbs[1]`, `SUPER^`) is an FB instance
                    // whose declaration the scope does not name, and read as a function it would push a box of a type
                    // no POU has in place of the instance call.
                    throw Err(head, ConflictCodes.NetworkUnsupported,
                        $"an FB instance the declarations do not name: '{head.Text}' is no POU name, and no declaration names it an instance, so its type is unknown.");
                type = head.Text;
                AddOtherWords(head, head.Text);
            }
            // Spec, "a POU named like an edge word": refused by name, at the call. A backticked head is still the
            // POU's name, and an instance's FB type is a POU too — the writer could spell none of them back.
            if (NextSpelling.ConstructWords.Contains(type))
                throw Err(head, ConflictCodes.NetworkUnsupported,
                    $"a POU named {type.ToUpperInvariant()}: the text reads {type.ToUpperInvariant()}(…) as its own construct, so a call of it has no spelling.");

            // The slot rule: ENO (slot 0 of a box with EN) is never an `=>` slot, nor is the slot a consumer is
            // connected to; positional pins fill the rest in order. A box consumed WITHOUT `.ENO` is connected by its
            // main output, which the text reads by NextSpelling.MainSlotOfCall — slot 0, or no stored slot for a
            // bit operator — and the writer refuses every box that reading would get wrong.
            var enoSlot = NextSpelling.EnoSlot(isExecute: false, hasEnable: hadEn);
            int? connected = eno ? enoSlot : consumed ? NextSpelling.MainSlotOfCall(type) : null;
            var next = 0;
            var built = new List<Output>();
            foreach (var (formal, target, positional) in outputs)
            {
                if (!positional) { built.Add(new Output(formal, new Operand(LValueText(target!.Value), IsLValue: true), null)); continue; }
                var slot = NextSpelling.NextFreeSlot(next, enoSlot, connected);
                next = slot + 1;
                if (target is { } tt) built.Add(new Output(null, new Operand(LValueText(tt), IsLValue: true), slot));
            }

            if (eno && !hadEn)
                throw Err(head, ConflictCodes.NetworkBadExpression,
                    $"`.ENO` on a box without EN: ENO echoes the enable, and '{head.Text}' has none.");

            var box = new Box(type, instance, NextSpelling.KindOf(type, instance is not null), inputs, built, en, null,
                Flags.None, MainOutputIndex: consumed && !eno ? connected : null, ConnectedSlot: connected);
            CheckConsumption(box, head, consumed, eno);
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
                if (!NextSpelling.Identifier.IsMatch(name.Text))
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
            if (NextSpelling.ConstructTaken(kw.Text, _scope))
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
                            !NextSpelling.IsMeasuredMode(mode))
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
            return new Box(NextSpelling.ExecuteType, null, NextSpelling.KindOf(NextSpelling.ExecuteType, false),
                new List<Input>(), new List<Output>(), en, snippet.Text, Flags.None,
                ConnectedSlot: eno ? NextSpelling.EnoSlot(isExecute: true, hasEnable: en is not null) : null);
        }

        /// <summary>The <c>.ENO</c> rule. Until census 1.6 shows an enabled box connected by its main output, a
        /// consumed enabled box must say <c>.ENO</c> — without it <c>coil := MOVE(EN := c, 0, =&gt; dst)</c> would
        /// read as "coil gets 0" — and a top-level box, whose output goes nowhere, cannot say it.</summary>
        private void CheckConsumption(Box b, Tok at, bool consumed, bool eno)
        {
            if (!consumed && eno)
                throw Err(at, ConflictCodes.NetworkBadExpression,
                    $"`.ENO` on '{at.Text}', which nothing consumes: a top-level box's output goes nowhere.");
            if (consumed && b.Enable is not null && !eno)
                throw Err(at, ConflictCodes.NetworkBadExpression,
                    $"the enabled box '{at.Text}' is consumed without `.ENO`: a consumer of a box with EN is connected to its ENO, written `.ENO`.");
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
            if (t.Kind == TokKind.Word) RefuseUndeclaredWire(t);
            // Every operand's words, whatever its token — the writer reserves the same (a typed literal's type
            // included), so a wire it would rename is one the reader refuses.
            AddOtherWords(t, t.Text);
            return Mark(new Leaf(new Operand(t.Text), Flags.None), t.Offset);
        }

        /// <summary>An assignment or <c>=&gt;</c> target's text: a token or backticked text.</summary>
        private string LValueText(Tok t)
        {
            switch (t.Kind)
            {
                case TokKind.Word:
                    if (NextSpelling.TextWords.Contains(t.Text))
                        throw Err(t, ConflictCodes.NetworkBadExpression,
                            $"'{t.Text}' as a target: a target spelled like a keyword of the text is written between backticks.");
                    RefuseUndeclaredWire(t);
                    AddOtherWords(t, t.Text);
                    return t.Text;
                case TokKind.Backtick:
                    AddOtherWords(t, t.Text);
                    return t.Text;
                case TokKind.Unnamed:
                case TokKind.Address:
                    return t.Text;
                default:
                    throw Err(t, ConflictCodes.NetworkBadExpression,
                        $"'{t.Text}' as a target: a target is a variable, a token or text between backticks.");
            }
        }

        /// <summary>A name shaped like a wire that neither this network nor the scope declares is a wire someone
        /// forgot to declare — read as a variable it would compile against nothing.</summary>
        private void RefuseUndeclaredWire(Tok t)
        {
            if (NextSpelling.WireName.IsMatch(t.Text) && !_wires.ContainsKey(t.Text) && !_scope.Contains(t.Text))
                throw Err(t, ConflictCodes.NetworkBadExpression,
                    $"'{t.Text}' is shaped like a wire and is declared neither in this network's VAR_TEMP block nor in scope.");
        }

        /// <summary>A word spelled where a wire name may not appear (a call head, backticked text, a target, a label,
        /// an operand's words) — the writer reserves the same words, so a wire equal to one would be renamed on the
        /// way out and the text would not be its own canonical form. Reported on the spot: the wire block precedes
        /// every statement, so the wire set is complete here, and a later error in the network cannot hide it.</summary>
        private void AddOtherWords(Tok at, string text)
        {
            foreach (var word in NextSpelling.Words(text))
                if (_wires.TryGetValue(word, out var w))
                    Diagnostics.Add(Diag(ConflictCodes.NetworkDuplicateName,
                        $"the wire {w.Name} is also spelled as a name in this network ('{at.Text}'); a wire's name must be " +
                        "no other name the network or its scope uses, case-insensitively.", at.Offset, at.Length));
        }

        /// <summary>Spec, "a hand-edited type": each wire's declared type against what its producer says, by the rule
        /// the writer declares with (<see cref="NextSpelling.ProducerType"/>) — the vendor's Demux has no field that
        /// would keep a type the producer contradicts. Run once the network is read, because a leaf's type is
        /// decided by how the wire is used.</summary>
        private void CheckWireTypes(IReadOnlyList<Node> trees)
        {
            foreach (var d in trees.OfType<Demux>().Where(d => d.Input is not null))
            {
                // BuildAssign makes a defining Demux only from a declared wire; one without is a reader defect, and
                // skipping it would drop the wire's type check without a trace.
                if (!_byId.TryGetValue(d.VarId, out var w))
                    throw new InvalidOperationException(
                        $"network text v2: a wire definition with VarId {d.VarId} that no VAR_TEMP declaration made.");
                var produced = NextSpelling.ProducerType(d.Input!, d.VarId, trees, _lang,
                    id => _byId.TryGetValue(id, out var o) ? o.Type : null);
                if (NextSpelling.Disagreement(produced, w.Type) is { } says)
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

        private static bool IsOperator(Tok t) => NextLexer.IsOperator(t);

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

        private NextNetworkTextDiagnostic Diag(string code, string message, int offset, int length)
        {
            var (line, col) = (_lx ?? new NextLexer(_text, 0)).LineCol(offset);
            return new NextNetworkTextDiagnostic(code, message, line, col, length);
        }

        private static string V1Refusal(string what) =>
            $"this is network text v1 ({what}), which Volt no longer reads and does not translate: re-pull the POU to get " +
            "the current form, and redo the edit on it.";

        private static readonly Regex Marker = new(@"^\(\*\s*@volt-implementation\s+(FBD|LD)\s*\*\)\s*$", RegexOptions.Compiled);
        private static readonly Regex BareMarker = new(@"^\(\*\s*@volt-implementation\s*\*\)", RegexOptions.Compiled);
        private static readonly Regex V1Header = new(@"^NETWORK\s+\d+", RegexOptions.Compiled);

        private static readonly HashSet<string> Structural = new() { ",", ")", "(", ";", ":=", "=>", ".", ":" };
    }
}
