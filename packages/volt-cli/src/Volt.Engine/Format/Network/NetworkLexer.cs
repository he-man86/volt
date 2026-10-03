using System;
using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;
using Volt.Contracts;

namespace Volt.Engine.Format.Network;

internal enum TokKind
{
    Marker,     // the body's IMPLEMENTATION line; Text = FBD | LD
    Word,       // an identifier or dotted path
    Number,
    Typed,      // T#1S, 16#FF
    Address,    // %IX0.0
    Unnamed,    // ???
    Backtick,   // Text = the verbatim content between the backticks
    String,     // a TITLE; Text = the DECODED value
    Comment,    // a // line; Text = what follows `//` and one space
    Snippet,    // an EXECUTE body; Text = its lines joined by \n
    Wires,      // a whole VAR_TEMP block, as the post-push comparison keys it; Text = name:type per wire, by VarId
    Sym,        // punctuation and operators
    Error,      // Text = message, Code = its NETWORK_* code
    Eof,
}

/// <summary>One token, with its span. <see cref="AtLineStart"/> is what makes <c>NETWORK</c> a header: the page's
/// rule is "the whole word NETWORK at a line start", so <c>NetworkState := 1;</c> mid-body is not one.</summary>
internal readonly record struct Tok(TokKind Kind, string Text, int Offset, int Length, bool AtLineStart,
                                    string? Code = null)
{
    public bool Is(string word) => Kind == TokKind.Word && string.Equals(Text, word, StringComparison.OrdinalIgnoreCase);
    public bool IsSym(string s) => Kind == TokKind.Sym && Text == s;

    /// <summary>What the gate compares: the kind and the text, never the position.</summary>
    public (TokKind, string) Key => (Kind, Text);
}

/// <summary>
/// The network text v2 lexer: on demand, one token at a time, so the parser can switch it into the one raw mode
/// the grammar has — an EXECUTE body, whose lines are verbatim ST and end at the first line whose first word is
/// <c>END_EXECUTE</c>. Newlines are otherwise layout; the header ending at its newline is decided by the parser
/// from token positions, and a <c>//</c> comment ends at its newline by construction.
///
/// <para>A lexical error is a token (<see cref="TokKind.Error"/>) that has consumed its text, never an exception:
/// the parser turns it into a diagnostic at its span, and recovery can always make progress past it.</para>
/// </summary>
internal sealed class NetworkLexer
{
    private readonly string _s;
    private readonly List<int> _lineStarts = new() { 0 };
    private int _i;

    public NetworkLexer(string s, int start)
    {
        _s = s;
        _i = start;
        for (var k = 0; k < s.Length; k++) if (s[k] == '\n') _lineStarts.Add(k + 1);
    }

    /// <summary>A lexer standing where this one stands, for a look ahead that must not move this one.</summary>
    private NetworkLexer(NetworkLexer at)
    {
        _s = at._s;
        _lineStarts = at._lineStarts;
        _i = at._i;
    }

