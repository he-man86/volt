using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace Volt.Engine.Format.St;

/// <summary>
/// Small reads over an item's DECLARATION — the facts a body write needs that the body itself cannot carry.
/// </summary>
public static class StDeclaration
{
    // ONE variable statement: `t1 : TON`, `t1 : TON := (...)`, `a, t1 : TON`, `t1:TON`, `t2 : Standard.TON`,
    // `g5 AT %IX0.0 : BOOL`. The type is the name after the colon — a QUALIFIED one whole: a library type is declared
    // through its namespace (`Standard.TON` in three corpus projects, `Tc2_Standard.TON` on TwinCAT), and reading only
    // its first identifier made the type the namespace, so a push built a box of type `Standard`. Anything after the
    // name (array bounds, an initializer, a string length, `TO T`) is not the type name.
    private static readonly Regex VarStatement = new(
        @"^\s*(?<names>[A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*(?:\bAT\s+%\S+?\s*)?:\s*(?<type>[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

    // What ends a statement besides its `;`: the words that open or close a block of them, and a section's qualifiers.
    // Each stands alone in a declaration (none can be a variable's name), so a block opened or closed on a statement's
    // line (`VAR_INPUT x : BOOL; END_VAR`), a qualifier (`VAR CONSTANT`, `VAR RETAIN PERSISTENT`) and a header
    // (`TYPE ST_T :` before `STRUCT`) are never part of the statement beside them.
    private static readonly Regex StatementEnd = new(
        @";|\b(?:VAR|VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_GLOBAL|VAR_TEMP|VAR_STAT|VAR_INST|VAR_CONFIG|VAR_EXTERNAL|" +
        @"VAR_ACCESS|END_VAR|CONSTANT|RETAIN|NON_RETAIN|PERSISTENT|STRUCT|END_STRUCT|UNION|END_UNION|END_TYPE)\b",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

    /// <summary>Every variable statement of a declaration, in order: its names and its type (openspec
    /// <c>bridge-refusal-review</c> D5). Read by STATEMENT — the code up to each <c>;</c> — with every comment and
    /// pragma blanked and every string's text blanked (<see cref="StTrivia"/>, which nests comments as both vendors
    /// do), so a list wrapped over lines (<c>a,</c> / <c>t2 : TON;</c>), a located variable and a one-line block are
    /// read whole, and a trailing comment is no part of the next statement. The one-line rule this replaced lost all
    /// three, and a lost name at a call head wrote a FUNCTION box where the text called an instance, without a word.
    /// A header (<c>METHOD Run : BOOL</c>, <c>FUNCTION F : INT</c>) declares nothing: two words stand before its
    /// colon.</summary>
    private static IEnumerable<(string[] Names, string Type)> Statements(string? declaration)
    {
        if (string.IsNullOrEmpty(declaration)) yield break;
        var code = string.Join("\n", StTrivia.Code(declaration!.Replace("\r", "").Split('\n')));
        foreach (var statement in StatementEnd.Split(code))
        {
            var m = VarStatement.Match(statement);
            if (!m.Success) continue;
            yield return (m.Groups["names"].Value.Split(',').Select(n => n.Trim()).ToArray(), m.Groups["type"].Value);
        }
    }

    /// <summary>Whether a DECLARED type and a box's stored type name one type. IEC names are case-insensitive, and a
    /// declaration may name a library type through its namespace (<c>Standard.TON</c>) where the vendor's box holds
    /// it bare (<c>TON</c>), or the other way round: a qualified name and its own last segment are one type. Two
    /// different namespaces are two types.</summary>
    public static bool SameType(string declared, string stored)
    {
        if (string.Equals(declared, stored, StringComparison.OrdinalIgnoreCase)) return true;
        bool Qualifies(string qualified, string bare) =>
            bare.IndexOf('.') < 0 && qualified.EndsWith("." + bare, StringComparison.OrdinalIgnoreCase);
        return Qualifies(declared, stored) || Qualifies(stored, declared);
    }

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
        if (string.IsNullOrEmpty(name)) return null;
        foreach (var (names, type) in Statements(declaration))
            foreach (var declared in names)
                if (string.Equals(declared, name, StringComparison.OrdinalIgnoreCase))
                    return type;
        return null;
    }

    /// <summary>Every variable a declaration declares (<c>a, t1 : TON;</c> → <c>a</c>, <c>t1</c>), comments
    /// stripped — the names a graphical body's wires must not collide with (network text, <c>NetworkScope</c>).
    /// The same statement rule as <see cref="TypeOfVariable"/>, so a name one finds the other resolves.</summary>
    public static IEnumerable<string> DeclaredNames(string? declaration) =>
        Statements(declaration).SelectMany(s => s.Names);

    /// <summary>The language's name for a call to the base implementation. Not an instance, and not a variable
    /// anything declares — which is exactly why looking it up as one failed.</summary>
    public const string SuperCall = "SUPER^";

    // `EXTENDS Base`, allowing a namespaced base (`NS.FB_Base`) because CODESYS writes one.
    private static readonly Regex ExtendsClause = new(
        @"\bEXTENDS\s+(?<base>[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex EndVar = new(@"\bEND_VAR\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);

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
        // The first base the scope names: a POU's own header, or — in a member's scope, which is the member's
        // declaration and then its owner's — the owner's, since a member extends nothing.
        if (string.Equals(target, SuperCall, StringComparison.OrdinalIgnoreCase)) return BasesOf(scope).FirstOrDefault();

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

    /// <summary>
    /// <paramref name="declaration"/> with the declarations of every base it inherits from (<c>EXTENDS</c>, followed
    /// to the root) after it — the names a body of the POU can see, in the order IEC resolves them: its own first,
    /// an inherited member only where nothing nearer declares the name.
    ///
    /// <para><b>Why the scope needs it.</b> A derived FB's body and its methods use the base's members as their own.
    /// A scope built without them read <c>tBase(IN := a)</c> — a call to an inherited timer — as a FUNCTION named
    /// <c>tBase</c> on push, and sent the pulled box to the marker as an instance no declaration names.</para>
    ///
    /// <para>Every <c>EXTENDS</c> outside a VAR block is followed, not only the first: a member's scope is its own
    /// declaration followed by its owner's (<c>SourceScopes.Scope</c>), and it is the OWNER's header that extends. A
    /// base <paramref name="declarationOf"/> cannot answer (a library FB) contributes nothing — its members are not in
    /// the project. Each base is read once, so an inheritance cycle ends.</para>
    /// </summary>
    public static string? WithInherited(string? declaration, Func<string, string?> declarationOf)
    {
        if (string.IsNullOrEmpty(declaration)) return declaration;
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var parts = new List<string> { declaration! };
        var pending = new Queue<string>(BasesOf(declaration));
        while (pending.Count > 0)
        {
            var name = pending.Dequeue();
            if (!seen.Add(name) || declarationOf(name) is not { } inherited) continue;
            parts.Add(inherited);
            foreach (var next in BasesOf(inherited)) pending.Enqueue(next);
        }
        return string.Join("\n", parts);
    }

    /// <summary>Every base an <c>EXTENDS</c> clause outside a VAR block names, in order, comments stripped — the header
    /// may wrap the clause onto its own line, as CODESYS stores it, and nothing inside a VAR block may answer for a
    /// header (a variable's type is no base). The ONE scanner of the clause: <c>SUPER^</c> and the inherited scope ask
    /// it the same question.</summary>
    private static IEnumerable<string> BasesOf(string? declaration)
    {
        if (string.IsNullOrEmpty(declaration)) yield break;
        var inBlockComment = false;
        var inVars = false;
        foreach (var raw in declaration!.Replace("\r", "").Split('\n'))
        {
            var line = CodeHelper.CodeOn(raw, ref inBlockComment).TrimStart();
            if (line.Length == 0) continue;
            // A block may open and close on one line (`VAR_INPUT x : INT; END_VAR`), and the header after it is read.
            if (!inVars && line.StartsWith("VAR", StringComparison.OrdinalIgnoreCase)) inVars = true;
            if (inVars)
            {
                if (EndVar.IsMatch(line)) inVars = false;
                continue;
            }
            var m = ExtendsClause.Match(line);
            if (m.Success) yield return m.Groups["base"].Value;
        }
    }
}
