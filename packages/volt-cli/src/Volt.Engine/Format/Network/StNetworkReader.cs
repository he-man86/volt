using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace Volt.Engine.Format.Network;

/// <summary>
/// NETWORK TEXT (<see cref="StNetworkWriter"/>, openspec <c>network-language</c>) → the <see cref="NetworkBody"/> model. Its own
/// small lexer and recursive-descent parser for the subset a network holds (the engine has no ST expression parser): calls with
/// formal and positional pins, the contacts infix <c>AND</c> / <c>OR</c>, a wire's definition <c>w1 := …;</c>, a leading label, and
/// the <c>%</c> lines. Anything else is refused by name, with its line; a form of an earlier text names the form that replaced it.
///
/// <para>The call is the box (openspec network-output-member): a call of an FB instance in reach is an FB box of the instance's
/// declared type, a call of an FB type the box with no instance (<c>???</c>); <c>EN :=</c> first is the shown EN where the callee
/// declares no <c>EN</c> of its own. Its flow is its default output, ENO where EN is shown, else a function's value or an FB's
/// first output; <c>.NAME</c> names another (<see cref="NetworkSpelling.SignatureOf(string, bool, NetworkScope)"/>). A statement is
/// an <c>ASSIGN</c> (every coil, jump and return), a wire's definition, a value standing alone (<c>a;</c>, <c>INVERT(AND(a, b));</c>,
/// <c>RAIL();</c>, a box consumed by nothing), the empty item <c>;</c>, a label. A name its network declares <c>VAR w1 : ANY; END_VAR</c>
/// is a wire: a Demux over its definition, read by its name any number of times. The marks <c>INVERT</c>, <c>RISING</c>,
/// <c>FALLING</c>, <c>ASSIGN</c>, <c>BRANCH</c>, <c>BRANCH_SHORTCIRCUIT</c>, <c>RAIL</c>, <c>OPERAND</c> and <c>COMMENT</c> are the text's
/// own elements (<see cref="StNetworkWriter.ElementHeads"/>), and <c>EXECUTE(EN := e, '&lt;ST&gt;')</c> the Execute box, its ST the one
/// string that spans lines.</para>
///
/// <para><b>Marks read alike where they run alike</b>: a value's marks, outermost first, go to the receiver it stands at as far as
/// it holds them (the line into a coil <c>INVERT(RISING(·))</c>, a pin or EN one mark), the rest to the node itself (a contact or a
/// box, <c>RISING(INVERT(·))</c>).</para>
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
        // A body holding no code reads no call, so it asks the scope nothing.
        if (lines.Skip(1).Any(l => l.Trim().Length > 0 && !l.StartsWith("%", StringComparison.Ordinal) && !l.StartsWith("//", StringComparison.Ordinal)) &&
            StNetworkWriter.ReservedNameIn(scope) is { } reserved)
            throw new StNetworkReadException(1, $"{StNetworkWriter.ReservedNameReason} is refused: '{reserved}' is declared in reach, and the text spells its own call with that name");
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

    private abstract class AExpr { public int Line; public bool Bracketed; }
    private sealed class AOperand : AExpr { public string Text = ""; }
    private sealed class AWire : AExpr { public string Name = ""; }
    private sealed class ANot : AExpr { public AExpr Inner = null!; }
    private sealed class ABin : AExpr { public string Type = ""; public List<AExpr> Operands = new(); }
    /// <summary>A wire's definition, <c>w1 := value</c>: the one assignment a network holds.</summary>
    private sealed class AAssign : AExpr { public List<ATarget> Targets = new(); public AExpr Value = null!; }
    /// <summary>An assignment's target as written (an earlier text's coil, refused by name): its operand, its operator, its
    /// comment's string literal where it is <c>COMMENT(y, '…')</c>.</summary>
    private sealed class ATarget { public string Text = ""; public string Op = ":="; public string? Comment; }
    /// <summary>A call: <c>Head(args)</c>, closed by <c>.Member</c> where written.</summary>
    private sealed class ACall : AExpr { public string Head = ""; public List<AArg> Args = new(); public string? Member; }
    /// <summary>A pin of a call: its formal where named, its value or its output's target — an operand, or on an <c>ASSIGN</c> a jump
    /// <c>JMP.label</c> (<see cref="Jump"/>) or the return <c>RETURN</c> (<see cref="Return"/>).</summary>
    private sealed class AArg { public string? Formal; public bool Out; public AExpr? Value; public string? Target; public string? TargetComment; public bool Jump; public bool Return; public int Line; }

    private abstract class AStmt { public int Line; }
    private sealed class SAssign : AStmt { public AAssign Assign = null!; }
    private sealed class SCall : AStmt { public ACall Call = null!; }
    private sealed class SEmpty : AStmt { }
    /// <summary>A value standing alone (<c>a;</c>, <c>NOT AND(a, b);</c>, <c>RAIL();</c>).</summary>
    private sealed class SValue : AStmt { public AExpr Value = null!; }

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
            if (IsWord("IF")) throw Error($"a network holds no IF: a jump on a value is {JumpForm}, a return {ReturnForm}");
            foreach (var w in new[] { "FOR", "WHILE", "REPEAT", "CASE", "EXIT", "CONTINUE" })
                if (IsWord(w)) throw Error($"an LD/FBD network cannot hold a {w}");
            // ST's empty statement: the empty item.
            if (Is(";"))
            {
                _i++;
                return new SEmpty { Line = line };
            }
            if (IsWord("JMP") || IsWord("RETURN")) throw Error(ControlForm);
            RefuseMarkWord();
            if (KeywordCallHead() is { } op)
            {
                _i++;
                return CallStatement(CallArgs(op, line), line);
            }
            var at = _i;
            if (TryTarget() is { } target)
            {
                // THE ONE ASSIGNMENT A NETWORK HOLDS: a wire's definition. Any other is an earlier text's coil.
                if (target is { Op: ":=", Comment: null } && _isWire(target.Text) && !Chained())
                {
                    var value = Expr();
                    Expect(";");
                    return new SAssign { Assign = new AAssign { Targets = { target }, Value = value, Line = line }, Line = line };
                }
                _i = at;
                throw Error(CoilForm(target.Op));
            }
            _i = at;
            if (TryOperandSpan(_i, allowCall: true) is { IsCall: true } span)
            {
                _i = span.Next;
                return CallStatement(CallArgs(span.Text, line), line);
            }
            if (Peek() is { Kind: Tk.Ident } && Is(":", 1)) throw Error("a label stands first in its network: it is the network's label");
            // A value standing alone, as it stands in a tree.
            var standing = Expr();
            Expect(";");
            return new SValue { Value = standing, Line = line };
        }

        /// <summary>Whether another target follows (an earlier text's chain, <c>w1 := y := a</c>), nothing consumed.</summary>
        private bool Chained()
        {
            var at = _i;
            var chained = TryTarget() is not null;
            _i = at;
            return chained;
        }

        /// <summary>The form of a coil an earlier text wrote with an assignment operator, named.</summary>
        private static string CoilForm(string op) => op switch
        {
            "S=" => $"y S= value is no network text: a set coil is {StNetworkWriter.AssignHead}(value, {StNetworkWriter.AssignOutput}{StNetworkWriter.SetSuffix} => y)",
            "R=" => $"y R= value is no network text: a reset coil is {StNetworkWriter.AssignHead}(value, {StNetworkWriter.AssignOutput}{StNetworkWriter.ResetSuffix} => y)",
            _ => $"y := value is no network text: a coil is {StNetworkWriter.AssignHead}(value, {StNetworkWriter.AssignOutput} => y), and only a wire is assigned, w1 := value",
        };

        /// <summary>A mark word written before a name, an earlier text's mark: refused, naming the function it is now.</summary>
        private void RefuseMarkWord()
        {
            if (!Network || !IsMark()) return;
            throw Error($"a mark is a function around a value, {StNetworkWriter.InvertHead}(a), {StNetworkWriter.RisingHead}(a), {StNetworkWriter.FallingHead}(a); " +
                        $"on a receiver it is in the output's name, {StNetworkWriter.AssignOutput}{StNetworkWriter.InvertedSuffix} => y. NOT(a) is the NOT box");
        }

        /// <summary>A call standing as a statement: a box at a root, closed as <see cref="Builder.Member"/> reads it.</summary>
        private SCall CallStatement(ACall call, int line)
        {
            Expect(";");
            return new SCall { Call = call, Line = line };
        }

        private static string JumpForm => $"{StNetworkWriter.AssignHead}(value, {StNetworkWriter.AssignOutput} => {StNetworkWriter.JumpHead}.label)";

        private static string ReturnForm => $"{StNetworkWriter.AssignHead}(value, {StNetworkWriter.AssignOutput} => {StNetworkWriter.ReturnHead})";

        /// <summary>The one form of a jump and a return: a target of an <c>ASSIGN</c>.</summary>
        private static string ControlForm =>
            $"a jump or a return is a target of an {StNetworkWriter.AssignHead}: {JumpForm}; {ReturnForm}; (on the rail, {StNetworkWriter.RailHead}() as its value)";

        /// <summary>The words an earlier text wrote as marks before a name or as a prefix (<c>NOT a</c>, <c>RISING IN := a</c>).</summary>
        private static readonly string[] MarkWords = { "NOT", StNetworkWriter.InvertHead, StNetworkWriter.RisingHead, StNetworkWriter.FallingHead };

        /// <summary>A mark word at <paramref name="k"/> that heads no call (a word followed by <c>(</c> is a call).</summary>
        private bool IsMark(int k = 0) => MarkWords.Any(w => IsWord(w, k)) && !Is("(", k + 1);

        /// <summary>AN ASSIGNMENT'S TARGET and its operator at the current position, consumed — a coil's operand (or
        /// <c>COMMENT(y, '…')</c>), then <c>:=</c>, <c>S=</c> or <c>R=</c> — else null, nothing consumed.</summary>
        private ATarget? TryTarget()
        {
            var save = _i;
            ATarget? t = null;
            if (TryCommented() is { } commented)
                t = new ATarget { Text = commented.Text, Comment = commented.Literal };
            else if (TryOperandSpan(_i, allowCall: false) is { IsCall: false } s)
            {
                _i = s.Next;
                t = new ATarget { Text = s.Text };
            }
            if (t is not null && AssignOp() is { } op)
            {
                t.Op = op;
                return t;
            }
            _i = save;
            return null;
        }

        /// <summary>A RECEIVER'S OPERAND WITH ITS COMMENT, <c>COMMENT(y, '…')</c>, at the current position, consumed: its text
        /// and its comment's string literal (read by the builder) — else null, nothing consumed.</summary>
        private (string Text, string Literal)? TryCommented()
        {
            if (!Network || !IsWord(StNetworkWriter.CommentHead) || !Is("(", 1)) return null;
            if (TryOperandSpan(_i + 2, allowCall: false) is not { IsCall: false } s || !Is(",", s.Next - _i) ||
                Peek(s.Next - _i + 1) is not { Kind: Tk.Literal } lit || !lit.Text.StartsWith("'", StringComparison.Ordinal) ||
                !Is(")", s.Next - _i + 2))
                return null;
            _i = s.Next + 3;
            return (s.Text, lit.Text);
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

        /// <summary>A bracket groups a chain inside a tighter chain or the same one (a second box), and nothing else: the
        /// writer brackets exactly these, so any other bracket would be a second spelling of one network.</summary>
        private const string NeedlessBracket = "a bracket that groups nothing: a bracket holds an AND / OR chain inside a tighter chain or the same one";

        private static int LevelOf(string type) => Array.FindIndex(Levels, l => l.Any(o => o.Type == type));

        public AExpr Expr()
        {
            var at = _i;
            var e = Level(0);
            if (Network && e.Bracketed) { _i = at; throw Error(NeedlessBracket); }
            return e;
        }

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
            if (Network && cur is not null)
                foreach (var o in cur.Operands)
                    if (o.Bracketed && !(o is ABin b && LevelOf(b.Type) <= k)) throw new StNetworkReadException(o.Line, NeedlessBracket);
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
            RefuseMarkWord();
            if (IsWord("NOT") && !Is("(", 1))
            {
                _i++;
                return new ANot { Inner = Unary(), Line = line };
            }
            if (Is("-") && Peek(1) is { Kind: Tk.Literal } n && n.Start == _t[_i].End && char.IsDigit(n.Text[0]))
            {
                _i += 2;
                return new AOperand { Text = _src.Substring(_t[_i - 2].Start, n.End - _t[_i - 2].Start), Line = line };
            }
            if (Is("("))
            {
                // A bracketed expression; an assignment in brackets is an earlier text's coil inside a value.
                var save = _i;
                _i++;
                if (Network && TryTarget() is { } nested)
                {
                    // A wire defined where it is first read, `(w1 := value)`; any other is an earlier text's coil inside a value.
                    if (nested is { Op: ":=", Comment: null } && _isWire(nested.Text) && !Chained())
                    {
                        var value = Expr();
                        Expect(")");
                        return new AAssign { Targets = { nested }, Value = value, Line = line };
                    }
                    _i = save + 1;
                    throw Error($"(y := value) is no network text: a coil inside a value is {StNetworkWriter.AssignHead}(value, {StNetworkWriter.AssignOutput} => y)");
                }
                _i = save + 1;
                var e = Level(0);
                Expect(")");
                if (Network && e.Bracketed) throw new StNetworkReadException(e.Line, NeedlessBracket);
                e.Bracketed = true;
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
                var at = Line;
                if (Network && IsMark())
                    throw Error($"a mark before a pin: a pin's mark is a function around its value, IN := {StNetworkWriter.InvertHead}(a), and an output's is in its name, Q{StNetworkWriter.InvertedSuffix} => x");
                if (Peek() is { Kind: Tk.Ident } f && Is("=>", 1))
                {
                    _i += 2;
                    if (IsWord("JMP") && Is(".", 1) && Peek(2) is { Kind: Tk.Ident } label && (label.Text == Box.UnnamedInstance || !IsKeyword(label.Text)))
                    {
                        _i += 3;
                        call.Args.Add(new AArg { Formal = f.Text, Out = true, Target = label.Text, Jump = true, Line = at });
                    }
                    else if (IsWord("RETURN"))
                    {
                        _i++;
                        call.Args.Add(new AArg { Formal = f.Text, Out = true, Target = Box.UnnamedInstance, Return = true, Line = at });
                    }
                    else if (TryCommented() is { } commented)
                        call.Args.Add(new AArg { Formal = f.Text, Out = true, Target = commented.Text, TargetComment = commented.Literal, Line = at });
                    else
                    {
                        var span = TryOperandSpan(_i, allowCall: false) ?? throw Error("an output target");
                        if (span.IsCall) throw Error("an output target");
                        _i = span.Next;
                        call.Args.Add(new AArg { Formal = f.Text, Out = true, Target = span.Text, Line = at });
                    }
                }
                else if (Network && Is(":="))
                    throw Error($"an empty pin name: a pin with no name is its value alone, its mark a function around it, {StNetworkWriter.InvertHead}(b)");
                else if (Peek() is { Kind: Tk.Ident } g && Is(":=", 1) && !IsKeyword(g.Text))
                {
                    _i += 2;
                    call.Args.Add(new AArg { Formal = g.Text, Value = Expr(), Line = at });
                }
                else call.Args.Add(new AArg { Value = Expr(), Line = at });
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
                case SAssign a:
                {
                    var name = a.Assign.Targets[0].Text;
                    // An enabled box other than a comparison is a wire's whole value only where every read of the wire is a
                    // coil's value.
                    if (a.Assign.Value is ACall valueCall && EnOnlyByValue(valueCall) is not null) _enabledValue[name] = valueCall.Head;
                    return new Demux(VarId(name, s.Line), Marked(a.Assign.Value, Receiver.None, assignValue: true));
                }
                case SEmpty: return new Leaf(new Operand(""), Flags.None);
                case SCall c: return RootValue(c.Call);
                case SValue v: return RootValue(v.Value);
                default: throw Error(s.Line, "an unknown statement");
            }
        }

        /// <summary>A VALUE STANDING ALONE: as it stands in a tree, a box consumed by nothing with its marks around it
        /// (<c>INVERT(AND(a, b));</c>, <c>RISING(t1(…));</c>), an <c>ASSIGN</c>, any other value.</summary>
        private Node RootValue(AExpr e) => Marked(e, Receiver.None, assignValue: false, root: true);

        /// <summary>The receivers a value's marks go to, outermost first, as far as each holds them: the line into a coil
        /// (<see cref="Item"/>: <c>INVERT(RISING(·))</c>), a pin or EN (<see cref="Pin"/>: one mark), or none.</summary>
        private enum Receiver { None, Pin, Item }

        /// <summary>
        /// A VALUE WITH ITS MARKS (network-language rule 1): the marks around it, outermost first, go to the receiver it stands at
        /// as far as that holds them in its run order — the line into a coil the negation outside the edge, a pin or EN one mark —
        /// and the rest to the node itself, a contact's operand or a box, the edge outside the negation (the IDE negates first,
        /// N17). Marks that run alike read alike: a changed network is rebuilt with the outer mark on the receiver. A stack deeper
        /// than the store holds, or a mark on what holds none (a wire, a branch, the rail, an <c>ASSIGN</c>, a contact group), is
        /// refused by name. The receiver's own flags come back in <paramref name="held"/>.
        /// </summary>
        private Node Marked(AExpr e, Receiver receiver, out Flags held, bool assignValue = false, bool root = false)
        {
            var marks = new List<string>();
            var core = e;
            while (core is ACall c && MarkOf(c) is { } m)
            {
                marks.Add(m);
                core = c.Args[0].Value!;
            }
            var line = e.Line;
            var k = 0;
            held = Flags.None;
            if (receiver == Receiver.Item)
            {
                if (k < marks.Count && marks[k] == StNetworkWriter.InvertHead) { held = held with { Negated = true }; k++; }
                if (k < marks.Count && marks[k] != StNetworkWriter.InvertHead) held = Edge(held, marks[k++]);
            }
            else if (receiver == Receiver.Pin && k < marks.Count)
                held = marks[k++] is var first && first == StNetworkWriter.InvertHead ? held with { Negated = true } : Edge(held, first);
            var node = core is ACall call && root && ElementHead(call.Head, call.Line) is null ? CallBox(call, consumed: false) : Expr(core, assignValue);
            if (k == marks.Count) return node;
            // The node's own marks: the edge outside the negation.
            var own = Flags.None;
            if (k < marks.Count && marks[k] != StNetworkWriter.InvertHead) own = Edge(own, marks[k++]);
            if (k < marks.Count && marks[k] == StNetworkWriter.InvertHead) { own = own with { Negated = true }; k++; }
            if (k < marks.Count)
                throw Error(line, $"{string.Join("(", marks)}(…): a stack of marks deeper than the IDE stores. A value's node holds an edge outside a negation, " +
                                  $"{StNetworkWriter.RisingHead}({StNetworkWriter.InvertHead}(a)), and its receiver: the line into a coil a negation outside an edge, a pin or EN one mark");
            return node switch
            {
                Leaf { Flags.IsNone: true } l => l with { Flags = own },
                Box { Flags.IsNone: true } b when !IsContactGroup(core) => b with { Flags = own },
                _ => throw Error(line, $"{marks[k - 1]}(…) on a wire, a branch, the rail, an {StNetworkWriter.AssignHead} or a contact group: a mark is on a contact, a box, or a receiver"),
            };
        }

        private Node Marked(AExpr e, Receiver receiver, bool assignValue = false, bool root = false)
        {
            var node = Marked(e, receiver, out var held, assignValue, root);
            if (!held.IsNone) throw new InvalidOperationException("a value standing at no receiver gave its marks to one");
            return node;
        }

        /// <summary>A contact group, infix <c>a AND b</c>: it holds no mark of its own.</summary>
        private static bool IsContactGroup(AExpr e) => e is ABin;

        private static Flags Edge(Flags f, string mark) =>
            mark == StNetworkWriter.RisingHead ? f with { Rising = true } : f with { Falling = true };

        /// <summary>The mark a call is (<c>INVERT(x)</c>, <c>RISING(x)</c>, <c>FALLING(x)</c>, by its canonical name), or null for any
        /// other call. A mark takes one value, positional, and names no output.</summary>
        private string? MarkOf(ACall c)
        {
            var mark = new[] { StNetworkWriter.InvertHead, StNetworkWriter.RisingHead, StNetworkWriter.FallingHead }
                .FirstOrDefault(h => Is(c.Head, h));
            if (mark is null) return null;
            if (c.Member is not null || c.Args.Count != 1 || c.Args[0] is not { Out: false, Formal: null, Value: not null })
                throw Error(c.Line, $"the mark {c.Head} takes one value, positional, and names no output");
            return mark;
        }

        /// <summary>
        /// <c>ASSIGN(value, Q =&gt; y, Q_SET =&gt; x, Q =&gt; JMP.l, Q =&gt; RETURN)</c> (network-language rule 3): every coil, jump and return,
        /// one stored node — its value with the marks of the line into every coil, its targets in stored order, each target's own
        /// mark in its output's name.
        /// </summary>
        private Assign AssignElement(ACall c)
        {
            if (c.Member is not null) throw Error(c.Line, $"{c.Head}(…).{c.Member}: an {StNetworkWriter.AssignHead} hands its value on, and names no output");
            if (c.Args.Count < 2 || c.Args[0] is not { Out: false, Formal: null, Value: not null } || c.Args.Skip(1).Any(a => !a.Out))
                throw Error(c.Line, $"{StNetworkWriter.AssignHead} takes its value, positional, then one target or more, {StNetworkWriter.AssignHead}(value, {StNetworkWriter.AssignOutput} => y)");
            var targets = c.Args.Skip(1).Select(a => Target(a)).ToList();
            var control = Flags.None.WithControlFlowFrom(targets);
            // A jump's or a return's value is no coil's: an enabled box other than a comparison is read by its value only as a
            // coil's (1.4).
            var value = Marked(c.Args[0].Value!, Receiver.Item, out var line, assignValue: !control.Jump && !control.Return);
            return new Assign(value, targets, line.WithControlFlowFrom(targets));
        }

        /// <summary>ONE TARGET OF AN <c>ASSIGN</c> as the model holds it: its mark from its output's name (<c>Q</c>, <c>Q_INVERTED</c>,
        /// <c>Q_SET</c>, <c>Q_RESET</c>), a coil's operand with its comment, a jump's label (<c>JMP.label</c>), the return
        /// (<c>RETURN</c>, the vendor's <c>???</c>).</summary>
        private Operand Target(AArg a)
        {
            var mark = ReceivedMark(a.Formal!) ?? throw Error(a.Line,
                $"{a.Formal} => on an {StNetworkWriter.AssignHead}: its outputs are {StNetworkWriter.AssignOutput}, {StNetworkWriter.AssignOutput}{StNetworkWriter.InvertedSuffix}, " +
                $"{StNetworkWriter.AssignOutput}{StNetworkWriter.SetSuffix} and {StNetworkWriter.AssignOutput}{StNetworkWriter.ResetSuffix}; an edge is on the value, {StNetworkWriter.RisingHead}(a)");
            var what = a.Jump ? StNetworkWriter.JumpHead + "." + a.Target : StNetworkWriter.ReturnHead;
            if (a.Jump || a.Return)
            {
                if (mark.Set || mark.Reset)
                    throw Error(a.Line, $"{a.Formal} => {what}: a jump or a return is no set or reset coil");
                return new Operand(a.Target!, IsLValue: true, Flags: mark with { Jump = a.Jump, Return = a.Return });
            }
            if (_net.IsWire(a.Target!))
                throw Error(a.Line, $"the wire {a.Target} as an {StNetworkWriter.AssignHead} target: a wire is defined alone, {a.Target} := value");
            if (_net.IsForeignWire(a.Target!)) throw Error(a.Line, $"the wire {a.Target} is read outside its network: a wire is its network's");
            return new Operand(a.Target!, IsLValue: true, Flags: mark.IsNone ? null : mark, Comment: Comment(a.TargetComment, a.Target!, a.Line));
        }

        /// <summary>The mark an <c>ASSIGN</c> output's name spells (<c>Q</c> none, <c>Q_INVERTED</c>, <c>Q_SET</c>, <c>Q_RESET</c>), or null
        /// where it is no output of an <c>ASSIGN</c>.</summary>
        private static Flags? ReceivedMark(string formal)
        {
            if (Is(formal, StNetworkWriter.AssignOutput)) return Flags.None;
            if (Is(formal, StNetworkWriter.AssignOutput + StNetworkWriter.InvertedSuffix)) return Flags.None with { Negated = true };
            if (Is(formal, StNetworkWriter.AssignOutput + StNetworkWriter.SetSuffix)) return Flags.None with { Set = true };
            if (Is(formal, StNetworkWriter.AssignOutput + StNetworkWriter.ResetSuffix)) return Flags.None with { Reset = true };
            return null;
        }

        /// <summary>THE OPERAND COMMENT a <c>COMMENT(x, '…')</c> states, from its string literal (null: none): IEC's escape
        /// (<c>$$</c>, <c>$'</c>, <c>$L</c>, <c>$R</c>), never empty — no comment is the plain operand.</summary>
        private string? Comment(string? literal, string operand, int line)
        {
            if (literal is null) return null;
            if (_net.InReach(StNetworkWriter.CommentHead))
                throw Error(line, $"the call {StNetworkWriter.CommentHead} names something declared in reach, which the text reads as its own operand comment");
            if (literal.Length < 2 || literal[literal.Length - 1] != '\'')
                throw Error(line, $"{StNetworkWriter.CommentHead} takes an operand and one string, {StNetworkWriter.CommentHead}(a, '<the comment>')");
            var text = NetworkSpelling.Unescape(literal.Substring(1, literal.Length - 2), '\'', out var error) ?? throw Error(line, error!);
            if (text.Length == 0) throw Error(line, $"{StNetworkWriter.CommentHead}({operand}, ''): an empty comment is the plain operand {operand}");
            return text;
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
                    throw Error(n.Line, $"NOT a is no network text: a negation is {StNetworkWriter.InvertHead}(a), and NOT(a) is the NOT box");
                case ABin b:
                    return new Box(b.Type, null, CallKind.Operator, b.Operands.Select(o => new Input(null, Expr(o), Flags.None)).ToList(),
                        Array.Empty<Output>(), null, null, Flags.None, ConnectedSlot: NetworkSpelling.MainSlotOfCall(b.Type),
                        Members: StNetworkWriter.ElementMembers(b.Type, contact: true));
                case AAssign a: return new Demux(VarId(a.Targets[0].Text, a.Line), Marked(a.Value, Receiver.None));
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

        /// <summary>The text's own elements: <c>OPERAND('…')</c>, <c>COMMENT(a, '…')</c>, the rail <c>RAIL()</c>, the parallel branch
        /// <c>BRANCH(FEED := f, b1, b2)</c> / <c>BRANCH_SHORTCIRCUIT(…)</c>, an <c>ASSIGN</c>, and a mark standing at no receiver
        /// (<see cref="Marked(AExpr, Receiver, bool, bool)"/>).</summary>
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
            if (element == StNetworkWriter.CommentHead)
            {
                if (c.Member is not null || c.Args.Count != 2 || c.Args.Any(a => a.Out || a.Formal is not null) ||
                    c.Args[1].Value is not AOperand { Text: var literal } || !literal.StartsWith("'", StringComparison.Ordinal))
                    throw Error(c.Line, $"{c.Head} takes an operand and one string, {StNetworkWriter.CommentHead}(a, '<the comment>'), and names no output");
                if (c.Args[0].Value is not (AOperand or ACall) || c.Args[0].Value is ACall oc && !Is(oc.Head, StNetworkWriter.OperandHead) ||
                    Expr(c.Args[0].Value!) is not Leaf { Flags.IsNone: true, Operand: { Comment: null, Text.Length: > 0 } } leaf)
                    throw Error(c.Line, $"{c.Head} wraps an operand, and the marks stand outside it: {StNetworkWriter.InvertHead}({StNetworkWriter.CommentHead}(a, 'why')), {StNetworkWriter.RisingHead}({StNetworkWriter.CommentHead}(a, 'why'))");
                return leaf with { Operand = leaf.Operand with { Comment = Comment(literal, leaf.Operand.Text, c.Line) } };
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
            if (element == StNetworkWriter.AssignHead) return AssignElement(c);
            return Marked(c, Receiver.None);
        }

        /// <summary>The box type of an enabled FUNCTION box other than a comparison read by its value or a data output (it shows EN,
        /// and its call is closed by a member: its flow is otherwise its ENO), else null.</summary>
        private string? EnOnlyByValue(ACall c)
        {
            if (IsExecute(c) || Callee(c).Instance is not null) return null;
            if (c.Args.FirstOrDefault() is not { Out: false } first || !Is(first.Formal, Box.EnablePin)) return null;
            var signature = NetworkSpelling.SignatureOf(c.Head, block: false, _net.Scope);
            if (NetworkSpelling.Comparisons.Contains(c.Head) || signature is { DeclaresEn: true }) return null;
            // With no member it hands on its ENO, its default flow; closed by a member it is read by a data output.
            return c.Member is null ? null : c.Head;
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

        /// <summary>THE BOX A CALL IS (openspec network-output-member, network-language rule 4): a call of an FB instance an FB box of
        /// its declared type, a call of an FB type the box with no instance; <c>EN :=</c> first the shown EN, where the callee declares
        /// no EN of its own; its flow its default output, <c>.NAME</c> another (<see cref="Member"/>); a mark on an output in the
        /// output's name (<see cref="OutputMark"/>).</summary>
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
                    : c.Args.FirstOrDefault(a => a.Out && (Is(a.Formal, Box.EnoPin) || Is(a.Formal, StNetworkWriter.ResultPin))) is { } o ? o.Formal + " =>"
                    : null;
                if (what is not null)
                    throw Error(c.Line, $"{what} on the call {c.Head}, whose callee no declaration in reach states: it is a box flag or the callee's own pin, which only the declaration tells");
            }

            Node? enable = null;
            var enableFlags = Flags.None;
            if (!declaresEn && at < c.Args.Count && c.Args[at] is { Out: false } en && Is(en.Formal, Box.EnablePin))
            {
                enable = Marked(en.Value!, Receiver.Pin, out enableFlags);
                at++;
            }
            var inputs = new List<Input>();
            var outputs = new List<(string? Formal, string Target, Flags Marks, string? Comment)>();
            for (var k = at; k < c.Args.Count; k++)
            {
                var a = c.Args[k];
                if (a.Out)
                {
                    if (_net.IsWire(a.Target!))
                        throw Error(c.Line, $"the call {c.Head} wires its output {a.Formal} to the wire {a.Target}: a wire is defined by `{a.Target} := <box>`, its box closed by the output it reads");
                    if (a.Jump || a.Return)
                        throw Error(c.Line, $"the call {c.Head} wires {a.Formal} => to a jump or a return: those are targets of an {StNetworkWriter.AssignHead}");
                    // `OUT =>` is a function's value, each the next unnamed slot; on an FB call it is the FB's own output named OUT.
                    var (name, mark) = OutputMark(c, type, a.Formal!, signature);
                    outputs.Add((Is(name, StNetworkWriter.ResultPin) && instance is null ? null : name, a.Target!, mark,
                        Comment(a.TargetComment, a.Target!, c.Line)));
                    continue;
                }
                if (signature is not null && !declaresEn && Is(a.Formal, Box.EnablePin))
                    throw Error(c.Line, enable is null
                        ? $"EN := stands first in the call {c.Head}: it is the box's shown EN"
                        : $"the call {c.Head} holds EN := twice");
                var value = Marked(a.Value!, Receiver.Pin, out var pinFlags);
                inputs.Add(new Input(a.Formal, value, pinFlags));
            }

            // AN FB'S OR A PROGRAM'S BOX PASSES ONLY NAMED PINS (live CODESYS 3.5.21.40, openspec nwl-box-storage-map): `t2(a, i)`
            // stores no names and builds as `t2()`, `x := p(a, i).q` as `x := p.q` with the program not called. A FUNCTION is
            // given its names by the push (`NetworkDerivation`).
            if ((instance is not null || signature is { Shape: CalleeShape.Program }) && inputs.Any(i => i.Formal is null))
                throw Error(c.Line, $"the call {c.Head} passes a pin by position: the box of an FB or a program passes only named pins, and the IDE drops the rest. Name it, {c.Head}(<pin> := value)");
            // A VARIABLE ON THE ENO PIN IS NEVER WRITTEN (live CODESYS 3.5.21.40, openspec nwl-box-storage-map), on an operator, a
            // FUNCTION, an FB alike, and a FUNCTION's `OUT =>` beside it is not written either. ENO is read as a coil's value.
            if (signature is not null && !declaresEno && outputs.Any(o => Is(o.Formal, Box.EnoPin)))
                throw Error(c.Line, $"the call {c.Head} wires ENO =>: the IDE never writes a variable on the ENO pin. ENO is the flow of a box showing EN, {StNetworkWriter.AssignHead}({c.Head}(EN := …), {StNetworkWriter.AssignOutput} => v)");
            // AN OPERATOR RUNS ITS PINS BY POSITION, whatever their names say (live CODESYS 3.5.21.40, openspec nwl-box-storage-map).
            if (NetworkSpelling.IsOperator(signature) && NetworkSpelling.OperatorPinOutOfPlace(type, inputs.Select(i => i.Formal).ToList()) is { } pin)
                throw Error(c.Line, $"the box {c.Head} names its pin {pin} out of place: an operator runs its pins by position, whatever their names say. Write them in order");
            // ONE OUTPUT, ONE TARGET (live CODESYS 3.5.21.40, openspec nwl-box-storage-map): the IDE writes no second target.
            if (outputs.GroupBy(o => o.Formal ?? StNetworkWriter.ResultPin, StringComparer.OrdinalIgnoreCase).FirstOrDefault(g => g.Count() > 1) is { } twice)
                throw Error(c.Line, $"the call {c.Head} wires {twice.Key} => twice: the IDE writes no second target. Two targets are one {StNetworkWriter.AssignHead}, {StNetworkWriter.AssignHead}({c.Head}(…), {StNetworkWriter.AssignOutput} => x, {StNetworkWriter.AssignOutput} => y)");

            var (hasEno, connected, byName) = Member(c, type, instance is not null, signature, consumed, declaresEno, enable is not null,
                outputs.Any(o => o.Formal is null));
            // A BOX READ BY ITS VALUE WRITES ITS READER AND NO `OUT =>` (live CODESYS 3.5.21.40, openspec nwl-box-storage-map).
            if (consumed && !hasEno && instance is null && signature is { Shape: not CalleeShape.Program } && connected is null or 0 && outputs.Any(o => o.Formal is null))
                throw Error(c.Line, $"the box {c.Head} is read by its value and wires OUT =>: the IDE writes no second target. Two targets are one {StNetworkWriter.AssignHead}, {StNetworkWriter.AssignHead}({c.Head}(…), {StNetworkWriter.AssignOutput} => x, {StNetworkWriter.AssignOutput} => y)");
            // A FUNCTION'S `OUT =>` AT A ROOT IS WRITTEN ONLY WITH ITS ENO SHOWN OR A VAR_OUTPUT READ (live CODESYS 3.5.21.40, openspec
            // nwl-box-storage-map); with EN shown and no ENO the IDE faults on the box.
            if (!consumed && !hasEno && signature is { Shape: CalleeShape.Function } && !NetworkSpelling.IsOperator(signature) && connected is null && outputs.Any(o => o.Formal is null))
                throw Error(c.Line, $"the function box {c.Head} wires OUT => at a root with no EN: the IDE does not write it. Read its value, {StNetworkWriter.AssignHead}({c.Head}(…), {StNetworkWriter.AssignOutput} => x)");
            // `OUT =>` ON AN FB OR A PROGRAM THAT DECLARES NONE lands past its names or on its first output (same measurement).
            if (signature is { Shape: CalleeShape.Block or CalleeShape.Program } && !signature.Outputs.Any(o => Is(o, StNetworkWriter.ResultPin)) &&
                outputs.Any(o => (o.Formal is null || Is(o.Formal, StNetworkWriter.ResultPin)) && o.Target != Box.UnnamedInstance))
                throw Error(c.Line, $"the call {c.Head} wires OUT =>, and {type} declares no output OUT: the IDE does not write it");
            // AN OPERATOR READ THROUGH ITS ENO NEEDS ITS VALUE WIRED (live CODESYS 3.5.21.40, openspec nwl-box-storage-map): it does not
            // build, and a user FUNCTION does. `ASSIGN(GT(EN := go, i, j, OUT => v), Q => y)` builds and runs.
            if (consumed && hasEno && NetworkSpelling.IsOperator(signature) && !outputs.Any(o => o.Formal is null))
                throw Error(c.Line, $"the operator box {c.Head} hands on its ENO and wires its value nowhere. Wire it, {c.Head}(EN := …, …, OUT => v)");
            var eno = hasEno ? 0 : (int?)null;
            var next = 0;
            var outs = new List<Output>();
            foreach (var (formal, target, marks, comment) in outputs)
            {
                var operand = new Operand(target, IsLValue: true, Flags: marks.IsNone ? null : marks, Comment: comment);
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
        /// WHAT FLOWS ON FROM THE CALL (network-language rule 4). Its default output — the shown ENO where EN is shown, else a function's
        /// value or an FB's or a program's first output — with no member; <c>.NAME</c> another output, never the default. A callee no
        /// declaration in reach states is read as written: <c>.NAME</c> the output named so (its slot unknown, which the push refuses by
        /// name), nothing an FB read by no named output, a function by its value. At a ROOT nothing reads the flow: <c>.NAME</c> names
        /// the stored main slot past its first, and ENO is shown where EN is, except on a function or an operator wiring no value
        /// (<c>GT(EN := go, i, j);</c>, which does not build with its ENO shown).
        /// </summary>
        private (bool HasEno, int? Connected, string? ByName) Member(ACall c, string type, bool block, CalleeSignature? signature,
                                                                     bool consumed, bool declaresEno, bool enabled, bool valueWired)
        {
            var member = c.Member;
            if (member is not null && Is(member, Box.EnoPin) && !declaresEno)
                throw Error(c.Line, $".ENO is no network text: ENO is the flow of a box showing EN, written as the call alone, {c.Head}(EN := …)");
            if (!consumed && member is null)
                return (enabled && (signature is not { Shape: CalleeShape.Function } || valueWired), null, null);
            if (consumed && member is null && enabled)
            {
                if (declaresEno)
                    throw Error(c.Line, $"the box {c.Head} shows EN, and {type} declares an output ENO of its own: which one flows on, the text cannot tell");
                return (true, 0, null);
            }
            if (signature is null)
                return member is not null ? (false, null, member) : (false, block ? null : NetworkSpelling.MainSlotOfCall(type), null);
            var outputs = block ? signature.Outputs : signature.DataOutputs;
            if (member is null)
            {
                if (outputs.Count == 0) throw Error(c.Line, $"the box {c.Head} is read, and {type} declares no output to read");
                return block ? (false, null, outputs[0]) : (false, NetworkSpelling.MainSlotOfCall(type), null);
            }
            var slot = outputs.Select((o, i) => (o, i)).Where(x => Is(x.o, member)).Select(x => (int?)x.i).FirstOrDefault();
            if (slot is null)
                throw Error(c.Line, $"the box {c.Head} is closed by .{member}, which names no output of {type} ({string.Join(", ", outputs)})");
            if (slot == 0 && !(consumed && enabled))
                throw Error(c.Line, consumed
                    ? $"the box {c.Head} is closed by .{member}, its default output: the default flows on with no member, {c.Head}(…)"
                    : $"the box {c.Head} stands at a root closed by .{member}, the first output of {type}: a root with no closer is its first output, so it names none");
            return block ? (false, null, member) : (false, slot, null);
        }

        /// <summary>
        /// AN OUTPUT PIN'S NAME AND MARK (network-language rule 2): a suffix <c>_INVERTED</c>, <c>_SET</c>, <c>_RESET</c> marks the output
        /// it ends, the reset the vendor's <c>Negation</c> and <c>Set</c> bits together as on a coil (<see cref="Flags.CoilFromVendor"/>).
        /// A name the callee declares as it stands is that output, unmarked. Refused where it reads two ways (rule 9): the callee
        /// declares both the name and its stem (<c>Q</c> and <c>Q_SET</c>), or no declaration in reach states which.
        /// </summary>
        private (string Name, Flags Mark) OutputMark(ACall c, string type, string formal, CalleeSignature? signature)
        {
            var suffix = StNetworkWriter.ReceiverSuffixes.FirstOrDefault(x => formal.EndsWith(x, StringComparison.OrdinalIgnoreCase));
            if (suffix is null || formal.Length == suffix.Length) return (formal, Flags.None);
            var stem = formal.Substring(0, formal.Length - suffix.Length);
            var outputs = signature?.DataOutputs ?? (IReadOnlyList<string>)Array.Empty<string>();
            bool Declared(string n) => outputs.Any(o => Is(o, n));
            if (signature is null || Declared(stem) && Declared(formal))
                throw Error(c.Line, $"{formal} => on the call {c.Head}: {StNetworkWriter.MarkedOutputReason} is refused, " +
                                    (signature is null ? $"no declaration in reach states whether {type} declares {formal} or {stem}" : $"{type} declares both {stem} and {formal}"));
            if (Declared(formal)) return (formal, Flags.None);
            var mark = Is(suffix, StNetworkWriter.ResetSuffix) ? Flags.None with { Negated = true, Set = true }
                : Is(suffix, StNetworkWriter.SetSuffix) ? Flags.None with { Set = true }
                : Flags.None with { Negated = true };
            return (stem, mark);
        }

        /// <summary>THE EXECUTE BOX: <c>EXECUTE(EN := e, '&lt;ST&gt;')</c> — EN where it shows EN, then its ST, one string,
        /// nothing else; its one output its ENO (by type), read through it where consumed, so no member closes the call.</summary>
        private Box ExecuteBox(ACall c, bool consumed)
        {
            if (_net.InReach(c.Head))
                throw Error(c.Line, $"the call {c.Head} names something declared in reach, which the text reads as its Execute box");
            // Its one output is its ENO, its flow: read through it where consumed.
            if (c.Member is { } member)
                throw Error(c.Line, $"the Execute box is closed by .{member}: its one output is its ENO, its flow, written as the call alone");
            var at = 0;
            Node? enable = null;
            var enableFlags = Flags.None;
            if (c.Args.Count > 0 && c.Args[0] is { Out: false } en && Is(en.Formal, Box.EnablePin))
            {
                enable = Marked(en.Value!, Receiver.Pin, out enableFlags);
                at = 1;
            }
            // Its one output is its ENO, by type: shown always. At a root nothing reads it, and the call builds and runs alike
            // with it shown or not (live CODESYS 3.5.21.40, box-states 1067/1075, 1087/1089).
            const bool eno = true;
            if (c.Args.Count != at + 1 || c.Args[at] is not { Out: false, Formal: null, Value: AOperand { Text: var literal } } ||
                literal.Length < 2 || literal[0] != '\'' || literal[literal.Length - 1] != '\'')
                throw Error(c.Line, $"the Execute box takes {Box.EnablePin} := first where it shows EN, then its ST as one string '<ST>', and nothing else");
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
