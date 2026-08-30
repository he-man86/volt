using System;
using System.Text.RegularExpressions;


using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Item;

namespace Volt.Engine.Format.St;

public static class CodeHelper
{
    // A parsed header carries only the KIND and the NAME — the sole things callers read. It deliberately does
    // NOT extract a return type / data type / access modifier: those had no readers, and requiring them on the
    // header line made a header unrecognizable when the `: type` tail wrapped to the next line (a real CODESYS
    // export form). Child-level metadata (method return types etc.) is parsed separately in StReader.
    public record CodeHeader(string Type, string? Name);

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
    /// <para>A PRAGMA is deliberately trivia for the WHOLE line, which is what both scanners already did: a
    /// <c>{attribute …}</c> sits on its own line in every form either vendor emits, and the multi-line pragma
    /// that would need real tracking is not valid IEC 61131-3.</para></summary>
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
            if (s.StartsWith("{", StringComparison.Ordinal)) return "";
            if (s.StartsWith("(*", StringComparison.Ordinal))
            {
                inBlockComment = true;
                s = s.Substring(2);
                continue;
            }
            return s;
        }
    }

    public static CodeHeader ParseCodeHeader(string code)
    {
        if (string.IsNullOrWhiteSpace(code))
            throw new BridgeException(BridgeErrorCodes.InvalidCodeHeader, "Empty code");

        var headerLine = HeaderLine(code);

        if (headerLine.Length == 0)
            throw new BridgeException(BridgeErrorCodes.InvalidCodeHeader, "No header line found");

        // Every pattern matches ONLY the keyword + the item name, and requires NOTHING after the name on the
        // header line. That is the whole point of the structural fix: a header's `: type` / return type /
        // `EXTENDS Base :` tail legally wraps onto the next line in real CODESYS exports, so requiring any of it
        // on the header line silently loses (or, for PROPERTY/TYPE, throws away) the item. We only need kind +
        // name; the DUT sub-type and any child metadata are derived elsewhere from the full body.
        //   FUNCTION_BLOCK is checked before FUNCTION — `\s+` after FUNCTION won't match the `_` in
        //   FUNCTION_BLOCK, but keep the order explicit anyway.
        if (Regex.IsMatch(headerLine, @"^(VAR_GLOBAL|VAR_CONFIG)\b", RegexOptions.IgnoreCase))
            return new CodeHeader(ItemKind.Kinds.Gvl, null);

        if (NameAfter(headerLine, "FUNCTION_BLOCK") is { } fb) return new CodeHeader(ItemKind.Kinds.FunctionBlock, fb);
        if (NameAfter(headerLine, "PROGRAM") is { } prg) return new CodeHeader(ItemKind.Kinds.Program, prg);
        if (NameAfter(headerLine, "INTERFACE") is { } iface) return new CodeHeader(ItemKind.Kinds.Interface, iface);
        if (NameAfter(headerLine, "FUNCTION") is { } fc) return new CodeHeader(ItemKind.Kinds.Function, fc);
        if (NameAfter(headerLine, "ACTION") is { } act) return new CodeHeader(ItemKind.Kinds.Action, act);
        // METHOD / PROPERTY may carry access modifiers (PUBLIC/PRIVATE/…) before the name.
        if (MemberName(headerLine, "METHOD") is { } meth) return new CodeHeader(ItemKind.Kinds.Method, meth);
        if (MemberName(headerLine, "PROPERTY") is { } prop) return new CodeHeader(ItemKind.Kinds.Property, prop);

        // A DUT is unambiguous — only a DUT begins with TYPE. Match just the name (EXTENDS/IMPLEMENTS/`:` may
        // wrap — the case that silently dropped pro2193's Fanuc_* structs). A DUT is ONE kind `dut`; struct/
        // enum/union/alias is not a Volt concept — it lives only in the declaration body, and the IDE derives
        // it from that text on both read and create. Volt never classifies the subtype.
        if (NameAfter(headerLine, "TYPE") is { } dut)
            return new CodeHeader(ItemKind.Kinds.Dut, dut);

        throw new BridgeException(BridgeErrorCodes.InvalidCodeHeader,
            $"Unrecognized code header: {(headerLine.Length > 80 ? headerLine.Substring(0, 80) + "..." : headerLine)}");
    }

    /// <summary>The item name after a leading keyword (`FUNCTION_BLOCK Foo` → `Foo`), or null if the header
    /// line doesn't start with that keyword. Nothing after the name is required, so a wrapped `: type` tail
    /// never defeats the match.</summary>
    private static string? NameAfter(string headerLine, string keyword) =>
        Regex.Match(headerLine, $@"^{keyword}\s+(\w+)", RegexOptions.IgnoreCase) is { Success: true } m ? m.Groups[1].Value : null;

    /// <summary>Like <see cref="NameAfter"/> but skips optional access/modifier keywords between the keyword and
    /// the name (`METHOD PUBLIC FINAL Foo` → `Foo`).</summary>
    private static string? MemberName(string headerLine, string keyword) =>
        Regex.Match(headerLine, $@"^{keyword}\s+(?:(?:PUBLIC|PRIVATE|PROTECTED|INTERNAL|FINAL|ABSTRACT)\s+)*(\w+)",
            RegexOptions.IgnoreCase) is { Success: true } m ? m.Groups[1].Value : null;

}
