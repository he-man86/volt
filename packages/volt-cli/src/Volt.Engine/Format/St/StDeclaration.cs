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
    private static string? TypeOfVariable(string? declaration, string name)
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

    /// <summary>Every variable a declaration declares (<c>a, t1 : TON;</c> → <c>a</c>, <c>t1</c>), comments
    /// stripped — the names a graphical body's wires must not collide with (network text, <c>NetworkScope</c>).
    /// The same line rule as <see cref="TypeOfVariable"/>, so a name one finds the other resolves.</summary>
    public static IEnumerable<string> DeclaredNames(string? declaration)
    {
        if (string.IsNullOrEmpty(declaration)) yield break;

        var inBlockComment = false;
        foreach (var raw in declaration!.Replace("\r", "").Split('\n'))
        {
            var line = CodeHelper.CodeOn(raw, ref inBlockComment);
            if (line.Length == 0) continue;
            var m = VarLine.Match(line);
            if (!m.Success) continue;
            foreach (var declared in m.Groups["names"].Value.Split(','))
                yield return declared.Trim();
        }
    }

    // `FUNCTION F : BOOL`, `FUNCTION_BLOCK FB EXTENDS …`, `PROGRAM P` — a header a call can name, attributes and
    // comments stripped first.
    private static readonly Regex CallableHeader = new(
        @"^\s*(FUNCTION_BLOCK|FUNCTION|PROGRAM)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    /// <summary>Whether a declaration is a POU a call can name — a FUNCTION, FUNCTION_BLOCK or PROGRAM — by its
    /// first code line. A GVL, a DUT or an interface of the same name is no callable; null is no item at all.</summary>
    public static bool IsCallableHeader(string? declaration)
    {
        if (string.IsNullOrEmpty(declaration)) return false;
        var inBlockComment = false;
        foreach (var raw in declaration!.Replace("\r", "").Split('\n'))
        {
            var line = CodeHelper.CodeOn(raw, ref inBlockComment);
            if (line.Trim().Length == 0 || line.TrimStart().StartsWith("{", StringComparison.Ordinal)) continue;
            return CallableHeader.IsMatch(line);
        }
        return false;
    }

    /// <summary>The language's name for a call to the base implementation. Not an instance, and not a variable
    /// anything declares — which is exactly why looking it up as one failed.</summary>
    public const string SuperCall = "SUPER^";

    // `EXTENDS Base`, allowing a namespaced base (`NS.FB_Base`) because CODESYS writes one.
    private static readonly Regex ExtendsClause = new(
        @"\bEXTENDS\s+(?<base>[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// <summary>The TYPE a graphical box calls, for the call targets a POU's own declaration cannot answer
    /// alone.
    ///
    /// <para><b>What this cost.</b> <see cref="TypeOfVariable"/> answers for `t1(IN := a)` — the instance is a
    /// local variable and its type is one line up. Two shapes in a real customer project (Lenze MID-S100) are
    /// not local variables at all, and pushing either was refused outright with "names a function-block
    /// instance that is not declared in this POU" — advice pointing at a declaration the engineer had already
    /// written, somewhere else:</para>
    /// <list type="bullet">
    /// <item><b>A qualified path.</b> `Mach1_AuxData.IEC_TIMERS.OffDelayLockDrives(...)` — a GVL, holding a
    /// struct, holding the timer. Measured live: the IDE stores `Instance` as that whole dotted path and
    /// `BoxType = 'TOF'`, so the type IS written down — three declarations away.</item>
    /// <item><b><c>SUPER^</c>.</b> Measured live: `Instance = 'SUPER^'`, `BoxType = 'ATD_FQI'` — the EXTENDS
    /// clause of the calling POU. Nine POUs across the corpus could be pulled and never pushed back.</item>
    /// </list>
    ///
    /// <para><paramref name="declarationOf"/> reaches ANOTHER item's declaration by name — the vendor seam,
    /// because only a driver can ask its IDE. It is called only for the shapes above, so a bare local
    /// instance still costs exactly one text scan and no project walk.</para></summary>
    public static string? TypeOfCallTarget(string? scope, string target, Func<string, string?> declarationOf)
    {
        if (string.IsNullOrEmpty(target)) return null;
        if (string.Equals(target, SuperCall, StringComparison.OrdinalIgnoreCase)) return BaseTypeOf(scope);

        var segments = target.Split('.');
        var declaration = scope;

        for (var i = 0; i < segments.Length; i++)
        {
            var type = TypeOfVariable(declaration, segments[i]);

            if (type is null)
            {
                // Only the HEAD may name something that is not a variable of the scope in hand: a GLOBAL
                // container (a GVL), whose own declaration is the scope the next segment is read against.
                // Local scope is consulted first, so an inner name still shadows a global exactly as IEC says.
                if (i != 0) return null;
                declaration = declarationOf(segments[i]);
                if (declaration is null) return null;
                continue;
            }

            if (i == segments.Length - 1) return type;

            declaration = declarationOf(type);
            if (declaration is null) return null;
        }

        // The path named a container and stopped there. A GVL is not something a box can call, and answering
        // with its name would put a non-type in `BoxType` — the very failure the refusal exists to prevent.
        return null;
    }

    /// <summary>The base type of a POU — the <c>EXTENDS</c> clause of its own header.</summary>
    private static string? BaseTypeOf(string? declaration)
    {
        if (string.IsNullOrEmpty(declaration)) return null;

        var inBlockComment = false;
        foreach (var raw in declaration!.Replace("\r", "").Split('\n'))
        {
            var line = CodeHelper.CodeOn(raw, ref inBlockComment);
            if (line.Length == 0) continue;

            var m = ExtendsClause.Match(line);
            if (m.Success) return m.Groups["base"].Value;

            // The header legally WRAPS — CODESYS stores `EXTENDS Base` on its own line — so the scan cannot
            // stop at the first code line. It stops at the first VAR block instead: everything below that is
            // variables, and nothing down there is allowed to answer for the header.
            if (line.TrimStart().StartsWith("VAR", StringComparison.OrdinalIgnoreCase)) break;
        }
        return null;
    }
}
