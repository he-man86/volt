using System.Collections.Generic;

namespace VoltBridge.Core.Fbd;

/// <summary>
/// Resolves a function-block / function's formal pin names — input pins (VAR_INPUT, then
/// VAR_IN_OUT) and output pins (VAR_OUTPUT, then VAR_IN_OUT) — in declaration order, from
/// its ST declaration. The FBD model is positional; the transpiler uses these to emit
/// <c>name := …</c> / <c>… => name</c>. Operators (OR/ADD/…) are not looked up.
/// </summary>
public static class FbdPins
{
    public static (IReadOnlyList<string> Inputs, IReadOnlyList<string> Outputs) FromDeclaration(string? declaration)
    {
        var input = new List<string>();
        var output = new List<string>();
        var inout = new List<string>();
        if (string.IsNullOrEmpty(declaration)) return (input, output);

        List<string>? cur = null;
        foreach (var raw in declaration!.Replace("\r\n", "\n").Split('\n'))
        {
            var line = StripComment(raw).Trim();
            if (line.Length == 0 || line[0] == '{') continue;          // blank / pragma
            var u = line.ToUpperInvariant();

            if (u.StartsWith("VAR_INPUT")) { cur = input; continue; }
            if (u.StartsWith("VAR_OUTPUT")) { cur = output; continue; }
            if (u.StartsWith("VAR_IN_OUT")) { cur = inout; continue; }
            if (u.StartsWith("END_VAR")) { cur = null; continue; }
            if (u.StartsWith("VAR")) { cur = null; continue; }          // VAR / VAR_TEMP / VAR_STAT — locals
            if (cur is null) continue;

            // A declaration line:  name1, name2 : TYPE := init;
            var colon = line.IndexOf(':');
            if (colon <= 0) continue;
            foreach (var n in line.Substring(0, colon).Split(','))
            {
                var name = n.Trim();
                if (IsIdentifier(name)) cur.Add(name);
            }
        }

        input.AddRange(inout);
        output.AddRange(inout);
        return (input, output);
    }

    private static string StripComment(string line)
    {
        var i = line.IndexOf("(*", System.StringComparison.Ordinal);
        if (i >= 0) line = line.Substring(0, i);
        var j = line.IndexOf("//", System.StringComparison.Ordinal);
        if (j >= 0) line = line.Substring(0, j);
        return line;
    }

    private static bool IsIdentifier(string s)
    {
        if (s.Length == 0 || (!char.IsLetter(s[0]) && s[0] != '_')) return false;
        foreach (var c in s) if (!char.IsLetterOrDigit(c) && c != '_') return false;
        return true;
    }
}
