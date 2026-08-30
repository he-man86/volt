using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace Volt.Engine.Format.St;

/// <summary>
/// Small reads over an item's DECLARATION — the facts a body write needs that the body itself cannot carry.
/// </summary>
public static class StDeclaration
{
    // `t1 : TON;`, `t1 : TON := (...);`, `a, t1 : TON;`, `t1:TON;`. The type is the first identifier after the
    // colon; anything after it (array bounds, an initializer, a string length) is not the type name.
    private static readonly Regex VarLine = new(
        @"^\s*(?<names>[A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*:\s*(?<type>[A-Za-z_]\w*)",
        RegexOptions.Compiled);

    /// <summary>The declared TYPE of a variable, or null when the declaration does not name one.
    ///
    /// <para><b>Why a body write needs this.</b> Network text carries ONE name for a function-block call —
    /// `t1(IN := a, PT := pt)` — because that is what an engineer writes and reads. The IDEs need TWO: the box's
    /// TYPE (`TON`), which is what they resolve the call's signature from, and its INSTANCE (`t1`). The type is
    /// nowhere in the body; it is in the declaration, one line up (`t1 : TON;`), which the same push writes.</para>
    ///
    /// <para>IEC identifiers are case-insensitive, so the lookup is too. Comments are stripped first, so a
    /// commented-out declaration cannot answer for a live one.</para></summary>
    public static string? TypeOfVariable(string? declaration, string name)
    {
        if (string.IsNullOrEmpty(declaration) || string.IsNullOrEmpty(name)) return null;

        var inBlockComment = false;
        foreach (var raw in declaration!.Replace("\r", "").Split('\n'))
        {
            var line = CodeHelper.CodeOn(raw, ref inBlockComment);
            if (line.Length == 0) continue;

            var m = VarLine.Match(line);
            if (!m.Success) continue;

            foreach (var declared in m.Groups["names"].Value.Split(','))
                if (string.Equals(declared.Trim(), name, StringComparison.OrdinalIgnoreCase))
                    return m.Groups["type"].Value;
        }
        return null;
    }
}
