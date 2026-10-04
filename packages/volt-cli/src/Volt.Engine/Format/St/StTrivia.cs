using System.Collections.Generic;
using System.Text;

namespace Volt.Engine.Format.St;

/// <summary>
/// Where the comments, strings and pragmas of a text are, across lines — the question a WHOLE-LINE rule needs
/// answered: does this line start inside a comment, and what code does the text hold outside all of them?
///
/// <para><b>THE trivia skipper of the ST format</b> — the boundary rule, the END-line mirror
/// and the CHILD SPLITTER (<c>StReader</c>: where each METHOD / ACTION / PROPERTY block opens and closes, openspec
/// <c>push-without-header-check</c> 5.E.1) all read through it. Comments NEST, as both vendors' do
/// (<c>lex_nested_block_comment</c>, <c>(* outer (* inner *) n := 99; still inside *)</c>, builds clean on CODESYS and
/// TwinCAT), and a comment opened AFTER code on its line is seen (bakon-nano's <c>:= TRUE;(*NOT (</c> spans lines).
/// <c>CodeHelper.CodeOn</c>, which the splitter used to read through, did neither: a word after an inner <c>*)</c> was
/// code and an <c>END_METHOD</c> inside a comment ended the member there. A <c>(*</c> inside a <c>//</c> comment, a
/// string or a pragma opens nothing; a BOM at the start of the text is no code.</para>
/// </summary>
internal static class StTrivia
{
    /// <summary>Per line: true when the line starts inside a block comment.</summary>
    public static bool[] OpenAtStart(IList<string> lines) => Scan(lines).OpenAtStart;

    /// <summary>Per line: the CODE alone, at its columns — every comment and pragma blanked to spaces, and every
    /// string's TEXT blanked between its quotes, which stay: a string is code, so a line holding one is no trivia line,
    /// but nothing inside it is a keyword or opens a comment.</summary>
    public static string[] Code(IList<string> lines) => Scan(lines).Code;

    /// <summary>Where each block comment opens — its line and the column of its <c>(*</c> — in order, NESTED ones
    /// included: comments nest, so a <c>(*</c> inside a comment opens a comment of its own (the retired-comment rule
    /// asks about every comment, at any depth). One inside a <c>//</c> comment, a string or a pragma opens nothing,
    /// exactly as for <see cref="OpenAtStart"/>.</summary>
    public static List<(int Line, int Column)> CommentOpenings(IList<string> lines) => Scan(lines).Openings;

    /// <summary>The <c>(*</c> that never close — each one still open when the text ends, as its line and column, in
    /// order. Empty for any text whose comments all close. Comments nest, so a <c>(* a (* b *)</c> leaves the OUTER
    /// one open.</summary>
    public static List<(int Line, int Column)> UnterminatedOpenings(IList<string> lines) => Scan(lines).Unclosed;

    /// <summary>Per line, per column: what the character IS — <see cref="CodeChar"/>, <see cref="CommentChar"/> (a block
    /// or <c>//</c> comment, its delimiters included), <see cref="StringChar"/> (a string's TEXT; its quotes are code, as
    /// in <see cref="Code"/>), <see cref="PragmaChar"/> (a pragma, its braces included) or <see cref="BomChar"/> (the BOM
    /// at the start of the text). The question a refusal that depends on WHERE a character stands needs answered
    /// (<c>StReader</c>'s U+FEFF refusal, openspec <c>bridge-refusal-review</c> 7.3).</summary>
    public static string[] Classes(IList<string> lines) => Scan(lines).Classes;

    public const char CodeChar = 'c', CommentChar = 'm', StringChar = 's', PragmaChar = 'p', BomChar = 'b';

    private static (bool[] OpenAtStart, string[] Code, List<(int Line, int Column)> Openings,
        List<(int Line, int Column)> Unclosed, string[] Classes) Scan(IList<string> lines)
    {
        var open = new bool[lines.Count];
        var code = new string[lines.Count];
        var classes = new string[lines.Count];
        var openings = new List<(int Line, int Column)>();
        var stack = new List<(int Line, int Column)>();   // the openers not yet closed, innermost last
        var depth = 0;
        for (int i = 0; i < lines.Count; i++)
        {
            open[i] = depth > 0;
            var line = lines[i];
            var sb = new StringBuilder(line.Length);
            var kb = new StringBuilder(line.Length);   // the class of each character, column for column with sb
            for (int j = 0; j < line.Length; j++)
            {
                var c = line[j];
                var next = j + 1 < line.Length ? line[j + 1] : '\0';
                if (depth > 0)
                {
                    if (c == '(' && next == '*') { openings.Add((i, j)); stack.Add((i, j)); depth++; sb.Append("  "); kb.Append(CommentChar, 2); j++; }
                    else if (c == '*' && next == ')') { depth--; stack.RemoveAt(stack.Count - 1); sb.Append("  "); kb.Append(CommentChar, 2); j++; }
                    else { sb.Append(' '); kb.Append(CommentChar); }
                    continue;
                }
                if (c == '(' && next == '*') { openings.Add((i, j)); stack.Add((i, j)); depth = 1; sb.Append("  "); kb.Append(CommentChar, 2); j++; continue; }
                if (c == '/' && next == '/') { sb.Append(' ', line.Length - j); kb.Append(CommentChar, line.Length - j); break; }
                if (i == 0 && j == 0 && c == '﻿') { sb.Append(' '); kb.Append(BomChar); continue; }   // a BOM opens no code
                if (c == '\'' || c == '"' || c == '{')
                {
                    // A string ends at its own quote (`$` escapes the next character, `$'` included); a pragma at
                    // its `}`. Neither crosses a line in valid ST, so an unclosed one ends with the line.
                    // A PRAGMA is trivia and is blanked whole. A STRING is code: its text is blanked (no keyword and
                    // no comment opener inside it counts) but its quotes stay, so a line holding one is a code line.
                    var pragma = c == '{';
                    var close = pragma ? '}' : c;
                    sb.Append(pragma ? ' ' : c);
                    kb.Append(pragma ? PragmaChar : CodeChar);
                    var inner = pragma ? PragmaChar : StringChar;
                    for (j++; j < line.Length; j++)
                    {
                        if (!pragma && line[j] == '$' && j + 1 < line.Length) { sb.Append("  "); kb.Append(StringChar, 2); j++; continue; }
                        if (line[j] == close) { sb.Append(pragma ? ' ' : close); kb.Append(pragma ? PragmaChar : CodeChar); break; }
                        sb.Append(' ');
                        kb.Append(inner);
                    }
                    continue;
                }
                sb.Append(c);
                kb.Append(CodeChar);
            }
            code[i] = sb.ToString();
            classes[i] = kb.ToString();
        }
        return (open, code, openings, stack, classes);
    }
}
