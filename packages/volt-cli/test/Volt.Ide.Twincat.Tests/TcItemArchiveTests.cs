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
        /// <summary>A refused import that still DEPOSITS the item here first — measured on TwinCAT: <c>ImportChild</c>
        /// into <c>References</c> refused "No elements imported" and left the GVL at the PLC project root (DIALECT C2q).</summary>
        public FakeNode? DepositOnRefusal;
        /// <summary>The name an import gives a child this node already holds, the vendor's own way (<c>GVL_PackML_1</c>).</summary>
        public bool SuffixOnClash;
        public List<string> Deleted { get; } = new();
        public List<string> Imported { get; } = new();
        public List<string> Children { get; } = new();

        /// <summary>Writes a real zip, because <c>Flatten</c> opens and rewrites it — a stub that wrote nothing
        /// would make the test pass without exercising the archive handling at all.</summary>
        public void ExportChild(string name, string zipPath)
        {
            using var zip = ZipFile.Open(zipPath, ZipArchiveMode.Create);
            var entry = zip.CreateEntry($"POUs/{name}.TcPOU");
            using var w = new StreamWriter(entry.Open());
            w.Write("<TcPlcObject><POU Name=\"" + name + "\" /></TcPlcObject>");
        }

        public void DeleteChild(string name) { Deleted.Add(name); Children.Remove(name); }

        public void ImportChild(string zipPath, object a, bool b, object c)
        {
            var name = ArchivedName(zipPath);
            if (ThrowOnImport)
            {
                DepositOnRefusal?.Children.Add(name);
                throw new InvalidOperationException("No elements imported. Please check content of the archive file");
            }
            Imported.Add(zipPath);
            Children.Add(SuffixOnClash ? name + "_1" : name);
        }

        private static string ArchivedName(string zipPath)
        {
            using var zip = ZipFile.OpenRead(zipPath);
            return Path.GetFileNameWithoutExtension(zip.Entries[0].Name);
        }
    }

    /// <summary>The PLC project root the move is given, with nothing of the item's name in it.</summary>
    private static readonly Func<object, IReadOnlyCollection<string>> Names = n => ((FakeNode)n).Children;

    private static void Move(FakeNode from, FakeNode to, string name, FakeNode? root = null)
    {
        from.Children.Add(name);
        TcItemArchive.Move(from, to, name, root ?? new FakeNode(), Names);
    }

    /// <summary>A REFUSED import that still deposited the item at the PLC project root is cleaned up before the undo
    /// (openspec <c>bridge-refusal-review</c> 4d review, DIALECT C2q). Measured: <c>ImportChild</c> into <c>References</c>
    /// refused, the GVL appeared at the root, and the undo's re-import into <c>GVLs</c> came back as
    /// <c>GVL_PackML_1</c> — the push said "refused" and the next pull showed two items. The stray is the moved item's
    /// own copy (the root did not hold the name before the import), so deleting it is the undo of a step the vendor took.</summary>
    [Fact]
    public void A_refused_import_that_deposited_the_item_at_the_PLC_root_leaves_no_copy_there()
    {
        var root = new FakeNode();
        var from = new FakeNode();
        var to = new FakeNode { ThrowOnImport = true, DepositOnRefusal = root };

        var ex = Assert.Throws<InvalidOperationException>(() => Move(from, to, "GVL_PackML", root));

        Assert.Contains("No elements imported", ex.Message);              // the vendor's refusal is what the push reports
        Assert.Equal(new[] { "GVL_PackML" }, root.Deleted);               // the stray copy, deleted
        Assert.Empty(root.Children);
        Assert.Equal(new[] { "GVL_PackML" }, from.Children);              // back where it was, under its own name
    }

    /// <summary>A name the root ALREADY held before the import is not the move's copy and is never deleted.</summary>
    [Fact]
    public void A_name_the_PLC_root_held_before_the_import_is_not_touched()
    {
        var root = new FakeNode();
        root.Children.Add("GVL_PackML");                                  // a different object, there before
        var from = new FakeNode();
        var to = new FakeNode { ThrowOnImport = true };

        Assert.Throws<InvalidOperationException>(() => Move(from, to, "GVL_PackML", root));

        Assert.Empty(root.Deleted);
        Assert.Equal(new[] { "GVL_PackML" }, root.Children);
    }

    /// <summary>An undo that brings the item back under ANOTHER name is refused by name, not reported as a plain refusal:
    /// the project now holds the item as <c>GVL_PackML_1</c>, and the next pull would show it as a new item.</summary>
    [Fact]
    public void An_undo_that_restores_the_item_under_another_name_is_refused_naming_both()
    {
        var from = new FakeNode { SuffixOnClash = true };
        var to = new FakeNode { ThrowOnImport = true };

        var ex = Assert.Throws<InvalidOperationException>(() => Move(from, to, "GVL_PackML"));

        Assert.Contains("'GVL_PackML'", ex.Message);
        Assert.Contains("'GVL_PackML_1'", ex.Message);
        Assert.Contains("No elements imported", ex.Message);
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

        var ex = Assert.Throws<InvalidOperationException>(() => Move(from, to, "FB_Orphan"));

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

        Assert.Throws<InvalidOperationException>(() => Move(from, to, "FB_Restored"));

        Assert.Single(from.Imported);                       // it really was put back
        Assert.False(File.Exists(from.Imported[0]), "a recovered move must not leave its archive behind");
    }

    /// <summary>And the happy path deletes it too.</summary>
    [Fact]
    public void A_successful_move_deletes_its_archive()
    {
        var from = new FakeNode();
        var to = new FakeNode();

        Move(from, to, "FB_Moved");

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
