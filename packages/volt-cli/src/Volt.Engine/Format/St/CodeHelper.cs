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
    /// its wire name's extension (openspec <c>push-without-header-check</c>).</para>
    /// <para><b>Decides no kind and no name.</b> Its one caller is network-text scope (<c>StDeclaration</c>'s
    /// <c>IsCallableHeader</c> / <c>IsFunctionBlockType</c>): whether a callee's declaration is a POU a call can name, or
    /// a function block — analysis, which the item's kind (<c>pou</c>) cannot answer (5.Qa). The repo gate
    /// <c>NoKindFromTextTests</c> keeps every other header read out (5.F.2).</para></summary>
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
    /// <para><b>One trivia scanner per line.</b> There were two, and they disagreed about the same line. This one
    /// skipped any line STARTING with <c>(*</c> — so <c>(* doc *) FUNCTION_BLOCK FB</c>, where the comment closes
    /// and the declaration follows, was skipped whole and <see cref="HeaderLine"/> answered with the NEXT line.
    /// <c>StReader</c>'s scanner called that same line CODE, which is correct. Two answers to one question, and
    /// the wrong one was the one <c>CodesysTypeMap.LeadingKeyword</c> read (deleted with openspec
    /// <c>push-without-header-check</c> 5.Q — a POU's kind is its class now): it was TOTAL by design and fell back to
    /// FUNCTION_BLOCK, so a PROGRAM written that way was reported as <c>function_block</c> on refs/fetch — the same
    /// failure the leading-<c>{attribute}</c> case was fixed for, arriving through the other trivia.</para>
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
    /// the (since deleted) DUT subtype reader needed <c>TYPE E : {attribute 'strict'} (A, B);</c> to read as an
    /// enumeration, and grew its own scanner to get that answer — a second trivia rule disagreeing with this one
    /// about the same line. An unclosed <c>{</c> is still trivia to the end of the line: the multi-line pragma
    /// that would need real tracking is not valid IEC 61131-3.</para>
    ///
    /// <para><b>Not the splitter's.</b> The child splitter (<c>StReader</c>) reads through <see cref="StTrivia"/>, which
    /// NESTS comments and sees one opened after code (openspec <c>push-without-header-check</c> 5.E.1); this one does
    /// neither. What still asks it is <see cref="HeaderLine"/> (network-text scope, above) and
    /// <c>StDeclaration</c>'s variable and EXTENDS readers (network text, parked).</para></summary>
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
}
