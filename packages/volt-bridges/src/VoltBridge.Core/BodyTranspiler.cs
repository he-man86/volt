using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace VoltBridge.Core;

public static class BodyTranspiler
{
    public static TranspileResult TranspileGraphicalBodyToSt(string bodyXml, string bodyLanguage)
    {
        var placeholder = bodyLanguage switch
        {
            "FBD" => "(* Graphical FBD body — transpiler not yet ported to C#. *)\n",
            "LD" => "(* Graphical LD body — transpiler not yet ported to C#. *)\n",
            "SFC" => "(* Graphical SFC body — SFC transpiler not yet implemented. *)\n",
            "CFC" => "(* Graphical CFC body — CFC transpiler not yet implemented. *)\n",
            _ => "(* Graphical body — transpiler not yet ported to C#. *)\n",
        };
        return new TranspileResult(true, placeholder, new List<string>());
    }

    public static string MaterializeGraphicalPouAsSt(string name, string sourceText, string bodyXml, string bodyLanguage)
    {
        var transpiled = TranspileGraphicalBodyToSt(bodyXml, bodyLanguage);
        return SpliceTranspiledBody(sourceText, transpiled.St, transpiled.TempDeclarations);
    }

    private static string SpliceTranspiledBody(string declaration, string body, List<string> tempDeclarations)
    {
        // Find the END statement that closes the POU
        var endRe = new System.Text.RegularExpressions.Regex(
            @"^END_(?:PROGRAM|FUNCTION_BLOCK|FUNCTION)\b[^\n]*\n?",
            System.Text.RegularExpressions.RegexOptions.Multiline);
        var endMatch = endRe.Match(declaration);
        if (!endMatch.Success)
            return declaration + "\n" + body;

        var prefix = declaration.Substring(0, endMatch.Index);
        var endLine = endMatch.Value.Trim();
        var suffix = declaration.Substring(endMatch.Index + endMatch.Length).Trim();

        var tempSection = tempDeclarations.Count == 0
            ? ""
            : "\nVAR_TEMP\n" + string.Join("\n", tempDeclarations) + "\nEND_VAR\n";

        var bodyBlock = body.Length == 0 ? "" : "\n" + body.Trim() + "\n";
        var afterBlock = suffix.Length == 0 ? "" : "\n" + suffix + "\n";

        return prefix.TrimEnd() + "\n" + tempSection + bodyBlock + "\n" + endLine + "\n" + afterBlock;
    }
}

public class TranspileResult
{
    public bool Success { get; }
    public string St { get; }
    public List<string> TempDeclarations { get; }
    public string? ErrorReason { get; }

    public TranspileResult(bool success, string st, List<string> tempDeclarations, string? errorReason = null)
    {
        Success = success;
        St = st;
        TempDeclarations = tempDeclarations;
        ErrorReason = errorReason;
    }
}
