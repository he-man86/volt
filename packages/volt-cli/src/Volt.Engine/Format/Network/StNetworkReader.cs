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
/// formal and positional pins, the infix operators by ST precedence, <c>NOT</c> and the marks, <c>JMP.l</c> /
/// <c>RETURN</c> targets, a leading label, and the <c>%</c> lines. Anything else is refused by name, with its line.
///
/// <para>The call is the box (openspec network-output-member): a call of an FB instance in reach is an FB box of the
/// instance's declared type, a call of an FB type the box with no instance (<c>???</c>); <c>EN :=</c> first is the shown EN
/// and <c>.ENO</c> closing the call the shown
/// ENO, where the callee declares no <c>EN</c>/<c>ENO</c> of its own; any other <c>.NAME</c> names the output a consumer
/// reads, required where the callee declares more than one data output and refused where it declares one
/// (<see cref="NetworkSpelling.SignatureOf(string, bool, NetworkScope)"/>). A statement is an assignment, a call, a call
/// closed by <c>.ENO</c>, a jump or a return, a label. A name its network declares <c>VAR w1 : ANY; END_VAR</c> is a wire: a Demux over its
/// definition, read by its name any number of times. <c>BRANCH</c>, <c>BRANCH_SHORTCIRCUIT</c>, <c>RISING</c>, <c>RAIL</c> and
/// <c>FALLING</c> are the text's own elements (<see cref="StNetworkWriter.ElementHeads"/>), and <c>EXECUTE(EN := e,
/// '&lt;ST&gt;')</c> the Execute box, its ST the one string that spans lines.</para>
///
/// <para>The push reads every LD/FBD body through it (<see cref="StNetworkGate"/>, <see cref="NetworkBodyReader"/>), as
/// the round-trip oracle does.</para>
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
        char? open = null;
        for (var k = 0; k < lines.Count; k++)
        {
            if (open is null && IsWiresLine(lines[k])) allWires.UnionWith(WireDeclaration(lines[k], k + 1));
            open = OpenQuoteAfter(lines[k], open);
        }
        var i = 1;
        var readers = new List<NetworkReader>();
        while (i < lines.Count)
        {
            if (!IsNetworkLine(lines[i]))
                throw new StNetworkReadException(i + 1, $"'{lines[i]}' where a {StNetworkWriter.NetworkLine} line stands");
            var start = i;
            open = OpenQuoteAfter(lines[i++], null);
            while (i < lines.Count && (open is not null || !IsNetworkLine(lines[i]))) open = OpenQuoteAfter(lines[i++], open);
            var reader = new NetworkReader(lines.GetRange(start, Math.Min(i, lines.Count) - start), start + 1, nets.Count, scope, bodyWires, allWires);
            nets.Add(reader.Read());
            readers.Add(reader);
        }
        var body = new NetworkBody(lang, nets);
        RequireWriterNumbering(body, scope, readers);
        return body;
    }

    /// <summary>THE WIRE NAMES THE WRITER GIVES (<see cref="StNetworkWriter.BodyWires"/>): <c>w1</c>, <c>w2</c>, … across the
    /// body, in the order the text first names them, past every name the body's operands use and every name in reach. Any
    /// other numbering is a second text of one model, refused by name.</summary>
    private static void RequireWriterNumbering(NetworkBody body, NetworkScope scope, IReadOnlyList<NetworkReader> readers)
    {
        var names = new StNetworkWriter.BodyWires(body, scope);
        foreach (var r in readers)
        {
            var declared = r.Declared;
            for (var k = 0; k < r.FirstNamed.Count; k++)
            {
                var expected = names.New();
                var wire = r.FirstNamed[k];
                if (!string.Equals(wire, expected, StringComparison.Ordinal))
                    throw new StNetworkReadException(r.DeclarationLine, $"the wire {wire} is the body's {expected}: a body's wires are w1, w2, … across its networks, in the order the text first names them");
                if (!string.Equals(declared[k], wire, StringComparison.Ordinal))
                    throw new StNetworkReadException(r.DeclarationLine, $"the wire {declared[k]} is the body's {wire}: a network declares its wires in the order the text first names them");
            }
        }
    }

    /// <summary>Whether <paramref name="line"/> declares wires: its first word <c>VAR</c>, in any case.</summary>
    private static bool IsWiresLine(string line) =>
        string.Equals(FirstWord(line), StNetworkWriter.WiresOpen, StringComparison.OrdinalIgnoreCase);

    private static string FirstWord(string line)
    {
        var t = line.TrimStart();
        var k = 0;
        while (k < t.Length && (char.IsLetterOrDigit(t[k]) || t[k] == '_')) k++;
        return t.Substring(0, k);
    }

    /// <summary>THE WIRES A NETWORK DECLARES (owner, 2026-10-28): one line <c>VAR w1 : ANY; w2 : ANY; END_VAR</c>, each
    /// <c>: ANY</c> — the type is its definition's, which the text does not state.</summary>
    private static IReadOnlyList<string> WireDeclaration(string line, int lineNo)
    {
        var form = $"a network's wires are declared on one line, {StNetworkWriter.WiresOpen} w1 : {StNetworkWriter.WireType}; w2 : {StNetworkWriter.WireType}; {StNetworkWriter.WiresClose}";
        List<Tok> t;
        try { t = Lex(line, _ => lineNo); }
        catch (StNetworkReadException e) { throw new StNetworkReadException(lineNo, form + ", not " + e.Message); }
        static bool Word(Tok tok, string w) => tok.Kind == Tk.Ident && string.Equals(tok.Text, w, StringComparison.OrdinalIgnoreCase);
        if (t.Count < 2 || !Word(t[t.Count - 1], StNetworkWriter.WiresClose)) throw new StNetworkReadException(lineNo, form);
        var names = new List<string>();
        for (var k = 1; k < t.Count - 1; k += 4)
        {
            if (k + 3 >= t.Count - 1 || t[k].Kind != Tk.Ident || t[k + 1].Text != ":" || t[k + 2].Kind != Tk.Ident || t[k + 3].Text != ";")
                throw new StNetworkReadException(lineNo, form);
            if (!Word(t[k + 2], StNetworkWriter.WireType))
                throw new StNetworkReadException(lineNo, $"the wire {t[k].Text} is declared {t[k + 2].Text}: a wire is declared : {StNetworkWriter.WireType}, its type its definition's");
            names.Add(t[k].Text);
        }
        if (names.Count == 0) throw new StNetworkReadException(lineNo, form);
        return names;
    }

    private static bool IsNetworkLine(string line) =>
        line == StNetworkWriter.NetworkLine || line.StartsWith(StNetworkWriter.NetworkLine + " ", StringComparison.Ordinal);

    /// <summary>The quote of the string still open at the end of <paramref name="line"/>, which starts inside the string
    /// <paramref name="open"/> opened (null: outside one). The Execute box's CODE is the one string that spans lines, and a
    /// line inside it is its ST, no line of the text.</summary>
    private static char? OpenQuoteAfter(string line, char? open)
    {
        for (var k = 0; k < line.Length; k++)
        {
            var c = line[k];
            if (open is { } q)
            {
                if (c == '$') k++;
                else if (c == q) open = null;
            }
            else if (c == '\'' || c == '"') open = c;
            else if (c == '/' && k + 1 < line.Length && line[k + 1] == '/') break;
        }
        return open;
    }

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
            new[] { StNetworkWriter.NetworkLine, StNetworkWriter.DisabledLine, StNetworkWriter.UnsupportedLine }
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
                if (h.Length == 2) throw Error(0, $"an empty title \"\": a network with no title is the line {StNetworkWriter.NetworkLine} alone");
                title = NetworkSpelling.Unescape(h.Substring(1, h.Length - 2), '"', out var err) ?? throw Error(0, err!);
            }
            var i = 1;
            var disabled = false;
            string? unsupported = null, hash = null;
            if (i < _lines.Count && _lines[i] == StNetworkWriter.DisabledLine) { disabled = true; i++; }
            if (i < _lines.Count && IsWiresLine(_lines[i]))
            {
                DeclarationLine = _firstLine + i;
                foreach (var w in WireDeclaration(_lines[i], _firstLine + i))
                {
                    if (WireId(w) is null) throw Error(i, $"the wire '{w}': a wire is w<n>");
                    if (_scope.Contains(w) || _scope.InstanceType(w) is not null)
                        throw Error(i, $"the wire '{w}' is also a name declared in reach: a wire is never a variable");
                    if (!_wires.Add(w)) throw Error(i, $"the wire '{w}' is named twice");
                    Declared.Add(w);
                    if (!_bodyWires.Add(w)) throw Error(i, $"the wire '{w}' is named on an earlier network too: a wire name is one network's in a body");
                }
                i++;
            }
            var comment = new List<string>();
            while (i < _lines.Count && _lines[i].StartsWith("//", StringComparison.Ordinal))
            {
                var c = _lines[i++].Substring(2);
                comment.Add(NetworkSpelling.Unescape(c.StartsWith(" ", StringComparison.Ordinal) ? c.Substring(1) : c, null, out var err)
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
                i++;
            }

            // The code: a line inside the Execute box's CODE string is its ST, no line of the text.
            var code = new StringBuilder();
            var lineOf = new List<int>();   // code line → index into _lines
            char? open = null;
            for (; i < _lines.Count; i++)
            {
                var line = _lines[i];
                if (open is null)
                {
                    if (line.StartsWith("%", StringComparison.Ordinal))
                        throw Error(i, KnownLine(line)
                            ? $"the line '{line}' among the code: a network's % lines stand first, {StNetworkWriter.NetworkLine} then {StNetworkWriter.DisabledLine}"
                            : $"'{line}': a network holds no such line");
                    if (IsWiresLine(line))
                        throw Error(i, $"{StNetworkWriter.WiresOpen} after the network's comment or code: its wires are declared after its % lines, before its comment");
                    if (FirstWord(line) is { } w && string.Equals(w, "VAR_TEMP", StringComparison.OrdinalIgnoreCase))
                        throw Error(i, $"VAR_TEMP: a network's wires keep their value across scans, as ST's VAR does, and are declared {StNetworkWriter.WiresOpen} w1 : {StNetworkWriter.WireType}; {StNetworkWriter.WiresClose}");
                    if (line.TrimStart().StartsWith("//", StringComparison.Ordinal))
                        throw Error(i, "a comment after the code starts: a network's comment is its // lines before the code");
                }
                open = OpenQuoteAfter(line, open);
                code.Append(line).Append('\n');
                lineOf.Add(i);
            }

            var src = code.ToString();
            Func<int, int> bodyLine = k => _firstLine + lineOf[Math.Min(k, lineOf.Count - 1)];
            var toks = Lex(src, bodyLine);
            for (var k = 0; k < toks.Count; k++)
                if (toks[k].Kind == Tk.Ident && _wires.Contains(toks[k].Text) && !(k > 0 && toks[k - 1].Text == ".") &&
                    !FirstNamed.Contains(toks[k].Text, StringComparer.OrdinalIgnoreCase))
                    FirstNamed.Add(toks[k].Text);
            var parser = new Parser(src, toks, w => _wires.Contains(w), _firstLine, bodyLine) { Network = true };
            var (label, stmts) = parser.Statements();
            if (unsupported is not null && stmts.Count > 0)
                throw Error(0, $"a network shown {StNetworkWriter.UnsupportedLine} holds nothing else but its label");
            var trees = new Builder(this, stmts, _firstLine).Build();
            return new Network(_order, title, label, comment.Count == 0 ? null : string.Join("\r\n", comment), disabled,
                trees, unsupported, hash);
        }

        /// <summary>The wires its declaration line names, in order, and the line it stands on.</summary>
        public List<string> Declared { get; } = new();
        public int DeclarationLine { get; private set; }

        /// <summary>The wires in the order the code first names them.</summary>
        public List<string> FirstNamed { get; } = new();

        public NetworkScope Scope => _scope;
        public string? InstanceType(string head) => _scope.InstanceType(head);
        public bool IsBlockType(string head) => _scope.IsBlockType(head);
        /// <summary>Whether anything is declared in reach under <paramref name="name"/>: a POU, an instance or a variable.</summary>
        public bool InReach(string name) => _scope.Contains(name) || _scope.IsCallable(name);
        public IEnumerable<string> Wires => _wires;
        public bool IsWire(string name) => _wires.Contains(name);

        /// <summary>A name another network of the body names a wire: never this network's operand or target.</summary>
        public bool IsForeignWire(string name) => !_wires.Contains(name) && _allWires.Contains(name);
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
    private sealed class AAssign : AExpr { public List<ATarget> Targets = new(); public AExpr Value = null!; }
    /// <summary>One target of an assignment: a coil (its operand, its operator, the marks before it), a jump
    /// <c>JMP.label</c> or the return <c>RETURN</c>.</summary>
    private sealed class ATarget { public string Text = ""; public string Op = ":="; public List<string> Marks = new(); public bool Jump; public bool Return; }
    /// <summary>A call: <c>Head(args)</c>, closed by <c>.Member</c> where written.</summary>
    private sealed class ACall : AExpr { public string Head = ""; public List<AArg> Args = new(); public string? Member; }
    /// <summary>A pin of a call: its formal where named, the marks before it (<c>NOT IN := a</c>), its value or its output's
    /// target.</summary>
    private sealed class AArg { public string? Formal; public bool Out; public AExpr? Value; public string? Target; public List<string> Marks = new(); }

    private abstract class AStmt { public int Line; }
    private sealed class SAssign : AStmt { public AAssign Assign = null!; }
    private sealed class SCall : AStmt { public ACall Call = null!; }
    private sealed class SEmpty : AStmt { }

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
            if (char.IsLetter(c) || c == '_')
            {
                i++;
                while (i < s.Length && (char.IsLetterOrDigit(s[i]) || s[i] == '_')) i++;
                if (i < s.Length && s[i] == '#')
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
                // The Execute box's ST, `EXECUTE(…, '…')`, is the one string that spans lines: its code as it stands.
                var code = c == '\'' && toks.Count >= 1 && toks[toks.Count - 1] is { Kind: Tk.Sym, Text: "(" or "," } && InExecuteCall(toks);
                i++;
                while (i < s.Length && s[i] != c)
                {
                    if (s[i] == '$' && i + 1 < s.Length) i++;
                    if (s[i] == '\n' && !code) throw new StNetworkReadException(Line(i), "a string across a line: only the Execute box's ST spans lines");
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

    /// <summary>Whether the innermost bracket open at the end of <paramref name="toks"/> is an <c>EXECUTE(</c> call's: its ST,
    /// a positional string, is the one string that spans lines.</summary>
    private static bool InExecuteCall(List<Tok> toks)
    {
        var depth = 0;
        for (var k = toks.Count - 1; k >= 0; k--)
        {
            if (toks[k] is { Kind: Tk.Sym, Text: ")" }) depth++;
            else if (toks[k] is { Kind: Tk.Sym, Text: "(" } && depth-- == 0)
                return k > 0 && toks[k - 1].Kind == Tk.Ident &&
                       string.Equals(toks[k - 1].Text, StNetworkWriter.ExecuteHead, StringComparison.OrdinalIgnoreCase);
        }
        return false;
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
            if (IsWord("IF")) throw Error("a network holds no IF: a jump on a value is JMP.label := value, a return RETURN := value");
            foreach (var w in new[] { "FOR", "WHILE", "REPEAT", "CASE", "EXIT", "CONTINUE" })
                if (IsWord(w)) throw Error($"an LD/FBD network cannot hold a {w}");
            // ST's empty statement: the empty item.
            if (Is(";"))
            {
                _i++;
                return new SEmpty { Line = line };
            }
            if (IsWord("JMP") && !Is(".", 1) || IsWord("RETURN") && !Is(":=", 1) && !IsWord("S", 1) && !IsWord("R", 1)) throw Error(ControlForm);
            if (KeywordCallHead() is { } op)
            {
                _i++;
                return CallStatement(CallArgs(op, line), line);
            }
            var at = _i;
            if (TryTarget() is not null)
            {
                _i = at;
                var assign = AssignTail(line);
                Expect(";");
                return new SAssign { Assign = assign, Line = line };
            }
            _i = at;
            var span = TryOperandSpan(_i, allowCall: true) ?? throw Error("a statement (an assignment, a call, a jump or a return)");
            if (span.IsCall)
            {
                _i = span.Next;
                return CallStatement(CallArgs(span.Text, line), line);
            }
            _i = at;
            var a = AssignTail(line);
            Expect(";");
            return new SAssign { Assign = a, Line = line };
        }

        /// <summary>A call standing as a statement: a box at a root, its call closed by <c>.ENO</c> where it shows ENO and by
        /// nothing else — a root hands nothing on, so no other output is named.</summary>
        private SCall CallStatement(ACall call, int line)
        {
            if (call.Member is { } member && !string.Equals(member, Box.EnoPin, StringComparison.OrdinalIgnoreCase))
                throw new StNetworkReadException(line, $"the call {call.Head} stands as a statement closed by .{member}: a box at a root hands nothing on, and its call is closed by .ENO (it shows ENO) or by nothing");
            Expect(";");
            return new SCall { Call = call, Line = line };
        }

        /// <summary>The one form of a jump and a return: a target.</summary>
        private const string ControlForm =
            "a jump or a return is a target: JMP.label := value; RETURN := value; (on the rail, := RAIL())";

        /// <summary>The marks a network writes before a receiver or as a prefix: <c>NOT</c>, <c>RISING</c>, <c>FALLING</c>.</summary>
        private static readonly string[] MarkWords = { "NOT", StNetworkWriter.RisingHead, StNetworkWriter.FallingHead };

        /// <summary>A mark word at <paramref name="k"/> that heads no call (a word followed by <c>(</c> is a call).</summary>
        private bool IsMark(int k = 0) => MarkWords.Any(w => IsWord(w, k)) && !Is("(", k + 1);

        /// <summary>The mark words at the current position, consumed, in text order (outermost first).</summary>
        private List<string> Marks()
        {
            var marks = new List<string>();
            while (IsMark()) marks.Add(_t[_i++].Text.ToUpperInvariant());
            return marks;
        }

        /// <summary>A TARGET and its operator at the current position, consumed — the marks before it, then a coil's operand,
        /// <c>JMP.label</c> or <c>RETURN</c>, then <c>:=</c>, <c>S=</c> or <c>R=</c> — else null, nothing consumed: a complete
        /// operand followed by an assignment operator takes the marks before it on its receiver.</summary>
        private ATarget? TryTarget()
        {
            var save = _i;
            var marks = Network ? Marks() : new List<string>();
            ATarget? t = null;
            if (IsWord("JMP") && Is(".", 1) && Peek(2) is { Kind: Tk.Ident } l && !IsKeyword(l.Text))
            {
                _i += 3;
                t = new ATarget { Text = l.Text, Jump = true };
            }
            else if (IsWord("RETURN"))
            {
                _i++;
                t = new ATarget { Text = Box.UnnamedInstance, Return = true };
            }
            else if (TryOperandSpan(_i, allowCall: false) is { IsCall: false } s)
            {
                _i = s.Next;
                t = new ATarget { Text = s.Text };
            }
            if (t is not null && AssignOp() is { } op)
            {
                t.Op = op;
                t.Marks = marks;
                return t;
            }
            _i = save;
            return null;
        }

        /// <summary><c>t1 op t2 op … value</c> at the current position.</summary>
        private AAssign AssignTail(int line)
        {
            var a = new AAssign { Line = line };
            while (TryTarget() is { } t) a.Targets.Add(t);
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
            Peek() is { Kind: Tk.Ident } t && Is("(", 1) && new[] { "AND", "OR", "XOR", "MOD", "NOT" }.Any(w =>
                string.Equals(t.Text, w, StringComparison.OrdinalIgnoreCase)) ? t.Text : null;

        private AExpr Unary()
        {
            var line = Line;
            if (KeywordCallHead() is { } op)
            {
                _i++;
                return CallArgs(op, line);
            }
            if (Network && (IsWord("JMP") || IsWord("RETURN"))) throw Error(ControlForm);
            if (IsWord("NOT") && !Is("(", 1))
            {
                _i++;
                return new ANot { Inner = Unary(), Line = line };
            }
            if (Network && IsMark())
                throw Error("a value's edge is the call RISING(…) / FALLING(…); a mark word before a name marks a receiver, followed by :=, S=, R= or =>");
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
                if (TryTarget() is not null)
                {
                    _i = save + 1;
                    var a = AssignTail(line);
                    Expect(")");
                    return a;
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

        /// <summary>After the head: <c>(args)</c>, then the member closing the call, <c>.NAME</c>, where written.</summary>
        private ACall CallArgs(string head, int line)
        {
            var call = Args(head, line);
            if (Is(".") && Peek(1) is { Kind: Tk.Ident } m && !IsKeyword(m.Text))
            {
                call.Member = m.Text;
                _i += 2;
            }
            return call;
        }

        private ACall Args(string head, int line)
        {
            var call = new ACall { Head = head, Line = line };
            Expect("(");
            if (Is(")")) { _i++; return call; }
            while (true)
            {
                // The marks before a formal are the pin's (`NOT IN := a`, `NOT Q => x`); before anything else, the value's.
                var save = _i;
                var marks = Network ? Marks() : new List<string>();
                if (Peek() is { Kind: Tk.Ident } f && Is("=>", 1))
                {
                    _i += 2;
                    var span = TryOperandSpan(_i, allowCall: false) ?? throw Error("an output target");
                    if (span.IsCall) throw Error("an output target");
                    _i = span.Next;
                    call.Args.Add(new AArg { Formal = f.Text, Out = true, Target = span.Text, Marks = marks });
                }
                else if (Network && Is(":="))
                {
                    // THE EMPTY NAME: a pin the IDE stores unnamed, its marks before it (`AND(a, NOT := b)`); unmarked it is
                    // its value alone, one spelling.
                    if (marks.Count == 0) throw Error("an empty pin name with no mark: a pin with no name and no mark is its value alone");
                    _i++;
                    call.Args.Add(new AArg { Value = Expr(), Marks = marks });
                }
                else if (Peek() is { Kind: Tk.Ident } g && Is(":=", 1) && !IsKeyword(g.Text))
                {
                    _i += 2;
                    call.Args.Add(new AArg { Formal = g.Text, Value = Expr(), Marks = marks });
                }
                else
                {
                    _i = save;
                    call.Args.Add(new AArg { Value = Expr() });
                }
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
        private readonly HashSet<string> _defined = new(StringComparer.OrdinalIgnoreCase);

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

        /// <summary>The wires whose definition's whole value is an enabled box other than a comparison read by its value.</summary>
        private readonly Dictionary<string, string> _enabledValue = new(StringComparer.OrdinalIgnoreCase);

        public Node Tree(AExpr e) => Expr(e);

        public List<Node> Build()
        {
            var items = _stmts.Select(Item).ToList();
            foreach (var w in _net.Wires)
                if (!_defined.Contains(w)) throw Error(_firstLine, $"the wire {w} is named and never defined");
            return NumberDemuxIds(items);
        }

        private int VarId(string wire, int line)
        {
            if (!_defined.Add(wire)) throw Error(line, $"the wire {wire} is defined twice");
            return WireId(wire) ?? throw Error(line, $"the wire '{wire}' is not w<n>");
        }

        private Node Item(AStmt s)
        {
            switch (s)
            {
                case SAssign a when IsWireDefinition(a.Assign):
                {
                    var name = a.Assign.Targets[0].Text;
                    if (a.Assign.Targets[0].Marks.Count > 0) throw Error(s.Line, $"a mark on the wire {name}: a wire holds none, its producer or a consumer does");
                    // An enabled box other than a comparison is a wire's whole value only where every read of the wire is a
                    // coil's value.
                    if (a.Assign.Value is ACall valueCall && EnOnlyByValue(valueCall) is not null) _enabledValue[name] = valueCall.Head;
                    return new Demux(VarId(name, s.Line), Expr(a.Assign.Value, assignValue: true));
                }
                case SAssign a: return Assign(a.Assign);
                case SEmpty: return new Leaf(new Operand(""), Flags.None);
                case SCall c when ElementHead(c.Call.Head, c.Line) is not null:
                    throw Error(s.Line, $"the call {c.Call.Head} stands alone: a branch, an edge or the rail is a value in a tree");
                case SCall c: return CallBox(c.Call, consumed: false);
                default: throw Error(s.Line, "an unknown statement");
            }
        }

        private bool IsWireDefinition(AAssign a) =>
            a.Targets.Count == 1 && a.Targets[0] is { Op: ":=", Jump: false, Return: false } t && _net.IsWire(t.Text);

        private Node Assign(AAssign a)
        {
            if (IsWireDefinition(a))
            {
                if (a.Targets[0].Marks.Count > 0) throw Error(a.Line, $"a mark on the wire {a.Targets[0].Text}: a wire holds none, its producer or a consumer does");
                return new Demux(VarId(a.Targets[0].Text, a.Line), Expr(a.Value));
            }
            foreach (var t in a.Targets)
                if (!t.Jump && !t.Return && _net.IsWire(t.Text)) throw Error(a.Line, $"the wire {t.Text} is assigned beside other targets: a wire is defined alone");
            var targets = a.Targets.Select(t => Target(t, a.Line)).ToList();
            StNetworkWriter.RequireChainMarks(targets, reason => Error(a.Line, reason));
            // A jump's or a return's value is no coil's: an enabled box other than a comparison is read by its value only as
            // a coil's (1.4).
            var item = Flags.None.WithControlFlowFrom(targets);
            return new Assign(Expr(a.Value, assignValue: !item.Jump && !item.Return), targets, item);
        }

        /// <summary>One target as the model holds it: a coil with its kind (<c>S=</c>, <c>R=</c>) and its marks; a jump
        /// (<c>JMP.label</c>) or the return (<c>RETURN</c>, the vendor's <c>???</c>), which take <c>:=</c> and no mark.</summary>
        private static Operand Target(ATarget t, int line)
        {
            var marks = MarkFlags(t.Marks, line);
            if (t.Jump || t.Return)
            {
                var what = t.Jump ? "JMP." + t.Text : "RETURN";
                if (!marks.IsNone) throw Error(line, $"a mark on the target {what}: a jump or a return carries none");
                if (t.Op != ":=") throw Error(line, $"{what} {t.Op}: a jump or a return takes :=");
                return new Operand(t.Text, IsLValue: true, Flags: t.Jump ? Flags.None with { Jump = true } : Flags.None with { Return = true });
            }
            var f = t.Op == "S=" ? Flags.None with { Set = true } : t.Op == "R=" ? Flags.None with { Reset = true } : Flags.None;
            if (marks.Negated && (f.Set || f.Reset))
                throw Error(line, $"NOT {t.Text} {t.Op}: a negated set or reset coil is no coil of its own (the reset coil is {t.Text} R= value)");
            f = f with { Negated = marks.Negated, Rising = marks.Rising, Falling = marks.Falling };
            return new Operand(t.Text, IsLValue: true, Flags: f.IsNone ? null : f);
        }

        /// <summary>THE MARKS BEFORE A RECEIVER, outermost first, as the flags it holds: <c>NOT</c> a negation, <c>RISING</c> /
        /// <c>FALLING</c> an edge. The IDE negates first (N17), so a stacked mark is written edge, then NOT
        /// (<c>RISING NOT IN := a</c>); the reverse order, or a mark twice, is refused by name.</summary>
        private static Flags MarkFlags(IReadOnlyList<string> marks, int line)
        {
            var f = Flags.None;
            foreach (var m in marks)
            {
                if (m == "NOT")
                {
                    if (f.Negated) throw Error(line, "NOT twice before one receiver");
                    f = f with { Negated = true };
                    continue;
                }
                if (f.Rising || f.Falling) throw Error(line, "two edges before one receiver");
                if (f.Negated) throw Error(line, $"NOT {m}: the IDE negates first, so the edge is written outside the negation, {m} NOT");
                f = m == StNetworkWriter.RisingHead ? f with { Rising = true } : f with { Falling = true };
            }
            return f;
        }

        /// <param name="assignValue">The expression is an assignment's whole value: the one place an enabled box other than a
        /// comparison is read by its value (1.4: CODESYS refuses it inside a box).</param>
        private Node Expr(AExpr e, bool assignValue = false)
        {
            switch (e)
            {
                case AOperand o:
                    if (o.Text.IndexOf('\n') >= 0) throw Error(o.Line, "a string across a line: only the Execute box's ST spans lines");
                    if (_net.IsForeignWire(o.Text)) throw Error(o.Line, $"the wire {o.Text} is read outside its network: a wire is its network's");
                    return new Leaf(new Operand(o.Text), Flags.None);
                case AWire w:
                    // A Demux read by its name: after its definition, or before it (the value the wire held, the previous
                    // scan's), once or more.
                    if (!assignValue && _enabledValue.TryGetValue(w.Name, out var enabledHead)) throw EnabledValueNotACoil(w.Line, enabledHead);
                    return new Demux(WireId(w.Name)!.Value, null);
                case ANot n:
                {
                    // The value mark NOT: on a contact its negation, on a box read where it stands its negated output
                    // (`NOT t1(…).Q`); the NOT box is the call NOT(…).
                    var inner = Expr(n.Inner);
                    switch (inner)
                    {
                        case Leaf { Flags.IsNone: true } l when n.Inner is AOperand || n.Inner is ACall oc && Is(oc.Head, StNetworkWriter.OperandHead):
                            return l with { Flags = Flags.None with { Negated = true } };
                        case Box { Flags.IsNone: true, StCode: null } b when n.Inner is ACall:
                            return b with { Flags = Flags.None with { Negated = true } };
                        case Leaf { Flags: { Rising: true } or { Falling: true } }:
                        case Box { Flags: { Rising: true } or { Falling: true } }:
                            throw Error(n.Line, "NOT before an edge: the IDE negates first, so the edge is written outside the negation, RISING(NOT a)");
                        default:
                            throw Error(n.Line, "NOT before a wire, a branch, a coil, the rail, an Execute box or another NOT: NOT marks a contact or a box read where it stands, and the NOT box is NOT(…)");
                    }
                }
                case ABin b:
                    return new Box(b.Type, null, CallKind.Operator, b.Operands.Select(o => new Input(null, Expr(o), Flags.None)).ToList(),
                        Array.Empty<Output>(), null, null, Flags.None, ConnectedSlot: NetworkSpelling.MainSlotOfCall(b.Type),
                        Members: StNetworkWriter.ElementMembers(b.Type, contact: true));
                case AAssign a: return Assign(a);
                case ACall c:
                    if (ElementHead(c.Head, c.Line) is { } element) return Element(c, element);
                    if (!assignValue && EnOnlyByValue(c) is not null) throw EnabledValueNotACoil(c.Line, c.Head);
                    return CallBox(c, consumed: true);
                default: throw Error(e.Line, "an unknown expression");
            }
        }

        /// <summary>The element of the text a call head names (a branch, an edge), or null for any other call. Such a name
        /// declared in reach would give the text two meanings, which the writer refuses to write, so the reader refuses it.</summary>
        private string? ElementHead(string head, int line)
        {
            var element = StNetworkWriter.ElementHeads.FirstOrDefault(h => string.Equals(h, head, StringComparison.OrdinalIgnoreCase));
            if (element is not null && _net.InReach(head))
                throw Error(line, $"the call {head} names something declared in reach, which the text reads as its own {element}");
            return element;
        }

        /// <summary><c>BRANCH(FEED := f, b1, b2)</c> / <c>BRANCH_SHORTCIRCUIT(…)</c>: the parallel branch; <c>RISING(x)</c> /
        /// <c>FALLING(x)</c>: the edge on the contact or the box <c>x</c> (a negated contact negated first, N17).</summary>
        private Node Element(ACall c, string element)
        {
            if (element == StNetworkWriter.OperandHead)
            {
                if (c.Member is not null || c.Args.Count != 1 || c.Args[0] is not { Out: false, Formal: null, Value: AOperand { Text: var lit } } ||
                    lit.Length < 2 || lit[0] != '\'' || lit[lit.Length - 1] != '\'')
                    throw Error(c.Line, $"{c.Head} takes one string, '<the operand's text>', and names no output");
                var text = NetworkSpelling.UnescapeCode(lit.Substring(1, lit.Length - 2), out var escape, "an operand's text") ?? throw Error(c.Line, escape!);
                if (text.Length == 0) throw Error(c.Line, $"{c.Head} holds no text: an empty operand is ;");
                if (IsOperand(text)) throw Error(c.Line, $"{c.Head}('{lit.Substring(1, lit.Length - 2)}'): a plain operand is written as it stands");
                return new Leaf(new Operand(text), Flags.None);
            }
            if (element == StNetworkWriter.RailHead)
            {
                if (c.Args.Count != 0 || c.Member is not null) throw Error(c.Line, $"the rail {c.Head}() takes no value and names no output");
                return new Terminator(Flags.None);
            }
            if (element is StNetworkWriter.BranchHead or StNetworkWriter.ShortCircuitHead)
            {
                Node? feed = null;
                var branches = new List<Node>();
                for (var k = 0; k < c.Args.Count; k++)
                {
                    var a = c.Args[k];
                    if (k == 0 && !a.Out && string.Equals(a.Formal, StNetworkWriter.FeedPin, StringComparison.OrdinalIgnoreCase))
                    {
                        feed = Expr(a.Value!);
                        continue;
                    }
                    if (a.Out || a.Formal is not null)
                        throw Error(c.Line, $"the branch {c.Head} takes {StNetworkWriter.FeedPin} := first, if fed, then its branches, positional");
                    branches.Add(Expr(a.Value!));
                }
                if (branches.Count == 0) throw Error(c.Line, $"the branch {c.Head} holds no branch");
                return new Parallel(feed, branches, element == StNetworkWriter.BranchHead ? ParallelMode.Sequential : ParallelMode.BoxShortCircuit);
            }
            if (c.Args.Count != 1 || c.Args[0].Out || c.Args[0].Formal is not null)
                throw Error(c.Line, $"the edge {c.Head} takes one value, positional");
            var rising = element == StNetworkWriter.RisingHead;
            var inner = Expr(c.Args[0].Value!);
            switch (inner)
            {
                case Leaf { Flags: { Rising: false, Falling: false } } l:
                    return l with { Flags = l.Flags with { Rising = rising, Falling = !rising } };
                case Box { Flags: { Rising: false, Falling: false }, StCode: null } b when b.Enable is null || b.Instance is not null || NetworkSpelling.ConnectedByEno(b):
                    return b with { Flags = b.Flags with { Rising = rising, Falling = !rising } };
                default:
                    throw Error(c.Line, $"the edge {c.Head} over a wire, a branch, a coil, the rail, an Execute box or another edge: an edge is on a contact or on a box read where it stands");
            }
        }

        /// <summary>The box type of an enabled FUNCTION box other than a comparison read by its value or a data output (it shows EN
        /// and no ENO: its call closed by nothing or by a member other than <c>.ENO</c>),
        /// else null.</summary>
        private string? EnOnlyByValue(ACall c)
        {
            if (IsExecute(c) || Callee(c).Instance is not null) return null;
            if (c.Args.FirstOrDefault() is not { Out: false } first || !Is(first.Formal, Box.EnablePin)) return null;
            var signature = NetworkSpelling.SignatureOf(c.Head, block: false, _net.Scope);
            if (NetworkSpelling.Comparisons.Contains(c.Head) || signature is { DeclaresEn: true }) return null;
            // Closed by `.ENO`, the shown ENO, it hands on its ENO; closed by any other member it is still read by a data output.
            if (c.Member is { } member && Is(member, Box.EnoPin) && signature is not { DeclaresEno: true }) return null;
            return c.Head;
        }

        private static bool Is(string? a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);

        private static bool IsExecute(ACall c) => Is(c.Head, StNetworkWriter.ExecuteHead);

        /// <summary>WHAT A CALL HEAD NAMES (design "FB boxes: the instance is the call head"): an FB instance in reach, the
        /// box of its declared type; an FB TYPE in reach, the vendor's unnamed-instance box (<c>???</c>); anything else the
        /// box of that type.</summary>
        private (string Type, Operand? Instance) Callee(ACall c)
        {
            if (_net.InstanceType(c.Head) is { } declared) return (declared, new Operand(c.Head, IsInstance: true));
            if (_net.IsBlockType(c.Head)) return (c.Head, new Operand(Box.UnnamedInstance, IsInstance: true));
            return (c.Head, null);
        }

        /// <summary>THE BOX A CALL IS (openspec network-output-member): a call of an FB instance an FB box of its declared type,
        /// a call of an FB type the box with no instance; <c>EN :=</c> first the shown EN and <c>.ENO</c> the shown ENO, where
        /// the callee declares no EN / ENO of its own; <c>.NAME</c> the output a consumer reads (<see cref="Member"/>).</summary>
        private Box CallBox(ACall c, bool consumed)
        {
            if (IsExecute(c)) return ExecuteBox(c, consumed);
            var (type, instance) = Callee(c);
            var at = 0;
            var signature = NetworkSpelling.SignatureOf(type, instance is not null, _net.Scope);
            if (signature is { DeclaresOut: true })
                throw Error(c.Line, $"{type} declares VAR_OUTPUT OUT, which also names its value: the text cannot tell the two apart");
            var declaresEn = signature is { DeclaresEn: true };
            var declaresEno = signature is { DeclaresEno: true };
            if (signature is null)
            {
                // A CALLEE NO DECLARATION IN REACH STATES: each of these means a box flag or the callee's own pin, chosen by a
                // declaration the text cannot see, so the reader refuses it as the writer does (StNetworkUnspellableException).
                string? what = instance is { Text: Box.UnnamedInstance } ? $"the call of the FB type {type}"
                    : c.Args.FirstOrDefault() is { Out: false } f && Is(f.Formal, Box.EnablePin) ? "EN :="
                    : c.Member is { } m && Is(m, Box.EnoPin) ? ".ENO"
                    : c.Args.FirstOrDefault(a => a.Out && (Is(a.Formal, Box.EnoPin) || Is(a.Formal, StNetworkWriter.ResultPin))) is { } o ? o.Formal + " =>"
                    : null;
                if (what is not null)
                    throw Error(c.Line, $"{what} on the call {c.Head}, whose callee no declaration in reach states: it is a box flag or the callee's own pin, which only the declaration tells");
            }

            Node? enable = null;
            var enableFlags = Flags.None;
            if (!declaresEn && at < c.Args.Count && c.Args[at] is { Out: false } en && Is(en.Formal, Box.EnablePin))
            {
                enable = Expr(en.Value!);
                enableFlags = MarkFlags(en.Marks, c.Line);
                at++;
            }
            var inputs = new List<Input>();
            var outputs = new List<(string? Formal, string Target, Flags Marks)>();
            for (var k = at; k < c.Args.Count; k++)
            {
                var a = c.Args[k];
                if (a.Out)
                {
                    if (_net.IsWire(a.Target!))
                        throw Error(c.Line, $"the call {c.Head} wires its output {a.Formal} to the wire {a.Target}: a wire is defined by `{a.Target} := <box>`, its box closed by the output it reads");
                    // `OUT =>` is a function's value, each the next unnamed slot; on an FB call it is the FB's own output named OUT.
                    outputs.Add((Is(a.Formal, StNetworkWriter.ResultPin) && instance is null ? null : a.Formal, a.Target!, MarkFlags(a.Marks, c.Line)));
                    continue;
                }
                if (signature is not null && !declaresEn && Is(a.Formal, Box.EnablePin))
                    throw Error(c.Line, enable is null
                        ? $"EN := stands first in the call {c.Head}: it is the box's shown EN"
                        : $"the call {c.Head} holds EN := twice");
                inputs.Add(new Input(a.Formal, Expr(a.Value!), MarkFlags(a.Marks, c.Line)));
            }

            var (hasEno, connected, byName) = Member(c, type, instance is not null, signature, consumed, declaresEno);
            if (signature is not null && !hasEno && !declaresEno && outputs.Any(o => Is(o.Formal, Box.EnoPin)))
                throw Error(c.Line, $"the call {c.Head} wires ENO => and shows no ENO: ENO => v is a target of the shown ENO, which its call closed by .ENO states");
            var eno = hasEno ? 0 : (int?)null;
            var next = 0;
            var outs = new List<Output>();
            foreach (var (formal, target, marks) in outputs)
            {
                var operand = new Operand(target, IsLValue: true, Flags: marks.IsNone ? null : marks);
                if (formal is not null) { outs.Add(new Output(formal, operand)); continue; }
                next = NetworkSpelling.NextFreeSlot(next, eno, connected);
                outs.Add(new Output(null, operand, next++));
            }
            return new Box(type, instance, NetworkSpelling.KindOf(type, instance is not null), inputs, outs, enable, null, Flags.None,
                ConnectedSlot: connected, HasEnoOutput: hasEno, MainOutputName: byName,
                Members: enable is not null || instance is not null || outs.Count > 0 ? null : StNetworkWriter.ElementMembers(type, contact: false))
                { EnableFlags = enableFlags };
        }

        /// <summary>
        /// WHAT CLOSES THE CALL: <c>.ENO</c> the shown ENO (read through it where consumed); <c>.NAME</c> the data output a
        /// consumer reads, where the callee declares more than one, refused where it declares one; nothing, a consumed box
        /// reading its one data output. A callee no declaration in reach states is read as written: <c>.NAME</c> the output
        /// named so (its slot unknown, which the push refuses by name), nothing an FB read by no named output, a function by
        /// its value.
        /// </summary>
        private (bool HasEno, int? Connected, string? ByName) Member(ACall c, string type, bool block, CalleeSignature? signature,
                                                                     bool consumed, bool declaresEno)
        {
            var member = c.Member;
            if (member is not null && Is(member, Box.EnoPin) && !declaresEno) return (true, consumed ? 0 : null, null);
            if (!consumed)
            {
                if (member is not null)
                    throw Error(c.Line, $"the box {c.Head} stands at a root closed by .{member}: a root hands nothing on, and its call is closed by .ENO (it shows ENO) or by nothing");
                return (false, null, null);
            }
            if (signature is null)
                return member is not null ? (false, null, member) : (false, block ? null : NetworkSpelling.MainSlotOfCall(type), null);
            var outputs = block ? signature.Outputs : signature.DataOutputs;
            if (member is null)
            {
                if (outputs.Count == 1)
                    return block ? (false, null, outputs[0]) : (false, NetworkSpelling.MainSlotOfCall(type), null);
                throw Error(c.Line, outputs.Count == 0
                    ? $"the box {c.Head} is read, and {type} declares no output to read"
                    : $"the box {c.Head} is read and names no output: {type} has {outputs.Count} ({string.Join(", ", outputs)}), so its call is closed by the one its consumer reads, .{outputs[0]}");
            }
            var slot = outputs.Select((o, i) => (o, i)).Where(x => Is(x.o, member)).Select(x => (int?)x.i).FirstOrDefault();
            if (slot is null)
                throw Error(c.Line, $"the box {c.Head} is closed by .{member}, which names no output of {type} ({string.Join(", ", outputs)})");
            if (outputs.Count == 1)
                throw Error(c.Line, $"the box {c.Head} is closed by .{member}, the one output {type} has: a box with one output names none");
            return block ? (false, null, member) : (false, slot, null);
        }

        /// <summary>THE EXECUTE BOX: <c>EXECUTE(EN := e, '&lt;ST&gt;')</c> — EN where it shows EN, then its ST, one string,
        /// nothing else; its one output its ENO (by type), read through it where consumed, so no member closes the call.</summary>
        private Box ExecuteBox(ACall c, bool consumed)
        {
            if (_net.InReach(c.Head))
                throw Error(c.Line, $"the call {c.Head} names something declared in reach, which the text reads as its Execute box");
            // EN and ENO as on every box (network-text-one-to-one F13): `EN :=` shows EN, `.ENO` shows ENO, at a root too.
            var eno = c.Member is { } m && Is(m, Box.EnoPin);
            if (c.Member is { } member && !eno)
                throw Error(c.Line, $"the Execute box is closed by .{member}: its one output is its ENO, read as .ENO");
            var at = 0;
            Node? enable = null;
            var enableFlags = Flags.None;
            if (c.Args.Count > 0 && c.Args[0] is { Out: false } en && Is(en.Formal, Box.EnablePin))
            {
                enable = Expr(en.Value!);
                enableFlags = MarkFlags(en.Marks, c.Line);
                at = 1;
            }
            if (c.Args.Count != at + 1 || c.Args[at] is not { Out: false, Formal: null, Value: AOperand { Text: var literal } } ||
                literal.Length < 2 || literal[0] != '\'' || literal[literal.Length - 1] != '\'')
                throw Error(c.Line, $"the Execute box takes {Box.EnablePin} := first where it shows EN, then its ST as one string '<ST>', and nothing else");
            if (consumed && !eno)
                throw Error(c.Line, "the Execute box is read and shows no ENO: its one output is its ENO, read as .ENO");
            var st = NetworkSpelling.UnescapeCode(literal.Substring(1, literal.Length - 2), out var error) ?? throw Error(c.Line, error!);
            return new Box(NetworkSpelling.ExecuteType, null, NetworkSpelling.KindOf(NetworkSpelling.ExecuteType, false), Array.Empty<Input>(),
                Array.Empty<Output>(), enable, st, Flags.None, ConnectedSlot: consumed ? 0 : null, HasEnoOutput: eno) { EnableFlags = enableFlags };
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
