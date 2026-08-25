using System;
using System.IO;
using System.IO.Compression;
using System.Linq;

namespace Volt.Cli.Ide.Twincat;

/// <summary>
/// TwinCAT's per-item archive — <c>ITcSmTreeItem.ExportChild</c> / <c>ImportChild</c> — and the one fact that
/// turns it into a MOVE.
///
/// <para><b>The archive is a plain zip, and each entry is named by the item's PROJECT-RELATIVE PATH.</b> Measured
/// live (DIALECT D4f): exporting <c>VltProbePou</c> out of folder <c>VltProbeF</c> yields a single entry
/// <c>VltProbeF\VltProbePou.TcPOU</c>, and <c>ImportChild</c> RECREATES that path under the target — which is why
/// a naive export/import lands the item at <c>Target/VltProbeF/VltProbePou</c> instead of moving it. That
/// recreation was read for a long time as "TwinCAT has no move", and the note it left behind said the technique
/// was "usable only with a way to rewrite the path inside the archive, which has not been found". The path is a
/// zip ENTRY NAME. Rewriting it is <see cref="Flatten"/>, below.</para>
///
/// <para>Two vendor constraints the file name and arguments encode, both measured:
/// <list type="bullet">
/// <item><c>ExportChild</c> REQUIRES a <c>.zip</c> file name — <c>.xml</c>, <c>.tszip</c>, <c>.tpzip</c>,
/// <c>.tczip</c>, <c>.tcpou</c>, <c>.xti</c> and <c>.tsproj</c> are all refused.</item>
/// <item><c>ImportChild</c>'s 4th argument RENAMES the imported child, and TwinCAT then rejects the import
/// outright ("Cannot change imported child name!"). It must be omitted, so a move keeps the NAME — which is what
/// Volt wants anyway: the wire identity is the name.</item>
/// </list></para>
/// </summary>
internal static class TcItemArchive
{
    /// <summary>Relocate <paramref name="name"/> from <paramref name="from"/> to <paramref name="to"/>, whole —
    /// children, graphical bodies and all. Export, flatten, delete, import.
    /// <para>The delete has to happen between the export and the import (<c>ImportChild</c> refuses a name the
    /// target's subtree already holds), which opens a window where the item exists only inside the archive. If the
    /// import fails, the archive is imported back into the ORIGINAL parent before the failure is rethrown, so a
    /// refused move leaves the project as it was rather than one POU short. That restore is not a fallback hiding
    /// a fault — the fault is still thrown; it is the undo for a step that already succeeded.</para></summary>
    public static void Move(dynamic from, dynamic to, string name)
    {
        var zip = Path.Combine(Path.GetTempPath(), "volt_move_" + Guid.NewGuid().ToString("N") + ".zip");
        try
        {
            from.ExportChild(name, zip);
            Flatten(zip);
            from.DeleteChild(name);
            try
            {
                to.ImportChild(zip, Type.Missing, false, Type.Missing);
            }
            catch
            {
                // Put it back where it came from. If THIS throws too the original is genuinely gone, and the
                // archive path is in the message so it can be re-imported by hand.
                try { from.ImportChild(zip, Type.Missing, false, Type.Missing); }
                catch (Exception restore)
                {
                    throw new InvalidOperationException(
                        $"move of '{name}' failed AND could not be undone — the item is in the archive at {zip}, " +
                        $"import it manually ({restore.Message})", restore);
                }
                throw;
            }
        }
        finally { try { File.Delete(zip); } catch { /* temp file */ } }
    }

    /// <summary>Strip every entry's directory prefix, so <c>ImportChild</c> has no source path left to recreate
    /// under the target and drops the item straight in. Rewrites the archive in place.
    /// <para>Only entry NAMES change — each entry's bytes are copied through untouched, so nothing here parses or
    /// re-serializes the vendor's payload.</para></summary>
    private static void Flatten(string zip)
    {
        var rebuilt = zip + ".flat";
        using (var src = ZipFile.OpenRead(zip))
        {
            if (src.Entries.All(e => Leaf(e.FullName) == e.FullName)) return;   // already flat (item was at the root)
            using var dst = ZipFile.Open(rebuilt, ZipArchiveMode.Create);
            foreach (var entry in src.Entries)
            {
                var copy = dst.CreateEntry(Leaf(entry.FullName), CompressionLevel.Optimal);
                using var input = entry.Open();
                using var output = copy.Open();
                input.CopyTo(output);
            }
        }
        File.Delete(zip);
        File.Move(rebuilt, zip);
    }

    // TwinCAT writes the separator as '\', .NET's zip API normalizes to '/' on read — handle both.
    private static string Leaf(string entryPath) =>
        entryPath.Substring(entryPath.LastIndexOfAny(new[] { '/', '\\' }) + 1);
}
