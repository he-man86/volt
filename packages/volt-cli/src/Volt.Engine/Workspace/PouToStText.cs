using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

using Volt.Cli.Transport;

namespace Volt.Engine.Workspace;

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

        if (pou.Kind == ItemKind.Kinds.Interface)
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
        kind is not (ItemKind.Kinds.Gvl or ItemKind.Kinds.Dut);

    // No silent fallback — an invented `END_<KIND>` would write syntactically wrong ST into the user's repo.
    // The kind is DERIVED text (CodeHelper.ParseCodeHeader), so a malformed export can legitimately hand us
    // `method`/`property`/`action` here; fail loud, exactly like the sibling ItemKind.ExtFor (which throws on
    // the same kind a few lines later in Materializer — so this fallback was masked, not unreachable).
    private static string EndKeyword(string kind) => kind switch
    {
        ItemKind.Kinds.FunctionBlock => "END_FUNCTION_BLOCK",
        ItemKind.Kinds.Program => "END_PROGRAM",
        ItemKind.Kinds.Function => "END_FUNCTION",
        ItemKind.Kinds.Interface => "END_INTERFACE",
        _ => throw new BridgeException(BridgeErrorCodes.InvalidCodeHeader, $"No END keyword for kind '{kind}'"),
    };

    private static int KindOrder(string kind) => kind switch
    {
        ItemKind.Kinds.Method => 0,
        ItemKind.Kinds.Action => 1,
        ItemKind.Kinds.Property => 2,
        _ => 3,
    };

    private static string AssembleChild(ChildData child)
    {
        if (child.Kind == ItemKind.Kinds.Property) return AssembleProperty(child);
        var decl = child.Declaration.TrimEnd();
        var impl = PrependFolder(child.Folder, (child.BodyText ?? "").Trim());
        var end = child.Kind switch
        {
            ItemKind.Kinds.Method => "END_METHOD",
            ItemKind.Kinds.Action => "END_ACTION",
            _ => throw new BridgeException(BridgeErrorCodes.InvalidCodeHeader,
                $"No END keyword for POU child kind '{child.Kind}'"),
        };
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

    /// <summary>Prepend a `%FOLDER &lt;path&gt;` directive to a child body — the child's sub-folder
    /// within the POU. The signature line stays a clean identifier; this `%FOLDER` line sits at the top
    /// of the body, ahead of its graphical content (the `NETWORK` marker for editable FBD/LD).</summary>
    private static string PrependFolder(string? folder, string impl)
    {
        if (string.IsNullOrEmpty(folder)) return impl;
        return impl.Length == 0 ? $"%FOLDER {folder}" : $"%FOLDER {folder}\n{impl}";
    }
}
