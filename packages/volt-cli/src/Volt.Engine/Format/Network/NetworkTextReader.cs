using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;

namespace Volt.Engine.Format.Network;

/// <summary>
/// Network text (openspec <c>ld-fbd-coverage</c> 2R.3, the grammar of <c>readability.md</c>, specified by
/// <c>docs/network-text.html</c>): reads a body back into a <see cref="NetworkBody"/>, the inverse of
/// <see cref="NetworkTextWriter"/>. There is no second reader: v1 text (<c>LET</c>, <c>NETWORK &lt;n&gt; &lt;LANG&gt;</c>) is
/// refused with a "re-pull" message, and every spelling the 2R rules replaced (<c>.ENO</c>, <c>IF … THEN</c>, the ST
/// operator symbols, <c>PARALLEL(…)</c>, BRANCH lines and <c>INTO BRANCHES</c>, <c>EN :=</c> on a box, <c>VAR_TEMP</c>,
/// the member pragma, backticked literals) fails as whatever it is, with a message naming the new spelling (P12) — no
/// aliases.
///
/// <para><b>Lines, then items.</b> The text is tokenized once; a network's body is cut into LINES by P2 (at bracket depth
/// 0 a line break ends the line unless the line ends with a word that cannot end it), and one <c>;</c> ends one NWL item.
/// A line without <c>;</c> is OPEN: its root box's ENO goes to a later line of the item, and each <c>ENO</c> takes the
/// oldest open line not yet taken — top to bottom, left to right within a line (B4, P3). A box's role — a top-level
/// item, an open line, or a value — is known before its line is parsed, so each node is built once and never
/// rebuilt.</para>
///
/// <para><b>Bad input is a diagnostic, never an exception.</b> Every finding carries a <c>NETWORK_*</c> code and a span,
/// and a failed network does not hide the next one's findings. What the reader cannot know from the text — whether a
/// call head is an FB instance, its type — it takes from the declarations (<see cref="NetworkScope"/>).</para>
/// </summary>
public static class NetworkTextReader
{
    /// <summary>Read <paramref name="text"/>, a whole graphical body starting with its <c>IMPLEMENTATION LD|FBD</c> line.</summary>
    public static NetworkReadResult Read(string text, NetworkScope scope) => ReadTokens(text, scope).Result;

    internal static (NetworkReadResult Result, ReadTrace Trace) ReadTokens(string text, NetworkScope scope)
    {
        if (text is null) throw new ArgumentNullException(nameof(text));
        if (scope is null) throw new ArgumentNullException(nameof(scope));
        var p = new Parser(text, scope);
        var body = p.ParseBody();
        return (new NetworkReadResult(p.Diagnostics.Count == 0 ? body : null, p.Diagnostics),
                new ReadTrace(p.Lexer, p.Spans, p.Headers));
    }

    /// <summary>What a read leaves behind for the gate. <see cref="Spans"/> is keyed by node IDENTITY.</summary>
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

    /// <summary>Who consumes a box: nothing (a top-level item), a later line's ENO (an open line), or a consumer reading
    /// its data.</summary>
    private enum Role { Top, Eno, Value }

    /// <summary>A box as written, before its role is known to the value it stands in: the role decides its connected slot,
    /// its ENO and the slots its positional <c>=&gt;</c> pins fill.</summary>
    private sealed class BoxSyn
    {
        public string Type = "";
        public Operand? Instance;
        public List<Input> Inputs = new();
        /// <summary>Output pins in source order; a positional one fills the next free slot, a bare <c>=&gt;</c> passes one over.</summary>
        public List<(string? Formal, Tok? Target, bool Positional)> Outputs = new();
        public Node? Enable;
        public bool HadEn;
        public Tok? Named;
        public string? StCode;
        public Flags Flags = Flags.None;
        public Tok Head;
        /// <summary>An operator written in its call form (P5), MOVE's included: refused where its word form fits.</summary>
        public bool OperatorCall;

        public bool EnabledComparison => HadEn && NetworkSpelling.Comparisons.Contains(Type);
    }

    /// <summary>A value as parsed: a built node, or a box whose role its consumer decides. <see cref="Word"/> is a box
    /// word, MOVE's word form or a parallel — what P4 (1) brackets as an operand of another word.</summary>
    private sealed class Syn
    {
        public Node? Node;
        public BoxSyn? Box;
        public Tok Start;
        public bool Bracketed;
        public bool Word;
        public bool Empty;

        /// <summary>A modifier's brackets carry the value whole (<c>NOT (a GT b EN c)</c>, <c>R_EDGE(…)</c>): no bracket rule
        /// applies to it any more.</summary>
        public bool Covered;

        public bool EnabledComparison => !Covered && Box?.EnabledComparison == true;
    }

    /// <summary>One item's OPEN LINES (P3): each line without <c>;</c> hands its root box to the queue, and each
    /// <c>ENO</c> takes the oldest one not yet taken.</summary>
    private sealed class ItemCtx
    {
        public readonly Queue<(Box Box, Tok At)> Open = new();
    }

    private sealed class Parser
    {
        private readonly string _text;
        private readonly NetworkScope _scope;
        private NetworkLexer? _lx;
        private List<Tok> _toks = new();
        private int _p;
        private int _end;          // the current line's end (exclusive), or the token count outside a line
        private BodyLanguage _lang;
        private ItemCtx _item = new();

        public readonly List<NetworkTextDiagnostic> Diagnostics = new();
        public readonly Dictionary<Node, (int Offset, int Length)> Spans = new(ByIdentity.Instance);
        public readonly List<Tok> Headers = new();
        public NetworkLexer? Lexer => _lx;

        private HashSet<int> _splits = new();

        public Parser(string text, NetworkScope scope)
        {
            _text = text;
            _scope = scope;
        }

        /// <summary>Record that <paramref name="node"/> was read from <paramref name="start"/> through the last token
        /// consumed.</summary>
        private T Mark<T>(T node, int start) where T : Node
        {
            var last = _p > 0 ? _toks[Math.Min(_p, _toks.Count) - 1] : default;
            var end = last.Offset + last.Length;
            Spans[node] = (start, Math.Max(1, end - start));
            return node;
        }

        // ── the body ────────────────────────────────────────────────────────────────────────────────

