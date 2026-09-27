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
    /// <c>function_block</c> on the wire. Two ways to find a header line is one too many; this is the one.
    /// <see cref="ParseCodeHeader"/> is the strict caller — it turns "no header" into a coded throw — and a
    /// classifier that must stay total calls this directly instead.</para></summary>
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
    /// <para>This is a MATERIALIZATION concern only: it picks the file extension the DUT is written under. The
    /// wire kind stays the one <c>dut</c> (see <see cref="ItemKind.DutSubtypeExtensions"/> for why identity must
    /// not carry it), and both vendors still create every DUT with a single call, deriving the subtype from
    /// this same declaration text. So Volt is not classifying anything the IDE does not — it is reading the
    /// same thing the IDE reads, to name the file the way an engineer expects.</para>
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
    /// <para><b>A declaration that states no subtype still answers <c>alias</c> here</b>, and the spec says it
    /// must not be given one (openspec <c>dut-subtype-on-the-wire</c>: it is published unreadable). The refusal
    /// belongs where the wire name is minted, per item, so the one item surfaces in <c>unreadable</c> and the
    /// rest of the fetch goes on. Until the engine mints the name there, this function's only caller is the CLI's
    /// file naming, which runs over a whole pull with no per-item refusal path: throwing here aborted every
    /// <c>volt pull</c> and <c>volt init</c> over one DUT whose text an engineer was mid-way through typing.
    /// </para></summary>
    public static string DutSubtype(string code)
    {
        var rest = AfterTypeColon(code ?? "");
        if (rest.StartsWith("STRUCT", StringComparison.OrdinalIgnoreCase)) return "struct";
        if (rest.StartsWith("UNION", StringComparison.OrdinalIgnoreCase)) return "union";
        if (rest.StartsWith("(", StringComparison.Ordinal)) return "enum";
        return "alias";
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

    /// <summary>The item KIND a declaration's header names — <c>function_block</c>, <c>program</c>, … — and
    /// nothing else.
    ///
    /// <para><b>It used to return the NAME too, and the name was a lie.</b> Nothing read it: the item's name is
    /// the FILENAME, which the wire carries as <c>name.kind</c> and both drivers get from the tree. Worse, it was
    /// wrong wherever a modifier sat where the name was expected — <c>FUNCTION_BLOCK ABSTRACT libObject</c> read
    /// as <c>ABSTRACT</c>, on 78 files across the corpora. Deleting an unread field is a small win; deleting an
    /// unread field that is also incorrect removes a trap.</para>
    ///
    /// <para><b>And with the name gone, so do the regexes.</b> Nine <c>Regex.Match</c> calls per file existed
    /// only to capture a name after a keyword, with the modifier alternation spelled twice and a
    /// FUNCTION_BLOCK-before-FUNCTION ordering hazard called out in a comment. The kind is the FIRST TOKEN of the
    /// header line, compared whole — which is both faster and unable to have that ordering bug, because
    /// <c>FUNCTION</c> is not <c>FUNCTION_BLOCK</c> when you compare tokens instead of prefixes.</para>
    ///
    /// <para>A keyword with NOTHING after it is still not a header (<c>FUNCTION_BLOCK</c> alone), and that guard
    /// is kept — the global-variable keywords are the deliberate exception, since a GVL header names nothing.
    /// Modifiers are simply not looked at any more: <c>METHOD PUBLIC FINAL Foo</c> and <c>METHOD Foo</c> are the
    /// same kind, which was the only thing the modifier-skipping was ever in service of.</para></summary>
    public static string ParseCodeHeader(string code)
    {
        if (string.IsNullOrWhiteSpace(code))
            throw new BridgeException(BridgeErrorCodes.InvalidCodeHeader, "Empty code");

        var headerLine = HeaderLine(code);
        if (headerLine.Length == 0)
            throw new BridgeException(BridgeErrorCodes.InvalidCodeHeader, "No header line found");

        // `HeaderLine` only ever returns a line with code on it, so this cannot come back empty today — but an
        // array index is the wrong thing to bet that on when every other way out of here is a coded refusal.
        var tokens = headerLine.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        var keyword = tokens.Length > 0 ? tokens[0] : "";

        // A GVL is the one header with no name after the keyword.
        if (Is(keyword, "VAR_GLOBAL") || Is(keyword, "VAR_CONFIG")) return ItemKind.Kinds.Gvl;

        // Everything else names something. `TYPE Foo:` counts — the token carries the colon and this does not
        // care, because the name is not being read, only its presence.
        if (tokens.Length >= 2)
        {
            if (Is(keyword, "FUNCTION_BLOCK")) return ItemKind.Kinds.FunctionBlock;
            if (Is(keyword, "PROGRAM")) return ItemKind.Kinds.Program;
            if (Is(keyword, "INTERFACE")) return ItemKind.Kinds.Interface;
            if (Is(keyword, "FUNCTION")) return ItemKind.Kinds.Function;
            if (Is(keyword, "ACTION")) return ItemKind.Kinds.Action;
            if (Is(keyword, "METHOD")) return ItemKind.Kinds.Method;
            if (Is(keyword, "PROPERTY")) return ItemKind.Kinds.Property;
            // A DUT is unambiguous — only a DUT begins with TYPE — and it is ONE kind. struct/enum/union/alias
            // is not a Volt concept on the wire; it lives in the declaration body, where `DutSubtype` reads it
            // to name the FILE and where both IDEs read it to create the object.
            if (Is(keyword, "TYPE")) return ItemKind.Kinds.Dut;
        }

        throw new BridgeException(BridgeErrorCodes.InvalidCodeHeader,
            $"Unrecognized code header: {(headerLine.Length > 80 ? headerLine.Substring(0, 80) + "..." : headerLine)}");
    }

    /// <summary>Whole-token keyword comparison. IEC identifiers are case-insensitive, so this is too.</summary>
    private static bool Is(string token, string keyword) =>
        string.Equals(token, keyword, StringComparison.OrdinalIgnoreCase);
}
