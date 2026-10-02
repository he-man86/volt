using System;
using System.Text.RegularExpressions;


using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Item;

namespace Volt.Engine.Format.St;

public static class CodeHelper
{
    /// <summary>The first line of a declaration that is actually a HEADER — skipping blank lines, `{…}` pragmas,
    /// `//` comments and `(* … *)` blocks. Returns <c>""</c> when there is none.
    /// <para><b>TOTAL by contract: it never throws.</b> That is what lets a classifier consume it. The CODESYS
    /// driver used to find its keyword with a bare <c>TrimStart()</c> + first-token read, which yields <c>""</c>
    /// for any declaration opening with a pragma or a doc comment — so a `PROGRAM` behind
    /// <c>{attribute 'qualified_only'}</c> fell to the FUNCTION_BLOCK default and was reported as
    /// <c>function_block</c> on the wire. Two ways to find a header line is one too many; this is the one.</para>
    /// <para><b>Never asked on a push.</b> Its strict sibling <c>ParseCodeHeader</c>, which turned "no header" into
    /// <c>INVALID_CODE_HEADER</c>, is DELETED: it classified a pushed text by its header, and a top-level item's kind is
    /// its wire name's extension (openspec <c>push-without-header-check</c>). What reads a header now reads it from the
    /// IDE, to classify what the IDE holds.</para></summary>
    public static string HeaderLine(string? code)
    {
        if (string.IsNullOrWhiteSpace(code)) return "";

        var inBlockComment = false;
        foreach (var line in code!.Split('\n'))
        {
            var onLine = CodeOn(line, ref inBlockComment);
            if (onLine.Length > 0) return onLine;
        }
        return "";
    }

    /// <summary>The CODE on one line — the line with leading trivia (blank, <c>//</c>, <c>(* … *)</c>, a pragma)
    /// removed — or <c>""</c> when the line is trivia all the way through. <paramref name="inBlockComment"/>
    /// carries <c>(* … *)</c> state across lines and is updated in place.
    ///
    /// <para><b>THE one trivia scanner.</b> There were two, and they disagreed about the same line. This one
    /// skipped any line STARTING with <c>(*</c> — so <c>(* doc *) FUNCTION_BLOCK FB</c>, where the comment closes
    /// and the declaration follows, was skipped whole and <see cref="HeaderLine"/> answered with the NEXT line.
    /// <c>StReader</c>'s scanner called that same line CODE, which is correct. Two answers to one question, and
    /// the wrong one was the one <c>CodesysTypeMap.LeadingKeyword</c> reads: it is TOTAL by design and falls back
    /// to FUNCTION_BLOCK, so a PROGRAM written that way was reported as <c>function_block</c> on refs/fetch —
    /// the same failure the leading-<c>{attribute}</c> case was fixed for, arriving through the other trivia.</para>
    ///
    /// <para>It LOOPS rather than testing the head once, so a line may carry several comments before its code
    /// (<c>(* a *) (* b *) PROGRAM P</c>) and a block comment may close mid-line with code after it. Each pass
    /// consumes at least two characters, so it always terminates. Nested <c>(*</c> is NOT tracked — neither
    /// scanner ever did, and no recorded export contains one.</para>
    ///
    /// <para>A PRAGMA is trivia up to its closing <c>}</c>, and code after it on the same line is code — the same
    /// rule as a closed <c>(* … *)</c>. It used to be trivia for the WHOLE line, on the grounds that a
    /// <c>{attribute …}</c> sits on its own line in every form either vendor emits; for those lines the two rules
    /// agree. They disagree only where code follows the pragma, and there the whole-line rule threw the code away:
    /// the DUT subtype reader (<see cref="DutSubtype"/>) needs <c>TYPE E : {attribute 'strict'} (A, B);</c> to read
    /// as an enumeration, and grew its own scanner to get that answer — a second trivia rule disagreeing with this
    /// one about the same line. An unclosed <c>{</c> is still trivia to the end of the line: the multi-line pragma
    /// that would need real tracking is not valid IEC 61131-3.</para>
    ///
    /// <para><b>THE one scanner still</b>: <see cref="WithoutComments"/> answers a different question (the line
    /// with EVERY comment removed, trailing ones included), and every "where does the code start" question —
    /// <see cref="HeaderLine"/>, <c>StReader</c>, <c>StDeclaration</c>, <see cref="DutSubtype"/> — asks this.</para></summary>
    /// <summary>The line with its comments removed — a TRAILING <c>// …</c> and any complete
    /// <c>(* … *)</c> span, wherever they sit.
    ///
    /// <para><b>Not the same question as <see cref="CodeOn"/>.</b> That one answers "does this line START with
    /// code", which is what a block scanner needs; it leaves a trailing comment attached. A SIGNATURE parser
    /// needs the other answer, because its patterns anchor at end-of-line: an engineer documenting a method on
    /// its own signature line — <c>METHOD INTERNAL _mStrConcatA //Concats string to sContent</c>, which is
    /// exactly how CODESYS stores it — failed the match outright, so Volt pulled the POU and then refused its
    /// own text.</para>
    ///
    /// <para>String literals are respected, so a <c>//</c> inside <c>'http://x'</c> is not a comment.</para>
    /// </summary>
    public static string WithoutComments(string line)
    {
        var sb = new System.Text.StringBuilder(line.Length);
        var inString = false;
        var quote = '\0';
        for (var i = 0; i < line.Length; i++)
        {
            var c = line[i];
            if (inString)
            {
                sb.Append(c);
                if (c == quote) inString = false;
                continue;
            }
            if (c == '\'' || c == '"') { inString = true; quote = c; sb.Append(c); continue; }
            if (c == '/' && i + 1 < line.Length && line[i + 1] == '/') break;          // to end of line
            if (c == '(' && i + 1 < line.Length && line[i + 1] == '*')
            {
                var close = line.IndexOf("*)", i + 2, System.StringComparison.Ordinal);
                if (close < 0) break;                                                  // unterminated: the rest is comment
                sb.Append(' ');                                                        // a span may sit BETWEEN tokens
                i = close + 1;
                continue;
            }
            sb.Append(c);
        }
        return sb.ToString().Trim();
    }

