using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;

namespace Volt.Engine.Format.Network;

/// <summary>
/// Network text v2.1 (openspec <c>ld-fbd-coverage</c> 2R.6b, <c>v2-spec.md</c>): reads a body back into a
/// <see cref="NetworkBody"/>, the inverse of <see cref="NetworkTextWriter"/> — RECURSIVE DESCENT over the grammar, each node
/// built once where it is read, whether something consumes it passed down from its parent. It accepts the token sequences
/// the writer produces in any layout that passes the one indentation check (a continuation line of an item is indented
/// deeper than the item's first line; a line that is not ends the item — "missing `;`?").
///
/// <para><b>Bad input is a diagnostic, never an exception.</b> Every finding carries a <c>NETWORK_*</c> code and a span, and
/// a failed network does not hide the next one's findings. The checks over the model that no spelling decides are the
/// shared validator's (<see cref="NetworkValidator"/>), reported at the node it names. What the text cannot know — whether
/// a declaration names an instance, and its type — it takes from the declarations (<see cref="NetworkScope"/>).</para>
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

    internal sealed class ByIdentity : IEqualityComparer<Node>
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

    /// <summary>A box as read, before the consumer it stands in decides its connection.</summary>
    private sealed class BoxSyn
    {
        public string Type = "";
        public Operand? Instance;
        public bool OperatorCall;
        public bool IsCall;
        public List<Input> Inputs = new();
        /// <summary>Data outputs in text order; a positional one (no formal) fills the next free slot, a bare <c>=&gt;</c>
        /// (no target) passes one over.</summary>
        public List<(string? Formal, Tok? Target)> Outputs = new();
        public bool EnoShown;
        public Tok? EnoTarget;
        public Node? Enable;
        public Flags EnableFlags = Flags.None;
        public Tok? Named;
        public string? StCode;
        public Flags Flags = Flags.None;
        public Tok Head;
        /// <summary>Where the box's text starts, when not at its head: a word box at its first operand.</summary>
        public Tok? Start;
    }

    /// <summary>A value as read: a built node, or a call whose consumer decides its connection.</summary>
    private sealed class Syn
    {
        public Node? Node;
        public BoxSyn? Call;
        public Tok Start;
        public bool Empty;
        public bool Bracketed;
    }

    private sealed class Parser
    {
        private readonly string _text;
        private readonly NetworkScope _scope;
        private NetworkLexer? _lx;
        private List<Tok> _toks = new();
        private int _p;
        // The item being read: its first token and that token's column — a later token starting a line at or left of it
        // ends the item (the one indentation check).
        private int _itemStart = -1;
        private int _itemColumn;

        public readonly List<NetworkTextDiagnostic> Diagnostics = new();
        public readonly Dictionary<Node, (int Offset, int Length)> Spans = new(ByIdentity.Instance);
        public readonly List<Tok> Headers = new();
        public NetworkLexer? Lexer => _lx;

        public Parser(string text, NetworkScope scope)
        {
            _text = text;
            _scope = scope;
        }

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
                if (St.ImplementationMarker.Stated(first) is { } stated)
                    message = $"the body states '{first.Trim()}' — a network-text body opens with IMPLEMENTATION FBD or " +
                              "IMPLEMENTATION LD" + (stated.Length == 0 ? "; this line states no language." : ".");
                else
                    message = "a graphical body opens with the line stating its language, IMPLEMENTATION FBD or " +
                              "IMPLEMENTATION LD, on its first line.";
                Diagnostics.Add(Diag(ConflictCodes.NetworkParse, message, start, Math.Max(1, first.Length)));
                return null;
            }

            var language = NetworkText.LanguageNamed(marked)
                           ?? throw new VoltInvariantException($"the line states '{marked}', which is no body language.");
            _lx = new NetworkLexer(_text, eol);

            _toks = _lx.Tokenize();
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
            return new NetworkBody(language, networks);
        }

        /// <summary>After an error: skip to the end of the network it is in, so the next one is still read.</summary>
        private void Recover()
        {
            _itemStart = -1;
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
            _itemStart = -1;
            var hdr = Next();
            Headers.Add(hdr);
            var hdrLine = Line(hdr);
            string? label = null, title = null;
            var disabled = false;
            var stage = 0;   // LABEL, DISABLED, TITLE — in that order

            void Order(Tok t, int at, string what)
            {
                if (stage >= at)
                    throw Err(t, ConflictCodes.NetworkParse,
                        stage == at ? $"a NETWORK header carries {what} twice."
                            : "the NETWORK header is NETWORK [LABEL: x] [DISABLED] [TITLE: \"…\"], in that order.");
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
                        throw Err(s, ConflictCodes.NetworkParse, "`TITLE: \"\"`: a network with no title has no TITLE.");
                }
                else
                    throw Err(t, ConflictCodes.NetworkParse,
                        $"'{t.Text}' in a NETWORK header: the header is NETWORK [LABEL: x] [DISABLED] [TITLE: \"…\"], and it ends at its newline.");
            }

            // The network's comment: the `//` lines between the header and the first item, joined as the IDE stores them.
            var comment = new List<string>();
            while (Raw(_p).Kind == TokKind.Comment) comment.Add(Next().Text);
            if (Raw(_p).Kind == TokKind.Error) throw Err(Raw(_p), Raw(_p).Code!, Raw(_p).Text);

            var trees = new List<Node>();
            string? unsupported = null, hash = null;
            while (true)
            {
                _itemStart = -1;
                var t = Raw(_p);
                if (t.Is("END_NETWORK") || t.Kind == TokKind.Eof || (t.Is("NETWORK") && t.AtLineStart))
                {
                    if (!t.Is("END_NETWORK")) throw Err(hdr, ConflictCodes.NetworkNotClosed, "this NETWORK has no END_NETWORK.");
                    _p++;
                    break;
                }
                if (t.Kind == TokKind.Comment)
                    throw Err(t, ConflictCodes.NetworkParse,
                        "a // comment after an item: the network's one comment is the // lines between its header and its " +
                        "first item, and NWL has no per-item comment to move this one to.");

                if (t.Is(NetworkSpelling.UnsupportedWord))
                {
                    _p++;
                    if (trees.Count > 0)
                        throw Err(t, ConflictCodes.NetworkUnsupported,
                            "an UNSUPPORTED line beside other items: it stands for the whole network's content, and is its network's only line.");
                    var shape = Next();
                    if (shape.Kind != TokKind.DString || !NetworkSpelling.UnsupportedShape.IsMatch(shape.Text.Substring(1, shape.Text.Length - 2)))
                        throw Err(shape, ConflictCodes.NetworkParse,
                            "an UNSUPPORTED line names the shape Volt cannot show, as a quoted phrase, and its hash: UNSUPPORTED \"a flag on a box input pin\" #3f9a01c2;");
                    var h = Next();
                    if (h.Kind != TokKind.Hash || !NetworkSpelling.UnsupportedHash.IsMatch(h.Text))
                        throw Err(h, ConflictCodes.NetworkParse,
                            "an UNSUPPORTED line ends with the network's hash, `#` and 8 lower-case hex digits: UNSUPPORTED \"<shape>\" #3f9a01c2;");
                    ExpectSym(";", "UNSUPPORTED \"<shape>\" #<hash>;");
                    if (!Raw(_p).Is("END_NETWORK"))
                        throw Err(Raw(_p), ConflictCodes.NetworkUnsupported,
                            "an item after an UNSUPPORTED line: the line stands for the whole network's content, and is its network's only line.");
                    unsupported = shape.Text.Substring(1, shape.Text.Length - 2);
                    hash = h.Text;
                    continue;
                }

                trees.Add(ParseItem());
            }

            var network = new Network(index, title, label, comment.Count > 0 ? string.Join("\r\n", comment) : null, disabled, trees,
                unsupported, hash);
            // The checks over the model no spelling decides — reported at the node they name. The network is read to its
            // END_NETWORK already, so the next one is read on.
            if (NetworkValidator.Check(network) is { } finding)
            {
                var (offset, length) = finding.At is not null && Spans.TryGetValue(finding.At, out var span) ? span : (hdr.Offset, hdr.Length);
                Diagnostics.Add(Diag(finding.Code, finding.Reason + ": " + finding.Detail, offset, length));
                return null;
            }
            return network;
        }

        // ── items ───────────────────────────────────────────────────────────────────────────────────

        /// <summary>One item: <c>[top] ;</c> — a coil list and its value, a split's definition, or a value.</summary>
        private Node ParseItem()
        {
            var first = Raw(_p);
            _itemStart = _p;
            _itemColumn = Column(first);
            try
            {
                if (first.IsSym(";")) { Next(); return Mark(new Terminator(Flags.None), first.Offset); }
                if (first.IsSym("(") && (CoilAt(_p + 1) || SplitDefinitionAt(_p + 1)))
                    throw Err(first, ConflictCodes.NetworkBadExpression,
                        "a redundant bracket: an item's own assignment or split is not bracketed, `x := a;` — a nested one is, `y := (x := a);`.");
                Node node;
                if (CoilAt(_p)) node = ParseAssign(first);
                else if (SplitDefinitionAt(_p)) node = ParseSplitDefinition();
                else node = Slot(consumed: false, first);
                var end = Peek();
                if (!end.IsSym(";")) throw Unexpected(end, "an item ends with `;`");
                Next();
                return node;
            }
            finally { _itemStart = -1; }
        }

        /// <summary>A COIL starts at <paramref name="i"/>: <c>[R_EDGE|F_EDGE] [NOT] head</c> and its storage, <c>:=</c>,
        /// <c>S=</c> or <c>R=</c>; the head a target, <c>JMP label</c> or <c>RETURN</c>.</summary>
        private bool CoilAt(int i)
        {
            var k = i - _p;
            if (PeekAt(k).Is("R_EDGE") || PeekAt(k).Is("F_EDGE")) k++;
            if (PeekAt(k).Is("NOT")) k++;
            var t = PeekAt(k);
            if (t.Is("JMP")) k += 2;
            else if (t.Is("RETURN")) k += 1;
            else if (IsTargetToken(t) || (IsSplitWord(t) && !PeekAt(k + 1).IsSym(":="))) k += 1;   // a split as a coil: refused by name
            else return false;
            return IsStorage(PeekAt(k));
        }

        private static bool IsSplitWord(Tok t) => t.Kind == TokKind.Word && NetworkSpelling.SplitShape.IsMatch(t.Text);

        private static bool IsStorage(Tok t) => t.IsSym(":=") || t.IsSym("S=") || t.IsSym("R=");

        private bool SplitDefinitionAt(int i) =>
            PeekAt(i - _p) is var t && t.Kind == TokKind.Word && NetworkSpelling.SplitShape.IsMatch(t.Text) && PeekAt(i - _p + 1).IsSym(":=");

        private static bool IsTargetToken(Tok t) =>
            t.Kind is TokKind.Backtick or TokKind.Unnamed or TokKind.Address ||
            (t.Kind == TokKind.Word && !NetworkSpelling.IsReserved(t.Text));

        /// <summary><c>coil coil … value</c> — ONE vendor Assign, its targets in order, the value after the last.</summary>
        private Node ParseAssign(Tok first)
        {
            var targets = new List<Operand>();
            while (CoilAt(_p)) targets.Add(ParseCoil());
            var value = CoilValue();
            return Mark(new Assign(value, targets, Flags.None.WithControlFlowFrom(targets)), first.Offset);
        }

        /// <summary>A coil's or a split's value: nothing (the empty terminator) where the item or bracket ends.</summary>
        private Node CoilValue()
        {
            var t = Peek();
            if (t.IsSym(";") || t.IsSym(")") || t.Kind == TokKind.Eof) return Mark(new Terminator(Flags.None), t.Offset);
            return Slot(consumed: true, t);
        }

        private Operand ParseCoil()
        {
            var start = Peek();
            var mods = Flags.None;
            if (Peek().Is("R_EDGE") || Peek().Is("F_EDGE")) mods = Next().Is("R_EDGE") ? mods with { Rising = true } : mods with { Falling = true };
            if (Peek().Is("NOT")) { Next(); mods = mods with { Negated = true }; }
            Operand target;
            var h = Next();
            if (h.Is("JMP"))
            {
                var l = Next();
                if (l.Kind != TokKind.Word || !NetworkSpelling.Identifier.IsMatch(l.Text))
                    throw Err(l, ConflictCodes.NetworkBadExpression, "JMP takes one label, an identifier.");
                target = new Operand(l.Text, IsLValue: true, Flags: Flags.None with { Jump = true });
            }
            else if (h.Is("RETURN")) target = new Operand(Box.UnnamedInstance, IsLValue: true, Flags: Flags.None with { Return = true });
            else target = new Operand(TargetText(h), IsLValue: true);

            var op = Next();
            var storage = op.Text switch
            {
                "S=" => Flags.None with { Set = true },
                "R=" => Flags.None with { Reset = true },
                _ => Flags.None,
            };
            // The vendor spells a coil kind with two bits, Negation and Set (Flags.CoilFromVendor): a negated set coil IS the
            // reset coil, and a negated reset coil none it holds apart from it.
            if (mods.Negated && storage.Set)
                throw Err(start, ConflictCodes.NetworkBadExpression,
                    $"`NOT {target.Text} S=`: the IDE stores a negated set coil as the reset coil — write `{target.Text} R= …`.");
            if (mods.Negated && storage.Reset)
                throw Err(start, ConflictCodes.NetworkBadExpression,
                    $"`NOT {target.Text} R=`: a negated reset coil is no coil the IDE stores apart from the reset coil.");
            var f = (target.Flags ?? Flags.None) with
            {
                Negated = mods.Negated, Rising = mods.Rising, Falling = mods.Falling, Set = storage.Set, Reset = storage.Reset,
            };
            return target with { Flags = f.IsNone ? null : f };
        }

        /// <summary><c>split&lt;n&gt; := value</c> — the split's one definition.</summary>
        private Node ParseSplitDefinition()
        {
            var name = Next();
            var id = SplitId(name);
            Next();   // :=
            var value = CoilValue();
            return Mark(new Demux(id, value), name.Offset);
        }

        private int SplitId(Tok name)
        {
            var digits = name.Text.Substring(NetworkSpelling.SplitPrefix.Length);
            if (digits.Length > 1 && digits[0] == '0')
                throw Err(name, ConflictCodes.NetworkBadExpression, $"the split {name.Text}: its number is the VarId, with no leading zeros.");
            if (!int.TryParse(digits, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var id))
                throw Err(name, ConflictCodes.NetworkBadExpression, $"the split {name.Text} carries a VarId out of range.");
            return id;
        }

        // ── values ──────────────────────────────────────────────────────────────────────────────────

        /// <summary>
        /// A SLOT — a coil's or a split's value, a pin, an EN source, a branch: a box (its word, MOVE, a call or an
        /// EXECUTE, each with its outputs and pin state), a parallel, a term, or a bracketed assignment or split. A bracket
        /// around anything else is redundant: no tree prints it.
        /// </summary>
        private Node Slot(bool consumed, Tok at)
        {
            var s = Compound(consumed);
            if (s.Empty)
                throw at.Is("ENO") || at.Is("EN") || at.IsSym("=>") || at.Is(NetworkSpelling.ShortCircuitWord)
                    ? Unexpected(at, "a value is expected here")
                    : Err(at, ConflictCodes.NetworkParse, "a value is expected here.");
            if (s.Bracketed && s.Node is not Assign && s.Node is not Demux { Input: not null })
                throw Err(s.Start, ConflictCodes.NetworkBadExpression,
                    "a redundant bracket: brackets mark a compound as another word's operand, after a modifier, or a nested assignment — a slot holds one box bare.");
            return Built(s, consumed);
        }

        /// <summary>What a slot or a bracket holds — <see cref="Slot"/> without its bracket rule.</summary>
        private Syn Compound(bool consumed)
        {
            var start = Peek();
            if (start.Is(NetworkSpelling.BranchWord)) return new Syn { Node = ParseParallel(null, start), Start = start };
            if (start.Is(NetworkSpelling.Move)) return new Syn { Node = ParseMove(consumed), Start = start };
            if (start.Is("EXECUTE")) return new Syn { Node = ParseExecute(consumed), Start = start };

            var first = Operand();
            var t = Peek();
            if (IsWord(t)) return new Syn { Node = ParseWordBox(first, consumed), Start = first.Empty ? t : first.Start };
            if (t.Is(NetworkSpelling.BranchWord))
            {
                if (first.Empty) throw Err(t, ConflictCodes.NetworkParse, "BRANCH with an empty feed before it: an unfed parallel is `BRANCH (a, b)` alone.");
                var feed = Built(first, consumed: true);
                return new Syn { Node = ParseParallel(feed, first.Start), Start = first.Start };
            }
            if (first.Call is { } call && !first.Bracketed && call.Flags.IsNone)
            {
                PinState(call);
                return new Syn { Node = Finalize(call, consumed), Start = first.Start };
            }
            return first;
        }

        private Node Built(Syn s, bool consumed) => s.Call is { } c ? Finalize(c, consumed) : s.Node!;

        private static bool IsWord(Tok t) => t.Kind == TokKind.Word && NetworkSpelling.OperatorWords.Contains(t.Text);

        /// <summary>Whether <paramref name="t"/> ends an operand: nothing of a value stands there.</summary>
        private static bool EndsOperand(Tok t) =>
            t.Kind == TokKind.Eof || t.IsSym(";") || t.IsSym(",") || t.IsSym(")") || t.IsSym("=>") || IsWord(t) ||
            t.Is(NetworkSpelling.BranchWord) || t.Is(NetworkSpelling.ShortCircuitWord) || t.Is("ENO") || t.Is("EN") ||
            t.Kind == TokKind.Snippet || t.Is("END_EXECUTE");

        /// <summary>
        /// An OPERAND — a word's input, MOVE's, a parallel's feed, a positional pin: a term (a leaf, a call with no pin
        /// state, a split, <c>[mods] x</c>, <c>mods (box)</c>, the negated empty slot <c>NOT</c>), a bracketed compound, or
        /// nothing.
        /// </summary>
        private Syn Operand()
        {
            var t = Peek();
            if (EndsOperand(t)) return new Syn { Empty = true, Start = t };

            if (t.Is("NOT") || t.Is("R_EDGE") || t.Is("F_EDGE"))
            {
                var (mods, count) = ModifiersAt(_p);
                var after = PeekAt(count);
                if (after.Is("EN")) return new Syn { Empty = true, Start = t };   // the EN pin's own modifier
                for (var k = 0; k < count; k++) Next();
                if (EndsOperand(after))
                    return new Syn { Node = Mark(new Terminator(mods), t.Offset), Start = t };
                if (after.Is("NOT") || after.Is("R_EDGE") || after.Is("F_EDGE"))
                    throw Err(after, ConflictCodes.NetworkBadExpression,
                        "a modifier after a modifier: a node carries one edge and one negation, `R_EDGE NOT x` — the edge first.");
                if (after.IsSym("("))
                {
                    var inner = Bracket();
                    if (inner.Node is Parallel)
                        throw Err(t, ConflictCodes.NetworkUnsupported, "a modifier on a parallel: the IDE holds no flag on a parallel (N20).");
                    if (inner.Node is Assign or Demux)
                        throw Err(t, ConflictCodes.NetworkUnsupported, "a modifier on an assignment or a split: the IDE holds no flag on either (N20, census 1.1).");
                    if (inner.Node is not Box b)
                        throw Err(inner.Start, ConflictCodes.NetworkBadExpression,
                            "a redundant bracket: after a modifier a box is bracketed, and a single operand or a call is not — `NOT x`, `NOT f(a)`.");
                    if (!b.Flags.IsNone)
                        throw Err(inner.Start, ConflictCodes.NetworkBadExpression,
                            "a modifier after a modifier: a node carries one edge and one negation, `R_EDGE NOT x` — the edge first.");
                    return new Syn { Node = Mark(b with { Flags = mods }, t.Offset), Start = t };
                }
                var core = Operand();
                if (core.Node is Demux)
                    throw Err(t, ConflictCodes.NetworkUnsupported, "a modifier on a split: the IDE holds no flag on a split (N20) — put it on its feeder or a consumer.");
                if (core.Call is { } call)
                {
                    call.Flags = mods;
                    if (Peek().Is("ENO") || Peek().Is("EN") || ModifiersAt(_p) is var (_, n) && n > 0 && PeekAt(n).Is("EN"))
                        throw Err(Peek(), ConflictCodes.NetworkBadExpression,
                            "a pin state after a modified call: a box with EN or ENO after a modifier is bracketed, `NOT (f(a) EN c)`.");
                    return new Syn { Call = call, Start = t };
                }
                if (core.Node is Leaf l) return new Syn { Node = Mark(l with { Flags = mods }, t.Offset), Start = t };
                throw Err(t, ConflictCodes.NetworkBadExpression, "a modifier stands before an operand, a call or a bracketed box.");
            }

            if (t.IsSym("(")) return Bracket();

            switch (t.Kind)
            {
                case TokKind.Word:
                    if (NetworkSpelling.SplitShape.IsMatch(t.Text))
                    {
                        Next();
                        if (Peek().IsSym("(")) throw Err(t, ConflictCodes.NetworkBadExpression, $"{t.Text} is a split, never a call head.");
                        if (Peek().IsSym(":="))
                            throw Err(t, ConflictCodes.NetworkBadExpression, $"a split defined where a value stands is bracketed, `({t.Text} := value)`.");
                        if (Peek().IsSym(":"))
                            throw Err(Peek(), ConflictCodes.NetworkBadExpression,
                                $"a type on the split {t.Text}: a split's type is its feeder's and is never written — `{t.Text} := value;`.");
                        return new Syn { Node = Mark(new Demux(SplitId(t), null), t.Offset), Start = t };
                    }
                    if (t.Is("JMP") || t.Is("RETURN"))
                        throw Err(t, ConflictCodes.NetworkBadExpression,
                            "a jump or a return is a coil, its value after it: `JMP l := c;`, `RETURN := ;` (C11).");
                    if (t.Is(NetworkSpelling.Move) || t.Is("EXECUTE"))
                        throw Err(t, ConflictCodes.NetworkBadExpression,
                            $"{t.Text.ToUpperInvariant()} as an operand: a box that is another word's operand stands in brackets, `x AND ({t.Text.ToUpperInvariant()} …)`.");
                    if (NetworkSpelling.IsReserved(t.Text))
                        throw Err(t, ConflictCodes.NetworkBadExpression,
                            $"'{t.Text}' at operand position: a name spelled like a word of the text is written between backticks, `{t.Text}`.");
                    Next();
                    if (Peek().IsSym("(") || Peek().IsSym(":")) return Call(t);
                    if (Peek().IsSym(".") && PeekAt(1).Is("ENO")) throw OldEno(Peek());
                    return LeafOf(t);

                case TokKind.Backtick:
                    Next();
                    if (Peek().IsSym("(") || Peek().IsSym(":")) return Call(t);
                    if (NetworkSpelling.IsLiteral(t.Text))
                        throw Err(t, ConflictCodes.NetworkBadExpression, $"a literal between backticks: write it bare, {t.Text}.");
                    return LeafOf(t);

                case TokKind.Unnamed:
                    Next();
                    if (Peek().IsSym(":")) return Call(t);
                    if (Peek().IsSym("("))
                        throw Err(t, ConflictCodes.NetworkBadExpression, "??? is no call head; an unnamed instance is written `??? : TYPE(…)`.");
                    return LeafOf(t);

                case TokKind.Number:
                case TokKind.Typed:
                case TokKind.Address:
                case TokKind.SString:
                case TokKind.DString:
                    Next();
                    if (Peek().IsSym("(")) throw Err(t, ConflictCodes.NetworkBadExpression, $"'{t.Text}' is a literal and no call head.");
                    return LeafOf(t);

                case TokKind.Error:
                    throw Err(t, t.Code!, t.Text);

                default:
                    if (OldSymbol(t) is { } old) throw old;
                    throw Err(t, ConflictCodes.NetworkParse, t.Kind == TokKind.Eof
                        ? "the item ends here: a value is expected."
                        : $"'{t.Text}' where a value is expected: an operand that is not one token is written between backticks.");
            }
        }

        /// <summary><c>( compound )</c> as an operand: a box with its outputs and pin state, a parallel, an assignment or a
        /// split. A term in brackets — a leaf, a call with no pin state — is redundant.</summary>
        private Syn Bracket()
        {
            var open = Next();
            if (CoilAt(_p) || SplitDefinitionAt(_p))
            {
                var nested = CoilAt(_p) ? ParseAssign(Peek()) : ParseSplitDefinition();
                ExpectClose(open, "an assignment's bracket `(t := value)` closes after its value");
                return new Syn { Node = nested, Start = open, Bracketed = true };
            }
            var inner = Compound(consumed: true);
            if (inner.Empty) throw Err(open, ConflictCodes.NetworkParse, "an empty bracket: a value is expected in it.");
            ExpectClose(open, "a bracket closes after the compound it holds");
            if (inner.Call is not null || inner.Node is Leaf or Terminator or Demux { Input: null } || inner.Bracketed)
                throw Err(open, ConflictCodes.NetworkBadExpression,
                    "a redundant bracket: brackets hold a box (a word, MOVE, an EXECUTE, a call with EN or ENO), a parallel, an assignment or a split — nothing else.");
            if (inner.Node is Box b && IsPlainCall(b))
                throw Err(open, ConflictCodes.NetworkBadExpression,
                    "a redundant bracket: a call carries its own brackets, `x AND f(a)` — only a call with EN or ENO is bracketed as an operand.");
            return new Syn { Node = inner.Node, Start = open, Bracketed = true };
        }

        private static bool IsPlainCall(Box b) => b.StCode is null && b.Enable is null && !IsWordSpelled(b);

        private static bool IsWordSpelled(Box b) => NetworkTextWriter.IsWordOrMoveForm(b);

        private Syn LeafOf(Tok t) => new() { Node = Mark(new Leaf(new Operand(t.Text), Flags.None), t.Offset), Start = t };

        /// <summary>A pin's, a coil's or a value's modifiers at <paramref name="i"/> — <c>[R_EDGE|F_EDGE] [NOT]</c> — and how
        /// many tokens they take.</summary>
        private (Flags Flags, int Count) ModifiersAt(int i)
        {
            var f = Flags.None;
            var k = i - _p;
            if (PeekAt(k).Is("R_EDGE") || PeekAt(k).Is("F_EDGE"))
            {
                f = PeekAt(k).Is("R_EDGE") ? f with { Rising = true } : f with { Falling = true };
                k++;
            }
            if (PeekAt(k).Is("NOT")) { f = f with { Negated = true }; k++; }
            return (f, k - (i - _p));
        }

        // ── boxes ───────────────────────────────────────────────────────────────────────────────────

        /// <summary><c>opnd WORD opnd { WORD opnd } { =&gt; v }</c> and its pin state — one word, one box.</summary>
        private Node ParseWordBox(Syn first, bool consumed)
        {
            var w = Peek();
            var syn = new BoxSyn { Type = w.Text, Head = w, Start = first.Empty ? null : first.Start };
            syn.Inputs.Add(new Input(null, OperandNode(first, w), Flags.None));
            while (IsWord(Peek()))
            {
                var next = Next();
                if (!string.Equals(next.Text, syn.Type, StringComparison.OrdinalIgnoreCase))
                    throw Err(next, ConflictCodes.NetworkBadExpression,
                        $"'{syn.Type.ToUpperInvariant()}' and '{next.Text.ToUpperInvariant()}' at one level: one word is one box, so brackets separate boxes — `a {syn.Type.ToUpperInvariant()} (b {next.Text.ToUpperInvariant()} c)`.");
                syn.Inputs.Add(new Input(null, OperandNode(Operand(), next), Flags.None));
            }
            if (Peek().Is(NetworkSpelling.BranchWord))
                throw Err(Peek(), ConflictCodes.NetworkBadExpression, "BRANCH after a box word: a feed that is a box word is bracketed, `(a AND b) BRANCH (x, y)`.");
            if (Peek().Is(NetworkSpelling.Move) || Peek().Is("EXECUTE"))
                throw Err(Peek(), ConflictCodes.NetworkBadExpression, "a box after a word's operand: an operand that is a box stands in brackets.");
            Arrows(syn);
            PinState(syn);
            return Finalize(syn, consumed);
        }

        /// <summary>An operand as a model node: the empty terminator where nothing stands.</summary>
        private Node OperandNode(Syn s, Tok at) =>
            s.Empty ? Mark(new Terminator(Flags.None), at.Offset) : Built(s, consumed: true);

        /// <summary><c>MOVE opnd { =&gt; v }</c> and its pin state.</summary>
        private Node ParseMove(bool consumed)
        {
            var head = Next();
            var syn = new BoxSyn { Type = head.Text.ToUpperInvariant() == NetworkSpelling.Move ? head.Text : NetworkSpelling.Move, Head = head };
            syn.Inputs.Add(new Input(null, OperandNode(Operand(), head), Flags.None));
            if (IsWord(Peek()))
                throw Err(Peek(), ConflictCodes.NetworkBadExpression, "a box word after MOVE's operand: MOVE takes one operand — bracket a box, `MOVE (a ADD b) => x`.");
            if (Peek().Is(NetworkSpelling.BranchWord))
                throw Err(Peek(), ConflictCodes.NetworkBadExpression, "BRANCH after MOVE's operand: a parallel as MOVE's operand stands in brackets.");
            Arrows(syn);
            PinState(syn);
            return Finalize(syn, consumed);
        }

        /// <summary><c>EXECUTE</c> ⏎ the ST ⏎ <c>END_EXECUTE</c> and its pin state.</summary>
        private Node ParseExecute(bool consumed)
        {
            var kw = Next();
            var snippet = Next();
            if (snippet.Kind == TokKind.Error) throw Err(snippet, snippet.Code!, snippet.Text);
            if (snippet.Kind != TokKind.Snippet)
                throw Err(snippet, ConflictCodes.NetworkParse, "EXECUTE ends its line; its ST starts on the next line and END_EXECUTE ends it.");
            var end = Next();
            if (!end.Is("END_EXECUTE")) throw Err(end, ConflictCodes.NetworkParse, "an EXECUTE body ends with END_EXECUTE.");
            var syn = new BoxSyn { Type = NetworkSpelling.ExecuteType, Head = kw, StCode = snippet.Text };
            if (Peek().IsSym("=>")) throw Err(Peek(), ConflictCodes.NetworkBadExpression, "an EXECUTE box has no output pin: its one output is its ENO.");
            PinState(syn);
            return Finalize(syn, consumed);
        }

        private void Arrows(BoxSyn syn)
        {
            while (Peek().IsSym("=>"))
            {
                var arrow = Next();
                if (!IsTargetToken(Peek()))
                    throw Err(arrow, ConflictCodes.NetworkBadExpression, "`=>` with no target: a box word writes each output to a target.");
                syn.Outputs.Add((null, Next()));
            }
        }

        /// <summary><c>[ENO [=&gt; v]] [[mods] EN [src]]</c> — ENO where the box shows it, its EN last; <c>EN</c> alone is
        /// the empty enable.</summary>
        private void PinState(BoxSyn syn)
        {
            if (Peek().Is("ENO"))
            {
                Next();
                syn.EnoShown = true;
                if (Peek().IsSym("=>"))
                {
                    var arrow = Next();
                    if (!IsTargetToken(Peek())) throw Err(arrow, ConflictCodes.NetworkBadExpression, "`ENO =>` with no target.");
                    syn.EnoTarget = Next();
                }
            }
            var (mods, count) = ModifiersAt(_p);
            if (!PeekAt(count).Is("EN"))
            {
                if (Peek().IsSym("=>"))
                    throw Err(Peek(), ConflictCodes.NetworkBadExpression, "`=>` after ENO or EN: a box writes its outputs first, then ENO, then EN — `MOVE b => a ENO EN c`.");
                return;
            }
            for (var k = 0; k < count; k++) Next();
            var en = Next();
            syn.EnableFlags = mods;
            var at = Peek();
            syn.Enable = at.Kind == TokKind.Eof || at.IsSym(";") || at.IsSym(",") || at.IsSym(")")
                ? Mark(new Terminator(Flags.None), en.Offset)
                : Slot(consumed: true, at);
            if (Peek().Is("ENO"))
                throw Err(Peek(), ConflictCodes.NetworkBadExpression, "ENO after EN: a box writes ENO before its EN — `MOVE b => a ENO EN c`.");
            if (Peek().IsSym("=>"))
                throw Err(Peek(), ConflictCodes.NetworkBadExpression, "`=>` after EN: a box writes its outputs before its EN — `MOVE b => a EN c`.");
        }

        /// <summary><c>head(pins)[.name]</c>, <c>inst : TYPE(pins)[.name]</c>, <c>??? : TYPE(pins)</c> — the cursor after the
        /// head.</summary>
        private Syn Call(Tok head)
        {
            var syn = new BoxSyn { Head = head, IsCall = true };
            if (Peek().IsSym(":"))
            {
                Next();
                var type = Next();
                if (!(type.Kind == TokKind.Backtick || (type.Kind == TokKind.Word && !NetworkSpelling.IsReserved(type.Text))))
                    throw Err(type, ConflictCodes.NetworkBadExpression, "`inst : TYPE(…)` names the FB type: a name, or one between backticks.");
                if (!Peek().IsSym("(")) throw Err(Peek(), ConflictCodes.NetworkParse, "`inst : TYPE(pins)`: the call's pins follow its type.");
                syn.Instance = new Operand(head.Text, IsInstance: true);
                syn.Type = type.Text;
                if (head.Kind != TokKind.Unnamed && _scope.InstanceType(head.Text) is { } declared && !St.StDeclaration.SameType(declared, type.Text))
                    throw Err(type, ConflictCodes.NetworkBadExpression,
                        $"the instance '{head.Text}' is declared a '{declared}', and this call names it a '{type.Text}'.");
            }
            else if (head.Kind == TokKind.Backtick && NetworkSpelling.IsOperatorBox(head.Text))
            {
                syn.Type = head.Text;
                syn.OperatorCall = true;
            }
            else
            {
                if (_scope.InstanceType(head.Text) is { } fbType)
                    throw Err(head, ConflictCodes.NetworkBadExpression,
                        $"'{head.Text}' is an FB instance: its call names its type, `{NetworkTextWriter.Name(head.Text)} : {NetworkTextWriter.Name(fbType)}(…)`.");
                syn.Type = head.Text;
            }

            Next();   // (
            if (!Peek().IsSym(")"))
            {
                while (true)
                {
                    Pin(syn);
                    var sep = Peek();
                    if (sep.IsSym(",")) { Next(); continue; }
                    if (sep.IsSym(")")) break;
                    if (sep.Is("EN") || sep.Is("ENO"))
                        throw Err(sep, ConflictCodes.NetworkBadExpression,
                            $"{sep.Text.ToUpperInvariant()} inside a call's brackets: a call's ENO and EN follow it, `f(a) ENO EN c` — a box with them is bracketed as a pin's operand.");
                    throw Unexpected(sep, "a call's pins are separated by `,` and closed by `)`");
                }
            }
            Next();   // )
            if (syn.OperatorCall)
                for (var i = 0; i < syn.Inputs.Count; i++)
                    if (NetworkSpelling.IsDefaultFormal(syn.Type, i, syn.Inputs[i].Formal))
                        syn.Inputs[i] = syn.Inputs[i] with { Formal = null };

            if (Peek().IsSym("."))
            {
                var dot = Next();
                var e = Peek();
                if (e.Is("ENO")) throw OldEno(dot);
                if (e.Kind == TokKind.Backtick || (e.Kind == TokKind.Word && NetworkSpelling.Identifier.IsMatch(e.Text) && !NetworkSpelling.IsReserved(e.Text)))
                    syn.Named = Next();
                else throw Err(e, ConflictCodes.NetworkParse, "after a call, `.name` names the FB output a consumer reads.");
            }
            return new Syn { Call = syn, Start = head };
        }

        /// <summary>One pin: <c>[mods] name := v</c>, <c>[mods] name =&gt; t</c>, a positional <c>=&gt; t</c> (a bare
        /// <c>=&gt;</c> passes a slot over), or a positional value.</summary>
        private void Pin(BoxSyn syn)
        {
            if (Peek().IsSym("=>"))
            {
                Next();
                syn.Outputs.Add((null, Peek().IsSym(",") || Peek().IsSym(")") ? null : TargetTok(Next())));
                return;
            }

            var (mods, count) = ModifiersAt(_p);
            var nameTok = PeekAt(count);
            var op = PeekAt(count + 1);
            if ((nameTok.Kind == TokKind.Word || nameTok.Kind == TokKind.Backtick) && (op.IsSym(":=") || op.IsSym("=>")))
            {
                for (var k = 0; k < count; k++) Next();
                var name = Next();
                if (name.Kind == TokKind.Word && NetworkSpelling.IsReserved(name.Text))
                {
                    if (name.Is("EN"))
                        throw Err(name, ConflictCodes.NetworkBadExpression, "`EN :=` in a call: the enable follows the box, `f(…) EN c`, its modifier before the word — `NOT EN c`.");
                    if (name.Is("ENO"))
                        throw Err(name, ConflictCodes.NetworkBadExpression, "`ENO =>` in a call: ENO follows the call, `f(…) ENO => v EN c`.");
                    throw Err(name, ConflictCodes.NetworkBadExpression, $"a pin named '{name.Text}', a word of the text: it is written between backticks, `{name.Text}`.");
                }
                Next();   // := or =>
                if (op.IsSym(":="))
                {
                    var at = Peek();
                    var v = at.IsSym(",") || at.IsSym(")") ? Mark(new Terminator(Flags.None), op.Offset) : Slot(consumed: true, at);
                    syn.Inputs.Add(new Input(name.Text, v, mods));
                    return;
                }
                if (!mods.IsNone)
                    throw Err(nameTok, ConflictCodes.NetworkUnsupported, "a flag on an output pin: a modified output pin is not measured.");
                if (Peek().IsSym(",") || Peek().IsSym(")"))
                    throw Err(name, ConflictCodes.NetworkBadExpression,
                        $"`{name.Text} =>` wired to nothing: a named output pin holds a target, and an unwired one is not written.");
                syn.Outputs.Add((name.Text, TargetTok(Next())));
                return;
            }
            var start = Peek();
            var value = Operand();
            syn.Inputs.Add(new Input(null, OperandNode(value, start), Flags.None));
        }

        /// <summary>B8: <c>[feed] BRANCH (b1, b2, …) [SHORTCIRCUIT]</c> — the cursor on BRANCH.</summary>
        private Node ParseParallel(Node? feed, Tok start)
        {
            Next();   // BRANCH
            var open = Peek();
            if (!open.IsSym("("))
                throw Err(open, ConflictCodes.NetworkParse, "BRANCH takes its branches as a bracketed list, `feed BRANCH (a, b)`.");
            Next();
            if (Peek().IsSym(")")) throw Err(Peek(), ConflictCodes.NetworkUnsupported, "a parallel with no branch: `BRANCH ()` holds none.");
            var branches = new List<Node>();
            while (true)
            {
                var at = Peek();
                branches.Add(at.IsSym(",") || at.IsSym(")") ? Mark(new Terminator(Flags.None), at.Offset) : Slot(consumed: true, at));
                var sep = Peek();
                if (sep.IsSym(",")) { Next(); continue; }
                if (sep.IsSym(")")) { Next(); break; }
                throw Unexpected(sep, "a parallel's branches are separated by `,` and closed by `)`");
            }
            var mode = NetworkSpelling.DerivedMode;
            if (Peek().Is(NetworkSpelling.ShortCircuitWord)) { Next(); mode = ParallelMode.BoxShortCircuit; }
            if (Peek().Is("EN") || Peek().Is("ENO") || Peek().IsSym("=>"))
                throw Err(Peek(), ConflictCodes.NetworkBadExpression, "a pin after a parallel: a parallel is no box, and has no EN, ENO or output.");
            return Mark(new Parallel(feed, branches, mode), start.Offset);
        }

        // ── building the box ────────────────────────────────────────────────────────────────────────

        /// <summary>
        /// A box given its consumer — the one place its connection is decided from the text: a top-level box is connected to
        /// nothing; a box that shows ENO, an Execute box, and an FB read with nothing after its call (its declared ENO) are
        /// read through ENO; an FB read by <c>.name</c> by that output (its slot the push derives); any other box by its value.
        /// Positional <c>=&gt;</c> pins fill the slots that remain, in order.
        /// </summary>
        private Box Finalize(BoxSyn s, bool consumed)
        {
            var isExecute = s.StCode is not null;
            var isFb = s.Instance is not null;
            if (s.EnoShown && s.Enable is null && (isFb || isExecute || s.OperatorCall || !s.IsCall))
                throw Err(s.Head, ConflictCodes.NetworkBadExpression,
                    "ENO without EN: the text shows ENO on an enabled box, `MOVE b => a ENO EN c`, or on a function's, " +
                    "`x := f(a) ENO` — an operator's does not build without EN, and an FB's declared ENO and an EXECUTE " +
                    "box's are read with nothing after the box (X9).");
            if (s.Named is { } nm && !consumed)
                throw Err(nm, ConflictCodes.NetworkBadExpression, $"`.{nm.Text}` on a box nothing consumes: a top-level box's output goes nowhere.");
            if (s.Named is { } fn && !isFb)
                throw Err(fn, ConflictCodes.NetworkUnsupported,
                    $"`.{fn.Text}` on '{s.Head.Text}', which is no FB: a function is read by its value (a function read by a declared output is not measured).");

            var hasEno = s.EnoShown || isExecute || (isFb && consumed && s.Named is null && s.Enable is null);
            if (isFb && consumed && s.Enable is not null && !s.EnoShown && s.Named is null)
                throw Err(s.Head, ConflictCodes.NetworkBadExpression,
                    "a consumed FB with EN and no ENO is read through an output: write it, `t1 : TON(…).Q EN c` — or show its ENO.");

            int? connected = !consumed ? null
                : hasEno && s.Named is null ? 0
                : isFb ? null
                : NetworkSpelling.MainSlotOfCall(s.Type);

            var outputs = new List<Output>();
            if (s.EnoTarget is { } eno) outputs.Add(new Output(Box.EnoPin, new Operand(TargetText(eno), IsLValue: true), 0));
            var next = 0;
            var enoSlot = hasEno ? 0 : (int?)null;
            foreach (var (formal, target) in s.Outputs)
            {
                if (formal is not null) { outputs.Add(new Output(formal, new Operand(TargetText(target!.Value), IsLValue: true), null)); continue; }
                var slot = NetworkSpelling.NextFreeSlot(next, enoSlot, connected);
                next = slot + 1;
                if (target is { } tt) outputs.Add(new Output(null, new Operand(TargetText(tt), IsLValue: true), slot));
            }

            var box = new Box(s.Type, s.Instance, NetworkSpelling.KindOf(s.Type, isFb), s.Inputs, outputs, s.Enable, s.StCode, s.Flags,
                ConnectedSlot: connected, HasEnoOutput: hasEno, MainOutputName: s.Named?.Text) { EnableFlags = s.EnableFlags };

            // One tree, one text: an operator in its backticked call form where its word holds it.
            if (s.OperatorCall && NetworkTextWriter.IsWordOrMoveForm(box))
                throw Err(s.Head, ConflictCodes.NetworkBadExpression,
                    string.Equals(s.Type, NetworkSpelling.Move, StringComparison.OrdinalIgnoreCase)
                        ? "`MOVE`(…) in its call form where its word holds it: write `MOVE b => a`."
                        : $"`{s.Type}`(…) in its call form where its word holds it: write `a {s.Type} b`.");
            return Mark(box, (s.Start ?? s.Head).Offset);
        }

        private Tok TargetTok(Tok t)
        {
            if (!IsTargetToken(t))
                throw Err(t, ConflictCodes.NetworkBadExpression,
                    t.Kind == TokKind.Word && NetworkSpelling.SplitShape.IsMatch(t.Text)
                        ? $"{t.Text} as an output target: a split is defined by its own `{t.Text} := value` and is never a target."
                        : $"'{t.Text}' as a target: a target is a variable, `???`, an address or text between backticks.");
            return t;
        }

        /// <summary>An assignment or <c>=&gt;</c> target's text: a token or backticked text.</summary>
        private string TargetText(Tok t)
        {
            switch (t.Kind)
            {
                case TokKind.Word:
                    if (NetworkSpelling.SplitShape.IsMatch(t.Text))
                        throw Err(t, ConflictCodes.NetworkBadExpression,
                            $"{t.Text} as a coil target: a split is defined by `{t.Text} := value;` and is never a coil's or a pin's target.");
                    if (NetworkSpelling.IsReserved(t.Text))
                        throw Err(t, ConflictCodes.NetworkBadExpression,
                            $"'{t.Text}' as a target: a target spelled like a word of the text is written between backticks.");
                    return t.Text;
                case TokKind.Backtick:
                case TokKind.Unnamed:
                case TokKind.Address:
                    return t.Text;
                default:
                    throw Err(t, ConflictCodes.NetworkBadExpression,
                        $"'{t.Text}' as a target: a target is a variable, `???`, an address or text between backticks.");
            }
        }

        private ParseError OldEno(Tok dot) =>
            Err(dot, ConflictCodes.NetworkParse,
                "`.ENO` is not network text: a box read through its ENO shows `ENO` after its outputs, `x := MOVE 1 => t ENO EN c;`.");

        /// <summary>ST's operator symbols are not network text — refused BY NAME with the word that replaces them.</summary>
        private ParseError? OldSymbol(Tok t)
        {
            if (t.Kind != TokKind.Sym) return null;
            string? word = t.Text switch
            {
                "+" => "ADD", "-" => "SUB", "*" => "MUL", "/" => "DIV", ">" => "GT", "<" => "LT", ">=" => "GE",
                "<=" => "LE", "=" => "EQ", "<>" => "NE", _ => null,
            };
            if (word is null)
                return t.Text is "(" or ")" or "," or ";" or ":" or ":=" or "=>" or "." or "S=" or "R=" || t.Text.Any(c => c > '\u007f' || char.IsLetterOrDigit(c)) ? null
                    : Err(t, ConflictCodes.NetworkUnknownOperator,
                        $"'{t.Text}' is no operator of network text: a box is its name — the words are AND OR XOR ADD SUB MUL DIV MOD GT GE EQ NE LE LT MOVE, and every other box is a call, `f(IN := a)`.");
            if (t.Text is "-" or "+" && Raw(_p + 1).Kind == TokKind.Number)
                return Err(t, ConflictCodes.NetworkBadExpression,
                    $"'{t.Text} {Raw(_p + 1).Text}': a negative literal is the minus touching its digit, -1, and a '+' sign is not written.");
            if (t.Text == "-" && Raw(_p + 1).Kind == TokKind.Word && Raw(_p + 1).Offset == t.Offset + 1)
                return Err(t, ConflictCodes.NetworkBadExpression, $"'-{Raw(_p + 1).Text}': a negation of a value is a box, `0 SUB {Raw(_p + 1).Text}`.");
            return Err(t, ConflictCodes.NetworkBadExpression, $"'{t.Text}' is not network text: a box is its name — write {word} (`a {word} b`).");
        }

        private ParseError Unexpected(Tok t, string what)
        {
            if (t.Kind == TokKind.Error) return Err(t, t.Code!, t.Text);
            if (t.Kind == TokKind.Eof && t.Text == MissingSemicolon)
                return Err(t, ConflictCodes.NetworkParse,
                    "missing `;`? A line indented no deeper than its item's first line starts a new item, so the item before it ends with `;`.");
            if (OldSymbol(t) is { } old) return old;
            if (t.IsSym(".") && Raw(_p + 1).Is("ENO")) return OldEno(t);
            if (t.Is("EN") || t.Is("ENO"))
                return Err(t, ConflictCodes.NetworkBadExpression,
                    $"{t.Text.ToUpperInvariant()} where no box takes it: ENO and EN follow the box they belong to (its outputs first), and a box that is another word's operand is bracketed with them.");
            if (t.IsSym("=>"))
                return Err(t, ConflictCodes.NetworkBadExpression, "`=>` here: a box word writes its outputs after its operands, a call inside its brackets.");
            if (t.Is(NetworkSpelling.BranchWord))
                return Err(t, ConflictCodes.NetworkBadExpression, "BRANCH after a box: a feed that is a box is bracketed, `(a AND b) BRANCH (x, y)`.");
            if (t.Is(NetworkSpelling.ShortCircuitWord))
                return Err(t, ConflictCodes.NetworkBadExpression, "SHORTCIRCUIT after something no parallel: it follows a parallel's branch list.");
            if (IsWord(t))
                return Err(t, ConflictCodes.NetworkBadExpression,
                    $"'{t.Text}' after a box at its level: one word is one box, and brackets separate boxes.");
            if (t.Kind == TokKind.Eof)
                return Err(t, ConflictCodes.NetworkParse, "the body ends inside an item: " + what + ".");
            return Err(t, ConflictCodes.NetworkParse, $"'{t.Text}': {what}.");
        }

        // ── tokens ──────────────────────────────────────────────────────────────────────────────────

        private const string MissingSemicolon = "\u0000missing-semicolon";

        private Tok Raw(int i) => i < _toks.Count ? _toks[i] : _toks[_toks.Count - 1];

        private Tok Peek() => PeekAt(0);

        /// <summary>The token <paramref name="k"/> ahead, inside the item: a token starting a line no deeper than the item's
        /// first line ends the item (the one indentation check) and reads as its end. An EXECUTE body and its
        /// <c>END_EXECUTE</c> are verbatim and exempt.</summary>
        private Tok PeekAt(int k)
        {
            for (var j = 0; j <= k; j++)
            {
                var i = _p + j;
                var t = Raw(i);
                if (_itemStart >= 0 && i > _itemStart && t.AtLineStart && t.Kind != TokKind.Snippet && t.Kind != TokKind.Eof &&
                    !(t.Is("END_EXECUTE") && Raw(i - 1).Kind == TokKind.Snippet) && Column(t) <= _itemColumn)
                    return new Tok(TokKind.Eof, MissingSemicolon, t.Offset, t.Length, true);
                if (j == k) return t;
                if (t.Kind == TokKind.Eof) return t;
            }
            return Raw(_p + k);
        }

        private Tok Next()
        {
            var t = Peek();
            if (t.Kind == TokKind.Error) throw Err(t, t.Code!, t.Text);
            if (t.Kind == TokKind.Eof && t.Text == MissingSemicolon) throw Unexpected(t, "an item ends with `;`");
            if (t.Kind != TokKind.Eof) _p++;
            return t;
        }

        private void ExpectSym(string sym, string form)
        {
            var t = Peek();
            if (!t.IsSym(sym))
                throw Err(t, ConflictCodes.NetworkParse, t.Kind == TokKind.Eof
                    ? $"the item ends where `{sym}` is expected ({form})."
                    : $"expected `{sym}` and found '{t.Text}' ({form}).");
            Next();
        }

        private void ExpectClose(Tok open, string what)
        {
            if (!Peek().IsSym(")")) throw Unexpected(Peek(), what);
            Next();
        }

        private void ExpectOnLine(string sym, int line, string form)
        {
            var t = Raw(_p);
            if (Line(t) != line) throw Err(t, ConflictCodes.NetworkParse, $"the NETWORK header ends at its newline; `{form}` is on one line.");
            ExpectSym(sym, form);
        }

        private int Line(Tok t) => _lx!.LineOf(t.Offset);

        private int Column(Tok t) => _lx!.LineCol(t.Offset).Column;

        private ParseError Err(Tok t, string code, string message) => new(code, message, t.Offset, Math.Max(1, t.Length));

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