    public (int Line, int Column) LineCol(int offset)
    {
        var lo = 0; var hi = _lineStarts.Count - 1;
        while (lo < hi)
        {
            var mid = (lo + hi + 1) / 2;
            if (_lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
        }
        return (lo + 1, offset - _lineStarts[lo] + 1);
    }

    public int LineOf(int offset) => LineCol(offset).Line;

    public Tok Next()
    {
        while (_i < _s.Length && char.IsWhiteSpace(_s[_i])) _i++;
        if (_i >= _s.Length) return new Tok(TokKind.Eof, "", _s.Length, 0, true);

        var start = _i;
        var atLineStart = AtLineStart(start);
        var c = _s[_i];

        if (c == '/' && Peek(1) == '/')
        {
            _i += 2;
            var end = LineEnd(_i);
            var text = WithoutLayoutCr(_s.Substring(_i, end - _i));
            _i = end;
            if (text.IndexOf('\r') >= 0) return LoneCr(start);
            // `//` and ONE space are syntax; the rest — indentation, a leading `//` — is the comment's text.
            if (text.StartsWith(" ", StringComparison.Ordinal)) text = text.Substring(1);
            return new Tok(TokKind.Comment, text, start, end - start, atLineStart);
        }

        if (c == '`')
        {
            var close = _s.IndexOf('`', _i + 1);
            if (close < 0)
            {
                _i = _s.Length;
                return Error(start, "an unclosed backtick: backticked text runs to the next backtick.", ConflictCodes.NetworkParse);
            }
            var inner = _s.Substring(_i + 1, close - _i - 1);
            _i = close + 1;
            // A backtick cannot be spelled INSIDE backticked text, so `a`b`c` is not two operands side by side —
            // it is text that holds a backtick, which the vendor's operand could hold and the text cannot.
            if (_i < _s.Length && (_s[_i] == '`' || IsWordChar(_s[_i])))
            {
                var stop = _i;
                while (stop < _s.Length && !char.IsWhiteSpace(_s[stop]) && _s[stop] != ';' && _s[stop] != ',' && _s[stop] != ')') stop++;
                _i = stop;
                return Error(start, "backticked text containing a backtick: a backtick cannot be spelled inside backticks.",
                    ConflictCodes.NetworkUnsupported);
            }
            return new Tok(TokKind.Backtick, inner, start, _i - start, atLineStart);
        }

        if (c == '"') return Title(start, atLineStart);

        if (c == '?' && Peek(1) == '?' && Peek(2) == '?')
        {
            _i += 3;
            return new Tok(TokKind.Unnamed, "???", start, 3, atLineStart);
        }

        if (c == '%')
        {
            var m = AddressAt.Match(_s, _i);
            if (m.Success && m.Index == _i)
            {
                _i += m.Length;
                return new Tok(TokKind.Address, m.Value, start, m.Length, atLineStart);
            }
        }

        // ASCII only, as NetworkSpelling's patterns are: a letter or digit outside ASCII is no character of a bare
        // token, so it falls through to a one-character symbol the parser refuses. Taken as a word character it
        // would reach NumberAt, which matches nothing there, and the lexer would stand still on it forever.
        if (IsWordChar(c))
        {
            while (_i < _s.Length && IsWordChar(_s[_i])) _i++;
            // A typed literal: the word before `#` is its type or base (T#1S, 16#FF, DT#2020-01-01-12:00:00).
            if (_i < _s.Length && _s[_i] == '#')
            {
                var j = _i + 1;
                while (j < _s.Length && (IsWordChar(_s[j]) || ".:+-".IndexOf(_s[j]) >= 0)) j++;
                if (j > _i + 1)
                {
                    _i = j;
                    return new Tok(TokKind.Typed, _s.Substring(start, _i - start), start, _i - start, atLineStart);
                }
            }
            if (c is >= '0' and <= '9')
            {
                _i = start;
                var m = NumberAt.Match(_s, _i);
                _i += m.Length;
                return new Tok(TokKind.Number, m.Value, start, m.Length, atLineStart);
            }
            // A dotted path is one operand token: `Mach1.GenFlags.Warning`, `T.Start`.
            while (_i + 1 < _s.Length && _s[_i] == '.' && IsWordChar(_s[_i + 1]))
            {
                _i++;
                while (_i < _s.Length && IsWordChar(_s[_i])) _i++;
            }
            // `S=` / `R=` are a word and `=`, as `S = x` is: which of the storage operator and a comparison with a
            // variable named S it is, is the PARSER's call from the position — whitespace plays no part.
            var word = _s.Substring(start, _i - start);
            return new Tok(TokKind.Word, word, start, word.Length, atLineStart);
        }

        foreach (var sym in Syms)
            if (string.CompareOrdinal(_s, _i, sym, 0, sym.Length) == 0)
            {
                _i += sym.Length;
                return new Tok(TokKind.Sym, sym, start, sym.Length, atLineStart);
            }

        _i++;
        return new Tok(TokKind.Sym, c.ToString(), start, 1, atLineStart);
    }

    /// <summary>The next non-whitespace character, across lines, or null at the end.</summary>
    public char? PeekChar()
    {
        var j = _i;
        while (j < _s.Length && char.IsWhiteSpace(_s[j])) j++;
        return j < _s.Length ? _s[j] : null;
    }

    /// <summary>Whether <c>=</c> — and not <c>=&gt;</c> — is next, across layout. Asked after an <c>S</c> or <c>R</c>
    /// that follows a target: it makes the pair the storage operator whatever the spacing.</summary>
    public bool EqualsFollows()
    {
        var j = _i;
        while (j < _s.Length && char.IsWhiteSpace(_s[j])) j++;
        return j < _s.Length && _s[j] == '=' && (j + 1 >= _s.Length || _s[j + 1] != '>');
    }

    /// <summary>
    /// Whether the pair of parentheses that comes next holds an infix operator at its OWN depth. Asked right after
    /// an operator word: parentheses are structural (spec), so after <c>AND</c> a pair holding an operator is a
    /// group and the word was the operator after an empty slot (<c>( AND (x OR y))</c>), while any other pair is
    /// the word's argument list (<c>AND(EN := go, a, b)</c>, <c>AND((x OR y), c)</c>). Spacing plays no part,
    /// which is what makes the writer's <c>AND (</c> and a hand-typed <c>AND(</c> the same text.
    ///
    /// <para>Scanned on a fork of the lexer, token by token, so backticks, titles and EXECUTE bodies inside the
    /// pair are skipped as the units they are — an <c>AND</c> in a snippet's ST is not the pair's operator.</para>
    /// </summary>
    public bool PairAheadHoldsOperator()
    {
        var f = new NetworkLexer(this);
        var w = new Walk(f);
        if (!w.Next().IsSym("(")) return false;
        while (true)
        {
            var t = w.Next();
            if (t.Kind == TokKind.Eof) return false;
            if (t.IsSym(")") && w.Depth == 0) return false;
            // An operator word is an infix operator here unless it is a pin's name or a CALL HEAD — a word whose own
            // pair holds no operator (the same rule, one level down): the argument list of `and(or(a, b), c)` holds
            // a call, not an operator, and is an argument list itself.
            if (w.Depth == 1 && IsOperator(t) &&
                !(t.Kind == TokKind.Word && (f.PinOperatorFollows() || (f.PeekChar() == '(' && !f.PairAheadHoldsOperator()))))
                return true;
        }
    }

    /// <summary>
    /// The tokens of a text as the reader consumes them, without reading it: every EXECUTE body is entered where the
    /// reader enters one — at an <c>EXECUTE</c> that is no pin's name, right after it or after the pin list
    /// <c>(EN := …)</c> that follows it, however deep that list nests another EXECUTE — and comes out as its snippet
    /// and its <c>END_EXECUTE</c>. It is the ONE scope-free copy of that rule: the look-ahead above and the gate's
    /// post-push comparison (<see cref="NetworkTextGate.SameTokens"/>) both walk through it, so the two cannot enter
    /// a body at different places, and an ST line inside a snippet is never lexed as network tokens.
    /// </summary>
    public sealed class Walk
    {
        private readonly NetworkLexer _lx;
        private readonly Stack<int> _executeAt = new();   // the depth an `EXECUTE(EN := …)` head's pair closes back to
        private readonly Queue<Tok> _body = new();

        public Walk(NetworkLexer lx) => _lx = lx;

        /// <summary>Open parentheses after the last token returned.</summary>
        public int Depth { get; private set; }

        public Tok Next()
        {
            var t = _body.Count > 0 ? _body.Dequeue() : Lexed();
            (_before, _last) = (_last, t);
            return t;
        }

        // The two tokens returned before the one in hand: a LABEL's name follows `LABEL :`, a jump's follows `JMP`.
        private Tok _before, _last;

        private Tok Lexed()
        {
            var t = _lx.Next();
            if (t.IsSym("(")) Depth++;
            else if (t.IsSym(")"))
            {
                Depth--;
                if (_executeAt.Count > 0 && _executeAt.Peek() == Depth) { _executeAt.Pop(); Body(); }
            }
            // In VALUE position only, as the reader opens one: a pin's name (`execute :=`) and a label — the header's
            // `LABEL: Execute` and `JMP Execute`, legal IEC labels the reader takes as names — open no body. Entered
            // at a label, the walk swallowed the rest of the text into one error token.
            else if (t.Is("EXECUTE") && !_lx.PinOperatorFollows() && !_last.Is("JMP") &&
                     !(_last.IsSym(":") && _before.Is("LABEL")))
            {
                if (_lx.PeekOnLine() == '(') _executeAt.Push(Depth);
                else Body();
            }
            return t;
        }

        private void Body()
        {
            var (snippet, end) = _lx.ExecuteBody();
            _body.Enqueue(snippet);
            // An error has consumed its text and the lexer goes on from it, as the reader's recovery does.
            if (snippet.Kind != TokKind.Error) _body.Enqueue(end);
        }
    }

    /// <summary>An infix operator of the table: a symbol, or one of the operator words.</summary>
    public static bool IsOperator(Tok t) =>
        (t.Kind == TokKind.Sym && FbdOperators.SymbolToType.ContainsKey(t.Text)) ||
        (t.Kind == TokKind.Word && (t.Is("AND") || t.Is("OR") || t.Is("XOR") || t.Is("MOD")));

    /// <summary>Whether <c>:=</c> or <c>=&gt;</c> is next, across layout. Asked right after a word inside an
    /// argument list: it makes that word a PIN NAME before it is read as a value, so a formal spelled like a
    /// construct of the text (<c>execute :=</c>, a real pin of Lenze's <c>identPolePosition</c>) is a name and
    /// never opens the construct.</summary>
    public bool PinOperatorFollows()
    {
        var j = _i;
        while (j < _s.Length && char.IsWhiteSpace(_s[j])) j++;
        return j + 1 < _s.Length && ((_s[j] == ':' && _s[j + 1] == '=') || (_s[j] == '=' && _s[j + 1] == '>'));
    }

    /// <summary>The next non-blank character on the current line, or null at its end. Lets the parser see
    /// whether an <c>EXECUTE</c> carries <c>(EN := …)</c> without lexing into its body.</summary>
    public char? PeekOnLine()
    {
        var j = _i;
        while (j < _s.Length && (_s[j] == ' ' || _s[j] == '\t' || _s[j] == '\r')) j++;
        return j < _s.Length && _s[j] != '\n' ? _s[j] : null;
    }

    /// <summary>An EXECUTE body: the rest of the current line must be blank; the body is every line after it up
    /// to the first line whose first word is <c>END_EXECUTE</c>, verbatim (a <c>\r</c> dropped, as the writer
    /// drops it). Returns the snippet and the <c>END_EXECUTE</c> word, or an error token.</summary>
    public (Tok Snippet, Tok End) ExecuteBody()
    {
        var eol = LineEnd(_i);
        if (_s.Substring(_i, eol - _i).Trim().Length != 0)
        {
            var at = _i;
            _i = eol;
            var e = Error(at, "an EXECUTE body starts on the line after EXECUTE; nothing may follow it on its own line.",
                ConflictCodes.NetworkParse);
            return (e, e);
        }
        var bodyStart = Math.Min(eol + 1, _s.Length);
        var lines = new List<string>();
        int? loneCr = null;
        var k = bodyStart;
        while (k < _s.Length)
        {
            var end = LineEnd(k);
            var line = WithoutLayoutCr(_s.Substring(k, end - k));
            var m = EndExecute.Match(line);
            if (m.Success)
            {
                var wordAt = k + m.Groups[1].Index;
                _i = wordAt + "END_EXECUTE".Length;
                // Reported once the body's end is found, so the parser resumes after END_EXECUTE and not inside ST.
                if (loneCr is { } cr) { var e = LoneCr(cr); return (e, e); }
                var snippet = string.Join("\n", lines);
                return (new Tok(TokKind.Snippet, snippet, bodyStart, wordAt - bodyStart, true),
                        new Tok(TokKind.Word, _s.Substring(wordAt, "END_EXECUTE".Length), wordAt, "END_EXECUTE".Length, true));
            }
            var at = line.IndexOf('\r');
            if (at >= 0 && loneCr is null) loneCr = k + at;
            lines.Add(line);
            k = end + 1;
        }
        var err = Error(eol, "an EXECUTE body with no END_EXECUTE: the body ends at the first line whose first word is END_EXECUTE.",
            ConflictCodes.NetworkParse);
        _i = _s.Length;
        return (err, err);
    }

    private Tok Title(int start, bool atLineStart)
    {
        var sb = new StringBuilder();
        _i++;
        while (true)
        {
            if (_i >= _s.Length || _s[_i] == '\n' || _s[_i] == '\r')
                return Error(start, "an unclosed TITLE string: a title ends at its closing quote, on the header's line (a newline inside it is $N).",
                    ConflictCodes.NetworkParse);
            var c = _s[_i];
            if (c == '"') { _i++; break; }
            if (c == '$')
            {
                // ST's string escapes, the ones the writer writes (owner decision 2026-09-26): $N, $R, $", $$.
                var e = Peek(1);
                string? v = e switch { 'N' or 'n' => "\n", 'R' or 'r' => "\r", '"' => "\"", '$' => "$", _ => null };
                if (v is null)
                {
                    _i += 2;
                    return Error(start, $"the escape '${e}' in a TITLE: a title spells $N, $R, $\" and $$ only.", ConflictCodes.NetworkParse);
                }
                sb.Append(v);
                _i += 2;
                continue;
            }
            sb.Append(c);
            _i++;
        }
        return new Tok(TokKind.String, sb.ToString(), start, _i - start, atLineStart);
    }

    /// <summary>A line's text without the CR of a CR LF, which is the file's layout — ONE CR, so a CR before it is
    /// still a lone one.</summary>
    private static string WithoutLayoutCr(string line) =>
        line.EndsWith("\r", StringComparison.Ordinal) ? line.Substring(0, line.Length - 1) : line;

    /// <summary>Spec: a line ending in a lone CR goes to the marker on pull, so on push it has no reading. It ends a
    /// line wherever it stands — an editor breaks the line there — and taking it as text would carry what follows
    /// into the comment or the ST, where the engineer sees a line of its own.</summary>
    private Tok LoneCr(int at) =>
        new(TokKind.Error,
            "a lone carriage return (CR without LF) in a comment or EXECUTE line: a line ends at LF, and a CR is layout only right before one.",
            at, 1, AtLineStart(at), ConflictCodes.NetworkParse);

    private Tok Error(int start, string message, string code) =>
        new(TokKind.Error, message, start, Math.Max(1, _i - start), AtLineStart(start), code);

    private bool AtLineStart(int offset)
    {
        for (var k = offset - 1; k >= 0; k--)
        {
            if (_s[k] == '\n') return true;
            if (!char.IsWhiteSpace(_s[k])) return false;
        }
        return true;
    }

    private int LineEnd(int from)
    {
        var e = _s.IndexOf('\n', from);
        return e < 0 ? _s.Length : e;
    }

    private char Peek(int ahead) => _i + ahead < _s.Length ? _s[_i + ahead] : '\0';

    private static bool IsWordChar(char c) => c is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9' or '_';

    // Longest first: `:=` before `:`, `<=` / `<>` before `<`.
    private static readonly string[] Syms = { ":=", "=>", "<=", ">=", "<>", "(", ")", ",", ";", ":", ".", "=", "<", ">", "+", "-", "*", "/" };

    // The token shapes are NetworkSpelling's, anchored here at the lexer's position: the writer leaves a text bare by
    // the same pattern this reads it back by.
    private static readonly Regex AddressAt = new(@"\G" + NetworkSpelling.AddressPattern, RegexOptions.Compiled);
    private static readonly Regex NumberAt = new(@"\G" + NetworkSpelling.NumberPattern, RegexOptions.Compiled);
    private static readonly Regex EndExecute = new(@"^\s*(END_EXECUTE)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
}
