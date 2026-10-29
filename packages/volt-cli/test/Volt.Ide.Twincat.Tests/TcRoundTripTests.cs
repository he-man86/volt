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
/// provably cannot — the text reader builds <c>new Operand(name)</c> and network text has no syntax for any of
/// them. So the writer was assigning four archive members from a model that never had values for them.</para>
///
/// <para>This drives the REAL path end to end:</para>
/// <code>
/// .TcPOU archive → TcNetworkReader → StNetworkWriter → the .fb text an engineer sees in git
///                                  → NetworkText.Validate → TcNetworkWriter.Apply → the archive again
/// </code>
/// <para>and asserts the thing that actually matters: <b>a push that changes nothing must change nothing.</b>
/// `PushService` always sends the item's own body, so a declaration-only edit — renaming a variable in the VAR
/// block — takes this exact path through every operand of every network.</para>
/// </summary>
public class TcRoundTripTests
{
    private static readonly System.Collections.Generic.IReadOnlyList<TcItemArchive.LiveText> NoLive =
        System.Array.Empty<TcItemArchive.LiveText>();

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
    /// and a view change the moment the writer started comparing the view (it now writes one, bridge-refusal-review 2.31).</summary>
    private static BodyLanguage LanguageOf(string body) =>
        string.Equals(TcArchive.ViewMode(Impl(body)), "Ld", System.StringComparison.OrdinalIgnoreCase)
            ? BodyLanguage.Ld
            : BodyLanguage.Fbd;

