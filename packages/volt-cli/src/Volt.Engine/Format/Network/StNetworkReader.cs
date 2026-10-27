using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace Volt.Engine.Format.Network;

/// <summary>
/// PLAIN-ST NETWORK TEXT (<see cref="StNetworkWriter"/>) → the <see cref="NetworkBody"/> model (openspec
/// <c>network-text-st</c> 2.2). Its own small lexer and recursive-descent parser for the subset a network holds (the engine
/// has no ST expression parser): assignments (<c>:=</c> <c>S=</c> <c>R=</c>, chained, nested in brackets), calls with
/// formal and positional pins, the infix operators by ST precedence, <c>NOT</c>, <c>IF c THEN JMP l; END_IF;</c> /
/// <c>RETURN</c>, a leading label, and the <c>%</c> lines. Anything else is refused by name, with its line.
///
/// <para>Two structural rules beside the syntax. A call whose head is <c>&lt;name&gt;_EN</c> is the ENABLED box of
/// <c>&lt;name&gt;</c> (a function, an operator, or an FB instance), its first argument <c>EN :=</c>; any other call's
/// <c>EN</c>/<c>ENO</c> are the callee's own pins. A name on a network's <c>%WIRES</c> line is a wire: read twice or more it
/// is a Demux over its definition; read once it is the call statement that defines it through an output
/// (<c>t1(IN := a, Q =&gt; w4)</c>), standing where it is read.</para>
///
/// <para><b>Read-only phase.</b> No push reads this text yet (<see cref="NetworkBodyReader"/> refuses an LD/FBD body by
/// name until section 3); it is the round-trip oracle's reader, and section 3's.</para>
/// </summary>
public static class StNetworkReader
{
    public static NetworkBody Read(string text, NetworkScope scope)
    {
        if (text is null) throw new ArgumentNullException(nameof(text));
        if (scope is null) throw new ArgumentNullException(nameof(scope));
        var lines = text.Replace("\r\n", "\n").Split('\n').ToList();
        if (lines.Count > 0 && lines[lines.Count - 1].Length == 0) lines.RemoveAt(lines.Count - 1);
        if (lines.Count == 0 || NetworkText.LanguageNamed(St.PropertyLines.LanguageOf(lines[0])) is not { } lang)
            throw new StNetworkReadException(1, "the body does not start with %LANGUAGE LD or %LANGUAGE FBD");
        var nets = new List<Network>();
        var bodyWires = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var allWires = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var l in lines)
            if (l.StartsWith(StNetworkWriter.WiresLine + " ", StringComparison.Ordinal))
                foreach (var w in l.Substring(StNetworkWriter.WiresLine.Length + 1).Split(',')) allWires.Add(w.Trim());
        var i = 1;
        while (i < lines.Count)
        {
            if (!IsNetworkLine(lines[i]))
                throw new StNetworkReadException(i + 1, $"'{lines[i]}' where a {StNetworkWriter.NetworkLine} line stands");
            var start = i++;
            while (i < lines.Count && !IsNetworkLine(lines[i]))
            {
                if (lines[i].StartsWith(StNetworkWriter.ExecuteLine, StringComparison.Ordinal))
                    while (++i < lines.Count && !lines[i].StartsWith(StNetworkWriter.EndExecuteLine, StringComparison.Ordinal)) { }
                i++;
            }
            nets.Add(new NetworkReader(lines.GetRange(start, Math.Min(i, lines.Count) - start), start + 1, nets.Count, scope, bodyWires, allWires).Read());
        }
        return new NetworkBody(lang, nets);
    }

    private static bool IsNetworkLine(string line) =>
        line == StNetworkWriter.NetworkLine || line.StartsWith(StNetworkWriter.NetworkLine + " ", StringComparison.Ordinal);

    // ── spelling predicates the writer shares ────────────────────────────────────────────────────────────────────

    private static readonly HashSet<string> Keywords = new(StringComparer.OrdinalIgnoreCase)
    {
        "AND", "OR", "XOR", "NOT", "MOD", "IF", "THEN", "ELSE", "ELSIF", "END_IF", "JMP", "RETURN", "CASE", "OF", "END_CASE",
        "FOR", "TO", "BY", "DO", "END_FOR", "WHILE", "END_WHILE", "REPEAT", "UNTIL", "END_REPEAT", "EXIT", "CONTINUE",
        // the set and reset operators: CODESYS ST takes `s` and `r` for no name (1.2: declaring one is C0009, and the LSP
        // reads `x := s;` as the vendor does: "Expression expected instead of 's'")
        "S", "R",
    };

    public static bool IsKeyword(string word) => Keywords.Contains(word);

    /// <summary>Whether <paramref name="text"/> reads back as exactly one operand (not a call): what a leaf may hold.</summary>
    public static bool IsOperand(string text)
    {
        try
        {
            var toks = Lex(text, k => 1 + k);
            var p = new Parser(text, toks, _ => false, 1);
            var s = p.TryOperandSpan(0, allowCall: false);
            return s is { } span && span.Next == toks.Count && span.Text == text || IsLiteral(text);
        }
        catch (StNetworkReadException) { return false; }
    }

    /// <summary>Whether <paramref name="text"/> reads as one ST expression of the subset — what an operand holding an
    /// expression an engineer typed into it is written as (bracketed).</summary>
    public static bool IsExpression(string text)
    {
        try
        {
            var toks = Lex(text, k => 1 + k);
            if (toks.Count == 0) return false;
            var p = new Parser(text, toks, _ => false, 1);
            p.Expr();
            return p.AtEnd;
        }
        catch (StNetworkReadException) { return false; }
    }

    /// <summary>The tree an operand holding an ST expression reads as (a stored member, design.md): the expression read as
    /// ST, every operator its box, against <paramref name="scope"/>. Not network text: infix arithmetic and comparisons are
    /// ST here, where a network spells each box as a call.</summary>
    public static Node ExpressionTree(string text, NetworkScope scope)
    {
        var p = new Parser(text, Lex(text, k => 1 + k), _ => false, 1);
        var e = p.Expr();
        if (!p.AtEnd) throw new StNetworkReadException(1, $"the operand '{text}' is more than one expression");
        var net = new NetworkReader(new List<string> { StNetworkWriter.NetworkLine }, 1, 0, scope);
        return new Builder(net, new List<AStmt>(), 1).Tree(e);
    }

    /// <summary>Whether <paramref name="text"/> is a name a call can head (an identifier chain, no literal).</summary>
    public static bool IsCallHead(string text) =>
        IsOperand(text) && !IsLiteral(text) && text != Box.UnnamedInstance;

    public static bool IsLiteral(string text)
    {
        try
        {
            var toks = Lex(text, k => 1 + k);
            return toks.Count == 1 && toks[0].Kind == Tk.Literal
                   || toks.Count == 2 && toks[0].Text == "-" && toks[1].Kind == Tk.Literal && toks[0].End == toks[1].Start;
        }
        catch (StNetworkReadException) { return false; }
    }

    // ── one network ──────────────────────────────────────────────────────────────────────────────────────────────

    private sealed class NetworkReader
    {
        private readonly List<string> _lines;
        private readonly int _firstLine;
        private readonly int _order;
        private readonly NetworkScope _scope;
        private readonly HashSet<string> _wires = new(StringComparer.OrdinalIgnoreCase);
        private readonly HashSet<string> _bodyWires;
        private readonly HashSet<string> _allWires;
        private readonly List<string> _snippets = new();

        /// <param name="bodyWires">The wires the body's earlier networks name: a wire is one network's (design.md 1.4).</param>
        /// <param name="allWires">Every wire the body's networks name: one of another network is read nowhere here.</param>
        public NetworkReader(List<string> lines, int firstLine, int order, NetworkScope scope, HashSet<string>? bodyWires = null,
                             HashSet<string>? allWires = null)
        {
            _lines = lines;
            _firstLine = firstLine;
            _order = order;
            _scope = scope;
            _bodyWires = bodyWires ?? new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            _allWires = allWires ?? new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        }

        private StNetworkReadException Error(int index, string what) => new(_firstLine + index, what);

        private static bool KnownLine(string line) =>
            new[] { StNetworkWriter.NetworkLine, StNetworkWriter.DisabledLine, StNetworkWriter.WiresLine, StNetworkWriter.UnsupportedLine }
                .Any(k => line == k || line.StartsWith(k + " ", StringComparison.Ordinal));

        public Network Read()
        {
            var head = _lines[0].Substring(StNetworkWriter.NetworkLine.Length);
            string? title = null;
            if (head.Length > 0)
            {
                var h = head.Substring(1);
                if (h.Length < 2 || h[0] != '"' || h[h.Length - 1] != '"')
                    throw Error(0, $"a network title is one \"…\" after {StNetworkWriter.NetworkLine} and one space, not '{h}'");
                title = NetworkSpelling.Unescape(h.Substring(1, h.Length - 2), out var err) ?? throw Error(0, err!);
            }
            var i = 1;
            var disabled = false;
            string? unsupported = null, hash = null;
            if (i < _lines.Count && _lines[i] == StNetworkWriter.DisabledLine) { disabled = true; i++; }
            if (i < _lines.Count && _lines[i].StartsWith(StNetworkWriter.WiresLine + " ", StringComparison.Ordinal))
            {
                foreach (var raw in _lines[i].Substring(StNetworkWriter.WiresLine.Length + 1).Split(','))
                {
                    var w = raw.Trim();
                    if (WireId(w) is null) throw Error(i, $"the wire '{w}': a wire is w<n>");
                    if (_scope.Contains(w) || _scope.InstanceType(w) is not null)
                        throw Error(i, $"the wire '{w}' is also a name declared in reach: a wire is never a variable");
                    if (!_wires.Add(w)) throw Error(i, $"the wire '{w}' is named twice");
                    if (!_bodyWires.Add(w)) throw Error(i, $"the wire '{w}' is named on an earlier network too: a wire name is one network's in a body");
                }
                i++;
            }
            var comment = new List<string>();
            while (i < _lines.Count && _lines[i].StartsWith("//", StringComparison.Ordinal))
            {
                var c = _lines[i++].Substring(2);
                comment.Add(NetworkSpelling.Unescape(c.StartsWith(" ", StringComparison.Ordinal) ? c.Substring(1) : c, out var err)
                            ?? throw Error(i - 1, "the comment line: " + err));
            }
            if (i < _lines.Count && _lines[i].StartsWith(StNetworkWriter.UnsupportedLine + " ", StringComparison.Ordinal))
            {
                var u = _lines[i].Substring(StNetworkWriter.UnsupportedLine.Length + 1);
                var q = u.LastIndexOf('"');
                var tail = q > 0 ? u.Substring(q + 1) : "";
                if (u.Length < 2 || u[0] != '"' || q <= 0 || !tail.StartsWith(" #", StringComparison.Ordinal)
                    || !NetworkSpelling.UnsupportedShape.IsMatch(u.Substring(1, q - 1)) || !NetworkSpelling.UnsupportedHash.IsMatch(tail.Substring(2)))
                    throw Error(i, $"'{_lines[i]}': the line is {StNetworkWriter.UnsupportedLine} \"<shape>\" #<8 hex digits>");
                unsupported = u.Substring(1, q - 1);
                hash = tail.Substring(2);
                if (++i < _lines.Count) throw Error(i, $"'{_lines[i]}' after the {StNetworkWriter.UnsupportedLine} line: that network holds nothing else");
            }

            // The code, an Execute block standing in it as `@EXEC<k>[(args)];` on the block's first line.
            var code = new StringBuilder();
            var lineOf = new List<int>();   // code line → index into _lines
            for (; i < _lines.Count; i++)
            {
                var line = _lines[i];
                if (line.StartsWith(StNetworkWriter.ExecuteLine, StringComparison.Ordinal))
                {
                    var args = line.Substring(StNetworkWriter.ExecuteLine.Length);
                    var st = new List<string>();
                    var at = i;
                    while (++i < _lines.Count && !_lines[i].StartsWith(StNetworkWriter.EndExecuteLine, StringComparison.Ordinal)) st.Add(_lines[i]);
                    if (i >= _lines.Count) throw Error(at, $"{StNetworkWriter.ExecuteLine} with no {StNetworkWriter.EndExecuteLine}");
                    if (_lines[i] != StNetworkWriter.EndExecuteLine) throw Error(i, $"'{_lines[i]}': {StNetworkWriter.EndExecuteLine} stands alone on its line");
                    code.Append("@EXEC").Append(_snippets.Count.ToString(CultureInfo.InvariantCulture)).Append(args).Append(";\n");
                    lineOf.Add(at);
                    _snippets.Add(string.Join("\n", st));
                    continue;
                }
                if (line.StartsWith("%", StringComparison.Ordinal))
                    throw Error(i, KnownLine(line)
                        ? $"the line '{line}' among the code: a network's % lines stand before it, in the order %DISABLED, %WIRES"
                        : $"'{line}': a network holds no such line");
                if (line.TrimStart().StartsWith("//", StringComparison.Ordinal))
                    throw Error(i, "a comment after the code starts: a network's comment is its // lines before the code");
                code.Append(line).Append('\n');
                lineOf.Add(i);
            }

            var src = code.ToString();
            Func<int, int> bodyLine = k => _firstLine + lineOf[Math.Min(k, lineOf.Count - 1)];
            var parser = new Parser(src, Lex(src, bodyLine), w => _wires.Contains(w), _firstLine, bodyLine) { Network = true };
            var (label, stmts) = parser.Statements();
            if (unsupported is not null && (label is not null || stmts.Count > 0))
                throw Error(0, "a network shown UNSUPPORTED holds code");
            var trees = new Builder(this, stmts, _firstLine).Build();
            return new Network(_order, title, label, comment.Count == 0 ? null : string.Join("\r\n", comment), disabled,
                trees, unsupported, hash);
        }

        public string? InstanceType(string head) => _scope.InstanceType(head);
        /// <summary>Whether anything is declared in reach under <paramref name="name"/>: a POU, an instance or a variable.</summary>
        public bool InReach(string name) => _scope.Contains(name) || _scope.IsCallable(name);
        public IEnumerable<string> Wires => _wires;
        public bool IsWire(string name) => _wires.Contains(name);

        /// <summary>A name another network of the body names a wire: never this network's operand or target.</summary>
        public bool IsForeignWire(string name) => !_wires.Contains(name) && _allWires.Contains(name);
        public string Snippet(int k) => _snippets[k];
    }

    private static int? WireId(string wire) =>
        wire.Length > 1 && (wire[0] == 'w' || wire[0] == 'W') && (wire[1] != '0' || wire.Length == 2)
        && int.TryParse(wire.Substring(1), NumberStyles.None, CultureInfo.InvariantCulture, out var id) ? id : null;

    // ── the AST ──────────────────────────────────────────────────────────────────────────────────────────────────

    private abstract class AExpr { public int Line; }
    private sealed class AOperand : AExpr { public string Text = ""; }
    private sealed class AWire : AExpr { public string Name = ""; }
    private sealed class ANot : AExpr { public AExpr Inner = null!; }
    private sealed class ABin : AExpr { public string Type = ""; public List<AExpr> Operands = new(); }
    private sealed class AAssign : AExpr { public List<(string Text, string Op)> Targets = new(); public AExpr Value = null!; }
    private sealed class ACall : AExpr { public string Head = ""; public List<AArg> Args = new(); }
    private sealed class AArg { public string? Formal; public bool Out; public AExpr? Value; public string? Target; }

    private abstract class AStmt { public int Line; }
    private sealed class SAssign : AStmt { public AAssign Assign = null!; }
    private sealed class SCall : AStmt { public ACall Call = null!; }
    private sealed class SControl : AStmt { public AExpr? Condition; public string? Jump; }

    // ── lexer ────────────────────────────────────────────────────────────────────────────────────────────────────

    private enum Tk { Ident, Literal, Sym }

    private readonly struct Tok
    {
        public Tok(Tk kind, string text, int start, int end) { Kind = kind; Text = text; Start = start; End = end; }
        public Tk Kind { get; }
        public string Text { get; }
        public int Start { get; }
        public int End { get; }
        public override string ToString() => Text;
    }

    private static readonly string[] Syms = { ":=", "=>", "<=", ">=", "<>", "**", "(", ")", ",", ";", ":", ".", "[", "]", "^", "+", "-", "*", "/", "<", ">", "=", "&" };

    /// <param name="lineOfCodeLine">The body's 1-based line of the code's <c>k</c>-th line, for a refusal's line.</param>
    private static List<Tok> Lex(string s, Func<int, int> lineOfCodeLine)
    {
        var toks = new List<Tok>();
        var i = 0;
        int Line(int at) => lineOfCodeLine(s.Take(at).Count(c => c == '\n'));
        while (i < s.Length)
        {
            var c = s[i];
            if (char.IsWhiteSpace(c)) { i++; continue; }
            var start = i;
            if (c == '(' && i + 1 < s.Length && s[i + 1] == '*')
                throw new StNetworkReadException(Line(i), "a (* comment in the code: a network's comment is its // lines before the code");
            if (c == '/' && i + 1 < s.Length && s[i + 1] == '/')
                throw new StNetworkReadException(Line(i), "a // comment after the code starts: a network's comment is its // lines before the code");
            if (c == '{') throw new StNetworkReadException(Line(i), "a pragma {…} in a network: a network holds none");
            if (char.IsLetter(c) || c == '_' || c == '@')
            {
                i++;
                while (i < s.Length && (char.IsLetterOrDigit(s[i]) || s[i] == '_')) i++;
                if (c != '@' && i < s.Length && s[i] == '#')
                {
                    i++;
                    while (i < s.Length && (char.IsLetterOrDigit(s[i]) || "_.:+-".IndexOf(s[i]) >= 0)) i++;
                    toks.Add(new Tok(Tk.Literal, s.Substring(start, i - start), start, i));
                    continue;
                }
                toks.Add(new Tok(Tk.Ident, s.Substring(start, i - start), start, i));
                continue;
            }
            if (char.IsDigit(c))
            {
                var afterDot = toks.Count > 0 && toks[toks.Count - 1].Text == "." && toks[toks.Count - 1].End == start;
                while (i < s.Length && (char.IsDigit(s[i]) || s[i] == '_')) i++;
                if (!afterDot)
                {
                    if (i < s.Length && s[i] == '#')
                    {
                        i++;
                        while (i < s.Length && (char.IsLetterOrDigit(s[i]) || "_.".IndexOf(s[i]) >= 0)) i++;
                    }
                    else
                    {
                        if (i + 1 < s.Length && s[i] == '.' && char.IsDigit(s[i + 1]))
                        {
                            i++;
                            while (i < s.Length && (char.IsDigit(s[i]) || s[i] == '_')) i++;
                        }
                        if (i < s.Length && (s[i] == 'e' || s[i] == 'E'))
                        {
                            var j = i + 1;
                            if (j < s.Length && (s[j] == '+' || s[j] == '-')) j++;
                            if (j < s.Length && char.IsDigit(s[j]))
                            {
                                i = j;
                                while (i < s.Length && char.IsDigit(s[i])) i++;
                            }
                        }
                    }
                }
                toks.Add(new Tok(Tk.Literal, s.Substring(start, i - start), start, i));
                continue;
            }
            if (c == '\'' || c == '"')
            {
                i++;
                while (i < s.Length && s[i] != c)
                {
                    if (s[i] == '$' && i + 1 < s.Length) i++;
                    if (s[i] == '\n') throw new StNetworkReadException(Line(i), "a string across a line");
                    i++;
                }
                if (i >= s.Length) throw new StNetworkReadException(Line(start), "an unclosed string");
                i++;
                toks.Add(new Tok(Tk.Literal, s.Substring(start, i - start), start, i));
                continue;
            }
            if (c == '%' && i + 1 < s.Length && "IQMiqm".IndexOf(s[i + 1]) >= 0)
            {
                i += 2;
                while (i < s.Length && (char.IsLetterOrDigit(s[i]) || s[i] == '.' || s[i] == '*')) i++;
                toks.Add(new Tok(Tk.Literal, s.Substring(start, i - start), start, i));
                continue;
            }
            if (c == '?' && string.CompareOrdinal(s, i, "???", 0, 3) == 0)
            {
                i += 3;
                toks.Add(new Tok(Tk.Ident, "???", start, i));
                continue;
            }
            var sym = Syms.FirstOrDefault(x => string.CompareOrdinal(s, i, x, 0, x.Length) == 0);
            if (sym is null) throw new StNetworkReadException(Line(i), $"the character '{c}'");
            i += sym.Length;
            toks.Add(new Tok(Tk.Sym, sym, start, i));
        }
        return toks;
    }

    // ── parser ───────────────────────────────────────────────────────────────────────────────────────────────────

    private sealed class Parser
    {
        private readonly string _src;
        private readonly List<Tok> _t;
        private readonly Func<string, bool> _isWire;
        private readonly int _firstLine;
        private readonly Func<int, int>? _lineOfCodeLine;
        private int _i;

        public Parser(string src, List<Tok> toks, Func<string, bool> isWire, int firstLine, Func<int, int>? lineOfCodeLine = null)
        {
            _src = src;
            _t = toks;
            _isWire = isWire;
            _firstLine = firstLine;
            _lineOfCodeLine = lineOfCodeLine;
        }

        public bool AtEnd => _i >= _t.Count;

        /// <summary>Network text, not an operand's ST expression: every box is a call, and infix is only the contacts
        /// (<c>AND</c>, <c>OR</c>, and <c>NOT</c> before an operand).</summary>
        public bool Network { get; init; }

        private Tok? Peek(int k = 0) => _i + k < _t.Count ? _t[_i + k] : null;
        private bool Is(string sym, int k = 0) => Peek(k) is { } t && t.Text == sym && t.Kind == Tk.Sym;
        private bool IsWord(string w, int k = 0) => Peek(k) is { Kind: Tk.Ident } t && string.Equals(t.Text, w, StringComparison.OrdinalIgnoreCase);

        private int LineAt(int tok)
        {
            var at = tok < _t.Count ? _t[tok].Start : _src.Length;
            var codeLine = _src.Take(at).Count(c => c == '\n');
            return _lineOfCodeLine is null ? _firstLine + codeLine : _lineOfCodeLine(codeLine);
        }

        private int Line => LineAt(_i);

        private StNetworkReadException Error(string what) =>
            new(Line, $"{what} at '{(Peek() is { } t ? _src.Substring(t.Start, Math.Min(40, _src.Length - t.Start)).Replace("\n", "⏎") : "the end")}'");

        private void Expect(string sym)
        {
            if (!Is(sym)) throw Error($"'{sym}' expected");
            _i++;
        }

        private void ExpectWord(string w)
        {
            if (!IsWord(w)) throw Error($"'{w}' expected");
            _i++;
        }

        public (string? Label, List<AStmt> Statements) Statements()
        {
            string? label = null;
            if (Peek() is { Kind: Tk.Ident } l && Is(":", 1) && !IsKeyword(l.Text))
            {
                label = l.Text;
                _i += 2;
            }
            var list = new List<AStmt>();
            while (_i < _t.Count) list.Add(Statement());
            return (label, list);
        }

        private AStmt Statement()
        {
            var line = Line;
            if (IsWord("IF"))
            {
                _i++;
                var cond = Expr();
                ExpectWord("THEN");
                if (!IsWord("JMP") && !IsWord("RETURN"))
                    throw Error("a network's IF holds one JMP or RETURN: an LD/FBD network cannot hold other code under a condition");
                var s = Control();
                s.Condition = cond;
                if (IsWord("ELSE") || IsWord("ELSIF")) throw Error("a network's IF has no ELSE or ELSIF");
                ExpectWord("END_IF");
                Expect(";");
                s.Line = line;
                return s;
            }
            foreach (var w in new[] { "FOR", "WHILE", "REPEAT", "CASE", "EXIT", "CONTINUE" })
                if (IsWord(w)) throw Error($"an LD/FBD network cannot hold a {w}");
            if (IsWord("JMP") || IsWord("RETURN"))
            {
                var c = Control();
                c.Line = line;
                return c;
            }
            if (KeywordCallHead() is { } op)
            {
                _i++;
                var call = CallArgs(op, line);
                Expect(";");
                return new SCall { Call = call, Line = line };
            }
            var at = _i;
            var span = TryOperandSpan(_i, allowCall: true) ?? throw Error("a statement (an assignment, a call, a jump or a return)");
            if (span.IsCall)
            {
                _i = span.Next;
                var call = CallArgs(span.Text, line);
                Expect(";");
                return new SCall { Call = call, Line = line };
            }
            _i = at;
            var a = AssignTail(line);
            Expect(";");
            return new SAssign { Assign = a, Line = line };
        }

        private SControl Control()
        {
            if (IsWord("JMP"))
            {
                _i++;
                if (Peek() is not { Kind: Tk.Ident } l || IsKeyword(l.Text)) throw Error("a label");
                _i++;
                Expect(";");
                return new SControl { Jump = l.Text };
            }
            ExpectWord("RETURN");
            Expect(";");
            return new SControl();
        }

        /// <summary><c>t1 op t2 op … value</c> at the current position.</summary>
        private AAssign AssignTail(int line)
        {
            var a = new AAssign { Line = line };
            while (true)
            {
                var save = _i;
                var span = TryOperandSpan(_i, allowCall: false);
                if (span is { IsCall: false } s)
                {
                    _i = s.Next;
                    if (AssignOp() is { } op)
                    {
                        a.Targets.Add((s.Text, op));
                        continue;
                    }
                }
                _i = save;
                break;
            }
            if (a.Targets.Count == 0)
                throw Error(Peek() is { Kind: Tk.Ident } && Is(":", 1) ? "a label stands first in its network: it is the network's label"
                    : "a statement (an assignment, a call, a jump or a return)");
            a.Value = Expr();
            return a;
        }

        private string? AssignOp()
        {
            if (Is(":=")) { _i++; return ":="; }
            if (Peek() is { Kind: Tk.Ident } w && (w.Text == "S" || w.Text == "R") && Is("=", 1) && _t[_i + 1].Start == w.End)
            {
                _i += 2;
                return w.Text + "=";
            }
            return null;
        }

        // Precedence: OR < XOR < AND < (= <>) < (< > <= >=) < (+ -) < (* / MOD) < NOT < primary.
        private static readonly (string Tok, string Type)[][] Levels =
        {
            new[] { ("OR", "OR") },
            new[] { ("XOR", "XOR") },
            new[] { ("AND", "AND"), ("&", "AND") },
            new[] { ("=", "EQ"), ("<>", "NE") },
            new[] { ("<", "LT"), (">", "GT"), ("<=", "LE"), (">=", "GE") },
            new[] { ("+", "ADD"), ("-", "SUB") },
            new[] { ("*", "MUL"), ("/", "DIV"), ("MOD", "MOD") },
        };

        /// <summary>The operators an ST expression holds and only an operand's expression may (network text spells each of
        /// these boxes as a call).</summary>
        private static readonly HashSet<string> CallOnly = new(StringComparer.Ordinal) { "XOR", "EQ", "NE", "LT", "GT", "LE", "GE", "ADD", "SUB", "MUL", "DIV", "MOD" };

        /// <summary>The extensible operators: one unbracketed chain of one of them is ONE box.</summary>
        private static readonly HashSet<string> Extensible = new(StringComparer.Ordinal) { "AND", "OR", "XOR", "ADD", "MUL" };

        public AExpr Expr() => Level(0);

        private AExpr Level(int k)
        {
            if (k == Levels.Length) return Unary();
            var left = Level(k + 1);
            ABin? cur = null;
            while (true)
            {
                var op = Levels[k].FirstOrDefault(o => Peek() is { } t &&
                    (t.Kind == Tk.Sym && t.Text == o.Tok || t.Kind == Tk.Ident && string.Equals(t.Text, o.Tok, StringComparison.OrdinalIgnoreCase) && char.IsLetter(o.Tok[0])));
                if (op.Type is null) break;
                if (Network && (CallOnly.Contains(op.Type) || op.Tok == "&"))
                    throw Error($"an infix '{op.Tok}': in a network every box is a call ({op.Type}(a, b)), and only contacts are infix AND / OR");
                var line = Line;
                _i++;
                var right = Level(k + 1);
                // One unbracketed chain of an extensible operator is ONE box: `a AND b AND c`.
                if (cur is not null && cur.Type == op.Type && Extensible.Contains(op.Type)) cur.Operands.Add(right);
                else cur = new ABin { Type = op.Type, Operands = { cur ?? left, right }, Line = line };
            }
            return cur ?? left;
        }

        /// <summary>A keyword operator heading a call at the current position (<c>AND(</c>, <c>GT</c> is no keyword), as its
        /// box type; null otherwise.</summary>
        private string? KeywordCallHead() =>
            Peek() is { Kind: Tk.Ident } t && Is("(", 1) && new[] { "AND", "OR", "XOR", "MOD", "NOT" }.FirstOrDefault(w =>
                string.Equals(t.Text, w, StringComparison.OrdinalIgnoreCase)) is { } op ? op : null;

        private AExpr Unary()
        {
            var line = Line;
            if (KeywordCallHead() is { } op)
            {
                _i++;
                return CallArgs(op, line);
            }
            if (IsWord("NOT"))
            {
                _i++;
                var inner = Unary();
                if (Network && inner is not AOperand)
                    throw new StNetworkReadException(line, "NOT before a call, a wire or another NOT: NOT before an operand is a negated contact, and the NOT box is NOT(…)");
                return new ANot { Inner = inner, Line = line };
            }
            if (Is("-") && Peek(1) is { Kind: Tk.Literal } n && n.Start == _t[_i].End && char.IsDigit(n.Text[0]))
            {
                _i += 2;
                return new AOperand { Text = _src.Substring(_t[_i - 2].Start, n.End - _t[_i - 2].Start), Line = line };
            }
            if (Is("("))
            {
                // A nested assignment `(t := v)`, else a bracketed expression.
                var save = _i;
                _i++;
                if (TryOperandSpan(_i, allowCall: false) is { IsCall: false } s)
                {
                    _i = s.Next;
                    if (AssignOp() is not null)
                    {
                        _i = save + 1;
                        var a = AssignTail(line);
                        Expect(")");
                        return a;
                    }
                }
                _i = save + 1;
                var e = Expr();
                Expect(")");
                return e;
            }
            var span = TryOperandSpan(_i, allowCall: true) ?? throw Error("an operand");
            _i = span.Next;
            if (span.IsCall) return CallArgs(span.Text, line);
            return _isWire(span.Text) ? new AWire { Name = span.Text, Line = line } : new AOperand { Text = span.Text, Line = line };
        }

        /// <summary>After the head: <c>(args)</c>.</summary>
        private ACall CallArgs(string head, int line)
        {
            var call = new ACall { Head = head, Line = line };
            if (head.StartsWith("@", StringComparison.Ordinal) && !Is("(")) return call;
            Expect("(");
            if (Is(")")) { _i++; return call; }
            while (true)
            {
                if (Peek() is { Kind: Tk.Ident } f && Is("=>", 1))
                {
                    _i += 2;
                    var span = TryOperandSpan(_i, allowCall: false) ?? throw Error("an output target");
                    if (span.IsCall) throw Error("an output target");
                    _i = span.Next;
                    call.Args.Add(new AArg { Formal = f.Text, Out = true, Target = span.Text });
                }
                else if (Peek() is { Kind: Tk.Ident } g && Is(":=", 1) && !IsKeyword(g.Text))
                {
                    _i += 2;
                    call.Args.Add(new AArg { Formal = g.Text, Value = Expr() });
                }
                else call.Args.Add(new AArg { Value = Expr() });
                if (Is(",")) { _i++; continue; }
                Expect(")");
                return call;
            }
        }

        public readonly struct Span
        {
            public Span(string text, int next, bool isCall) { Text = text; Next = next; IsCall = isCall; }
            public string Text { get; }
            public int Next { get; }
            public bool IsCall { get; }
        }

        /// <summary>An operand at token <paramref name="at"/> — a literal, <c>???</c>, or a name chain
        /// (<c>a.b[i + 1]^.c</c>) — as its exact source text; with a <c>(</c> after a chain, a call head.</summary>
        public Span? TryOperandSpan(int at, bool allowCall)
        {
            if (at >= _t.Count) return null;
            var first = _t[at];
            if (first.Kind == Tk.Literal) return new Span(first.Text, at + 1, false);
            if (first.Kind != Tk.Ident || IsKeyword(first.Text)) return null;
            if (first.Text.StartsWith("@", StringComparison.Ordinal)) return new Span(first.Text, at + 1, isCall: true);
            if (first.Text == "???")
                return new Span(first.Text, at + 1, at + 1 < _t.Count && _t[at + 1].Text == "(" && allowCall);
            var k = at + 1;
            while (k < _t.Count)
            {
                var t = _t[k];
                if (t.Text == "." && t.Kind == Tk.Sym && k + 1 < _t.Count && (_t[k + 1].Kind == Tk.Ident && !IsKeyword(_t[k + 1].Text) || _t[k + 1].Kind == Tk.Literal && char.IsDigit(_t[k + 1].Text[0]) || _t[k + 1].Text.StartsWith("%", StringComparison.Ordinal)))
                {
                    k += 2;
                    continue;
                }
                if (t.Text == "^" && t.Kind == Tk.Sym) { k++; continue; }
                if (t.Text == "[" && t.Kind == Tk.Sym)
                {
                    var depth = 0;
                    for (; k < _t.Count; k++)
                    {
                        if (_t[k].Text == "[") depth++;
                        else if (_t[k].Text == "]" && --depth == 0) break;
                    }
                    if (k >= _t.Count) return null;
                    k++;
                    continue;
                }
                break;
            }
            var text = _src.Substring(first.Start, _t[k - 1].End - first.Start);
            var isCall = k < _t.Count && _t[k].Text == "(" && _t[k].Kind == Tk.Sym;
            return new Span(text, k, isCall && allowCall);
        }
    }

    // ── AST → model ──────────────────────────────────────────────────────────────────────────────────────────────

    private sealed class Builder
    {
        private readonly NetworkReader _net;
        private readonly List<AStmt> _stmts;
        private readonly int _firstLine;
        private readonly Dictionary<string, int> _reads = new(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, ACall> _pending = new(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, int> _pendingAt = new(StringComparer.OrdinalIgnoreCase);
        private readonly HashSet<string> _spliced = new(StringComparer.OrdinalIgnoreCase);
        private readonly HashSet<string> _defined = new(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, int> _definedAt = new(StringComparer.OrdinalIgnoreCase);

        /// <summary>The index of the statement whose text is being read: an item, or a call statement spliced into it.</summary>
        private int _at;

        public Builder(NetworkReader net, List<AStmt> stmts, int firstLine)
        {
            _net = net;
            _stmts = stmts;
            _firstLine = firstLine;
        }

        private static StNetworkReadException Error(int line, string what) => new(line, what);

        /// <summary>An enabled box other than a comparison read by its value anywhere but as a coil's value (inside a box, as a
        /// jump's condition, as another wire's definition), read once or through a wire read twice (1.4).</summary>
        private static StNetworkReadException EnabledValueNotACoil(int line, string head) =>
            Error(line, $"the enabled box {head} is read by its value where it is no coil's value: a box with EN can be used for comparison operators only (CODESYS), and any other is read by its value only as a coil's value");

        /// <summary>The wires an enabled box other than a comparison defines by its value (<c>OUT =&gt;</c>), read twice or more.</summary>
        private readonly Dictionary<string, string> _enabledValue = new(StringComparer.OrdinalIgnoreCase);

        public Node Tree(AExpr e) => Expr(e);

        public List<Node> Build()
        {
            foreach (var s in _stmts) Count(s);
            var items = new List<Node>();
            var pendingWire = new Dictionary<AStmt, string>();
            for (var k = 0; k < _stmts.Count; k++)
                if (_stmts[k] is SCall c && WireOut(c.Call) is { } w && Reads(w.Target!) == 1)
                {
                    _pending[w.Target!] = c.Call;
                    _pendingAt[w.Target!] = k;
                    pendingWire[_stmts[k]] = w.Target!;
                }
            // A call statement read once is the box itself, STANDING WHERE IT IS READ: the run of such calls right before an
            // item is that item's, each read by it or by a call of the run read by it. The model runs a box where it is read,
            // so a call the text runs elsewhere (after its reader, or past another statement) would run in another order
            // than the text spells.
            var run = new List<AStmt>();
            for (var k = 0; k < _stmts.Count; k++)
            {
                var s = _stmts[k];
                if (pendingWire.ContainsKey(s))
                {
                    run.Add(s);
                    continue;
                }
                _at = k;
                items.Add(Item(s));
                foreach (var p in run)
                    if (!_spliced.Contains(pendingWire[p]))
                        throw Error(p.Line, $"the call {((SCall)p).Call.Head} defines the wire {pendingWire[p]}, read once, and does not stand directly before the statement that reads it: a box read once stands where it is read");
                run.Clear();
            }
            foreach (var p in _pending.Keys)
                if (!_spliced.Contains(p)) throw Error(_firstLine, $"the wire {p} is defined and never read after its definition");
            foreach (var w in _net.Wires)
            {
                if (!_defined.Contains(w) && !_pending.ContainsKey(w)) throw Error(_firstLine, $"the wire {w} is named and never defined");
                if (Reads(w) == 0) throw Error(_firstLine, $"the wire {w} is defined and never read");
            }
            return NumberDemuxIds(items);
        }

        private int Reads(string wire) => _reads.TryGetValue(wire, out var n) ? n : 0;

        private void Count(AStmt s)
        {
            switch (s)
            {
                case SAssign a: Count(a.Assign); break;
                case SCall c: Count(c.Call); break;
                case SControl k: Count(k.Condition); break;
            }
        }

        private void Count(AExpr? e)
        {
            switch (e)
            {
                case AWire w: _reads[w.Name] = Reads(w.Name) + 1; break;
                case ANot n: Count(n.Inner); break;
                case ABin b: foreach (var o in b.Operands) Count(o); break;
                case AAssign a: Count(a.Value); break;
                case ACall c: foreach (var x in c.Args) Count(x.Value); break;
            }
        }

        private AArg? WireOut(ACall c)
        {
            var outs = c.Args.Where(a => a.Out && _net.IsWire(a.Target!)).ToList();
            if (outs.Count > 1) throw Error(c.Line, $"the call {c.Head} defines {outs.Count} wires: a box defines one");
            return outs.FirstOrDefault();
        }

        private int VarId(string wire, int line)
        {
            if (!_defined.Add(wire)) throw Error(line, $"the wire {wire} is defined twice");
            _definedAt[wire] = _at;
            return WireId(wire) ?? throw Error(line, $"the wire '{wire}' is not w<n>");
        }

        private Node Item(AStmt s)
        {
            switch (s)
            {
                case SControl k:
                {
                    var value = k.Condition is null ? new Terminator(Flags.None) : Expr(k.Condition);
                    if (k.Jump is { } l)
                        return new Assign(value, new[] { new Operand(l, IsLValue: true, Flags: Flags.None with { Jump = true }) }, Flags.None with { Jump = true });
                    return new Assign(value, new[] { new Operand(Box.UnnamedInstance, IsLValue: true, Flags: Flags.None with { Return = true }) },
                        Flags.None with { Return = true });
                }
                case SAssign a when IsWireDefinition(a.Assign):
                {
                    var name = a.Assign.Targets[0].Text;
                    // `w2 := w1;` over a box read once through w1 is the box defining w2: the call names w2 itself, so one
                    // model has one text.
                    if (a.Assign.Value is AWire { } via && _pending.TryGetValue(via.Name, out var box))
                        throw Error(s.Line, $"the wire {name} is defined by the box {box.Head}, read once through the wire {via.Name}: the box defines the wire itself ({WireOut(box)!.Formal} => {name})");
                    if (Reads(name) < 2)
                        throw Error(s.Line, $"the wire {name} is read {Reads(name)} time(s): a wire defined by an expression is read twice or more (written inline when read once)");
                    return new Demux(VarId(name, s.Line), Expr(a.Assign.Value));
                }
                case SAssign a: return Assign(a.Assign);
                case SCall c:
                {
                    var wireOut = WireOut(c.Call);
                    if (wireOut is not null && EnabledByValue(c.Call) is { } valueType && !NetworkSpelling.Comparisons.Contains(valueType))
                        _enabledValue[wireOut.Target!] = c.Call.Head;
                    var box = CallBox(c.Call, consumed: wireOut is not null);
                    return wireOut is null ? box : new Demux(VarId(wireOut.Target!, s.Line), box);
                }
                default: throw Error(s.Line, "an unknown statement");
            }
        }

        private bool IsWireDefinition(AAssign a) =>
            a.Targets.Count == 1 && a.Targets[0].Op == ":=" && _net.IsWire(a.Targets[0].Text);

        private Node Assign(AAssign a)
        {
            if (IsWireDefinition(a)) return new Demux(VarId(a.Targets[0].Text, a.Line), Expr(a.Value));
            foreach (var t in a.Targets)
                if (_net.IsWire(t.Text)) throw Error(a.Line, $"the wire {t.Text} is assigned beside other targets: a wire is defined alone");
            var targets = a.Targets.Select(t => new Operand(t.Text, IsLValue: true,
                Flags: t.Op == "S=" ? Flags.None with { Set = true } : t.Op == "R=" ? Flags.None with { Reset = true } : null)).ToList();
            return new Assign(Expr(a.Value, assignValue: true), targets, Flags.None);
        }

        /// <param name="assignValue">The expression is an assignment's whole value: the one place an enabled box other than a
        /// comparison is read by its value (1.4: CODESYS refuses it inside a box).</param>
        private Node Expr(AExpr e, bool assignValue = false)
        {
            switch (e)
            {
                case AOperand o:
                    if (_net.IsForeignWire(o.Text)) throw Error(o.Line, $"the wire {o.Text} is read outside its network: a wire is its network's");
                    return new Leaf(new Operand(o.Text), Flags.None);
                case AWire w:
                    if (_pending.TryGetValue(w.Name, out var call))
                    {
                        var at = _pendingAt[w.Name];
                        if (at > _at) throw Error(w.Line, $"the wire {w.Name} is read before it is defined");
                        if (!assignValue && EnabledByValue(call) is { } type && !NetworkSpelling.Comparisons.Contains(type))
                            throw EnabledValueNotACoil(w.Line, call.Head);
                        _spliced.Add(w.Name);
                        var reader = _at;
                        _at = at;
                        var box = CallBox(call, consumed: true);
                        _at = reader;
                        return box;
                    }
                    if (Reads(w.Name) < 2) throw Error(w.Line, $"the wire {w.Name} is read once and is no call's output: a wire read once is the box that defines it");
                    if (!_defined.Contains(w.Name) || _definedAt[w.Name] > _at) throw Error(w.Line, $"the wire {w.Name} is read before it is defined");
                    if (!assignValue && _enabledValue.TryGetValue(w.Name, out var enabledHead)) throw EnabledValueNotACoil(w.Line, enabledHead);
                    return new Demux(WireId(w.Name)!.Value, null);
                case ANot n:
                {
                    var inner = Expr(n.Inner);
                    return inner is Leaf { Flags.IsNone: true } l && n.Inner is AOperand
                        ? l with { Flags = Flags.None with { Negated = true } }
                        : StNetworkWriter.NotBox(inner);
                }
                case ABin b:
                    return new Box(b.Type, null, CallKind.Operator, b.Operands.Select(o => new Input(null, Expr(o), Flags.None)).ToList(),
                        Array.Empty<Output>(), null, null, Flags.None, ConnectedSlot: NetworkSpelling.MainSlotOfCall(b.Type),
                        Members: StNetworkWriter.ElementMembers(b.Type, contact: true));
                case AAssign a: return Assign(a);
                case ACall c:
                    if (WireOut(c) is { } wo)
                        throw Error(c.Line, $"the call {c.Head} is read by its return and defines the wire {wo.Target}: a box read where it stands has no wire");
                    return CallBox(c, consumed: true);
                default: throw Error(e.Line, "an unknown expression");
            }
        }

        /// <summary>The box type of an enabled FUNCTION box whose value leaves through <c>OUT =&gt;</c> a wire, else null.</summary>
        private string? EnabledByValue(ACall c)
        {
            var head = c.Head;
            if (!head.EndsWith(StNetworkWriter.EnabledSuffix, StringComparison.OrdinalIgnoreCase) || head.Length <= StNetworkWriter.EnabledSuffix.Length)
                return null;
            var type = head.Substring(0, head.Length - StNetworkWriter.EnabledSuffix.Length);
            if (_net.InstanceType(type) is not null) return null;
            return c.Args.Any(a => a.Out && _net.IsWire(a.Target!) && string.Equals(a.Formal, StNetworkWriter.ResultPin, StringComparison.OrdinalIgnoreCase))
                ? type
                : null;
        }

        private Box CallBox(ACall c, bool consumed)
        {
            string type;
            Operand? instance = null;
            string? stCode = null;
            var enabled = false;
            if (c.Head.StartsWith("@EXEC", StringComparison.Ordinal))
            {
                type = NetworkSpelling.ExecuteType;
                stCode = _net.Snippet(int.Parse(c.Head.Substring(5), CultureInfo.InvariantCulture));
                enabled = c.Args.Count > 0 && !c.Args[0].Out && string.Equals(c.Args[0].Formal, Box.EnablePin, StringComparison.OrdinalIgnoreCase);
            }
            else
            {
                var head = c.Head;
                // `X_EN(…)` is the enabled box of X: anything declared in reach under that very name (a POU, an instance, a
                // variable) would give the text a second meaning, which the writer refuses to write, so the reader refuses
                // to read it.
                if (head.EndsWith(StNetworkWriter.EnabledSuffix, StringComparison.OrdinalIgnoreCase) && _net.InReach(head))
                    throw Error(c.Line, $"the call {head} names something declared in reach (a POU, an instance or a variable) whose name ends in {StNetworkWriter.EnabledSuffix}, which the text reads as an enabled box");
                if (head.EndsWith(StNetworkWriter.EnabledSuffix, StringComparison.OrdinalIgnoreCase)
                    && head.Length > StNetworkWriter.EnabledSuffix.Length)
                {
                    enabled = true;
                    head = head.Substring(0, head.Length - StNetworkWriter.EnabledSuffix.Length);
                    if (c.Args.Count == 0 || c.Args[0].Out || !string.Equals(c.Args[0].Formal, Box.EnablePin, StringComparison.OrdinalIgnoreCase))
                        throw Error(c.Line, $"the enabled box {c.Head} takes EN := as its first argument");
                }
                if (_net.InstanceType(head) is { } fbType)
                {
                    type = fbType;
                    instance = new Operand(head, IsInstance: true);
                }
                else type = head.ToUpperInvariant() is var up && StNetworkWriter.IsKeywordOperator(up) ? up : head;
            }

            Node? enable = null;
            var inputs = new List<Input>();
            var outputs = new List<(string? Formal, string Target)>();
            string? byName = null;
            var byEno = false;
            var byValue = false;
            var function = instance is null && stCode is null;
            if (c.Args.Count(a => a.Out && string.Equals(a.Formal, StNetworkWriter.ResultPin, StringComparison.OrdinalIgnoreCase)) > 1 && function)
                throw Error(c.Line, $"the call {c.Head} names {StNetworkWriter.ResultPin} twice: a box has one value");
            for (var k = 0; k < c.Args.Count; k++)
            {
                var a = c.Args[k];
                if (a.Out)
                {
                    var isEno = string.Equals(a.Formal, Box.EnoPin, StringComparison.OrdinalIgnoreCase);
                    if (_net.IsWire(a.Target!))
                    {
                        if (isEno && (enabled || stCode is not null)) byEno = true;
                        else if (function && enabled && string.Equals(a.Formal, StNetworkWriter.ResultPin, StringComparison.OrdinalIgnoreCase)) byValue = true;
                        else if (instance is null)
                            throw Error(c.Line, $"the call {c.Head} defines the wire {a.Target} through '{a.Formal}': an FB is read through an output, an enabled box through its ENO or its value ({StNetworkWriter.ResultPin})");
                        else byName = a.Formal;
                        continue;
                    }
                    if (enabled && isEno && instance is null)
                        throw Error(c.Line, $"the enabled box {c.Head} returns its ENO: it is read as the call's value, not wired with ENO =>");
                    // `OUT =>` is a function's result pin; on an FB call it is the FB's own output named OUT.
                    outputs.Add((string.Equals(a.Formal, StNetworkWriter.ResultPin, StringComparison.OrdinalIgnoreCase) && instance is null ? null : a.Formal, a.Target!));
                    continue;
                }
                if (k == 0 && enabled)
                {
                    enable = Expr(a.Value!);
                    continue;
                }
                inputs.Add(new Input(a.Formal, Expr(a.Value!), Flags.None));
            }
            if (enabled && enable is null) throw Error(c.Line, $"the enabled box {c.Head} has no EN := argument");
            // `X_EN` shows EN and ENO, its return being the ENO; read by its value (`OUT =>` a wire) it shows no ENO, as
            // CODESYS stores an enabled comparison read by its value (1.3).
            var hasEno = stCode is not null || enabled && !byValue;
            int? connected = !consumed ? null
                : byEno ? 0
                : byName is not null ? null
                : hasEno ? 0
                : NetworkSpelling.MainSlotOfCall(type);
            var eno = hasEno ? 0 : (int?)null;
            var next = 0;
            var outs = new List<Output>();
            foreach (var (formal, target) in outputs)
            {
                if (formal is not null) { outs.Add(new Output(formal, new Operand(target, IsLValue: true))); continue; }
                next = NetworkSpelling.NextFreeSlot(next, eno, connected);
                outs.Add(new Output(null, new Operand(target, IsLValue: true), next++));
            }
            return new Box(type, instance, NetworkSpelling.KindOf(type, instance is not null), inputs, outs, enable, stCode, Flags.None,
                ConnectedSlot: connected, HasEnoOutput: hasEno, MainOutputName: byName,
                Members: enabled || instance is not null || outs.Count > 0 ? null : StNetworkWriter.ElementMembers(type, contact: false));
        }
    }

    /// <summary>
    /// THE DEMUX IDS A TEXT READ STATES: a wire's name is not the vendor's VarId (the writer names wires across the body, design.md
    /// 1.4), so a read numbers each network's Demux nodes 1, 2, … in the order their definitions stand — the trees in item order,
    /// each node before its children, the enable before the pins.
    /// </summary>
    private static List<Node> NumberDemuxIds(IReadOnlyList<Node> trees)
    {
        var ids = new Dictionary<int, int>();
        void Walk(Node? n)
        {
            if (n is null) return;
            if (n is Demux { Input: not null } d && !ids.ContainsKey(d.VarId)) ids[d.VarId] = ids.Count + 1;
            foreach (var c in n.Children()) Walk(c);
        }
        foreach (var t in trees) Walk(t);
        return trees.Select(t => MapDemuxIds(t, ids)).ToList();
    }

    private static Node MapDemuxIds(Node n, IReadOnlyDictionary<int, int> ids) => n switch
    {
        Demux d => new Demux(ids.TryGetValue(d.VarId, out var id) ? id : d.VarId, d.Input is null ? null : MapDemuxIds(d.Input, ids)),
        Assign a => a with { Value = MapDemuxIds(a.Value, ids) },
        Box b => b with
        {
            Enable = b.Enable is null ? null : MapDemuxIds(b.Enable, ids),
            Inputs = b.Inputs.Select(i => i with { Value = MapDemuxIds(i.Value, ids) }).ToList(),
        },
        Parallel p => new Parallel(p.Input is null ? null : MapDemuxIds(p.Input, ids), p.Branches.Select(x => MapDemuxIds(x, ids)).ToList(), p.Mode),
        _ => n,
    };
}

/// <summary>A plain-ST network text the reader refuses: what, and the 1-based line of the body it stands on.</summary>
public sealed class StNetworkReadException : Exception
{
    public StNetworkReadException(int line, string message) : base($"line {line}: {message}") => Line = line;

    public int Line { get; }
}
