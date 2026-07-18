namespace Volt.Cli.Sync;

public enum Access { R, Rw }

public sealed record ExtensionDef(string Ext, Access DefaultAccess);

/// <summary>
/// Extension registry — the single source of truth for every workspace file extension Volt tracks. The bridge
/// sends full filenames (name.ext); the CLI looks up the extension here to determine access (rw for source items,
/// r for references). C# port of the original TypeScript implementation
/// </summary>
public static class Extensions
{
    public const string FolderMarker = ".gitkeep";

    // Writable source is named by KIND; only reference KINDS are read-only by extension. A graphical CFC/SFC body
    // is the same .fb/.prg/.fun (rw here; a push over it is refused by the bridge on live IDE state, not pre-filtered).
    private static readonly ExtensionDef[] All =
    {
        new("fb", Access.Rw), new("prg", Access.Rw), new("fun", Access.Rw), new("itf", Access.Rw),
        new("struct", Access.Rw), new("union", Access.Rw), new("enum", Access.Rw), new("alias", Access.Rw),
        new("gvl", Access.Rw),
        new("library", Access.R), new("device", Access.R), new("projectinfo", Access.R), new("trace", Access.R),
        new("recipe", Access.R), new("symbols", Access.R), new("task", Access.R), new("image_pool", Access.R),
        new("parameter_list", Access.R), new("text_list", Access.R), new("recipe_manager", Access.R),
        new("visualization_manager", Access.R), new("visualization", Access.R), new("library_manager", Access.R),
        new("class_diagram", Access.R), new("external_types", Access.R), new("tmc", Access.R),
    };

    private static readonly Dictionary<string, ExtensionDef> ByExt =
        All.ToDictionary(d => "." + d.Ext, StringComparer.OrdinalIgnoreCase);

    private static ExtensionDef? GetByExt(string ext) => ByExt.TryGetValue(ext, out var d) ? d : null;

    private static ExtensionDef? GetByPath(string relPath)
    {
        var slash = relPath.LastIndexOf('/');
        var baseName = slash >= 0 ? relPath.Substring(slash + 1) : relPath;
        var dot = baseName.LastIndexOf('.');
        return dot < 0 ? null : GetByExt(baseName.Substring(dot));
    }

    /// <summary>The full filename from a workspace path ("POUs/FB_Motor.fb" → "FB_Motor.fb"). Folder markers
    /// resolve to the containing folder name. Matches the bridge's wire names (which include extensions).</summary>
    public static string? FullNameFromPath(string relPath)
    {
        var slash = relPath.LastIndexOf('/');
        var baseName = slash >= 0 ? relPath.Substring(slash + 1) : relPath;
        if (baseName == FolderMarker)
        {
            if (slash <= 0) return null;
            var beforeSlash = relPath.LastIndexOf('/', slash - 1);
            return relPath.Substring(beforeSlash + 1, slash - (beforeSlash + 1));
        }
        var dot = baseName.LastIndexOf('.');
        if (dot < 0) return null;
        return GetByExt(baseName.Substring(dot)) == null ? null : baseName;
    }

    /// <summary>The extension definition for a full filename ("PLC_PRG.prg" → { ext:"prg", rw }).</summary>
    public static ExtensionDef? DefFromName(string fullName)
    {
        var dot = fullName.LastIndexOf('.');
        return dot < 0 ? null : GetByExt(fullName.Substring(dot));
    }

    public static bool IsTrackedPath(string relPath)
    {
        if (relPath.EndsWith("/" + FolderMarker, StringComparison.Ordinal) || relPath == FolderMarker) return true;
        if (relPath == ".gitattributes") return true;
        return GetByPath(relPath) != null;
    }

    public static bool IsPushable(string relPath) => GetByPath(relPath)?.DefaultAccess == Access.Rw;
    public static bool IsReadOnly(string relPath) => GetByPath(relPath)?.DefaultAccess == Access.R;

    /// <summary>Normalize EVERY workspace file to LF — the bridge always emits LF, so without this Windows git
    /// (core.autocrlf) round-trips the un-attributed read-only kinds through CRLF and pull/push see spurious drift.</summary>
    public static string GitattributesContent() => "* text=auto eol=lf\n";
}
