using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Xml.Linq;

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
    public static void Move(dynamic from, dynamic to, string name) => RoundTrip(from, to, name, rewrite: null);

    /// <summary>Place <paramref name="memberName"/> — a POU MEMBER — into <paramref name="folderPath"/> inside its
    /// own POU, by rewriting the POU's archive and re-importing it into the SAME parent.
    ///
    /// <para><b>Why not a move.</b> `ExportChild` REFUSES a member — *"The tree item 'Deep' cannot be exported
    /// seperately because it has no document file. Please export the parent node that contains the document!"* —
    /// because a member is not a file: TwinCAT stores the whole POU, members and all, in one `.TcPOU`. So the
    /// relocation happens one level up, on the thing that IS a file.</para>
    ///
    /// <para><b>And the placement is IN that file</b>, which is what makes this work at all (DIALECT D4j). A
    /// member carries <c>FolderPath="Helpers\Inner\"</c> — the full path, backslash-separated, trailing
    /// separator — and the folders themselves are <c>&lt;Folder Name="Helpers" Id="{guid}"&gt;</c> elements that
    /// NEST by element rather than by path. Every member kind uses the same attribute: <c>&lt;Method&gt;</c>,
    /// <c>&lt;Action&gt;</c> and <c>&lt;Property&gt;</c> alike. So a placement Beckhoff's PLCopen import discards
    /// is expressible, exactly, in Beckhoff's own storage format.</para>
    ///
    /// <para>An empty <paramref name="folderPath"/> moves the member back to the POU root.</para></summary>
    public static void MoveMember(dynamic pouParent, string pouName, string memberName, string folderPath)
    {
        // The lambda is typed BEFORE the call: RoundTrip's first arguments are `dynamic`, so the whole invocation
        // binds at runtime and a bare lambda has no type to infer there.
        Action<string> place = zip => SetMemberFolder(zip, memberName, folderPath);
        RoundTrip(pouParent, pouParent, pouName, place);
    }

    /// <summary>Export <paramref name="name"/> out of <paramref name="from"/>, optionally rewrite the archive, and
    /// import it into <paramref name="to"/>. The one shape both relocations share.</summary>
    private static void RoundTrip(dynamic from, dynamic to, string name, Action<string>? rewrite)
    {
        var zip = Path.Combine(Path.GetTempPath(), "volt_move_" + Guid.NewGuid().ToString("N") + ".zip");
        // Set when the archive becomes the ONLY surviving copy of the item — the source has been deleted and the
        // undo failed too. In that state the file is not a temp artefact, it is the engineer's work.
        var archiveIsLastCopy = false;
        try
        {
            from.ExportChild(name, zip);
            Flatten(zip);
            rewrite?.Invoke(zip);
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
                    // The item is gone from the source and never arrived at the destination: this archive is all
                    // that is left of it. The `finally` below used to delete it anyway — so the one instruction
                    // that could recover the engineer's work pointed at a path that no longer existed by the time
                    // they read it. A recovery route that deletes its own evidence is worse than no message.
                    archiveIsLastCopy = true;
                    throw new InvalidOperationException(
                        $"move of '{name}' failed AND could not be undone — the item is in the archive at {zip}, " +
                        $"import it manually ({restore.Message})", restore);
                }
                throw;
            }
        }
        // Deleted on every path EXCEPT the unrecoverable one. Keeping every archive would litter %TEMP% after
        // an ordinary hiccup the undo already repaired; keeping this one is the difference between a failed move
        // and a lost POU.
        finally { if (!archiveIsLastCopy) { try { File.Delete(zip); } catch { /* temp file */ } } }
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

    /// <summary>Point the named member at <paramref name="folderPath"/> inside the archived <c>.TcPOU</c>, creating
    /// the <c>&lt;Folder&gt;</c> chain it names. Rewrites the archive in place.
    /// <para>Parsed as XML rather than patched as text: the member elements carry declarations and implementations
    /// in CDATA, and a regex over that works until a body happens to contain the pattern.</para>
    /// <para>A member the archive does not carry is an ERROR, not a no-op. Silence would report a placement that
    /// never happened.</para></summary>
    private static void SetMemberFolder(string zip, string memberName, string folderPath)
    {
        var rebuilt = zip + ".placed";
        try { File.Delete(rebuilt); } catch { /* fresh temp */ }
        using (var src = ZipFile.OpenRead(zip))
        using (var dst = ZipFile.Open(rebuilt, ZipArchiveMode.Create))
        {
            var placed = false;
            foreach (var entry in src.Entries)
            {
                string text;
                using (var reader = new StreamReader(entry.Open())) text = reader.ReadToEnd();
                if (entry.FullName.EndsWith(".TcPOU", StringComparison.OrdinalIgnoreCase))
                    placed |= TryPlace(ref text, memberName, folderPath);
                var copy = dst.CreateEntry(entry.FullName, CompressionLevel.Optimal);
                using var writer = new StreamWriter(copy.Open());
                writer.Write(text);
            }
            if (!placed)
                throw new InvalidOperationException(
                    $"'{memberName}' is not in its POU's archive, so it cannot be placed in '{folderPath}'");
        }
        File.Delete(zip);
        File.Move(rebuilt, zip);
    }

    private static bool TryPlace(ref string tcPou, string memberName, string folderPath)
    {
        var doc = XDocument.Parse(tcPou);
        var member = doc.Descendants().FirstOrDefault(e =>
            e.Name.LocalName is "Method" or "Action" or "Property"
            && (string?)e.Attribute("Name") == memberName);
        if (member is null) return false;

        if (string.IsNullOrEmpty(folderPath))
        {
            member.Attribute("FolderPath")?.Remove();   // back to the POU root
        }
        else
        {
            var segments = folderPath.Split(Separators, StringSplitOptions.RemoveEmptyEntries);
            EnsureFolders(member.Parent!, segments);
            // The TRAILING separator is TwinCAT's own spelling, not decoration — this file is read by the IDE.
            member.SetAttributeValue("FolderPath", string.Join(Sep, segments) + Sep);
        }

        tcPou = doc.Declaration is null ? doc.ToString() : doc.Declaration + Environment.NewLine + doc.ToString();
        return true;
    }

    /// <summary>Ensure the nested <c>&lt;Folder Name="x" Id="{guid}"&gt;</c> chain exists under the POU. Folders
    /// nest by ELEMENT, one path segment each — not by writing a whole path into one Name.</summary>
    private static void EnsureFolders(XElement pou, string[] segments)
    {
        var node = pou;
        foreach (var segment in segments)
        {
            var next = node.Elements().FirstOrDefault(e =>
                e.Name.LocalName == "Folder" && (string?)e.Attribute("Name") == segment);
            if (next is null)
            {
                next = new XElement(pou.Name.Namespace + "Folder",
                    new XAttribute("Name", segment),
                    new XAttribute("Id", "{" + Guid.NewGuid() + "}"));
                node.Add(next);
            }
            node = next;
        }
    }

    // TwinCAT spells the member folder separator as a backslash, with a trailing one.
    private const string Sep = "\\";
    private static readonly char[] Separators = { '/', '\\' };

    // TwinCAT writes the separator as '\', .NET's zip API normalizes to '/' on read — handle both.
    private static string Leaf(string entryPath) =>
        entryPath.Substring(entryPath.LastIndexOfAny(new[] { '/', '\\' }) + 1);
}