        public NetworkBody? ParseBody()
        {
            var start = 0;
            while (start < _text.Length && char.IsWhiteSpace(_text[start])) start++;
            var eol = _text.IndexOf('\n', start);
            if (eol < 0) eol = _text.Length;
            var first = _text.Substring(start, eol - start).TrimEnd('\r');

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
            _lx = new NetworkLexer(_text, eol);

            var v1 = NetworkText.V1Constructs(_text, eol);
            if (v1.Count > 0)
            {
                foreach (var (at, what) in v1)
                    Diagnostics.Add(Diag(ConflictCodes.NetworkParse, NetworkText.V1Refusal(what), at.Offset, Math.Max(1, at.Length)));
                return null;
            }

            _toks = _lx.Tokenize();
            _end = _toks.Count;
            var networks = new List<Network>();
            while (true)
            {
                try
                {
                    var t = Raw(_p);
                    if (t.Kind == TokKind.Eof) break;
                    if (t.Is("NETWORK") && t.AtLineStart)
                    {
                        if (ParseNetwork(networks.Count) is { } n) networks.Add(n);
                        continue;
                    }
                    if (t.Kind == TokKind.Error) throw Err(t, t.Code!, t.Text);
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
            _end = _toks.Count;
            while (true)
            {
                var t = Raw(_p);
                if (t.Kind == TokKind.Eof || (t.Is("NETWORK") && t.AtLineStart)) return;
                _p++;
                if (t.Is("END_NETWORK")) return;
            }
        }

        // ── one network ─────────────────────────────────────────────────────────────────────────────

        private Network? ParseNetwork(int index)
        {
            _splits = new HashSet<int>();
            _end = _toks.Count;

            var hdr = Next();
            Headers.Add(hdr);
            var hdrLine = Line(hdr);
            string? label = null, title = null;
            var disabled = false;
            var stage = 0;   // P10: LABEL, DISABLED, TITLE — in that order

            void Order(Tok t, int at, string what)
            {
                if (stage >= at)
                    throw Err(t, ConflictCodes.NetworkParse,
                        stage == at ? $"a NETWORK header carries {what} twice."
                            : "the NETWORK header is NETWORK [LABEL: x] [DISABLED] [TITLE: \"…\"], in that order (P10).");
                stage = at;
            }

            while (Raw(_p) is var t && t.Kind != TokKind.Eof && Line(t) == hdrLine)
            {
                if (t.Kind == TokKind.Error) throw Err(t, t.Code!, t.Text);
                if (t.Is("LABEL"))
                {
                    Order(t, 1, "LABEL");
                    _p++;
                    ExpectOnLine(":", hdrLine, "LABEL: name");
                    var name = Next();
                    if (Line(name) != hdrLine || name.Kind != TokKind.Word || !NetworkSpelling.Identifier.IsMatch(name.Text))
                        throw Err(name, ConflictCodes.NetworkParse, "a LABEL is one identifier, on the header's line.");
                    label = name.Text;
                }
                else if (t.Is("DISABLED"))
                {
                    Order(t, 2, "DISABLED");
                    _p++;
                    disabled = true;
                }
                else if (t.Is("TITLE"))
                {
                    Order(t, 3, "TITLE");
                    _p++;
                    ExpectOnLine(":", hdrLine, "TITLE: \"…\"");
                    var s = Next();
                    if (Line(s) != hdrLine || s.Kind != TokKind.DString)
                        throw Err(s, ConflictCodes.NetworkParse, "a TITLE is a double-quoted string, on the header's line.");
                    title = NetworkLexer.DecodeTitle(s.Text, out var error) ?? throw Err(s, ConflictCodes.NetworkParse, error!);
                    if (title.Length == 0)
                        throw Err(s, ConflictCodes.NetworkParse, "`TITLE: \"\"`: a network with no title has no TITLE (P10).");
                }
                else
                    throw Err(t, ConflictCodes.NetworkParse,
                        $"'{t.Text}' in a NETWORK header: the header is NETWORK [LABEL: x] [DISABLED] [TITLE: \"…\"], and it ends at its newline.");
            }

            // P10: the network's comment — the `//` lines between the header and the body, joined as the IDE stores them.
            var comment = new List<string>();
            while (Raw(_p).Kind == TokKind.Comment) comment.Add(Next().Text);

            var trees = new List<Node>();
            string? unsupported = null;
            _item = new ItemCtx();

            while (true)
            {
                var t = Raw(_p);
                if (t.Is("END_NETWORK") || t.Kind == TokKind.Eof || (t.Is("NETWORK") && t.AtLineStart))
                {
                    if (_item.Open.Count > 0)
                        throw Err(_item.Open.Peek().At, ConflictCodes.NetworkBadExpression,
                            "an open line nothing takes: a line without `;` hands its box's ENO to a later line of its item, which reads it as ENO (B4, P3) — end it with `;`.");
                    if (!t.Is("END_NETWORK"))
                        throw Err(hdr, ConflictCodes.NetworkNotClosed, "this NETWORK has no END_NETWORK.");
                    _p++;
                    break;
                }
                if (t.Kind == TokKind.Comment)
                    throw Err(t, ConflictCodes.NetworkParse,
                        "a // comment after a statement: the network's one comment is the // lines between its header and " +
                        "its first statement, and NWL has no per-item comment to move this one to.");

                if (t.Is(NetworkSpelling.UnsupportedWord))
                {
                    _p++;
                    if (trees.Count > 0 || _item.Open.Count > 0)
                        throw Err(t, ConflictCodes.NetworkUnsupported,
                            "an UNSUPPORTED line beside other statements: it stands for the whole network's content, which Volt cannot show, and is its network's only line.");
                    var shape = Next();
                    if (shape.Kind != TokKind.DString || !NetworkSpelling.UnsupportedShape.IsMatch(shape.Text.Substring(1, shape.Text.Length - 2)))
                        throw Err(shape, ConflictCodes.NetworkParse,
                            "an UNSUPPORTED line names the shape Volt cannot show, as a quoted phrase: UNSUPPORTED \"a flag on a box input pin\";");
                    ExpectSym(";", "UNSUPPORTED \"<shape>\";");
                    var end = Raw(_p);
                    if (!end.Is("END_NETWORK"))
                        throw Err(end, ConflictCodes.NetworkUnsupported,
                            "a statement after an UNSUPPORTED line: the line stands for the whole network's content, and is its network's only line.");
                    unsupported = shape.Text.Substring(1, shape.Text.Length - 2);
                    continue;
                }

                var (lineEnd, semi) = LineEnd(_p);
                var lineStart = Raw(_p);
                _end = lineEnd;
                try
                {
                    var node = ParseStatement(semi);
                    if (semi)
                    {
                        // One `;` = one NWL item: every open line above it is taken by now (P3).
                        if (_item.Open.Count > 0)
                            throw Err(_item.Open.Peek().At, ConflictCodes.NetworkBadExpression,
                                "an open line nothing takes: its item ended with `;` before an ENO read it — every line without `;` is read by exactly one ENO of its item (B4, P3).");
                        trees.Add(node);
                    }
                    else
                    {
                        // P3: an open line's root is a box with an ENO — refused for any other root.
                        if (node is not Box box)
                            throw Err(lineStart, ConflictCodes.NetworkBadExpression,
                                "a line without `;` whose root is no box with an ENO (a coil, a split, a jump, a leaf, a parallel): end it with `;` (B4, P3).");
                        _item.Open.Enqueue((box, lineStart));
                    }
                }
                finally
                {
                    _end = _toks.Count;
                }
                _p = lineEnd;
            }

            return new Network(index, title, label, comment.Count > 0 ? string.Join("\r\n", comment) : null, disabled, trees, unsupported);
        }

        /// <summary>P2: where the line starting at <paramref name="from"/> ends, and whether it ends with <c>;</c>. At bracket
        /// depth 0 a line break ends a line unless the line ends with a word that cannot end it — an infix box word, BRANCH,
        /// <c>=&gt;</c>, <c>:=</c>, <c>S=</c>, <c>R=</c>; inside brackets line breaks are layout. An EXECUTE body and its
        /// END_EXECUTE belong to the EXECUTE's line.</summary>
        private (int End, bool Semicolon) LineEnd(int from)
        {
            var depth = 0;
            var j = from;
            while (true)
            {
                var t = Raw(j);
                if (t.Kind == TokKind.Eof) return (j, false);
                if (j > from && depth == 0)
                {
                    var prev = Raw(j - 1);
                    if (t.Is("END_NETWORK") || (t.Is("NETWORK") && t.AtLineStart) || t.Kind == TokKind.Comment) return (j, false);
                    if (t.Kind != TokKind.Snippet && prev.Kind != TokKind.Snippet && Line(t) > Line(prev) && !Continues(prev, j - 1))
                        return (j, false);
                }
                if (t.IsSym("(")) depth++;
                else if (t.IsSym(")")) depth = Math.Max(0, depth - 1);
                j++;
                if (t.IsSym(";") && depth == 0) return (j, true);
            }
        }

        private bool Continues(Tok prev, int at) => NetworkSpelling.ContinuesLine(prev, at > 0 ? Raw(at - 1) : default);

        // ── statements: one per line ────────────────────────────────────────────────────────────────

        private Node ParseStatement(bool semi)
        {
            var t = Peek();
            var role = semi ? Role.Top : Role.Eno;

            // The empty statement IS the empty item — a `;` that closes no statement.
            if (t.IsSym(";")) { Next(); AtLineEnd("the empty item is `;` alone"); return Mark(new Terminator(Flags.None), t.Offset); }

            if (t.Is("JMP") || t.Is("RETURN"))
            {
                var (target, flags) = ParseJump();
                Node cond = new Terminator(Flags.None);
                if (Peek().IsSym(":="))
                {
                    var op = Next();
                    if (AtEnd() || Peek().IsSym(";"))
                        throw Err(op, ConflictCodes.NetworkBadExpression,
                            $"`{t.Text.ToUpperInvariant()} … := ;`: a jump on the rail is `{(t.Is("JMP") ? "JMP l;" : "RETURN;")}` (P7, one spelling).");
                    cond = SlotHere();
                }
                else if (AtStorage())
                    throw Err(Peek(), ConflictCodes.NetworkBadExpression,
                        $"{t.Text.ToUpperInvariant()} with S= or R=: a jump or return is driven by `:=` (P7).");
                EndStatement(semi, "a jump");
                return Mark(new Assign(cond, new[] { target }, flags), t.Offset);
            }

            if (t.Is("EXECUTE")) return ParseExecute(role, semi);

            if ((t.Is("IF") || t.Is("VAR_TEMP")) && !StorageAt(_p + 1))
                throw Err(t, ConflictCodes.NetworkParse, t.Is("IF")
                    ? "IF … THEN is gone: a jump is a coil, `JMP l := c;`, and a return `RETURN := c;` (B4b, P12)."
                    : "VAR_TEMP is gone: a split is defined by `split<VarId> := value;` and needs no declaration (B6, P12).");

            if (t.Kind == TokKind.Word && NetworkSpelling.SplitShape.IsMatch(t.Text) && (PeekAt(1).IsSym(":=") || PeekAt(1).IsSym(":")))
                return ParseSplitDefinition(semi);

            if (t.Kind == TokKind.Word && NetworkSpelling.TextWords.Contains(t.Text) && StorageAt(_p + 1))
                throw Err(t, ConflictCodes.NetworkBadExpression,
                    $"'{t.Text}' as a target: a target spelled like a word of the text is written between backticks, `{t.Text}` (P1).");

            if (IsTargetToken(t) && StorageAt(_p + 1))
            {
                var targets = new List<(Tok Target, Tok Op)>();
                while (IsTargetToken(Peek()) && StorageAt(_p + 1))
                {
                    var tt = Next();
                    targets.Add((tt, TakeStorage()));
                }
                var value = SlotValue(targets[targets.Count - 1].Op);
                EndStatement(semi, "a coil");
                return Mark(BuildAssign(targets, value), t.Offset);
            }

            var root = ParseLevel();
            if (root.Empty) throw Err(t, ConflictCodes.NetworkParse, "a value is expected here.");
            if (root.Bracketed)
                throw Err(root.Start, ConflictCodes.NetworkBadExpression,
                    "brackets around a line's whole value: a line holds one box, never bracketed (B5, P4).");
            var node = root.Box is { } box ? Finalize(box, role) : root.Node!;
            EndStatement(semi, null);
            return node;
        }

        /// <summary>A slot's value after its storage operator — the empty terminator where none stands
        /// (<c>FirstCycle R= ;</c>, a coil on the rail).</summary>
        private Node SlotValue(Tok op) =>
            AtEnd() || Peek().IsSym(";") || Peek().IsSym(")") ? Mark(new Terminator(Flags.None), op.Offset)
                : SlotHere();

        /// <summary>The line's end: <c>;</c> where the line has one (it is the line's last token), nothing else after the
        /// statement.</summary>
        private void EndStatement(bool semi, string? what)
        {
            if (semi)
            {
                if (!Peek().IsSym(";")) throw Unexpected(Peek());
                Next();
            }
            else if (what is not null)
                throw Err(Peek(), ConflictCodes.NetworkBadExpression,
                    $"{what} ends its item with `;`: only a box with an ENO stands on an open line (B4, P3).");
            AtLineEnd(null);
        }

        private void AtLineEnd(string? what)
        {
            if (_p < _end) throw Unexpected(Raw(_p), what);
        }

        private ParseError Unexpected(Tok t, string? what = null)
        {
            if (t.Kind == TokKind.Error) return Err(t, t.Code!, t.Text);
            if (OldSymbol(t) is { } old) return old;
            if (t.IsSym(".") && Raw(_p + 1).Is("ENO")) return OldEno(t);
            if (t.Is("EN") && _p > 0) return Err(t, ConflictCodes.NetworkBadExpression,
                "EN where no box takes it: EN follows the box it enables — its word form, or its call alone at its bracket level (P4).");
            if (t.IsSym("=>")) return Err(t, ConflictCodes.NetworkBadExpression,
                "`=>` here: a call keeps its output pins inside its brackets, a box word writes them before EN (`a ADD b => x EN c`, P4).");
            if (t.Is("INTO") || t.Is("BRANCHES")) return Err(t, ConflictCodes.NetworkParse,
                $"'{t.Text}' is not network text: a parallel is its feed, the word BRANCH and its branches, `feed BRANCH (a, b)` (B8, P12).");
            if (t.Is(NetworkSpelling.BranchWord)) return Err(t, ConflictCodes.NetworkBadExpression,
                "BRANCH after a box word at its level: a feed that is a box word is bracketed, `(a AND b) BRANCH (x, y)` (B8, P4).");
            if (t.Is(NetworkSpelling.ShortCircuitWord)) return Err(t, ConflictCodes.NetworkBadExpression,
                "SHORTCIRCUIT after something no parallel: it follows a parallel's branch list, `feed BRANCH (a, b) SHORTCIRCUIT` (B8).");
            if (t.Kind == TokKind.Word && NetworkSpelling.OperatorWords.Contains(t.Text))
                return Err(t, ConflictCodes.NetworkBadExpression,
                    $"'{t.Text}' after a bracket level that already holds a box: one word = one box, and brackets separate boxes (B1, P4).");
            return Err(t, ConflictCodes.NetworkParse, what is null
                ? $"'{t.Text}' where the line ends: each line is one statement, ending with `;` or open for a later line's ENO (B4)."
                : $"'{t.Text}': {what}.");
        }

        private bool AtStorage() => StorageAt(_p);

        /// <summary>Whether a storage operator stands at <paramref name="i"/>: <c>:=</c>, or ExST's <c>S=</c> / <c>R=</c> — a
        /// word <c>S</c> or <c>R</c> and <c>=</c>. Only after a target, so the position decides, never the spacing.</summary>
        private bool StorageAt(int i)
        {
            if (i >= _end) return false;
            var t = Raw(i);
            return t.IsSym(":=") || ((t.Is("S") || t.Is("R")) && i + 1 < _end && Raw(i + 1).IsSym("="));
        }

        private Tok TakeStorage()
        {
            var t = Next();
            if (t.IsSym(":=")) return t;
            var eq = Next();
            return new Tok(TokKind.Sym, t.Text.ToUpperInvariant() + "=", t.Offset, eq.Offset + eq.Length - t.Offset, t.AtLineStart);
        }

        private bool IsTargetToken(Tok t) =>
            t.Kind is TokKind.Backtick or TokKind.Unnamed or TokKind.Address ||
            (t.Kind == TokKind.Word && !NetworkSpelling.IsReserved(t.Text)) ||
            (t.Kind == TokKind.Word && NetworkSpelling.SplitShape.IsMatch(t.Text));

        /// <summary>B6, P9: <c>split&lt;n&gt; := value;</c> — the split's one definition, before its references. No type is
        /// ever written: the Demux holds none, the type is its feeder's.</summary>
        private Node ParseSplitDefinition(bool semi)
        {
            var name = Next();
            var id = SplitId(name);
            if (Peek().IsSym(":"))
                throw Err(Peek(), ConflictCodes.NetworkBadExpression,
                    $"a type on the split {name.Text}: a split's type is its feeder's and is never written — `{name.Text} := value;` (B6, P9).");
            var op = Next();
            if (!op.IsSym(":="))
                throw Err(op, ConflictCodes.NetworkBadExpression, $"a split is defined with `:=`, and S=/R= are coils ({name.Text}, P9).");
            if (_splits.Contains(id))
                throw Err(name, ConflictCodes.NetworkDuplicateName, $"the split {name.Text} is defined twice (P9).");
            var value = SlotValue(op);
            EndStatement(semi, "a split's definition");
            _splits.Add(id);
            return Mark(new Demux(id, value), name.Offset);
        }

        /// <summary>The VarId a split's name carries (B6, P9: no leading zeros).</summary>
        private int SplitId(Tok name)
        {
            var digits = name.Text.Substring(NetworkSpelling.SplitPrefix.Length);
            if (digits.Length > 1 && digits[0] == '0')
                throw Err(name, ConflictCodes.NetworkBadExpression, $"the split {name.Text}: its number is the VarId, with no leading zeros (P9).");
            if (!int.TryParse(digits, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var id))
                throw Err(name, ConflictCodes.NetworkBadExpression, $"the split {name.Text} carries a VarId out of range.");
            return id;
        }

        private Node BuildAssign(List<(Tok Target, Tok Op)> targets, Node value)
        {
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

        /// <summary><c>JMP label</c> / <c>RETURN</c>. The bit rides on the target operand and on the item, as the vendor
        /// holds a drawn jump (DIALECT C13); a return's target is the vendor's constant <c>???</c>.</summary>
        private (Operand Target, Flags Flags) ParseJump()
        {
            var t = Next();
            if (t.Is("JMP"))
            {
                var l = Next();
                if (l.Kind != TokKind.Word || !NetworkSpelling.Identifier.IsMatch(l.Text))
                    throw Err(l, ConflictCodes.NetworkBadExpression, "JMP takes one label, an identifier.");
                var jump = Flags.None with { Jump = true };
                return (new Operand(l.Text, IsLValue: true, Flags: jump), jump);
            }
            var ret = Flags.None with { Return = true };
            return (new Operand(Box.UnnamedInstance, IsLValue: true, Flags: ret), ret);
        }

        /// <summary>P8: <c>EXECUTE [EN [c]]</c> on its line, the verbatim ST below it, <c>END_EXECUTE</c>, and <c>;</c> — or
        /// no <c>;</c>, where it is an open line a later ENO takes. Never a value.</summary>
        private Node ParseExecute(Role role, bool semi)
        {
            var kw = Next();
            if (Peek().IsSym("("))
                throw Err(Peek(), ConflictCodes.NetworkParse, "EXECUTE(EN := c) is gone: write `EXECUTE EN c` on the EXECUTE line (B3, P12).");
            var syn = new BoxSyn { Type = NetworkSpelling.ExecuteType, Head = kw };
            ParseEn(syn);
            // The body's lexical error (a lone CR) stands where the body would: past this line's tokens.
            if (AtEnd() && Raw(_p).Kind == TokKind.Error) throw Err(Raw(_p), Raw(_p).Code!, Raw(_p).Text);
            var snippet = Next();
            if (snippet.Kind == TokKind.Error) throw Err(snippet, snippet.Code!, snippet.Text);
            if (snippet.Kind != TokKind.Snippet)
                throw Err(snippet, ConflictCodes.NetworkParse, "EXECUTE [EN [c]] ends at its line; its ST starts on the next line (P8).");
            var end = Next();
            if (!end.Is("END_EXECUTE")) throw Err(end, ConflictCodes.NetworkParse, "an EXECUTE body ends with END_EXECUTE.");
            syn.StCode = snippet.Text;
            var box = Finalize(syn, role);
            EndStatement(semi, null);
            return box;
        }

        // ── values ──────────────────────────────────────────────────────────────────────────────────

        /// <summary>
        /// One BRACKET LEVEL (P4): a box word with its operands (<c>a ADD b ADD c</c>, B1), MOVE and its operand (B2), a
        /// parallel <c>[feed] BRANCH (a, b)</c> (B8), or one operand — each followed by its <c>=&gt;</c> pins and its
        /// <c>EN</c> tail where it is a box. The level's own box is left for its consumer to give its role.
        /// </summary>
        private Syn ParseLevel()
        {
            var start = Peek();
            if (start.Is(NetworkSpelling.BranchWord))
            {
                if (!PeekAt(1).IsSym("("))
                    throw Err(start, ConflictCodes.NetworkParse,
                        "BRANCH takes its branches as a bracketed list, `feed BRANCH (a, b)` — a BRANCH line is gone (B8, P12).");
                Next();
                return ParseParallel(null, start);
            }
            if (start.Is(NetworkSpelling.Move) && (!PeekAt(1).IsSym("(") || MoveOperandBracket()))
            {
                Next();
                var operand = ParseOperand();
                if (operand.Empty) throw Err(start, ConflictCodes.NetworkBadExpression, "MOVE takes one operand (B2); an empty input is `MOVE(IN := , => x)` (P5).");
                var syn = new BoxSyn { Type = NetworkSpelling.Move, Head = start };
                syn.Inputs.Add(new Input(null, Operand(operand), Flags.None));
                if (Peek().Kind == TokKind.Word && NetworkSpelling.OperatorWords.Contains(Peek().Text))
                    throw Err(Peek(), ConflictCodes.NetworkBadExpression, "a box word after MOVE's operand: MOVE takes ONE operand — bracket a box (B2, P4).");
                if (Peek().Is(NetworkSpelling.BranchWord))
                    throw Err(Peek(), ConflictCodes.NetworkBadExpression, "BRANCH after MOVE's operand: a parallel as MOVE's operand stands in brackets (B8, P4).");
                ParseArrows(syn);
                ParseEn(syn);
                return new Syn { Box = syn, Start = start, Word = true };
            }

            var first = ParseOperand();
            var t = Peek();

            if (t.Kind == TokKind.Word && NetworkSpelling.OperatorWords.Contains(t.Text))
            {
                if (first.Empty) throw Err(t, ConflictCodes.NetworkBadExpression, $"'{t.Text}' with no operand before it.");
                var word = t.Text.ToUpperInvariant();
                var syn = new BoxSyn { Type = word, Head = t };
                syn.Inputs.Add(new Input(null, Operand(first), Flags.None));
                while (Peek() is var w && w.Kind == TokKind.Word && NetworkSpelling.OperatorWords.Contains(w.Text))
                {
                    if (!string.Equals(w.Text, word, StringComparison.OrdinalIgnoreCase))
                        throw Err(w, ConflictCodes.NetworkBadExpression,
                            $"'{word}' and '{w.Text.ToUpperInvariant()}' at one bracket level: one word = one box, so brackets separate boxes — `a {word} (b {w.Text.ToUpperInvariant()} c)` (B1, P4).");
                    Next();
                    var op = ParseOperand();
                    if (op.Empty) throw Err(w, ConflictCodes.NetworkBadExpression, $"'{word}' with no operand after it.");
                    syn.Inputs.Add(new Input(null, Operand(op), Flags.None));
                }
                if (Peek().Is(NetworkSpelling.Move))
                    throw Err(Peek(), ConflictCodes.NetworkBadExpression, "MOVE inside another word's level: MOVE is a box of its own, bracketed (B2, P4).");
                if (Peek().Is(NetworkSpelling.BranchWord))
                    throw Err(Peek(), ConflictCodes.NetworkBadExpression,
                        "BRANCH after a box word at its level: a feed that is a box word is bracketed, `(a AND b) BRANCH (x, y)` (B8, P4).");
                if (NetworkSpelling.TwoInputOperators.Contains(word) && syn.Inputs.Count > 2)
                    throw Err(t, ConflictCodes.NetworkUnsupported,
                        $"{word} takes 2 inputs, and this one holds {syn.Inputs.Count}: the build refuses it (\"needs exactly '2' operands\", C3) — bracket one box per two operands (B1).");
                ParseArrows(syn);
                ParseEn(syn);
                return new Syn { Box = syn, Start = first.Start, Word = true };
            }

            if (t.Is(NetworkSpelling.Move))
                throw Err(t, ConflictCodes.NetworkBadExpression, "`a MOVE b` is not network text: MOVE writes its target as an output pin, `MOVE b => a` (B2, P12).");

            if (t.Is(NetworkSpelling.BranchWord))
            {
                if (first.Empty) throw Err(t, ConflictCodes.NetworkParse, "BRANCH with an empty feed before it: an unfed parallel is `BRANCH (a, b)` alone (B8).");
                if (first.Node is Terminator) throw Err(t, ConflictCodes.NetworkUnsupported, "a parallel fed by the empty terminator (B8, P6).");
                if (!PeekAt(1).IsSym("("))
                    throw Err(t, ConflictCodes.NetworkParse, "BRANCH takes its branches as a bracketed list, `feed BRANCH (a, b)` (B8).");
                var feed = Operand(first);
                Next();
                return ParseParallel(feed, first.Start);
            }

            if (first.Box is { } call && !first.Bracketed)
                ParseEn(call);
            else if (t.Is("EN") && !first.Empty)
                throw Err(t, ConflictCodes.NetworkBadExpression, first.Bracketed
                    ? "EN after a bracket: EN belongs to the box of its own bracket level — write it inside the brackets (P4)."
                    : "EN after a value that is no box: EN follows the box it enables (B3).");
            return first;
        }

        /// <summary>
        /// B2, B5: whether the bracket after <c>MOVE</c> is its OPERAND's (<c>MOVE (a ADD b) =&gt; x</c>) and not its call's
        /// pins (<c>MOVE(a, b)</c>). Tokens decide, never spacing: a call whose brackets hold exactly one positional
        /// input, no output pin and no formal IS the word form's tree — its call form is refused where the word fits (P5)
        /// — so such a bracket is the operand's, and P4 then asks it to hold a box word, a parallel or an enabled
        /// comparison. Anything else (<c>MOVE()</c>, a comma, <c>=&gt;</c>, <c>IN :=</c>) is the call.
        /// </summary>
        private bool MoveOperandBracket()
        {
            var i = _p + 1;          // the `(`
            var depth = 0;
            var first = i + 1;
            if (first < _end && Raw(first).IsSym(")")) return false;
            if (first + 1 < _end && Raw(first).Is("IN") && Raw(first + 1).IsSym(":=")) return false;
            if (first + 2 < _end && Raw(first).Is("NOT") && Raw(first + 1).Is("IN") && Raw(first + 2).IsSym(":=")) return false;
            for (; i < _end; i++)
            {
                var t = Raw(i);
                if (t.IsSym("(")) depth++;
                else if (t.IsSym(")") && --depth == 0) return true;
                else if (depth == 1 && (t.IsSym(",") || t.IsSym("=>"))) return false;
            }
            return false;
        }

        /// <summary>B8, P6: the parallel's branch list after <c>BRANCH</c> — a bracketed comma list of slots, at least two,
        /// none empty — and its mode: <c>SHORTCIRCUIT</c> where it is not the editor's.</summary>
        private Syn ParseParallel(Node? feed, Tok start)
        {
            var open = Next();
            if (!open.IsSym("(")) throw Err(open, ConflictCodes.NetworkParse, "BRANCH takes its branches as a bracketed list, `feed BRANCH (a, b)` (B8).");
            var branches = new List<Node>();
            while (true)
            {
                var at = Peek();
                if (at.IsSym(",") || at.IsSym(")"))
                {
                    if (at.IsSym(")") && branches.Count == 0)
                        throw Err(at, ConflictCodes.NetworkUnsupported, "a parallel with no branch: `BRANCH ()` holds none (B8, P6).");
                    throw Err(at, ConflictCodes.NetworkUnsupported, "an empty branch: each branch of a parallel holds a box, `(a, , b)` is refused (B8, P6).");
                }
                branches.Add(Slot(ParseLevel(), at));
                var sep = Peek();
                if (sep.IsSym(",")) { Next(); continue; }
                if (sep.IsSym(")")) { Next(); break; }
                throw Unexpected(sep, "a parallel's branches are separated by `,` and closed by `)`");
            }
            if (branches.Count == 1)
                throw Err(open, ConflictCodes.NetworkUnsupported,
                    "a parallel with one branch: it pushes, and does not compile (C0023) — write the branch as the value itself (B8, P6).");
            var mode = NetworkSpelling.DerivedMode;
            if (Peek().Is(NetworkSpelling.ShortCircuitWord)) { Next(); mode = ParallelMode.BoxShortCircuit; }
            if (Peek().Is("EN"))
                throw Err(Peek(), ConflictCodes.NetworkBadExpression, "EN after a parallel: a parallel is no box, and has no enable (B8).");
            if (Peek().IsSym("=>"))
                throw Err(Peek(), ConflictCodes.NetworkBadExpression, "`=>` after a parallel: a parallel is no box, and has no output pin (B8).");
            return new Syn { Node = Mark(new Parallel(feed, branches, mode), start.Offset), Start = start, Word = true };
        }

        /// <summary>A box word's <c>=&gt; v</c> pins (B1, B2), before its EN (P4: <c>MOVE b EN c =&gt; a</c> is refused).</summary>
        private void ParseArrows(BoxSyn syn)
        {
            while (Peek().IsSym("=>"))
            {
                var arrow = Next();
                if (AtEnd() || Peek().IsSym("=>") || !IsTargetToken(Peek()))
                    throw Err(arrow, ConflictCodes.NetworkBadExpression,
                        "`=>` with no target: a box word writes each output to a target, and a slot passed over is the call form's (P5).");
                syn.Outputs.Add((null, Target(Next()), true));
            }
        }

        /// <summary>B3: <c>EN c</c> after the box, its tail a slot running to <c>;</c>, <c>)</c>, <c>,</c> or the line's end
        /// (P4); <c>EN</c> alone is the empty enable.</summary>
        private void ParseEn(BoxSyn syn)
        {
            if (!Peek().Is("EN")) return;
            var en = Next();
            syn.HadEn = true;
            if (AtEnd() || Peek().IsSym(",") || Peek().IsSym(")") || Peek().IsSym(";") || Peek().Kind == TokKind.Snippet)
                syn.Enable = Mark(new Terminator(Flags.None), en.Offset);
            else
                syn.Enable = SlotHere();
            if (Peek().IsSym("=>"))
                throw Err(Peek(), ConflictCodes.NetworkBadExpression, "`=>` after EN: a box writes its outputs before its EN — `MOVE b => a EN c` (P4).");
            if (Peek().Is("EN"))
                throw Err(Peek(), ConflictCodes.NetworkBadExpression, "EN twice on one box.");
        }

        /// <summary>One operand of a level: a leaf, a split, <c>ENO</c>, a call, <c>NOT x</c>, an edge, or a bracket holding a
        /// box word, a parallel or an enabled comparison — never a bare box word (that is a level of its own, bracketed).</summary>
        private Syn ParseOperand()
        {
            var t = Peek();
            if (AtEnd() || t.IsSym(",") || t.IsSym(")") || t.IsSym(";") || t.Kind == TokKind.Snippet)
                return new Syn { Empty = true, Start = t, Node = null };

            if (t.Is("NOT"))
            {
                Next();
                var n = Peek();
                if (n.IsSym("(") && (PeekAt(1).Is("IN") && PeekAt(2).IsSym(":=") || PeekAt(1).Is("NOT") && PeekAt(2).Is("IN") && PeekAt(3).IsSym(":=")))
                {
                    // P5: `NOT(IN := a)` is the NOT box; `NOT (` + anything else negates that bracket.
                    Next();
                    return ParseCall(t, null, null, operatorCall: true, type: NetworkSpelling.NotBox);
                }
                if (n.Is("R_EDGE") || n.Is("F_EDGE"))
                    throw Err(t, ConflictCodes.NetworkBadExpression,
                        $"NOT outside {n.Text.ToUpperInvariant()}(…): the IDE negates before it detects the edge, so the one spelling is {n.Text.ToUpperInvariant()}(NOT x).");
                if (AtEnd() || n.IsSym(",") || n.IsSym(")") || n.IsSym(";"))
                    throw Err(t, ConflictCodes.NetworkUnsupported, "a flag on an empty slot: an unconnected position has no text to modify.");
                var inner = ParseOperand();
                return Flagged(inner, t, f =>
                {
                    if (f.Negated) throw Err(t, ConflictCodes.NetworkBadExpression, "NOT twice on one operand: one negation flag.");
                    return f with { Negated = true };
                });
            }

            if (t.Is("R_EDGE") || t.Is("F_EDGE"))
            {
                Next();
                var rising = t.Is("R_EDGE");
                if (NetworkSpelling.ConstructTaken(t.Text, _scope))
                    throw Err(t, ConflictCodes.NetworkUnsupported,
                        $"a POU or instance named {t.Text.ToUpperInvariant()}: the text reads {t.Text.ToUpperInvariant()}(…) as the edge flag, so the call has no spelling.");
                ExpectSym("(", $"{t.Text.ToUpperInvariant()}(x)");
                var inner = ParseLevel();
                if (inner.Empty) throw Err(t, ConflictCodes.NetworkUnsupported, "a flag on an empty slot: an unconnected position has no text to modify.");
                if (inner.Bracketed)
                    throw Err(inner.Start, ConflictCodes.NetworkBadExpression, $"{t.Text.ToUpperInvariant()}((…)): an edge's brackets carry its argument whole — a redundant bracket is refused (P4).");
                ExpectSym(")", $"{t.Text.ToUpperInvariant()}(x)");
                var flagged = Flagged(inner, t, f =>
                {
                    if (f.Rising || f.Falling)
                        throw Err(t, ConflictCodes.NetworkUnsupported, "nested edges: one operand carries one edge flag, and rising with falling has no spelling.");
                    return rising ? f with { Rising = true } : f with { Falling = true };
                });
                flagged.Word = false;
                flagged.Bracketed = false;
                return flagged;
            }

            switch (t.Kind)
            {
                case TokKind.Sym when t.Text == "(":
                {
                    Next();
                    // S2: a target and a storage operator at the pair's own depth — an assignment below the top level.
                    if (IsTargetToken(Peek()) && StorageAt(_p + 1)) return new Syn { Node = Mark(ParseNestedAssign(t), t.Offset), Start = t };
                    var inner = ParseLevel();
                    if (!Peek().IsSym(")")) throw Unexpected(Peek(), "a bracket closes after the box it holds");
                    Next();
                    if (inner.Empty || inner.Bracketed || !(inner.Word || inner.EnabledComparison))
                        throw Err(t, ConflictCodes.NetworkBadExpression,
                            "a redundant bracket: brackets mark a box word or a parallel as another word's operand, an enabled comparison, and a nested assignment — nothing else (B5, P4).");
                    inner.Bracketed = true;
                    inner.Start = t;
                    return inner;
                }

                case TokKind.Unnamed:
                    Next();
                    if (Peek().IsSym(":"))
                    {
                        // `??? : TYPE(…)` — the vendor's unnamed instance, which carries its type because no declaration can.
                        Next();
                        var ty = Next();
                        if (ty.Kind != TokKind.Word || !NetworkSpelling.Identifier.IsMatch(ty.Text))
                            throw Err(ty, ConflictCodes.NetworkBadExpression, "`??? : TYPE(…)` names the FB type, an identifier.");
                        ExpectSym("(", "??? : TYPE(pins)");
                        return ParseCall(t, Box.UnnamedInstance, ty.Text, operatorCall: false, type: null);
                    }
                    if (Peek().IsSym("("))
                        throw Err(t, ConflictCodes.NetworkBadExpression, "??? is no call head; an unnamed instance is written `??? : TYPE(…)`.");
                    return Leaf(t);

                case TokKind.Word:
                    return ParseWord(t);

                case TokKind.Backtick:
                    Next();
                    if (Peek().IsSym("(")) { Next(); return ParseCall(t, null, null, operatorCall: false, type: null); }
                    if (NetworkSpelling.IsLiteral(t.Text))
                        throw Err(t, ConflictCodes.NetworkBadExpression, $"a literal between backticks: write it bare, {t.Text} (P12).");
                    return Leaf(t);

                case TokKind.Number:
                case TokKind.Typed:
                case TokKind.Address:
                case TokKind.SString:
                case TokKind.DString:
                    Next();
                    if (Peek().IsSym("(")) throw Err(t, ConflictCodes.NetworkBadExpression, $"'{t.Text}' is a literal and no call head.");
                    return Leaf(t);

                case TokKind.Error:
                    throw Err(t, t.Code!, t.Text);

                default:
                    if (OldSymbol(t) is { } old) throw old;
                    throw Err(t, ConflictCodes.NetworkParse, t.Kind == TokKind.Eof
                        ? "the body ends inside a statement."
                        : $"'{t.Text}' where a value is expected: an operand that is not one token is written between backticks.");
            }
        }

        private Syn ParseWord(Tok t)
        {
            if (t.Is("ENO"))
            {
                Next();
                // P3: the oldest open line of the item not yet taken.
                if (_item.Open.Count == 0)
                    throw Err(t, ConflictCodes.NetworkBadExpression,
                        "ENO with no open line above it to take: ENO reads the box of the oldest line above it without `;` that no ENO has taken yet (B4, P3).");
                var (box, _) = _item.Open.Dequeue();
                return new Syn { Node = box, Start = t };
            }
            if (NetworkSpelling.SplitShape.IsMatch(t.Text))
            {
                Next();
                if (Peek().IsSym("(")) throw Err(t, ConflictCodes.NetworkBadExpression, $"{t.Text} is a split, never a call head (P9).");
                var id = SplitId(t);
                if (!_splits.Contains(id))
                    throw Err(t, ConflictCodes.NetworkBadExpression,
                        $"the split {t.Text} is referenced before its definition: a split is defined by `{t.Text} := value;` before its first use (P9).");
                return new Syn { Node = Mark(new Demux(id, null), t.Offset), Start = t };
            }
            if ((t.Is(NetworkSpelling.Move) || NetworkSpelling.OperatorWords.Contains(t.Text)) && PeekAt(1).IsSym("("))
            {
                Next(); Next();
                return ParseCall(t, null, null, operatorCall: true, type: t.Text);
            }
            if (t.Is("PARALLEL") && PeekAt(1).IsSym("(") && !_scope.IsCallable(t.Text))
                throw Err(t, ConflictCodes.NetworkParse, "PARALLEL(…) is not network text: a parallel is its feed, the word BRANCH and its branches, `feed BRANCH (a, b)` (B8, P12).");
            if (t.Is("EXECUTE"))
                throw Err(t, ConflictCodes.NetworkBadExpression, "EXECUTE where a value stands: an EXECUTE box is a line of its own, never a value (P8).");
            if (t.Is(NetworkSpelling.BranchWord))
                throw Err(t, ConflictCodes.NetworkBadExpression,
                    "an unfed parallel as an operand stands in brackets, `x AND (BRANCH (a, b))` (B8, P4).");
            if (NetworkSpelling.IsReserved(t.Text))
                throw Err(t, ConflictCodes.NetworkBadExpression,
                    $"'{t.Text}' at operand position: a variable spelled like a word of the text is written between backticks (P1).");
            Next();
            if (Peek().IsSym("(")) { Next(); return ParseCall(t, null, null, operatorCall: false, type: null); }
            if (Peek().IsSym(".") && PeekAt(1).Is("ENO")) throw OldEno(Peek());
            return Leaf(t);
        }

        private Syn Leaf(Tok t)
        {
            return new Syn { Node = Mark(new Leaf(new Operand(t.Text), Flags.None), t.Offset), Start = t };
        }

        /// <summary>A modifier on a parsed value: on a built node, or on a box whose role is still open. DIALECT N20: no flag
        /// on a split or a Parallel.</summary>
        private Syn Flagged(Syn inner, Tok modifier, Func<Flags, Flags> f)
        {
            if (inner.Box is { } box)
            {
                box.Flags = f(box.Flags);
                return new Syn { Box = box, Start = modifier, Covered = true };
            }
            var node = inner.Node!;
            Node flagged = node switch
            {
                Demux => throw Err(modifier, ConflictCodes.NetworkUnsupported,
                    $"{modifier.Text.ToUpperInvariant()} on a split: the IDE holds no flag on a split (N20); put it on the split's feeder or a consumer."),
                Parallel => throw Err(modifier, ConflictCodes.NetworkUnsupported,
                    $"{modifier.Text.ToUpperInvariant()} on a parallel: the IDE holds no flag on a parallel (N20, P6) — `NOT s BRANCH (a, b)` negates the feed."),
                Terminator => throw Err(modifier, ConflictCodes.NetworkUnsupported, "a flag on an empty slot: an unconnected position has no text to modify."),
                Leaf l => l with { Flags = f(l.Flags) },
                Box b => b with { Flags = f(b.Flags) },
                Assign => throw Err(modifier, ConflictCodes.NetworkUnsupported,
                    $"{modifier.Text.ToUpperInvariant()} on an assignment below the top level: the IDE holds no flag on an Assign item (census 1.1)."),
                _ => throw new InvalidOperationException($"a modifier on a {node.GetType().Name}"),
            };
            return new Syn { Node = Mark(flagged, modifier.Offset), Start = modifier };
        }

        /// <summary><c>(t1 := t2 S= … value)</c> after its <c>(</c> (S2): one Assign item below the top level, its value
        /// passing through to the consumer. A split is never a coil target (P9).</summary>
        private Assign ParseNestedAssign(Tok open)
        {
            var targets = new List<(Tok Target, Tok Op)>();
            while (IsTargetToken(Peek()) && StorageAt(_p + 1))
            {
                var tt = Next();
                targets.Add((tt, TakeStorage()));
            }
            var value = SlotValue(targets[targets.Count - 1].Op);
            if (!Peek().IsSym(")"))
                throw Unexpected(Peek(), "an assignment's pair `(t := value)` closes after its value");
            Next();
            return (Assign)BuildAssign(targets, value);
        }

        /// <summary>A call's pins after its <c>(</c>, the <c>)</c>, and an optional <c>.name</c> (S4). The head is the FB
        /// instance when the scope declares it one, else the BoxType verbatim; an operator's own word heads its call form
        /// (P5).</summary>
        private Syn ParseCall(Tok head, string? unnamedInstance, string? unnamedType, bool operatorCall, string? type)
        {
            var syn = new BoxSyn { Head = head, OperatorCall = operatorCall };
            var positional = false;
            if (Peek().IsSym(")")) Next();   // `f()` — a box with no input slot
            else
            {
                while (true)
                {
                    positional |= Pin(syn);
                    var sep = Peek();
                    if (sep.IsSym(",")) { Next(); continue; }
                    if (sep.IsSym(")")) { Next(); break; }
                    if (sep.Is("EN"))
                        throw Err(sep, ConflictCodes.NetworkBadExpression,
                            "EN inside a call's argument: an enabled comparison as a value stands in brackets, `f((a GT b EN c), d)` (P4).");
                    throw Unexpected(sep, "pins are separated by `,` and closed by `)`");
                }
            }

            if (Peek().IsSym("."))
            {
                var dot = Next();
                var e = Peek();
                if (e.Is("ENO")) throw OldEno(dot);
                if (e.Kind == TokKind.Word && NetworkSpelling.Identifier.IsMatch(e.Text) && !e.Is(Box.EnablePin) && !NetworkSpelling.IsReserved(e.Text))
                    syn.Named = Next();
                else
                    throw Err(e, ConflictCodes.NetworkParse, "after a call, `.name` names the output a consumer reads (S4).");
            }

            if (unnamedInstance is not null)
            {
                syn.Instance = new Operand(unnamedInstance, IsInstance: true);
                syn.Type = unnamedType!;
            }
            else if (operatorCall)
                syn.Type = type!;
            else if (_scope.InstanceType(head.Text) is { } fbType)
            {
                if (NetworkSpelling.ConstructWords.Contains(head.Text))
                    throw Err(head, ConflictCodes.NetworkUnsupported, $"an instance named {head.Text.ToUpperInvariant()}: the text reads it as its own construct.");
                syn.Instance = new Operand(head.Text, IsInstance: true);
                syn.Type = fbType;
            }
            else
            {
                if (!NetworkSpelling.IsName(head.Text))
                    throw Err(head, ConflictCodes.NetworkUnsupported,
                        $"an FB instance the declarations do not name: '{head.Text}' is no POU name, and no declaration names it an instance, so its type is unknown.");
                syn.Type = head.Text;
            }
            if (NetworkSpelling.ConstructWords.Contains(syn.Type))
                throw Err(head, ConflictCodes.NetworkUnsupported,
                    $"a POU named {syn.Type.ToUpperInvariant()}: the text reads {syn.Type.ToUpperInvariant()}(…) as its own construct, so a call of it has no spelling.");

            // An operator's pins named by its default formal (P5) read back unnamed, the vendor's own (census 1.13).
            for (var i = 0; i < syn.Inputs.Count; i++)
                if (syn.Inputs[i].Formal is { } f && NetworkSpelling.DefaultFormal(syn.Type, i) is { } d &&
                    string.Equals(f, d, StringComparison.OrdinalIgnoreCase))
                    syn.Inputs[i] = syn.Inputs[i] with { Formal = null };
            if (string.Equals(syn.Type, NetworkSpelling.NotBox, StringComparison.OrdinalIgnoreCase) && operatorCall && positional)
                throw Err(head, ConflictCodes.NetworkBadExpression, "the NOT box names its input: `NOT(IN := a)` (P5).");

            if (syn.Named is { } nm && syn.Outputs.Any(o => o.Positional))
                throw Err(nm, ConflictCodes.NetworkUnsupported,
                    $"a positional `=>` pin beside `.{nm.Text}`: positional pins fill the slots after the one a consumer reads, and `.{nm.Text}` states no slot. Name the pin.");
            return new Syn { Box = syn, Start = head };
        }

        /// <summary>One pin of a call; true for a positional input.</summary>
        private bool Pin(BoxSyn syn)
        {
            if (Peek().IsSym("=>"))
            {
                Next();
                // `=> v` fills the next output slot; a bare `=>` passes one over.
                syn.Outputs.Add((null, AtEnd() || Peek().IsSym(",") || Peek().IsSym(")") ? null : Target(Next()), true));
                return false;
            }

            var pinFlags = Flags.None;
            Tok? not = null;
            if (Peek().Is("NOT") && IsPinNameAt(_p + 1) && Raw(_p + 2).IsSym(":="))
            {
                not = Next();
                pinFlags = Flags.None with { Negated = true };
            }

            if (IsPinNameAt(_p) && (Raw(_p + 1).IsSym(":=") || Raw(_p + 1).IsSym("=>")))
            {
                var name = Next();
                var isEn = name.Kind == TokKind.Word && string.Equals(name.Text, Box.EnablePin, StringComparison.OrdinalIgnoreCase);
                var isEno = name.Kind == TokKind.Word && string.Equals(name.Text, Box.EnoPin, StringComparison.OrdinalIgnoreCase);
                if (name.Kind == TokKind.Word && NetworkSpelling.IsReserved(name.Text) && !isEn && !isEno)
                    throw Err(name, ConflictCodes.NetworkBadExpression,
                        $"a pin named '{name.Text}', a word of the text: it is written between backticks (P1).");
                var op = Next();
                if (op.Text == ":=")
                {
                    if (isEn)
                        throw Err(name, ConflictCodes.NetworkBadExpression,
                            not is null ? "`EN :=` on a box is not network text: the enable follows the box, `f(…) EN c` (B3, P12)."
                                        : "a flag on the EN pin: the enable is the rung itself, and the IDE holds no modifier on it — negate what feeds it.");
                    if (isEno)
                        throw Err(name, ConflictCodes.NetworkBadExpression, "`ENO :=`: ENO is an output — the named ENO pin is `ENO => x` (P5).");
                    var at = Peek();
                    var v = ParseLevel();
                    syn.Inputs.Add(new Input(name.Text, v.Empty ? Mark(new Terminator(Flags.None), op.Offset) : Slot(v, at), pinFlags));
                    return false;
                }
                if (isEn)
                    throw Err(name, ConflictCodes.NetworkBadExpression, "`EN =>`: EN is the enable input, never an output pin (B3).");
                if (AtEnd() || Peek().IsSym(",") || Peek().IsSym(")"))
                    throw Err(name, ConflictCodes.NetworkBadExpression,
                        $"`{name.Text} =>` wired to nothing: a named output pin holds a target, and an unwired one is not written.");
                syn.Outputs.Add((isEno ? Box.EnoPin : name.Text, Target(Next()), false));
                return false;
            }
            if (not is not null) throw Err(not.Value, ConflictCodes.NetworkParse, "NOT before a pin name: `NOT name := v` negates the pin.");

            var start = Peek();
            var value = ParseLevel();
            syn.Inputs.Add(new Input(null, value.Empty ? Mark(new Terminator(Flags.None), value.Start.Offset) : Slot(value, start), Flags.None));
            return true;
        }

        private bool IsPinNameAt(int i) =>
            i < _end && (Raw(i).Kind == TokKind.Word || Raw(i).Kind == TokKind.Backtick) && i + 1 < _end;

        private Tok Target(Tok t)
        {
            if (!IsTargetToken(t) || (t.Kind == TokKind.Word && NetworkSpelling.SplitShape.IsMatch(t.Text)))
                throw Err(t, ConflictCodes.NetworkBadExpression,
                    t.Kind == TokKind.Word && NetworkSpelling.SplitShape.IsMatch(t.Text)
                        ? $"{t.Text} as an output target: a split is defined by its own statement and is never a target (P9)."
                        : $"'{t.Text}' as a target: a target is a variable, a token or text between backticks.");
            return t;
        }

        // ── building nodes ──────────────────────────────────────────────────────────────────────────

        /// <summary>A slot's value parsed from the cursor (<see cref="Slot"/>).</summary>
        private Node SlotHere()
        {
            var at = Peek();
            return Slot(ParseLevel(), at);
        }

        /// <summary>P4: a SLOT's value — a coil's, a split's, a jump's, an EN tail, a pin, a call argument, a branch. It
        /// holds one box unbracketed; only an enabled comparison is bracketed, and it always is.</summary>
        private Node Slot(Syn s, Tok at)
        {
            if (s.Empty) throw Err(at, ConflictCodes.NetworkParse, "a value is expected here.");
            if (s.Bracketed && !s.EnabledComparison)
                throw Err(s.Start, ConflictCodes.NetworkBadExpression,
                    "a redundant bracket: a slot (a coil's value, an EN tail, a pin, a call argument, a branch) holds one box without brackets (B5, P4).");
            if (!s.Bracketed && s.EnabledComparison)
                throw Err(s.Start, ConflictCodes.NetworkBadExpression,
                    "an enabled comparison used as a value stands in brackets, `(a GT 40 EN c)` (B5, P4).");
            return s.Box is { } box ? Finalize(box, Role.Value) : s.Node!;
        }

        /// <summary>P4: an OPERAND of a box word — its inputs, MOVE's operand, a parallel's feed. A box word, a parallel and an
        /// enabled comparison there come bracketed from <see cref="ParseOperand"/>, anything else bare.</summary>
        private Node Operand(Syn s) =>
            s.Box is { } box ? Finalize(box, Role.Value) : s.Node!;

        /// <summary>
        /// A box given its role — the one place a box's slots are decided (the rules the writer refuses against):
        /// read by a later line's ENO → connected by its ENO slot; read by a consumer → connected by its main output, read by
        /// <see cref="NetworkSpelling.MainSlotOfCall"/>; a top-level item → connected by none, its ENO by its EN. Positional
        /// <c>=&gt;</c> pins fill the slots that remain.
        /// </summary>
        private Box Finalize(BoxSyn s, Role role)
        {
            var consumed = role != Role.Top;
            var byEno = role == Role.Eno;
            var isExecute = s.StCode is not null;

            if (role == Role.Value && isExecute)
                throw Err(s.Head, ConflictCodes.NetworkBadExpression, "an EXECUTE box read as a value: its only output is ENO (P8).");
            if (role == Role.Value && s.HadEn && !NetworkSpelling.Comparisons.Contains(s.Type))
                throw Err(s.Head, ConflictCodes.NetworkBadExpression,
                    $"an enabled '{s.Type}' read as a value: an enabled box is the root of its line, its value leaving only through `=>` or ENO (B4, N21) — write `… => t EN c`, or the box on its own line and `coil := ENO;`.");
            if (byEno)
            {
                if (NetworkSpelling.Comparisons.Contains(s.Type))
                    throw Err(s.Head, ConflictCodes.NetworkBadExpression,
                        "a comparison on an open line: a comparison has no ENO — an enabled comparison is a bracketed value, `(a GT 40 EN c)` (B4, P3, N21).");
                if (!s.HadEn && !isExecute && (NetworkSpelling.OperatorWords.Contains(s.Type) || s.OperatorCall ||
                                               string.Equals(s.Type, NetworkSpelling.Move, StringComparison.OrdinalIgnoreCase)))
                    throw Err(s.Head, ConflictCodes.NetworkBadExpression,
                        $"{s.Type.ToUpperInvariant()} without EN on an open line: an operator box shows ENO only with EN (N21) — end the line with `;` (P3).");
                if (!s.Flags.IsNone)
                    throw Err(s.Head, ConflictCodes.NetworkBadExpression,
                        "a modifier on an open line: the box a later line reads carries its modifier at the ENO there, `x := NOT ENO;` (P3).");
            }

            Box box;
            if (isExecute)
            {
                box = new Box(NetworkSpelling.ExecuteType, null, NetworkSpelling.KindOf(NetworkSpelling.ExecuteType, false),
                    new List<Input>(), new List<Output>(), s.Enable, s.StCode, s.Flags);
                if (byEno) box = box with { ConnectedSlot = NetworkSpelling.EnoSlot(box) };
                return Mark(box, s.Head.Offset);
            }

            if (s.Named is { } nm)
            {
                if (!consumed || byEno)
                    throw Err(nm, ConflictCodes.NetworkBadExpression,
                        $"`.{nm.Text}` on '{s.Head.Text}', which no consumer reads by its data: a top-level box's output goes nowhere.");
                if (NetworkSpelling.MainSlotOfCall(s.Type) is null)
                    throw Err(nm, ConflictCodes.NetworkBadExpression,
                        $"`.{nm.Text}` on a {s.Type.ToUpperInvariant()} box: a bit operator stores no main output to read by name.");
            }

            var hasEno = NetworkSpelling.TextHasEno(isExecute: false, s.HadEn, byEno, consumed);
            if (!hasEno && s.Outputs.Any(o => o.Formal == Box.EnoPin))
                throw Err(s.Head, ConflictCodes.NetworkBadExpression,
                    $"`ENO =>` on a '{s.Type}' box that has no ENO: a box shows ENO with EN, or where a later line reads it (P5).");
            var enoSlot = NetworkSpelling.EnoSlot(isExecute: false, hasEnoOutput: hasEno);
            int? connected = byEno ? enoSlot : s.Named is not null ? null
                : !consumed ? null
                : NetworkSpelling.MainSlotOfCall(s.Type) is { } main ? main
                : Box.BitOperatorSlot(s.Outputs.Any(o => !o.Positional) ? 1 : 0);
            var next = 0;
            var built = new List<Output>();
            foreach (var (formal, target, positional) in s.Outputs)
            {
                if (!positional) { built.Add(new Output(formal, new Operand(LValueText(target!.Value), IsLValue: true), null)); continue; }
                var slot = NetworkSpelling.NextFreeSlot(next, enoSlot, connected);
                next = slot + 1;
                if (target is { } tt) built.Add(new Output(null, new Operand(LValueText(tt), IsLValue: true), slot));
            }

            box = new Box(s.Type, s.Instance, NetworkSpelling.KindOf(s.Type, s.Instance is not null), s.Inputs, built, s.Enable, null,
                s.Flags, MainOutputIndex: consumed && !byEno ? connected : null, ConnectedSlot: connected,
                MainOutputName: s.Named?.Text);
            box = box with { HasEnoOutput = NetworkSpelling.EnoCarried(box, consumed) ? hasEno : null };

            if (s.OperatorCall && NetworkSpelling.TwoInputOperators.Contains(s.Type) && s.Inputs.Count > 2)
                throw Err(s.Head, ConflictCodes.NetworkUnsupported,
                    $"{s.Type.ToUpperInvariant()} takes 2 inputs, and this one holds {s.Inputs.Count}: the build refuses it (C3, B1).");
            // P5: an operator's call form only where its word form cannot carry the tree — one tree, one text.
            if (s.OperatorCall && NetworkSpelling.IsWordForm(box))
                throw Err(s.Head, ConflictCodes.NetworkBadExpression,
                    $"{s.Type}(…) in its call form where its word fits: write `a {s.Type.ToUpperInvariant()} b` (B1, P5).");
            if (s.OperatorCall && NetworkSpelling.IsMoveWordForm(box))
                throw Err(s.Head, ConflictCodes.NetworkBadExpression, "MOVE(…) in its call form where its word fits: write `MOVE b => a` (B2, P5).");
            return Mark(box, s.Head.Offset);
        }

        /// <summary>An assignment or <c>=&gt;</c> target's text: a token or backticked text. A reserved word is backticked
        /// (P1), a split is never a target (P9).</summary>
        private string LValueText(Tok t)
        {
            switch (t.Kind)
            {
                case TokKind.Word:
                    if (NetworkSpelling.SplitShape.IsMatch(t.Text))
                        throw Err(t, ConflictCodes.NetworkBadExpression,
                            $"{t.Text} as a coil target: a split is defined by `{t.Text} := value;` and is never a coil's or a pin's target (P9).");
                    if (NetworkSpelling.IsReserved(t.Text))
                        throw Err(t, ConflictCodes.NetworkBadExpression,
                            $"'{t.Text}' as a target: a target spelled like a word of the text is written between backticks (P1).");
                    return t.Text;
                case TokKind.Backtick:
                    // A literal is no target token, so a target holding one has no spelling but this (the vendor's text).
                    return t.Text;
                case TokKind.Unnamed:
                case TokKind.Address:
                    return t.Text;
                default:
                    throw Err(t, ConflictCodes.NetworkBadExpression,
                        $"'{t.Text}' as a target: a target is a variable, a token or text between backticks.");
            }
        }

        private ParseError OldEno(Tok dot) =>
            Err(dot, ConflictCodes.NetworkParse,
                "`.ENO` is not network text: write the box on its own line without `;`, and read its ENO on a later line with the word ENO (B4, P12).");

        /// <summary>P12: ST's operator symbols are not network text — refused BY NAME with the word that replaces them. Asked
        /// of the token at the cursor.</summary>
        private ParseError? OldSymbol(Tok t)
        {
            if (t.Kind != TokKind.Sym) return null;
            if (t.Text == "{")
                return Err(t, ConflictCodes.NetworkParse,
                    "the member pragma `{Member := value}` is not network text: a member is derived on push, and written only where it differs, in a natural spelling (B7, P12).");
            string? word = t.Text switch
            {
                "+" => "ADD", "-" => "SUB", "*" => "MUL", "/" => "DIV", ">" => "GT", "<" => "LT", ">=" => "GE",
                "<=" => "LE", "=" => "EQ", "<>" => "NE", _ => null,
            };
            // A symbol outside the table — an ASCII punctuation mark in operator position (`^`, `&`, `|`), never a
            // structural one, and never a character outside ASCII, which is no symbol of the text at all (NETWORK_PARSE).
            if (word is null)
                return t.Text is "(" or ")" or "," or ";" or ":" or ":=" or "=>" or "." || t.Text.Any(c => c > '\u007f' || char.IsLetterOrDigit(c)) ? null
                    : Err(t, ConflictCodes.NetworkUnknownOperator,
                        $"'{t.Text}' is no operator of network text: a box is its name — the words are AND OR XOR ADD SUB MUL DIV MOD GT GE EQ NE LE LT MOVE, and every other box is a call, `f(a, b)` (B1, P5).");
            if (t.Text is "-" or "+" && Raw(_p + 1).Kind == TokKind.Number)
                return Err(t, ConflictCodes.NetworkBadExpression,
                    $"'{t.Text} {Raw(_p + 1).Text}': a negative literal is the minus touching its digit, -1, and a '+' sign is not written (P12).");
            if (t.Text == "-" && Raw(_p + 1).Kind == TokKind.Word && Raw(_p + 1).Offset == t.Offset + 1)
                return Err(t, ConflictCodes.NetworkBadExpression,
                    $"'-{Raw(_p + 1).Text}': a negation of a value is a box, `0 SUB {Raw(_p + 1).Text}` (P12).");
            return Err(t, ConflictCodes.NetworkBadExpression,
                $"'{t.Text}' is not network text: a box is its name — write {word} (`a {word} b`, B1, P12).");
        }

        // ── tokens ──────────────────────────────────────────────────────────────────────────────────

        /// <summary>The token at <paramref name="i"/>, whatever line it is on.</summary>
        private Tok Raw(int i) => i < _toks.Count ? _toks[i] : _toks[_toks.Count - 1];

        private bool AtEnd() => _p >= _end;

        /// <summary>The next token of the CURRENT LINE: past its end, a synthetic end token at the next token's offset.</summary>
        private Tok Peek() => PeekAt(0);

        private Tok PeekAt(int k)
        {
            var i = _p + k;
            if (i >= _end)
            {
                var prev = _end > 0 ? Raw(_end - 1) : Raw(0);
                return new Tok(TokKind.Eof, "", prev.Offset + prev.Length, 0, false);
            }
            return Raw(i);
        }

        private Tok Next()
        {
            var t = Peek();
            if (t.Kind == TokKind.Error) throw Err(t, t.Code!, t.Text);
            if (_p < _end) _p++;
            return t;
        }

        private void ExpectSym(string sym, string form)
        {
            var t = Peek();
            if (!t.IsSym(sym))
                throw Err(t, ConflictCodes.NetworkParse, t.Kind == TokKind.Eof
                    ? $"the line ends where `{sym}` is expected ({form})."
                    : $"expected `{sym}` and found '{t.Text}' ({form}).");
            Next();
        }

        private void ExpectOnLine(string sym, int line, string form)
        {
            var t = Raw(_p);
            if (Line(t) != line) throw Err(t, ConflictCodes.NetworkParse, $"the NETWORK header ends at its newline; `{form}` is on one line.");
            ExpectSym(sym, form);
        }

        private int Line(Tok t) => _lx!.LineOf(t.Offset);

        private ParseError Err(Tok t, string code, string message) =>
            new(code, message, t.Offset, Math.Max(1, t.Length));

        private NetworkTextDiagnostic Diag(string code, string message, int offset, int length)
        {
            var (line, col) = (_lx ?? new NetworkLexer(_text, 0)).LineCol(Math.Min(offset, Math.Max(0, _text.Length)));
            return new NetworkTextDiagnostic(code, message, line, col, length);
        }
    }
}

/// <summary>One finding against a network-text body: a <c>NETWORK_*</c> code (<see cref="ConflictCodes"/>), a
/// message that names what was found, and the 1-based span it was found at.</summary>
public sealed record NetworkTextDiagnostic(string Code, string Message, int Line, int Column, int Length);

/// <summary>What <see cref="NetworkTextReader.Read"/> returns: the model when the text is valid, else null,
/// and every diagnostic found.</summary>
public sealed record NetworkReadResult(NetworkBody? Body, IReadOnlyList<NetworkTextDiagnostic> Diagnostics)
{
    public bool Ok => Body is not null && Diagnostics.Count == 0;
}
