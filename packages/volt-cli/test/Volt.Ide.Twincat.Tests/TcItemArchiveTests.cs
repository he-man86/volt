using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using Xunit;
using Volt.Ide.Twincat;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// <c>TcItemArchive</c> relocates an item by round-tripping it through the vendor's own archive export: export to
/// a zip, delete the original, import the zip at the destination. Between the delete and the import, THE ARCHIVE
/// IS THE ONLY COPY OF THE ITEM. Everything here is about that window.
///
/// <para>These are the first offline tests of the TwinCAT driver. Its collaborators are <c>dynamic</c>, so a plain
/// C# double with the right method names binds and no vendor call happens — the driver was untestable only
/// because nothing referenced it, not because it needed a live XAE.</para>
/// </summary>
public class TcItemArchiveTests
{
    /// <summary>A stand-in for a TwinCAT tree node. Bound via <c>dynamic</c>, so the method NAMES are the whole
    /// contract — the same way the driver itself talks to the vendor.
    /// <para>PUBLIC, and it has to be: <c>dynamic</c> resolves against the accessibility of the CALL SITE, which
    /// lives in the driver assembly. A private nested double binds to nothing there and fails with
    /// "'object' does not contain a definition for 'ExportChild'" — a message that reads like the double is
    /// wrong rather than merely invisible.</para></summary>
    public sealed class FakeNode
    {
        public bool ThrowOnImport;
        public List<string> Deleted { get; } = new();
        public List<string> Imported { get; } = new();

        /// <summary>Writes a real zip, because <c>Flatten</c> opens and rewrites it — a stub that wrote nothing
        /// would make the test pass without exercising the archive handling at all.</summary>
        public void ExportChild(string name, string zipPath)
        {
            using var zip = ZipFile.Open(zipPath, ZipArchiveMode.Create);
            var entry = zip.CreateEntry($"POUs/{name}.TcPOU");
            using var w = new StreamWriter(entry.Open());
            w.Write("<TcPlcObject><POU Name=\"" + name + "\" /></TcPlcObject>");
        }

        public void DeleteChild(string name) => Deleted.Add(name);

        public void ImportChild(string zipPath, object a, bool b, object c)
        {
            if (ThrowOnImport) throw new InvalidOperationException("COM said no");
            Imported.Add(zipPath);
        }
    }

    /// <summary>When the move fails AND the undo fails, the archive named in the message must still EXIST.
    /// <para>The message says "the item is in the archive at {zip}, import it manually" — and the <c>finally</c>
    /// deleted that very file on the way out. The item is already gone from the source at this point, so the
    /// engineer was handed the one instruction that could recover their work, pointing at a path that no longer
    /// existed. A recovery route that deletes its own evidence is worse than no message.</para></summary>
    [Fact]
    public void An_unrecoverable_move_leaves_the_archive_on_disk()
    {
        var from = new FakeNode { ThrowOnImport = true };   // undo also fails
        var to = new FakeNode { ThrowOnImport = true };     // the move itself fails

        var ex = Assert.Throws<InvalidOperationException>(() => TcItemArchive.Move(from, to, "FB_Orphan"));

        Assert.Contains("could not be undone", ex.Message);
        var path = ArchivePathFrom(ex.Message);
        try
        {
            Assert.True(File.Exists(path),
                $"the archive is the only remaining copy of 'FB_Orphan' and the error tells the engineer to import " +
                $"it by hand, but it was deleted: {path}");
            using var zip = ZipFile.OpenRead(path);
            Assert.NotEmpty(zip.Entries);                   // and it still holds the item, not an empty shell
        }
        finally { try { File.Delete(path); } catch { } }
    }

    /// <summary>The ordinary failure — the move fails but the undo SUCCEEDS — still cleans up.
    /// <para>Keeping every archive would turn a recoverable hiccup into litter in %TEMP%. The archive survives
    /// only when it is the last copy, which is exactly the condition the message describes.</para></summary>
    [Fact]
    public void A_move_that_is_successfully_undone_deletes_its_archive()
    {
        var from = new FakeNode();                          // undo succeeds
        var to = new FakeNode { ThrowOnImport = true };     // the move fails

        Assert.Throws<InvalidOperationException>(() => TcItemArchive.Move(from, to, "FB_Restored"));

        Assert.Single(from.Imported);                       // it really was put back
        Assert.False(File.Exists(from.Imported[0]), "a recovered move must not leave its archive behind");
    }

    /// <summary>And the happy path deletes it too.</summary>
    [Fact]
    public void A_successful_move_deletes_its_archive()
    {
        var from = new FakeNode();
        var to = new FakeNode();

        TcItemArchive.Move(from, to, "FB_Moved");

        Assert.Equal(new[] { "FB_Moved" }, from.Deleted);
        Assert.Single(to.Imported);
        Assert.False(File.Exists(to.Imported[0]));
    }

    private static string ArchivePathFrom(string message)
    {
        const string marker = "archive at ";
        var i = message.IndexOf(marker, StringComparison.Ordinal);
        Assert.True(i >= 0, $"the message must name the archive path; got: {message}");
        var rest = message.Substring(i + marker.Length);
        var end = rest.IndexOf(", import", StringComparison.Ordinal);
        return end >= 0 ? rest.Substring(0, end) : rest;
    }
}
