using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using Volt.Contracts;

namespace Volt.Engine.Format.Network;

internal enum TokKind
{
    Marker,     // the body's IMPLEMENTATION line; Text = FBD | LD
    Word,       // an identifier or dotted path
    Number,     // 5, 1.5, -1 (the minus touching the digit, P14)
    Typed,      // T#1S, 16#FF
    Address,    // %IX0.0
    Unnamed,    // ???
    Backtick,   // Text = the verbatim content between the backticks
    DString,    // a double-quoted string, as written (quotes included): a TITLE, or a WSTRING literal
    SString,    // a single-quoted ST string literal, as written (quotes included)
    Comment,    // a // line; Text = what follows `//` and one space
    Snippet,    // an EXECUTE body; Text = its lines joined by \n
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
/// The network text lexer (openspec <c>ld-fbd-coverage</c> 2R.3, <c>readability.md</c>): on demand, one token at a time,
/// with one raw mode — an EXECUTE body, whose lines are verbatim ST from the line after <c>EXECUTE [EN [c]]</c> to the
/// first line whose first word is <c>END_EXECUTE</c> (P9). That mode is entered by the token walk
/// (<see cref="Walk"/>), which every reader of the text goes through, so no reader can lex an ST body as network text.
/// Newlines are otherwise layout to the lexer: where a LINE ends (P2) is the parser's to decide from token positions.
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

    public string Source => _s;

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

    /// <summary>The end of the line <paramref name="offset"/> stands on (the offset of its LF, or the text's end).</summary>
    public int LineEndOf(int offset) => LineEnd(offset);

