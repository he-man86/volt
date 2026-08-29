using System;
using System.IO;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// THE PRODUCTION ROUND TRIP, against real vendor bytes.
///
/// <para><b>Why this file exists.</b> An audit found that the writer degrades the engineer's project on every
/// push, and that the existing writer test could not see it: it feeds the writer an ARCHIVE-derived model, while
/// the push path always hands it a TEXT-derived one. Those are different shapes. An archive-derived model
/// carries an operand's <c>Flags</c>, <c>LValue</c>, <c>Type</c> and <c>SymbolComment</c>; a text-derived one
/// provably cannot — <c>NetworkTextReader</c> builds <c>new Operand(name)</c> and network text has no syntax for
/// any of them. So the writer was assigning four archive members from a model that never had values for them.</para>
///
/// <para>This drives the REAL path end to end:</para>
/// <code>
/// .TcPOU archive → TcNetworkReader → NetworkTextWriter → the .fb text an engineer sees in git
///                                  → NetworkTextGate    → TcNetworkWriter.Apply → the archive again
/// </code>
/// <para>and asserts the thing that actually matters: <b>a push that changes nothing must change nothing.</b>
/// `PushService` always sends the item's own body, so a declaration-only edit — renaming a variable in the VAR
/// block — takes this exact path through every operand of every network.</para>
/// </summary>
public class TcRoundTripTests
{
    private static string Fixture(string name)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "Volt.sln"))) dir = dir.Parent;
        Assert.True(dir != null, "could not find Volt.sln above the test binaries");
        var path = Path.Combine(dir!.FullName, "test", "Volt.Engine.Tests", "fixtures", "tc-pou", name);
        Assert.True(File.Exists(path), $"missing vendor fixture: {path}");
        return path;
    }

    /// <summary>The NWL body of a vendor-written .TcPOU, exactly as it sits in the file.</summary>
    private static string Body(string fixture) =>
        XDocument.Load(Fixture(fixture), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single().ToString(SaveOptions.DisableFormatting);

    private static XElement Impl(string body) =>
        XElement.Parse(body, LoadOptions.PreserveWhitespace)
            .DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject");

    /// <summary>Read the archive the way a PULL does, then parse the text back the way a PUSH does. This is the
    /// model the writer actually receives in production — not the archive-derived one.</summary>
    private static NetworkBody TextDerivedModel(string body)
    {
        var pulled = TcNetworkReader.Read(Impl(body), BodyLanguage.Ld);
        var text = NetworkTextWriter.Write(pulled);
        return NetworkTextGate.Validate(text);
    }

    /// <summary>Every scalar member in the archive, addressed by its path, so a diff names WHAT changed.</summary>
    private static System.Collections.Generic.Dictionary<string, string> Scalars(string body)
    {
        var map = new System.Collections.Generic.Dictionary<string, string>();
        var root = XElement.Parse(body);
        var n = 0;
        foreach (var v in root.Descendants("v"))
        {
            var name = (string?)v.Attribute("n") ?? "?";
            map[$"{name}#{n++}"] = v.Value;
        }
        return map;
    }

    /// <summary>THE INVARIANT. Pull a body, push the identical text straight back, and the archive must be
    /// untouched — every operand's declared Type, its l-value marker, its modifier bits and the engineer's
    /// symbol comments still exactly as the IDE wrote them.
    ///
    /// <para>This needs NO body edit to trigger in production: `PushService` sends the item's own body on every
    /// push, so renaming a variable in the VAR block runs this path over every operand of every network.</para></summary>
    [Theory]
    [InlineData("POU_PBD.TcPOU")]
    [InlineData("ladder.TcPOU")]
    public void A_push_that_changes_nothing_changes_nothing_in_the_archive(string fixture)
    {
        var before = Body(fixture);
        var model = TextDerivedModel(before);

        var written = TcNetworkWriter.Apply(before, model);

        // Null is the ideal answer — "nothing changed, so nothing was written". If the writer does return a
        // document, it must at least be scalar-for-scalar what it was handed.
        if (written is null) return;

        var was = Scalars(before);
        var now = Scalars(written);
        var drifted = was.Where(kv => now.TryGetValue(kv.Key, out var v) && v != kv.Value)
                         .Select(kv => $"{kv.Key}: '{kv.Value}' -> '{now[kv.Key]}'")
                         .ToList();

        Assert.True(drifted.Count == 0,
            "a no-op push rewrote live vendor state:\n  " + string.Join("\n  ", drifted));
    }

    /// <summary>And the stated contract of the writer itself: an unchanged model is not written back AT ALL.
    /// Its doc says so — "an unchanged model does not come back at all" — and that is what stops a push from
    /// rewriting ids and vendor members for no change. Measured against the model production actually
    /// supplies, not one derived from the archive it is about to be compared with.</summary>
    [Theory]
    [InlineData("POU_PBD.TcPOU")]
    [InlineData("ladder.TcPOU")]
    public void A_push_of_an_unchanged_body_is_not_written_back_at_all(string fixture)
    {
        var before = Body(fixture);
        Assert.Null(TcNetworkWriter.Apply(before, TextDerivedModel(before)));
    }

    /// <summary>MEMBER PLACEMENT MUST PRODUCE A FILE TWINCAT CAN OPEN — and this is the one path where getting
    /// that wrong is unrecoverable.
    ///
    /// <para><c>MoveMember</c> relocates a member by exporting the POU, DELETING it from the project, and
    /// re-importing the rewritten archive. Between those two steps the archive is the ONLY copy of the item, and
    /// the rollback re-imports the same bytes — so if the rewrite produces something unopenable, the move AND
    /// its undo fail on the identical cause. Nothing covered this path at all.</para>
    ///
    /// <para>It serialized through a plain <c>StringWriter</c>, which makes <c>XDocument.Save</c> declare
    /// <c>encoding="utf-16"</c>, and the caller then wrote those characters as UTF-8 — a declaration that
    /// contradicts its own bytes, which is exactly what a reader refuses.</para></summary>
    [Fact]
    public void A_placed_member_is_written_as_valid_UTF8_XML()
    {
        var node = new PouNode(File.ReadAllText(Fixture("ITF1.TcIO")));

        TcItemArchive.MoveMember(node, "ITF1", "METH", "Helpers");

        var written = node.LastImported;
        Assert.NotNull(written);
        Assert.DoesNotContain("utf-16", written, StringComparison.OrdinalIgnoreCase);

        // The thing the IDE does with it, and the thing that failed.
        var ex = Record.Exception(() => XDocument.Parse(written!));
        Assert.True(ex is null, "a placed member left the archive unparseable: " + ex?.Message);

        // …and it actually did the job it was asked to do.
        Assert.Contains("FolderPath=\"Helpers", written);
    }

    /// <summary>A stand-in for the POU's tree node, carrying REAL vendor bytes through the export/import round
    /// trip so the archive handling is genuinely exercised. Public because <c>dynamic</c> binds against the
    /// driver assembly's accessibility, not this one's.</summary>
    public sealed class PouNode
    {
        private readonly string _content;
        public PouNode(string content) { _content = content; }
        public string? LastImported { get; private set; }

        public void ExportChild(string name, string zipPath)
        {
            using var zip = System.IO.Compression.ZipFile.Open(zipPath, System.IO.Compression.ZipArchiveMode.Create);
            var entry = zip.CreateEntry($"POUs/{name}.TcPOU");
            using var w = new StreamWriter(entry.Open());
            w.Write(_content);
        }

        public void DeleteChild(string name) { }

        public void ImportChild(string zipPath, object? before, bool reconnect, object? name)
        {
            using var zip = System.IO.Compression.ZipFile.OpenRead(zipPath);
            using var r = new StreamReader(zip.Entries[0].Open());
            LastImported = r.ReadToEnd();
        }
    }

    /// <summary>A FAULTED CLASSIFICATION MUST NOT LOOK LIKE AN ITEM WITH NO KIND.
    ///
    /// <para><c>TcObjectModel.ItemType</c> swallowed every COM fault and answered <c>ItemKind.Unknown</c>. Its
    /// comment claimed "an unreadable node is skipped, never phantom-emitted" - nothing skipped it. The walk
    /// emitted the item with kind -2, nothing was appended to <c>unwalked</c>, so <c>WalkResult.Complete</c>
    /// stayed TRUE, <c>FetchService</c> did not suppress deletions, and the pull DELETED the engineer's file for
    /// an item sitting in the IDE - the exact failure <c>WalkResult</c> exists to prevent.</para>
    ///
    /// <para>It also disarmed two engine guards from below: <c>ItemLookup.Find</c> ("Refusing to report it as
    /// absent") returned null so a push CREATED an item that already exists, and <c>MemberSites.Of</c> ("No
    /// catch, deliberately") dropped a member so the next push DELETED it from the IDE. Every sibling read in
    /// the same loop lets its fault out; this one is the exception, and CODESYS's counterpart has no catch at
    /// all.</para>
    ///
    /// <para>A <c>dynamic</c> double is the whole contract here, exactly as <c>TcItemArchiveTests</c> does it:
    /// a node whose <c>ItemType</c> throws must make the read THROW, not answer a kind.</para></summary>
    [Fact]
    public void A_faulted_ItemType_throws_rather_than_answering_a_kind()
    {
        var om = new TcObjectModel();

        var ex = Record.Exception(() => om.ItemType(new FaultingNode()));

        Assert.NotNull(ex);   // it answered ItemKind.Unknown instead, and the walk emitted a phantom
    }

    /// <summary>A node whose ItemType read faults - the COM behaviour the driver must not paper over.
    /// PUBLIC because `dynamic` binds against the CALL SITE's assembly, which is the driver's.</summary>
    public sealed class FaultingNode
    {
        public int ItemType => throw new InvalidOperationException("COM fault reading ItemType");
    }
}