    /// <summary>Read the archive the way a PULL does, then parse the text back the way a PUSH does. This is the
    /// model the writer actually receives in production — not the archive-derived one.</summary>
    private static NetworkBody TextDerivedModel(string body)
    {
        var pulled = TcNetworkReader.Read(Impl(body), LanguageOf(body));
        var text = TcText.Write(pulled);
        return TcText.Validate(text, TcText.ScopeOf(pulled));
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
    [InlineData("execute-box.TcPOU")]             // an Execute box - its ST must survive a no-op push
    [InlineData("ladder-demux.TcPOU")]            // a REAL fan-out wire, drawn in XAE - never folded into a multi-output assign
    // drawn-refused-shapes (an UNCONDITIONAL JMP beside a coil, drawn by hand) pulls as the MARKER: see
    // A_body_the_text_has_no_spelling_for_pulls_as_the_marker.
    public void A_push_that_changes_nothing_changes_nothing_in_the_archive(string fixture)
    {
        var before = Body(fixture);
        var model = TextDerivedModel(before);

        var written = TcText.Apply(before, model);

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
    [InlineData("execute-box.TcPOU")]             // an Execute box - its ST must survive a no-op push
    [InlineData("ladder-demux.TcPOU")]            // a REAL fan-out wire, drawn in XAE - never folded into a multi-output assign
    // an UNCONDITIONAL JMP beside a coil, drawn by hand in XAE — a jump is a coil since 2R.5 (`JMP owrods := out := ;`)
    [InlineData("drawn-refused-shapes.TcPOU")]
    public void A_push_of_an_unchanged_body_is_not_written_back_at_all(string fixture)
    {
        var before = Body(fixture);
        Assert.Null(TcText.Apply(before, TextDerivedModel(before)));
    }


    /// <summary>A REAL FAN-OUT WIRE SURVIVES AN EDIT — the half a no-op push can never reach.
    ///
    /// <para>`ladder-demux.TcPOU` network 2 is a `BoxTreeDemux` feeding two assigns: THREE archive items, drawn
    /// in XAE. Network text v1 spelled that `LET g1 := …; a := g1; b := g1;` — and until 2026-09-22 it spelled a
    /// MULTI-OUTPUT ASSIGNMENT (one item, two coils) exactly the same way. `Unhoist` folded that spelling back
    /// into one tree so the counts would match, which repaired the assign case and FLATTENED this one. v2 spells
    /// the two apart and the writer folds neither (<c>TcInPlaceSilentNoOpTests</c> holds the other direction).</para>
    ///
    /// <para><b>Neither theory above could see it</b>, and that is why this test exists rather than another
    /// fixture row: they push an UNCHANGED body, and `Unchanged` short-circuits per network before the item
    /// count is ever compared. Only an edit reaches the compare. Verified by putting `Unhoist` back: the two
    /// theories stay green and this fails with "network 3 changes from 3 to 1 item(s)".</para>
    ///
    /// <para>Driven through the TEXT: the pulled body, read back as a push reads it, with the comment of the fan-out
    /// network edited.</para></summary>
    [Fact]
    public void An_edit_to_a_network_holding_a_real_fan_out_wire_is_not_refused()
    {
        const string fixture = "ladder-demux.TcPOU";
        var before = Body(fixture);
        var edited = TextDerivedModel(before);

        // An ordinary VALUE edit inside the fan-out network — a comment, which every network carries and
        // which changes no shape at all. The point is only to make the network COUNT as changed.
        var networks = edited.Networks.Select((n, i) => i == 2 ? n with { Comment = "edited" } : n).ToList();

        var written = TcText.Apply(before, edited with { Networks = networks });

        Assert.NotNull(written);
        Assert.Contains("BoxTreeDemux", written);   // …and the wire is still a wire
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

        TcItemArchive.MoveMember(node, "ITF1", NoLive, null, "METH", "Helpers");

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
    /// every input's <c>Formal</c> to null. The text writer renders an instance call as
    /// <c>Formal := value</c>, so a TON pulled as <c>fbTimer( := bStart,  := T#5s)</c>: which pin each argument
    /// binds to silently gone from the file committed to git, and the text then unparseable
    /// (the reader refused the empty name), so that POU could never be pushed back.</para>
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
        var text = TcText.Write(
            TcNetworkReader.Read(Impl(Body("FbCall.derived.TcPOU")), BodyLanguage.Fbd));

        Assert.Contains("IN :=", text);
        Assert.Contains("PT :=", text);
        Assert.DoesNotContain(" := ,", text);      // the empty-formal signature
        Assert.DoesNotContain("( := ", text);
    }

    /// <summary>A VIEW CHANGE IS WRITTEN (openspec bridge-refusal-review 2.31, D7): the pushed marker says FBD and the
    /// IDE's body is a ladder, so the archive's <c>DefaultViewMode</c> slot — the member the CREATE route already sets
    /// (the archive's <c>DefaultViewMode</c> slot) — takes the pushed view, and NOTHING else in the archive changes. It was refused as
    /// "nothing here writes it" while the create route wrote exactly this slot.</summary>
    [Fact]
    public void A_marker_naming_the_other_view_writes_the_view_and_nothing_else()
    {
        var before = Body("ladder.TcPOU");
        Assert.Equal(BodyLanguage.Ld, LanguageOf(before));
        var pushed = TextDerivedModel(before) with { Language = BodyLanguage.Fbd };

        var after = TcText.Apply(before, pushed);

        Assert.NotNull(after);
        Assert.Equal("Fbd", TcArchive.ViewMode(Impl(after!)));
        var was = Scalars(before);
        var now = Scalars(after!);
        var changed = was.Keys.Where(k => was[k] != now[k]).ToList();
        Assert.Equal(new[] { "DefaultViewMode" }, changed.Select(k => k.Substring(0, k.IndexOf('#'))));
    }

    /// <summary>The same view writes nothing: an unchanged push returns null, view and all.</summary>
    [Fact]
    public void The_same_view_is_not_written()
    {
        var before = Body("ladder.TcPOU");
        Assert.Null(TcText.Apply(before, TextDerivedModel(before)));
    }

    /// <summary>AN FB CALL WHOSE INSTANCE IS DECLARED THROUGH ITS LIBRARY NAMESPACE IS THE SAME BOX. The text spells
    /// only the instance, and the reader takes the box type from the declaration — <c>t : Tc2_Standard.TON;</c>
    /// reads as <c>Tc2_Standard.TON</c> where the archive stores <c>TON</c>. That is one type (the writer accepts it,
    /// <c>StDeclaration.SameType</c>), and the type is no fact of the text: an edit of a pin value beside it is written
    /// in place, and the archive keeps the type it stores. Compared by exact spelling, the edit was refused as a
    /// retype and the network went to the importer, its ids re-minted.</summary>
    [Theory]
    [InlineData("Tc2_Standard.")]
    [InlineData("")]
    public void An_FB_call_typed_by_its_declarations_spelling_is_edited_in_place(string qualifier)
    {
        var before = Body("FbCall.derived.TcPOU");
        var model = TextDerivedModel(before);
        var ton = model.Networks.SelectMany(n => n.Trees).SelectMany(Boxes).Single(b => b.Instance is not null);
        var leaf = ton.Inputs.Select(i => i.Value).OfType<Leaf>().First();
        var edited = Map(model, n => n is Box b && ReferenceEquals(b, ton)
            ? b with
            {
                Type = qualifier + b.Type.ToLowerInvariant(),
                Inputs = b.Inputs.Select(i => ReferenceEquals(i.Value, leaf)
                    ? i with { Value = leaf with { Operand = leaf.Operand with { Text = "renamed" } } } : i).ToList(),
            }
            : n);

        var written = TcText.Apply(before, edited);

        Assert.NotNull(written);
        // The archive keeps the type it stores, byte for byte.
        Assert.Equal(new[] { "\"AND\"", "\"TON\"" },
            XElement.Parse(written!).Descendants("v").Where(v => (string?)v.Attribute("n") == "BoxType")
                .Select(v => v.Value).OrderBy(v => v, StringComparer.Ordinal));
        Assert.Contains("renamed", written);
    }

    private static NetworkBody Map(NetworkBody body, Func<Node, Node> f) =>
        body with { Networks = body.Networks.Select(n => n with { Trees = n.Trees.Select(t => MapNode(t, f)).ToList() }).ToList() };

    private static Node MapNode(Node n, Func<Node, Node> f) => f(n) switch
    {
        Box b => b with { Inputs = b.Inputs.Select(i => i with { Value = MapNode(i.Value, f) }).ToList() },
        Assign a => a with { Value = MapNode(a.Value, f) },
        var m => m,
    };

    /// <summary>And the pulled text is PARSEABLE, which is the half that made such a POU permanently
    /// unpushable: an empty pin name makes the reader throw "expected a name at: :=".</summary>
    [Fact]
    public void An_FB_call_pulls_as_text_that_can_be_pushed_back()
    {
        var text = TcText.Write(
            TcNetworkReader.Read(Impl(Body("FbCall.derived.TcPOU")), BodyLanguage.Fbd));

        var ex = Record.Exception(() => TcText.Validate(text,
            TcText.ScopeOf(TcNetworkReader.Read(Impl(Body("FbCall.derived.TcPOU")), BodyLanguage.Fbd))));
        Assert.True(ex is null, "a pulled FB call cannot be pushed back: " + ex?.Message + " | " + text);
    }

    /// <summary>AN EXECUTE BOX'S ST IS NEVER SILENTLY DROPPED.
    ///
    /// <para>A CODESYS Execute box carries raw ST on the box itself, and the archive records that with
    /// <c>ProvidesSTSnippet</c> + <c>STSnippet</c> — both measured members of <c>BoxTreeBox</c> (DIALECT N4).
    /// The reader hard-coded <c>StCode</c> to null and never looked at either, so
    /// the text writer's Execute arm could not fire and the box rendered as a bare
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
    /// engineer got no file at all — only a number in the "N unreadable" tally. The pull now shows the refusal as
    /// the network's UNSUPPORTED line (<c>ReadShown</c>, below). This strict reader's contract is unchanged, which is why
    /// this test is.</para></summary>
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

        TcItemArchive.MoveMember(node, "ITF1", NoLive, null, "METH", "Helpers");

        Assert.NotNull(node.LastImported);
        Assert.Contains("FolderPath=\"Helpers", node.LastImported!);
    }

    /// <summary>…AND THE PULL SHOWS THAT REFUSAL AS THE ONE NETWORK'S <c>UNSUPPORTED</c> LINE, NOT A MISSING POU (openspec
    /// ld-fbd-coverage 1b.4). The driver used to pre-scan the archive for the box and hide the whole body; the reader's
    /// per-network read (<c>ReadShown</c>, CODESYS's rule too) now keeps every other network editable and shows this
    /// one by the refusal's name. An ordinary ladder shows no such line.</summary>
    [Fact]
    public void An_unreadable_Execute_box_is_its_networks_UNSUPPORTED_line()
    {
        var shown = TcNetworkReader.ReadShown(Impl(Body("ExecuteBox.derived.TcPOU")), BodyLanguage.Fbd);
        Assert.Contains(shown.Networks, n => n.Unsupported == "an Execute box whose ST cannot be read");
        Assert.All(shown.Networks.Where(n => n.Unsupported is not null), n => Assert.Empty(n.Trees));
    }

    [Theory]
    [InlineData("POU_PBD.TcPOU")]
    [InlineData("FanOut.TcPOU")]
    public void An_ordinary_body_shows_no_UNSUPPORTED_network(string fixture)
    {
        Assert.All(TcNetworkReader.ReadShown(Impl(Body(fixture)), BodyLanguage.Fbd).Networks, n => Assert.Null(n.Unsupported));
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

        var written = TcText.Apply(before, swapped);
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
        else if (n is Assign a) foreach (var x in Boxes(a.Value)) yield return x;
    }

    /// <summary>The same body with every named box's inputs reversed — formals and values together.</summary>
    private static NetworkBody Swap(NetworkBody body) =>
        body with { Networks = body.Networks.Select(n => n with { Trees = n.Trees.Select(SwapNode).ToList() }).ToList() };

    private static Node SwapNode(Node n) => n switch
    {
        Box b when b.Inputs.Any(i => !string.IsNullOrEmpty(i.Formal)) =>
            b with { Inputs = b.Inputs.Reverse().ToList() },
        Box b => b with { Inputs = b.Inputs.Select(i => i with { Value = SwapNode(i.Value) }).ToList() },
        Assign a => a with { Value = SwapNode(a.Value) },
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
        var pulled = TcNetworkReader.Read(Impl(before), LanguageOf(before));
        var text = TcText.Write(pulled);
        Assert.Contains("out1", text);

        var edited = TcText.Validate(text.Replace("out1", "renamed"), TcText.ScopeOf(pulled));
        var written = TcText.Apply(before, edited);

        Assert.NotNull(written);
        Assert.Contains("\"renamed\"", written!);
        Assert.DoesNotContain("\"out1\"", written!);
    }

    /// <summary>A BOX'S OUTPUT PIN BEHIND AN <c>ENO</c> SLOT — the alignment case, and the one no fixture had.
    ///
    /// <para><c>OutputItems</c> is index-aligned with <c>OutputParam/Names</c>, and the <c>ENO</c> echo sits in
    /// slot 0 as a NULL (<c>&lt;n /&gt;</c>). <c>TcArchive.List</c> drops nulls, so reading through it
    /// compacted the list and every later pin took its neighbour's name — or, with one pin wired, was dropped
    /// outright. The CODESYS twin reads raw for exactly this reason; the TwinCAT arm shipped through the
    /// compacting accessor while its own doc comment claimed the two shared the rule.</para>
    ///
    /// <para><b>Nothing caught it.</b> Every other TC fixture has <c>Names = [""]</c>, so
    /// <c>Box.HasEnoSlot</c> was false in all of them and the skip never ran — deleting the body of
    /// <c>WriteBoxOutputs</c> left the suite green. This fixture is `FbCall.derived.TcPOU` with the two output
    /// slots the vendor gives a box that shows EN/ENO: the null echo, then the wired pin.</para></summary>
    [Fact]
    public void A_pin_behind_the_ENO_slot_keeps_its_own_name()
    {
        var model = TcNetworkReader.Read(Impl(Body("EnoSlot.derived.TcPOU")), BodyLanguage.Fbd);

        var box = model.Networks.SelectMany(n => n.Trees).SelectMany(Boxes).Single(b => b.Outputs.Count > 0);
        var pin = Assert.Single(box.Outputs);
        Assert.Equal("oResult", pin.Formal);      // not "ENO", and not null
        Assert.Equal("wiredPin", pin.Value.Text);
    }

    /// <summary>A VARIABLE STORED ON THE ENO SLOT OF AN FB WITHOUT EN IS THE FB'S OWN `ENO` PIN, never dropped: an ENO output
    /// with no EN is an FB's declared output (v2.1, X9), so the pull spells it as a pin, <c>ENO =&gt; v</c>, and the unchanged
    /// text pushes back as no change at all. The fixture is <c>EnoSlot.derived.TcPOU</c> (a TON with an ENO output and no
    /// EN) with its null echo replaced by a copy of the wired pin's operand.</summary>
    [Fact]
    public void A_variable_on_the_ENO_slot_of_an_FB_without_EN_is_its_ENO_pin_not_dropped()
    {
        var before = EnoWired(withEn: false);
        var pulled = TcNetworkReader.Read(Impl(before), BodyLanguage.Fbd);
        var text = TcText.Write(pulled);

        Assert.Contains("ENO => enoFlag", text);
        Assert.Null(TcText.Apply(before, TcText.Validate(text, TcText.ScopeOf(pulled))));
    }

    /// <summary>…and ON A BOX WITH EN IT IS THE NAMED ENO PIN (P5, 2R.5 awkward-sweep #23), the parity twin of CODESYS's
    /// <c>A_variable_wired_on_the_ENO_slot_is_the_named_ENO_pin_not_dropped</c>: pulled, the unchanged text pushes back as
    /// no change at all.</summary>
    [Fact]
    public void A_variable_on_the_ENO_slot_is_the_named_ENO_pin_not_dropped()
    {
        var before = EnoWired(withEn: true);
        var pulled = TcNetworkReader.Read(Impl(before), BodyLanguage.Fbd);
        var text = TcText.Write(pulled);

        Assert.Contains("ENO => enoFlag", text);
        Assert.Null(TcText.Apply(before, TcText.Validate(text, TcText.ScopeOf(pulled))));
    }

    /// <summary>…its deletion is refused, never a silent no-op: the in-place write never visited the ENO slot, so removing
    /// `ENO => enoFlag` wrote nothing, the push reported success and the IDE kept the variable.</summary>
    [Fact]
    public void Dropping_the_named_ENO_pin_is_refused_rather_than_ignored()
    {
        var before = EnoWired(withEn: true);
        var pulled = TcNetworkReader.Read(Impl(before), BodyLanguage.Fbd);
        var text = TcText.Write(pulled);
        Assert.Contains("ENO => enoFlag", text);
        var dropped = text.Replace(", ENO => enoFlag", "").Replace("ENO => enoFlag, ", "");
        Assert.NotEqual(text, dropped);

        var without = TcText.Validate(dropped, TcText.ScopeOf(pulled, EnoSlotFb));

        var ex = Assert.ThrowsAny<System.Exception>(() => TcText.Apply(before, without, EnoSlotFb));
        Assert.Contains("output pin 'ENO'", ex.Message);
    }

    /// <summary>…and its retarget is written onto the ENO slot, where the IDE stores it.</summary>
    [Fact]
    public void Retargeting_the_named_ENO_pin_writes_the_ENO_slot()
    {
        var before = EnoWired(withEn: true);
        var pulled = TcNetworkReader.Read(Impl(before), BodyLanguage.Fbd);
        var text = TcText.Write(pulled);

        var written = TcText.Apply(before, TcText.Validate(text.Replace("ENO => enoFlag", "ENO => wiredPin"), TcText.ScopeOf(pulled, EnoSlotFb)), EnoSlotFb);

        Assert.NotNull(written);
        var slots = Impl(written!).Descendants("l2").First(l => (string?)l.Attribute("n") == "OutputItems").Elements().ToList();
        Assert.Equal("\"wiredPin\"", slots[0].Elements("v").Single(v => (string?)v.Attribute("n") == "Operand").Value);
    }

    /// <summary>The block <c>EnoSlot.derived.TcPOU</c>'s box calls, as its declaration would state it — inputs IN, PT, one
    /// output oResult (its ENO is the shown one): a push reads its callee's declaration (network-output-member).</summary>
    private static readonly System.Collections.Generic.Dictionary<string, CalleeSignature> EnoSlotFb =
        new() { ["TON"] = new(CalleeShape.Block, new[] { "IN", "PT" }, new[] { "oResult" }) };

    /// <summary><c>EnoSlot.derived.TcPOU</c>'s NWL body with a variable on the ENO slot (its null echo replaced by a copy of
    /// the wired pin's operand, named <c>enoFlag</c>) and, <paramref name="withEn"/>, the enable a box showing EN/ENO holds:
    /// <c>EN</c> first in the input names and an input slot 0 wired to <c>go</c>.</summary>
    private static string EnoWired(bool withEn)
    {
        var nwl = XElement.Parse(Body("EnoSlot.derived.TcPOU"), LoadOptions.PreserveWhitespace);
        var box = nwl.Descendants("o").First(o => o.Elements("v").Any(v => (string?)v.Attribute("n") == "BoxType" && v.Value == "\"TON\""));
        var slots = box.Descendants("l2").First(l => (string?)l.Attribute("n") == "OutputItems");
        var echo = slots.Elements().First();
        Assert.Equal("n", echo.Name.LocalName);                    // the fixture's null ENO echo
        var wired = new XElement(slots.Elements().Skip(1).First());
        wired.Elements("v").Single(v => (string?)v.Attribute("n") == "Operand").Value = "\"enoFlag\"";
        echo.ReplaceWith(wired);
        if (withEn)
        {
            var param = box.Elements("o").Single(o => (string?)o.Attribute("n") == "InputParam");
            param.Elements("l2").Single(l => (string?)l.Attribute("n") == "Names").AddFirst(new XElement("v", "EN"));
            param.Elements("l2").Single(l => (string?)l.Attribute("n") == "Types").AddFirst(new XElement("v", "BOOL"));
            var inputs = box.Elements("l2").Single(l => (string?)l.Attribute("n") == "InputItems");
            var en = new XElement(inputs.Elements("o").First());
            en.Descendants("v").First(v => (string?)v.Attribute("n") == "Operand").Value = "\"go\"";
            inputs.AddFirst(en);
            // A box SHOWS its EN/ENO by the stored flags, not by the slot names (network-text-st 2.2, `Box.ShowsEnable`):
            // the fixture's TON stores both false, so the enabled box this describes states them true, as the vendor does.
            box.Elements("v").Single(v => (string?)v.Attribute("n") == "EN").Value = "true";
            box.Elements("v").Single(v => (string?)v.Attribute("n") == "ENO").Value = "true";
        }
        return nwl.ToString(SaveOptions.DisableFormatting);
    }

    /// <summary>…and it survives the round trip to text and back, so the `=>` form carries the right name.</summary>
    [Fact]
    public void A_pin_behind_the_ENO_slot_round_trips_through_the_text()
    {
        var text = TcText.Write(TcNetworkReader.Read(Impl(Body("EnoSlot.derived.TcPOU")), BodyLanguage.Fbd));

        Assert.Contains("oResult => wiredPin", text);
    }

    /// <summary>DELETING a pin in the text is REFUSED, not silently ignored. The writer skipped any slot the
    /// model did not name, so removing `=> x` left the old variable driving the live PLC while the push
    /// reported success and the next pull put the line back — the exact silent no-op this file's own comment
    /// says the box-output write exists to end.</summary>
    [Fact]
    public void Dropping_a_box_output_pin_is_refused_rather_than_ignored()
    {
        var before = Body("EnoSlot.derived.TcPOU");
        var pulled = TcNetworkReader.Read(Impl(before), BodyLanguage.Fbd);
        var text = TcText.Write(pulled);
        Assert.Contains("oResult => wiredPin", text);

        var without = TcText.Validate(text.Replace(", oResult => wiredPin", "").Replace("oResult => wiredPin", ""),
                                      TcText.ScopeOf(pulled));

        var ex = Assert.ThrowsAny<System.Exception>(() => TcText.Apply(before, without));
        Assert.Contains("output pin", ex.Message);
    }
}