    /// <summary>Every token from the lexer's position to the end, EXECUTE bodies taken by the walk's rule.</summary>
    public List<Tok> Tokenize()
    {
        var all = new List<Tok>();
        var w = new Walk(this);
        while (true)
        {
            var t = w.Next();
            all.Add(t);
            if (t.Kind == TokKind.Eof) return all;
        }
    }

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
            // `//` and ONE space are syntax; the rest — indentation, trailing spaces, a leading `//` — is the comment's
            // text (P12: stored verbatim).
            if (text.StartsWith(" ", StringComparison.Ordinal)) text = text.Substring(1);
            return new Tok(TokKind.Comment, text, start, end - start, atLineStart);
        }

        if (c == '`')
        {
            var close = _s.IndexOf('`', _i + 1);
            var eol = LineEnd(_i);
            if (close < 0 || close > eol)
            {
                _i = eol;
                return Error(start, "an unclosed backtick: backticked text runs to the next backtick, on its line.", ConflictCodes.NetworkParse);
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

        if (c == '"' || c == '\'') return Quoted(start, atLineStart, c);

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

        // P14: a negative literal is the minus TOUCHING the digit, `-1`; `- 1`, `-x` and `+1` stay symbols the parser
        // refuses by name.
        if (c == '-' && Peek(1) is >= '0' and <= '9')
        {
            var m = NumberAt.Match(_s, _i + 1);
            _i += 1 + m.Length;
            if (_i < _s.Length && _s[_i] == '#') return TypedRest(start, atLineStart);
            return new Tok(TokKind.Number, _s.Substring(start, _i - start), start, _i - start, atLineStart);
        }

        // ASCII only, as NetworkSpelling's patterns are: a letter or digit outside ASCII is no character of a bare
        // token, so it falls through to a one-character symbol the parser refuses.
        if (IsWordChar(c))
        {
            while (_i < _s.Length && IsWordChar(_s[_i])) _i++;
            // A typed literal: the word before `#` is its type or base (T#1S, 16#FF, DT#2020-01-01-12:00:00).
            if (_i < _s.Length && _s[_i] == '#') return TypedRest(start, atLineStart);
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

    private Tok TypedRest(int start, bool atLineStart)
    {
        var j = _i + 1;
        while (j < _s.Length && (IsWordChar(_s[j]) || ".:+-".IndexOf(_s[j]) >= 0)) j++;
        if (j == _i + 1)
        {
            _i = j;
            return Error(start, "a typed literal with nothing after its `#`.", ConflictCodes.NetworkParse);
        }
        _i = j;
        return new Tok(TokKind.Typed, _s.Substring(start, _i - start), start, _i - start, atLineStart);
    }

    /// <summary>A quoted string, kept AS WRITTEN (quotes and <c>$</c> escapes included): an ST string literal is an operand's
    /// text verbatim, and a TITLE is decoded by the header (<see cref="DecodeTitle"/>). It ends at its closing quote on its
    /// line; <c>$</c> takes the character after it.</summary>
    private Tok Quoted(int start, bool atLineStart, char quote)
    {
        _i++;
        while (true)
        {
            if (_i >= _s.Length || _s[_i] == '\n' || _s[_i] == '\r')
                return Error(start, quote == '"'
                        ? "an unclosed double-quoted string: it ends at its closing quote, on its line (a newline inside a TITLE is $N)."
                        : "an unclosed string literal: it ends at its closing quote, on its line.",
                    ConflictCodes.NetworkParse);
            var c = _s[_i];
            if (c == quote) { _i++; break; }
            if (c == '$') { _i += _i + 1 < _s.Length && _s[_i + 1] != '\n' ? 2 : 1; continue; }
            _i++;
        }
        return new Tok(quote == '"' ? TokKind.DString : TokKind.SString, _s.Substring(start, _i - start), start, _i - start, atLineStart);
    }

    /// <summary>A TITLE's value: the double-quoted token decoded with the escapes the writer writes (owner decision
    /// 2026-09-26) — <c>$N</c>, <c>$R</c>, <c>$"</c>, <c>$$</c>. Null and <paramref name="error"/> for any other escape.</summary>
    public static string? DecodeTitle(string quoted, out string? error)
    {
        error = null;
        var sb = new System.Text.StringBuilder();
        for (var i = 1; i < quoted.Length - 1; i++)
        {
            var c = quoted[i];
            if (c != '$') { sb.Append(c); continue; }
            var e = i + 1 < quoted.Length - 1 ? quoted[i + 1] : '\0';
            string? v = e switch { 'N' or 'n' => "\n", 'R' or 'r' => "\r", '"' => "\"", '$' => "$", _ => null };
            if (v is null)
            {
                error = $"the escape '${e}' in a TITLE: a title spells $N, $R, $\" and $$ only.";
                return null;
            }
            sb.Append(v);
            i++;
        }
        return sb.ToString();
    }

    /// <summary>The next character after whitespace, without moving.</summary>
    public char? PeekChar()
    {
        var j = _i;
        while (j < _s.Length && char.IsWhiteSpace(_s[j])) j++;
        return j < _s.Length ? _s[j] : null;
    }

    /// <summary>
    /// THE ONE WALK OVER THE TEXT'S TOKENS, raw mode included: the reader, the gate's token compare and the v1 scan all
    /// read through it. <c>EXECUTE</c> in value position opens a body at the END OF ITS LINE (P9: <c>EXECUTE [EN [c]]</c>
    /// ends at its line) — the header's <c>LABEL: Execute</c> and <c>JMP Execute</c> (labels, which the reader takes as
    /// names) open none. A variable or pin named EXECUTE is backticked (P1), so no other place can mean it.
    /// </summary>
    public sealed class Walk
    {
        private readonly NetworkLexer _lx;
        private readonly Queue<Tok> _queued = new();
        private int? _bodyAt;   // the end of an EXECUTE's line: its body starts after it

        public Walk(NetworkLexer lx) => _lx = lx;

        public Tok Next()
        {
            var t = _queued.Count > 0 ? _queued.Dequeue() : Lexed();
            (_before, _last) = (_last, t);
            return t;
        }

        // The two tokens returned before the one in hand: a LABEL's name follows `LABEL :`, a jump's follows `JMP`.
        private Tok _before, _last;

        private Tok Lexed()
        {
            if (_bodyAt is { } at)
            {
                // The next token on a later line than EXECUTE's (or the end) is where the body starts: what stands
                // between EXECUTE and its line's end is its `EN [c]`, lexed as tokens.
                var j = _lx._i;
                while (j < _lx._s.Length && char.IsWhiteSpace(_lx._s[j])) j++;
                if (j > at || j >= _lx._s.Length)
                {
                    _bodyAt = null;
                    _lx._i = at;
                    var (snippet, end) = _lx.ExecuteBody();
                    if (snippet.Kind != TokKind.Error) _queued.Enqueue(end);
                    return snippet;
                }
            }
            var t = _lx.Next();
            if (t.Is("EXECUTE") && !_last.Is("JMP") && !(_last.IsSym(":") && _before.Is("LABEL")))
                _bodyAt = _lx.LineEnd(t.Offset);
            return t;
        }
    }

    /// <summary>An EXECUTE body, from <see cref="_i"/> standing at the end of the <c>EXECUTE</c> line: its lines verbatim
    /// up to the first line whose first word is <c>END_EXECUTE</c>, and that word as a token of its own. A CR is
    /// layout only right before a LF; a lone one is refused, as in a comment.</summary>
    public (Tok Snippet, Tok End) ExecuteBody()
    {
        var eol = LineEnd(_i);
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
                return (new Tok(TokKind.Snippet, snippet, bodyStart, Math.Max(0, wordAt - bodyStart), true),
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

    private static string WithoutLayoutCr(string line) =>
        line.EndsWith("\r", StringComparison.Ordinal) ? line.Substring(0, line.Length - 1) : line;

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

    // Longest first: `:=` before `:`, `<=` / `<>` before `<`. The ST operator symbols are lexed so the parser can refuse
    // them BY NAME (P14: "write ADD / GT / …"), never as a stray character.
    private static readonly string[] Syms = { ":=", "=>", "<=", ">=", "<>", "(", ")", ",", ";", ":", ".", "=", "<", ">", "+", "-", "*", "/", "{", "}" };

    // The token shapes are NetworkSpelling's, anchored here at the lexer's position: the writer leaves a text bare by
    // the same pattern this reads it back by.
    private static readonly Regex AddressAt = new(@"\G" + NetworkSpelling.AddressPattern, RegexOptions.Compiled);
    private static readonly Regex NumberAt = new(@"\G" + NetworkSpelling.NumberPattern, RegexOptions.Compiled);
    private static readonly Regex EndExecute = new(@"^\s*(END_EXECUTE)\b", RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);
}