    public static string CodeOn(string line, ref bool inBlockComment)
    {
        // U+FEFF is NOT whitespace under .NET Core, so `Trim()` alone leaves a BOM glued to the header keyword and
        // every keyword match fails. Belt-and-braces with the strip at the push boundary: this function's whole
        // contract is that it finds the code, and no caller should have to know an invisible character can defeat
        // it. (StReader's copy of this scan did NOT strip it — one more way the two could differ.)
        var s = line.Trim().TrimStart('\uFEFF');
        while (true)
        {
            if (inBlockComment)
            {
                var close = s.IndexOf("*)", StringComparison.Ordinal);
                if (close < 0) return "";
                inBlockComment = false;
                s = s.Substring(close + 2).TrimStart();
                continue;
            }
            if (s.Length == 0) return "";
            if (s.StartsWith("//", StringComparison.Ordinal)) return "";
            if (s.StartsWith("{", StringComparison.Ordinal))
            {
                var close = s.IndexOf('}');
                if (close < 0) return "";
                s = s.Substring(close + 1).TrimStart();
                continue;
            }
            if (s.StartsWith("(*", StringComparison.Ordinal))
            {
                inBlockComment = true;
                s = s.Substring(2);
                continue;
            }
            return s;
        }
    }

    /// <summary>Which SUBTYPE a DUT declaration is — <c>struct</c> / <c>enum</c> / <c>union</c> / <c>alias</c>.
    ///
    /// <para><b>Legacy, on its way out (openspec <c>push-without-header-check</c> 5.F).</b> A project DUT's wire name
    /// is the subtype its VENDOR states (<see cref="ItemContent.DutSubtype"/>), never this read. Two callers are left:
    /// <c>LibSignatureRenderer</c> (until 5.D.2 takes a library DUT's subtype from its signature flags) and the
    /// drivers' interim stand-in <see cref="TryDutSubtype"/> (until 5.C/5.D). It is asked of what the IDE HOLDS,
    /// never of a pushed text — a push writes a DUT's text as sent.</para>
    ///
    /// <para>The rule is the grammar's: after the type name's <c>:</c>, a DUT body opens with <c>STRUCT</c>,
    /// <c>UNION</c>, or <c>(</c> for an enumeration; anything else is an alias (<c>TYPE T : INT (0..10);</c>,
    /// <c>TYPE T : ARRAY[..] OF X;</c>, <c>TYPE T : POINTER TO Y;</c>). An <c>EXTENDS Base</c> clause sits
    /// BEFORE the colon so it never interferes.
    /// </para>
    ///
    /// <para><b>Trivia anywhere before the body token is skipped</b> — a comment or pragma at the end of the
    /// <c>TYPE X :</c> line, a block comment before <c>STRUCT</c> (on its line or spanning lines), an attribute
    /// pragma before an enumeration's <c>(</c>. The subtype is the first CODE token after the colon; reading the
    /// raw text after it named a struct <c>alias</c> (<c>// note</c>) or <c>enum</c> (<c>(* note *)</c> opens with
    /// <c>(</c>).</para>
    ///
    /// <para><b>A declaration that states no subtype is REFUSED</b> (<see cref="FormatException"/>) — no colon,
    /// nothing after it, <c>END_TYPE</c> straight after it, or punctuation where a type would stand
    /// (<c>TYPE X : ;</c>): an alias NAMES a type, so it opens with one. It used to answer <c>alias</c>, "the shape that
    /// assumes least", which on the wire publishes <c>X.alias</c> for a text that never says so. The only caller of
    /// this throwing form is <c>LibSignatureRenderer</c>; the materializer never reaches it — a project DUT's
    /// subtype comes from its driver (<see cref="TryDutSubtype"/> for now), whose "no answer" publishes
    /// <c>X.dut</c>, so no project DUT becomes unreadable through this refusal.</para></summary>
    public static string DutSubtype(string code)
    {
        return DutSubtypeOrNull(code) ?? throw new FormatException(
            "the DUT declaration states no subtype — nothing after its 'TYPE <name> :' says whether it is a " +
            "STRUCT, UNION, enumeration or alias");
    }

