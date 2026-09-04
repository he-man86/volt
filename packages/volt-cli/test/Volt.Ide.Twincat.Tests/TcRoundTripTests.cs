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
    private static string Fixture(string name) => Fixtures.Path("tc-pou", name);

    /// <summary>The NWL body of a vendor-written .TcPOU, exactly as it sits in the file.</summary>
    private static string Body(string fixture) =>
        XDocument.Load(Fixture(fixture), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single().ToString(SaveOptions.DisableFormatting);

    private static XElement Impl(string body) =>
        XElement.Parse(body, LoadOptions.PreserveWhitespace)
            .DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject");

    /// <summary>The fixture's OWN view. This was hardcoded `Ld` while every fixture archive says `Fbd`, so the
    /// model built here disagreed with the body it was about to be written into — harmless while nothing looked,
    /// and a refusal the moment the writer started checking that a push cannot change a body's view.</summary>
    private static BodyLanguage LanguageOf(string body) =>
        string.Equals(TcArchive.ViewMode(Impl(body)), "Ld", System.StringComparison.OrdinalIgnoreCase)
            ? BodyLanguage.Ld
            : BodyLanguage.Fbd;

    /// <summary>Read the archive the way a PULL does, then parse the text back the way a PUSH does. This is the
    /// model the writer actually receives in production — not the archive-derived one.</summary>
    private static NetworkBody TextDerivedModel(string body)
    {
        var pulled = TcNetworkReader.Read(Impl(body), LanguageOf(body));
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
    [InlineData("FbCall.derived.TcPOU")]   // an FB call - the shape a box-type refusal wrongly rejects
    [InlineData("SetCoil.derived.TcPOU")]  // a SET coil - modifiers on an assignment TARGET
    [InlineData("ResetCoil.derived.TcPOU")]       // a RESET coil - the SAME target, Flags 3 instead of 2
    [InlineData("NegatedContact.derived.TcPOU")]  // a negated contact - the commonest modifier of all
    [InlineData("MultiOutput.derived.TcPOU")]     // one value driving two coils
    [InlineData("FanOut.TcPOU")]                  // a box with a REAL output item - see the note on this row
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
    [InlineData("FbCall.derived.TcPOU")]
    [InlineData("SetCoil.derived.TcPOU")]
    [InlineData("ResetCoil.derived.TcPOU")]
    [InlineData("NegatedContact.derived.TcPOU")]  // a negated contact - the commonest modifier of all
    [InlineData("MultiOutput.derived.TcPOU")]     // one value driving two coils
    [InlineData("FanOut.TcPOU")]                  // a box with a REAL output item - see the note on this row
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
        private readonly string _entry;
        public PouNode(string content, string? entryName = null)
        { _content = content; _entry = entryName ?? "POUs/{0}.TcPOU"; }
        public string? LastImported { get; private set; }

        public void ExportChild(string name, string zipPath)
        {
            using var zip = System.IO.Compression.ZipFile.Open(zipPath, System.IO.Compression.ZipArchiveMode.Create);
            var entry = zip.CreateEntry(_entry.Contains("{0}") ? string.Format(_entry, name) : _entry);
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

    /// <summary>AN FB CALL KEEPS ITS PIN NAMES.
    ///
    /// <para>The archive carries them — <c>&lt;o n="InputParam" t="ParamList"&gt;&lt;l2 n="Names"&gt;</c>, a
    /// measured member of <c>BoxTreeBox</c> (DIALECT N4) — and <c>TcNetworkReader</c> never read it, hard-coding
    /// every input's <c>Formal</c> to null. <c>NetworkTextWriter</c> renders an instance call as
    /// <c>Formal := value</c>, so a TON pulled as <c>fbTimer( := bStart,  := T#5s)</c>: which pin each argument
    /// binds to silently gone from the file committed to git, and the text then unparseable
    /// (<c>NetworkTextReader.Token</c> throws on the empty name), so that POU could never be pushed back.</para>
    ///
    /// <para>CODESYS reads exactly this data (<c>CodesysNetworkReader</c>, <c>InputParams</c> -> <c>Formal</c>),
    /// so this was the same fact on the same object model, read on one vendor and dropped on the other —
    /// against the rule that both must answer identically for the same project. <c>test/e2e/oracle.test.ts</c>
    /// already pins <c>tmr(IN := a, PT := T#5S)</c> as the required shape.</para>
    ///
    /// <para>The fixture is DERIVED from the vendor's own POU_PBD.TcPOU: the repo contains no .TcPOU with a
    /// function-block call, which is exactly why this went unnoticed. Only VALUES differ — every element shape
    /// is copied verbatim from a populated ParamList in that same vendor file.</para></summary>
    [Fact]
    public void An_FB_call_keeps_its_pin_names_through_a_pull()
    {
        var text = NetworkTextWriter.Write(
            TcNetworkReader.Read(Impl(Body("FbCall.derived.TcPOU")), BodyLanguage.Fbd));

        Assert.Contains("IN :=", text);
        Assert.Contains("PT :=", text);
        Assert.DoesNotContain(" := ,", text);      // the empty-formal signature
        Assert.DoesNotContain("( := ", text);
    }

    /// <summary>And the pulled text is PARSEABLE, which is the half that made such a POU permanently
    /// unpushable: an empty pin name makes the reader throw "expected a name at: :=".</summary>
    [Fact]
    public void An_FB_call_pulls_as_text_that_can_be_pushed_back()
    {
        var text = NetworkTextWriter.Write(
            TcNetworkReader.Read(Impl(Body("FbCall.derived.TcPOU")), BodyLanguage.Fbd));

        var ex = Record.Exception(() => NetworkTextGate.Validate(text));
        Assert.True(ex is null, "a pulled FB call cannot be pushed back: " + ex?.Message + " | " + text);
    }

    /// <summary>AN EXECUTE BOX'S ST IS NEVER SILENTLY DROPPED.
    ///
    /// <para>A CODESYS Execute box carries raw ST on the box itself, and the archive records that with
    /// <c>ProvidesSTSnippet</c> + <c>STSnippet</c> — both measured members of <c>BoxTreeBox</c> (DIALECT N4).
    /// The reader hard-coded <c>StCode</c> to null and never looked at either, so
    /// <c>NetworkTextWriter</c>'s Execute arm could not fire and the box rendered as a bare
    /// <c>EXECUTE();</c>: the ST it runs absent from git, with no marker, no diagnostic, no unreadable tally,
    /// and <c>volt status</c> clean.</para>
    ///
    /// <para>Volt REFUSES rather than reads, because the archive shape of a populated <c>STSnippet</c> has never
    /// been measured on TwinCAT and guessing at a vendor serialization is what produced twenty unopenable files
    /// once already. Refusing is loud and recoverable; rendering the box without its code is neither. Every
    /// other unrepresentable shape in this reader throws, and so does this one.</para>
    ///
    /// <para><b>The refusal is right; what it USED to cost was not.</b> A throw here is isolated by
    /// <c>Versioning.SafeVersion</c> into the Unreadable sentinel, so <c>fetch</c> skipped the POU and the
    /// engineer got no file at all — only a number in the "N unreadable" tally. The driver now detects the box
    /// BEFORE the walk (<c>TcArchive.HasExecuteBox</c>) and materializes the body as a marker, the same answer
    /// it already gives CFC, SFC and IL. This reader's contract is unchanged, which is why this test is.</para></summary>
    [Fact]
    public void An_Execute_box_is_refused_rather_than_rendered_without_its_ST()
    {
        var ex = Record.Exception(() =>
            TcNetworkReader.Read(Impl(Body("ExecuteBox.derived.TcPOU")), BodyLanguage.Fbd));

        Assert.NotNull(ex);
        Assert.Contains("ST", ex!.Message, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>AN INTERFACE MEMBER CAN BE PLACED TOO — it just does not live in a <c>.TcPOU</c>.
    ///
    /// <para><c>EnclosingPouOf</c> deliberately routes an interface's methods and properties down
    /// <c>MoveMember</c>, but the rewrite only ever examined entries ending <c>.TcPOU</c>. TwinCAT stores an
    /// interface in a <c>.TcIO</c> — whose <c>&lt;Itf&gt;</c> holds exactly the <c>&lt;Method&gt;</c> and
    /// <c>&lt;Property&gt;</c> children the placement looks for — so <c>placed</c> stayed false and it threw
    /// "is not in its POU's archive" about an archive the member is in fact inside. A loud failure with a wrong
    /// diagnosis, which is its own cost: it sends whoever reads it looking in the wrong place.</para>
    ///
    /// <para>It fails BEFORE the delete, so nothing was ever destroyed by this one.</para></summary>
    [Fact]
    public void An_interface_members_folder_can_be_set()
    {
        var node = new PouNode(File.ReadAllText(Fixture("ITF1.TcIO")), entryName: "DUTs/ITF1.TcIO");

        TcItemArchive.MoveMember(node, "ITF1", "METH", "Helpers");

        Assert.NotNull(node.LastImported);
        Assert.Contains("FolderPath=\"Helpers", node.LastImported!);
    }

    /// <summary>…AND THE DRIVER TURNS THAT REFUSAL INTO A MARKER RATHER THAN A MISSING POU. This is the half
    /// that was absent: the reader was right to refuse, and nothing converted the refusal into something an
    /// engineer could see. Detection happens before the node walk, on the vendor's own flag.</summary>
    [Fact]
    public void An_Execute_box_is_detected_before_the_walk_so_the_body_can_be_a_marker()
    {
        Assert.True(TcArchive.HasExecuteBox(Impl(Body("ExecuteBox.derived.TcPOU"))));
    }

    /// <summary>And it is NARROW — an ordinary ladder must not be mistaken for one, or every graphical body on
    /// this vendor would materialize as a marker instead of as editable network text.</summary>
    [Theory]
    [InlineData("POU_PBD.TcPOU")]
    [InlineData("FanOut.TcPOU")]
    public void An_ordinary_body_is_not_mistaken_for_an_Execute_box(string fixture)
    {
        Assert.False(TcArchive.HasExecuteBox(Impl(Body(fixture))));
    }

    /// <summary>REORDERING NAMED PINS MUST MOVE THE NAMES WITH THE VALUES, not just the values.
    ///
    /// <para>Network text names a call's pins — <c>t1(IN := a, PT := pt)</c> — so writing them in the other
    /// order says the same thing. The writer placed input VALUES positionally and never wrote
    /// <c>InputParam/Names</c> at all, so the swapped values landed in slots still named <c>[IN, PT]</c>:
    /// <c>PT</c>'s value on <c>IN</c>. Nothing refused it, the text round-tripped clean, and the running
    /// program changed. CODESYS has always written these on rebuild.</para></summary>
    [Fact]
    public void Reordering_a_calls_named_pins_moves_the_names_with_the_values()
    {
        var before = Body("FbCall.derived.TcPOU");
        var model = TextDerivedModel(before);

        // Swap the two named inputs, exactly as an engineer retyping the call would.
        var swapped = Swap(model);
        var pairsBefore = Pairs(model);
        Assert.Equal(2, pairsBefore.Count);   // the fixture really does carry named pins

        var written = TcNetworkWriter.Apply(before, swapped);
        Assert.NotNull(written);

        // Read it back: every formal must still be paired with ITS OWN value.
        var after = Pairs(TcNetworkReader.Read(Impl(written!), BodyLanguage.Fbd));
        Assert.Equal(pairsBefore.OrderBy(x => x.Key).ToList(), after.OrderBy(x => x.Key).ToList());
    }

    /// <summary>Each named pin as formal -> the text of the value wired to it.</summary>
    private static System.Collections.Generic.List<System.Collections.Generic.KeyValuePair<string, string>> Pairs(NetworkBody body) =>
        body.Networks.SelectMany(n => n.Trees).SelectMany(Boxes)
            .SelectMany(b => b.Inputs)
            .Where(i => !string.IsNullOrEmpty(i.Formal))
            .Select(i => new System.Collections.Generic.KeyValuePair<string, string>(i.Formal!, Text(i.Value)))
            .ToList();

    private static string Text(Node? n) => n switch
    {
        Leaf l => l.Operand.Text,
        Box b => b.Type,
        _ => n?.GetType().Name ?? "null",
    };

    private static System.Collections.Generic.IEnumerable<Box> Boxes(Node n)
    {
        if (n is Box b) { yield return b; foreach (var i in b.Inputs) foreach (var x in Boxes(i.Value)) yield return x; }
        else if (n is Assign a && a.Value is { } v) foreach (var x in Boxes(v)) yield return x;
    }

    /// <summary>The same body with every named box's inputs reversed — formals and values together.</summary>
    private static NetworkBody Swap(NetworkBody body) =>
        body with { Networks = body.Networks.Select(n => n with { Trees = n.Trees.Select(SwapNode).ToList() }).ToList() };

    private static Node SwapNode(Node n) => n switch
    {
        Box b when b.Inputs.Any(i => !string.IsNullOrEmpty(i.Formal)) =>
            b with { Inputs = b.Inputs.Reverse().ToList() },
        Box b => b with { Inputs = b.Inputs.Select(i => i with { Value = SwapNode(i.Value) }).ToList() },
        Assign a => a with { Value = a.Value == null ? null : SwapNode(a.Value) },
        _ => n,
    };

    /// <summary>A BOX'S OUTPUT PIN, EDITED IN TEXT, REACHES THE ARCHIVE.
    ///
    /// <para>This writer used to skip a box's own outputs entirely, and the reason given was sound while it
    /// held: network text had no syntax for them, so a text-derived model's <c>Box.Outputs</c> was always
    /// empty and comparing it against the archive compared against nothing. The format spells them now
    /// (<c>ET =&gt; elapsed</c>, and the unnamed result pin as the call's assignment), so skipping stopped
    /// being neutral — it would make an engineer's edit a SILENT NO-OP, the push reporting success while the
    /// archive kept the old variable. That is the failure shape this suite exists for.</para>
    ///
    /// <para>Driven through the TEXT, not by hand-building a model, so it exercises the same path a push
    /// does: pull the fixture, rename the pin's variable in the rendered text, validate, apply.</para></summary>
    [Fact]
    public void An_edited_box_output_pin_is_written_to_the_archive()
    {
        var before = Body("FanOut.TcPOU");
        var text = NetworkTextWriter.Write(TcNetworkReader.Read(Impl(before), LanguageOf(before)));
        Assert.Contains("out1", text);

        var edited = NetworkTextGate.Validate(text.Replace("out1", "renamed"));
        var written = TcNetworkWriter.Apply(before, edited);

        Assert.NotNull(written);
        Assert.Contains("\"renamed\"", written!);
        Assert.DoesNotContain("\"out1\"", written!);
    }
}
