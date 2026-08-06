using System;
using System.Text.RegularExpressions;

using Volt.Cli.Transport;

namespace Volt.Engine.Workspace.SourceText;

public static class CodeHelper
{
    // A parsed header carries only the KIND and the NAME — the sole things callers read. It deliberately does
    // NOT extract a return type / data type / access modifier: those had no readers, and requiring them on the
    // header line made a header unrecognizable when the `: type` tail wrapped to the next line (a real CODESYS
    // export form). Child-level metadata (method return types etc.) is parsed separately in StSplitter.
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

        var lines = code!.Split('\n');
        bool inBlockComment = false;
        for (int i = 0; i < lines.Length; i++)
        {
            var trimmed = lines[i].Trim();
            if (inBlockComment)
            {
                if (trimmed.Contains("*)")) inBlockComment = false;
                continue;
            }
            if (trimmed.Length == 0) continue;
            if (trimmed.StartsWith("{")) continue;
            if (trimmed.StartsWith("//")) continue;
            if (trimmed.StartsWith("(*"))
            {
                if (!trimmed.Contains("*)")) inBlockComment = true;
                continue;
            }
            return trimmed;
        }
        return "";
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