    /// <summary><b>INTERIM — the drivers' DUT subtype answer until the vendor's own source replaces it</b> (openspec
    /// <c>push-without-header-check</c>, design step 5.B choice 7): 5.D swaps CODESYS to its precompile signature, 5.C
    /// swaps TwinCAT to its total classifier, and 5.F deletes this, guarded by 5.F.2's repo gate. Called ONLY from the
    /// two drivers' <c>ReadContent</c>, below the vendor seam — never from the engine, which takes the answer as the
    /// driver hands it up (<see cref="ItemContent.DutSubtype"/>).
    ///
    /// <para><see cref="DutSubtype(string)"/>'s rule, answering null where that throws: a declaration that states no
    /// subtype is "no answer", and the item is published <c>name.dut</c>. Known interim disagreements with the vendor
    /// (CODESYS's signature) are listed in design.md step 5.B: a text with prose before a valid struct answers
    /// <c>struct</c> where the signature answers <c>None</c>, and <c>TYPE X : END_TYPE</c> answers null where it
    /// answers <c>Alias</c>. Two more, unmeasured on the vendor and 0 of 8175 corpus DUTs: the colon is taken without a
    /// <c>TYPE</c> before it (<c>X : STRUCT … END_TYPE</c> answers <c>struct</c>), and a digit-led token is a type
    /// (<c>TYPE X : 5; END_TYPE</c> answers <c>alias</c>); both probably declare nothing on the vendor.</para></summary>
    public static Item.DutSubtype? TryDutSubtype(string declaration) => DutSubtypeOrNull(declaration) switch
    {
        "struct" => Item.DutSubtype.Struct,
        "enum" => Item.DutSubtype.Enum,
        "union" => Item.DutSubtype.Union,
        "alias" => Item.DutSubtype.Alias,
        _ => null,
    };

    private static string? DutSubtypeOrNull(string code)
    {
        var rest = AfterTypeColon(code ?? "");
        if (rest.StartsWith("(", StringComparison.Ordinal)) return "enum";
        // The body keyword is compared as a WHOLE token, never a prefix: `TYPE T : Struct_Alarm;` is an alias of a
        // user type whose name begins with STRUCT, and a prefix match published it `T.struct`.
        var first = FirstToken(rest);
        if (first.Equals("STRUCT", StringComparison.OrdinalIgnoreCase)) return "struct";
        if (first.Equals("UNION", StringComparison.OrdinalIgnoreCase)) return "union";
        // Anything else is an alias only when a TYPE stands there — an identifier-led token (`INT`, `ARRAY`,
        // `POINTER`, a user type). Nothing, `END_TYPE`, or punctuation (`TYPE X : ;`) names no type, and calling it an
        // alias would mint `X.alias` for a text that never says so.
        if (first.Length == 0 || first.Equals("END_TYPE", StringComparison.OrdinalIgnoreCase)) return null;
        return "alias";
    }

    /// <summary>The leading identifier-ish run of <paramref name="s"/> — up to the first character that cannot be
    /// in an IEC identifier — so <c>END_TYPE;</c> reads as <c>END_TYPE</c> and <c>END_TYPEX</c> does not.</summary>
    private static string FirstToken(string s)
    {
        var i = 0;
        while (i < s.Length && (char.IsLetterOrDigit(s[i]) || s[i] == '_')) i++;
        return s.Substring(0, i);
    }

    /// <summary>The CODE after a DUT declaration's first colon, from its first token, or "" when there is no
    /// colon or nothing after it. Trivia is <see cref="CodeOn"/>'s — the one scanner — applied wherever a comment
    /// or pragma opens, so a colon inside a comment is not the type's colon either, and a comment or pragma
    /// between the colon and the body token is stepped over on its line or across lines. Stops at the first code
    /// after the colon: a whole body is never scanned.</summary>
    private static string AfterTypeColon(string code)
    {
        var inBlockComment = false;
        var sawColon = false;
        foreach (var line in code.Split('\n'))
        {
            var s = CodeOn(line, ref inBlockComment);
            while (s.Length > 0)
            {
                if (sawColon) return s;
                // `CodeOn` strips LEADING trivia only, so the colon is looked for up to the next trivia opener,
                // and whatever opens there goes back through `CodeOn`.
                var at = IndexOfColonOrTrivia(s);
                if (at < 0) break;
                if (s[at] == ':') { sawColon = true; at++; }
                s = CodeOn(s.Substring(at), ref inBlockComment);
            }
        }
        return "";
    }

    /// <summary>Where <paramref name="s"/> holds its first <c>:</c> or opens a comment or pragma; -1 for neither.</summary>
    private static int IndexOfColonOrTrivia(string s)
    {
        for (var i = 0; i < s.Length; i++)
        {
            var c = s[i];
            if (c == ':' || c == '{') return i;
            if ((c == '/' || c == '(') && i + 1 < s.Length && s[i + 1] == (c == '/' ? '/' : '*')) return i;
        }
        return -1;
    }
}
