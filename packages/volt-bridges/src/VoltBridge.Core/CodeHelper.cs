using System;
using System.Text.RegularExpressions;

namespace VoltBridge.Core;

public static class CodeHelper
{
    public record CodeHeader(
        string Type,
        string? Name,
        string? ReturnType = null,
        string? DataType = null,
        string? AccessModifier = null);

    public static CodeHeader ParseCodeHeader(string code)
    {
        if (string.IsNullOrWhiteSpace(code))
            throw new BridgeException(400, "INVALID_CODE_HEADER", "Empty code");

        var lines = code.Split('\n');
        string headerLine = "";
        int headerIdx = -1;
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
            headerLine = trimmed;
            headerIdx = i;
            break;
        }

        if (headerLine.Length == 0)
            throw new BridgeException(400, "INVALID_CODE_HEADER", "No header line found");

        if (Regex.IsMatch(headerLine, @"^(VAR_GLOBAL|VAR_CONFIG)\b", RegexOptions.IgnoreCase))
            return new CodeHeader("gvl", null);

        var fbMatch = Regex.Match(headerLine, @"^FUNCTION_BLOCK\s+(\w+)", RegexOptions.IgnoreCase);
        if (fbMatch.Success) return new CodeHeader("function_block", fbMatch.Groups[1].Value);

        var prgMatch = Regex.Match(headerLine, @"^PROGRAM\s+(\w+)", RegexOptions.IgnoreCase);
        if (prgMatch.Success) return new CodeHeader("program", prgMatch.Groups[1].Value);

        var fcMatch = Regex.Match(headerLine, @"^FUNCTION\s+(\w+)(?:\s*:\s*(.+?))?\s*;?\s*$", RegexOptions.IgnoreCase);
        if (fcMatch.Success)
            return new CodeHeader("function", fcMatch.Groups[1].Value,
                ReturnType: fcMatch.Groups[2].Success ? fcMatch.Groups[2].Value.Trim() : null);

        var methodMatch = Regex.Match(headerLine,
            @"^METHOD\s+((?:(?:PUBLIC|PRIVATE|PROTECTED|INTERNAL|FINAL|ABSTRACT)\s+)*)(\w+)(?:\s*:\s*(.+?))?\s*;?\s*$",
            RegexOptions.IgnoreCase);
        if (methodMatch.Success)
            return new CodeHeader("method", methodMatch.Groups[2].Value,
                ReturnType: methodMatch.Groups[3].Success ? methodMatch.Groups[3].Value.Trim() : null,
                AccessModifier: ExtractAcl(methodMatch.Groups[1].Value));

        var propMatch = Regex.Match(headerLine,
            @"^PROPERTY\s+(?:(PUBLIC|PRIVATE|PROTECTED|INTERNAL)\s+)?(\w+)\s*:\s*(.+?)\s*;?\s*$",
            RegexOptions.IgnoreCase);
        if (propMatch.Success)
            return new CodeHeader("property", propMatch.Groups[2].Value,
                DataType: propMatch.Groups[3].Value.Trim(),
                AccessModifier: propMatch.Groups[1].Success ? propMatch.Groups[1].Value.ToUpperInvariant() : null);

        var actMatch = Regex.Match(headerLine, @"^ACTION\s+(\w+)", RegexOptions.IgnoreCase);
        if (actMatch.Success) return new CodeHeader("action", actMatch.Groups[1].Value);

        var ifaceMatch = Regex.Match(headerLine, @"^INTERFACE\s+(\w+)", RegexOptions.IgnoreCase);
        if (ifaceMatch.Success) return new CodeHeader("interface", ifaceMatch.Groups[1].Value);

        var typeMatch = Regex.Match(headerLine, @"^TYPE\s+(\w+)\s*:", RegexOptions.IgnoreCase);
        if (typeMatch.Success)
        {
            var typeName = typeMatch.Groups[1].Value;
            var rest = string.Join("\n", lines, headerIdx, lines.Length - headerIdx);
            return new CodeHeader(DetectDutSubType(rest), typeName);
        }

        throw new BridgeException(400, "INVALID_CODE_HEADER",
            $"Unrecognized code header: {(headerLine.Length > 80 ? headerLine.Substring(0, 80) + "..." : headerLine)}");
    }

    private static string? ExtractAcl(string modifierList)
    {
        if (string.IsNullOrWhiteSpace(modifierList)) return null;
        foreach (var token in modifierList.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries))
        {
            var upper = token.ToUpperInvariant();
            if (upper is "PUBLIC" or "PRIVATE" or "PROTECTED" or "INTERNAL") return upper;
        }
        return null;
    }

    private static string DetectDutSubType(string typeBlock)
    {
        if (Regex.IsMatch(typeBlock, @"\bSTRUCT\b", RegexOptions.IgnoreCase)) return "structure";
        if (Regex.IsMatch(typeBlock, @"\bUNION\b", RegexOptions.IgnoreCase)) return "union";
        if (Regex.IsMatch(typeBlock, @":\s*\(", RegexOptions.IgnoreCase)) return "enumeration";
        return "alias";
    }
}
