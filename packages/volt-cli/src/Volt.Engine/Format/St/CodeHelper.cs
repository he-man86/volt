using System;
using System.Text.RegularExpressions;


using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Item;

namespace Volt.Engine.Format.St;

public static class CodeHelper
{
    // `HeaderLine` (a declaration's first code line) is DELETED with its last caller (openspec bridge-refusal-review
    // D3): network-text scope read a callee's header to decide "FB instance or FUNCTION call", and wrote the wrong body
    // when the header did not read. Scope asks the item's KIND and the vendor's refused names now. The repo gates
    // NoKindFromTextTests and NoCodeCheckLeftTests keep a header read out of the bridge.

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
    /// neither. What still asks it is <see cref="HeaderLine"/> and <c>StDeclaration</c>'s EXTENDS reader (network
    /// text); its variable reader reads by statement through <see cref="StTrivia"/> (D5).</para></summary>
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
