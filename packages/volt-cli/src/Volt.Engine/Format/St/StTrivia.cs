using System.Collections.Generic;
using System.Text;

namespace Volt.Engine.Format.St;

/// <summary>
/// Where the comments, strings and pragmas of a text are, across lines — the question a WHOLE-LINE rule needs
/// answered: does this line start inside a comment, and what code does the text hold outside all of them?
///
/// <para><b>Not <see cref="CodeHelper.CodeOn"/>.</b> That one finds where a line's code STARTS, skipping only
/// LEADING trivia, which is what the structure scan needs; it does not see a comment opened after code on its line,
/// and it does not nest. A boundary line inside either would then read as the boundary and split the file inside
/// the comment (bakon-nano's <c>:= TRUE;(*NOT (</c> spans lines; the LSP lexer nests <c>(* (* *) *)</c>), so the
/// boundary and the reserved-name rule ask this instead. A <c>(*</c> inside a <c>//</c> comment, a string or a
/// pragma opens nothing.</para>
/// </summary>
internal static class StTrivia
{
    /// <summary>Per line: true when the line starts inside a block comment.</summary>
    public static bool[] OpenAtStart(IList<string> lines) => Scan(lines).OpenAtStart;

    /// <summary>Per line: the line with every comment, string literal and pragma blanked to spaces — the code
    /// alone, at its columns.</summary>
    public static string[] Code(IList<string> lines) => Scan(lines).Code;

    private static (bool[] OpenAtStart, string[] Code) Scan(IList<string> lines)
    {
        var open = new bool[lines.Count];
        var code = new string[lines.Count];
        var depth = 0;
        for (int i = 0; i < lines.Count; i++)
        {
            open[i] = depth > 0;
            var line = lines[i];
            var sb = new StringBuilder(line.Length);
            for (int j = 0; j < line.Length; j++)
            {
                var c = line[j];
                var next = j + 1 < line.Length ? line[j + 1] : '\0';
                if (depth > 0)
                {
                    if (c == '(' && next == '*') { depth++; sb.Append("  "); j++; }
                    else if (c == '*' && next == ')') { depth--; sb.Append("  "); j++; }
                    else sb.Append(' ');
                    continue;
                }
                if (c == '(' && next == '*') { depth = 1; sb.Append("  "); j++; continue; }
                if (c == '/' && next == '/') { sb.Append(' ', line.Length - j); break; }
                if (c == '\'' || c == '"' || c == '{')
                {
                    // A string ends at its own quote (`$` escapes the next character, `$'` included); a pragma at
                    // its `}`. Neither crosses a line in valid ST, so an unclosed one ends with the line.
                    var close = c == '{' ? '}' : c;
                    sb.Append(' ');
                    for (j++; j < line.Length; j++)
                    {
                        sb.Append(' ');
                        if (c != '{' && line[j] == '$' && j + 1 < line.Length) { sb.Append(' '); j++; continue; }
                        if (line[j] == close) break;
                    }
                    continue;
                }
                sb.Append(c);
            }
            code[i] = sb.ToString();
        }
        return (open, code);
    }
}
