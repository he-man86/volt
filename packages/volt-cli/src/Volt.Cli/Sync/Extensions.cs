using Volt.Engine.Format.Body;
using Volt.Engine.Item;
namespace Volt.Cli.Sync;


public enum Access { R, Rw }

public sealed record ExtensionDef(string Ext, Access DefaultAccess);

/// <summary>
/// CLI-side extension registry: maps a workspace filename to its access (rw for source items, r for
/// references). The extension list + access is NOT re-declared here — it is DERIVED from
/// <see cref="ItemKind.FileExtensions"/> (the one canonical table), so a new kind is added in exactly one
/// place. A graphical CFC/SFC body is the same rw .fb/.prg/.fun (a push over it is refused by the bridge on
/// live IDE state, not pre-filtered here).
/// </summary>
public static class Extensions
{
    private static readonly ExtensionDef[] All =
        ItemKind.FileExtensions.Select(x => new ExtensionDef(x.Ext, x.IsWritable ? Access.Rw : Access.R)).ToArray();

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

    /// <summary>The full filename from a workspace path ("POUs/FB_Motor.fb" → "FB_Motor.fb"). Matches the
    /// bridge's wire names (which include extensions).
    ///
    /// <para>There was a FOLDER-MARKER arm here that resolved `POUs/.gitkeep` to the folder name `POUs`.
    /// Nothing has written a `.gitkeep` since folders stopped being items (`Materialize`: "legacy `.gitkeep`
    /// files are only READ back — never produced here"), and what survived was a trap: `IsTrackedPath` said yes
    /// while `IsPushable` said no, so a `.gitkeep` an engineer added by hand showed as an outgoing change every
    /// `volt status` and `volt push` answered "nothing to push", forever. It now falls through to the same
    /// foreign-file refusal every other unsyncable file in `src/` gets, which says so by name.</para></summary>
    public static string? FullNameFromPath(string relPath)
    {
        var slash = relPath.LastIndexOf('/');
        var baseName = slash >= 0 ? relPath.Substring(slash + 1) : relPath;
        var dot = baseName.LastIndexOf('.');
        if (dot < 0) return null;
        if (GetByExt(baseName.Substring(dot)) == null) return null;
        // A DUT is on disk as `.struct`/`.enum`/`.union`/`.alias` but on the wire as `.dut` — the one kind both
        // vendors have. Map it back here, at the single path→name seam, so nothing downstream (push, the version
        // gates, the folder maps) ever sees a name the bridge would not recognize.
        var ext = baseName.Substring(dot + 1);
        return ItemKind.IsDutFileExtension(ext)
            ? baseName.Substring(0, dot + 1) + ItemKind.WireExtFor(ext)
            : baseName;
    }

    /// <summary>The extension definition for a full filename ("PLC_PRG.prg" → { ext:"prg", rw }).</summary>
    public static ExtensionDef? DefFromName(string fullName)
    {
        var dot = fullName.LastIndexOf('.');
        return dot < 0 ? null : GetByExt(fullName.Substring(dot));
    }

    public static bool IsTrackedPath(string relPath)
    {
        if (relPath == ".gitattributes") return true;
        return GetByPath(relPath) != null;
    }

    public static bool IsPushable(string relPath) => GetByPath(relPath)?.DefaultAccess == Access.Rw;
    public static bool IsReadOnly(string relPath) => GetByPath(relPath)?.DefaultAccess == Access.R;

    /// <summary>Normalize EVERY workspace file to LF — the bridge always emits LF, so without this Windows git
    /// (core.autocrlf) round-trips the un-attributed read-only kinds through CRLF and pull/push see spurious drift.</summary>
    public static string GitattributesContent() => "* text=auto eol=lf\n";
}
