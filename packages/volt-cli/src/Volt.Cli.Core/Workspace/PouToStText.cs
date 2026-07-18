using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Volt.Cli.Core.Workspace;

/// <summary>Assembles a <see cref="PouData"/> into canonical workspace Structured Text.
/// Replaces the dict-based <c>StAssembler</c>.</summary>
public static class PouToStText
{
    public static string Convert(PouData pou)
    {
        if (!HasBody(pou.Kind))
            return pou.Declaration.TrimEnd() + "\n";

        var sb = new StringBuilder();
        sb.Append(pou.Declaration.TrimEnd());

        var impl = (pou.BodyText ?? "").Trim();
        if (impl.Length > 0)
            sb.Append('\n').Append('\n').Append(impl);

        var children = pou.Children
            .OrderBy(c => KindOrder(c.Kind))
            .ThenBy(c => c.Name, StringComparer.Ordinal)
            .ToList();

        if (pou.Kind == "interface")
        {
            foreach (var c in children) { sb.Append('\n').Append('\n'); sb.Append(AssembleChild(c)); }
            sb.Append('\n').Append('\n').Append(EndKeyword(pou.Kind));
        }
        else
        {
            sb.Append('\n').Append('\n').Append(EndKeyword(pou.Kind));
            foreach (var c in children) { sb.Append('\n').Append('\n'); sb.Append(AssembleChild(c)); }
        }

        sb.Append('\n');
        return sb.ToString();
    }

    private static bool HasBody(string kind) =>
        kind is not ("gvl" or "structure" or "enumeration" or "union" or "alias");

    private static string EndKeyword(string kind) => kind switch
    {
        "function_block" => "END_FUNCTION_BLOCK",
        "program" => "END_PROGRAM",
        "function" => "END_FUNCTION",
        "interface" => "END_INTERFACE",
        _ => $"END_{kind.ToUpperInvariant()}",
    };

    private static int KindOrder(string kind) => kind switch
    {
        "method" => 0,
        "action" => 1,
        "property" => 2,
        _ => 3,
    };

    private static string AssembleChild(ChildData child)
    {
        if (child.Kind == "property") return AssembleProperty(child);
        var decl = child.Declaration.TrimEnd();
        var impl = PrependFolder(child.Folder, (child.BodyText ?? "").Trim());
        var end = child.Kind == "method" ? "END_METHOD" : "END_ACTION";
        return impl.Length == 0 ? $"{decl}\n{end}" : $"{decl}\n{impl}\n{end}";
    }

    private static string AssembleProperty(ChildData child)
    {
        var parts = new List<string> { child.Declaration.TrimEnd() };
        if (!string.IsNullOrEmpty(child.Folder)) parts.Add($"%FOLDER {child.Folder}");
        if (child.GetterCode is not null || child.GetterDeclaration is not null)
            parts.Add(AssembleAccessor("GET", child.GetterDeclaration, child.GetterCode));
        if (child.SetterCode is not null || child.SetterDeclaration is not null)
            parts.Add(AssembleAccessor("SET", child.SetterDeclaration, child.SetterCode));
        parts.Add("END_PROPERTY");
        return string.Join("\n", parts);
    }

    private static string AssembleAccessor(string keyword, string? decl, string? impl)
    {
        var d = (decl ?? "").Trim();
        var i = (impl ?? "").Trim();
        var lines = new List<string> { keyword };
        if (d.Length > 0) lines.Add(d);
        if (i.Length > 0) lines.Add(i);
        lines.Add($"END_{keyword}");
        return string.Join("\n", lines);
    }

    private static string PrependFolder(string? folder, string impl)
    {
        if (string.IsNullOrEmpty(folder)) return impl;
        return impl.Length == 0 ? $"%FOLDER {folder}" : $"%FOLDER {folder}\n{impl}";
    }
}
