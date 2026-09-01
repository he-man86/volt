using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// The gate that was missing when Volt wrote twenty <c>.TcPOU</c> files TwinCAT could not open
/// (<c>Value cannot be null. Parameter name: iILStatement</c>).
///
/// <para>The oracle is a VENDOR-WRITTEN body — <c>POU_PBD.TcPOU</c> from the fixture project, an FBD POU with
/// two networks of AND boxes, one of them disabled. Nothing here needs a live XAE: the archive is a file, and
/// the writer is pure. That is the point. This is cheap, offline, and it would have caught the corruption
/// before it reached a project.</para>
///
/// <para><b>What each test is actually asserting</b> is the writer's one rule — it creates nothing. A
/// serialization Volt cannot reproduce is a serialization Volt has no business authoring, so the first test is
/// identity, and the refusal tests are the boundary of what "edit in place" can honestly cover.</para>
/// </summary>
public class TcNetworkWriterTests
{
    // -- the oracle --------------------------------------------------------------------------------

    /// <summary>The <c>&lt;NWL&gt;</c> body of the vendor-written fixture, exactly as it sits in the file.</summary>
    private static string VendorBody()
    {
        var doc = XDocument.Load(FixturePath(), LoadOptions.PreserveWhitespace);
        var nwl = doc.Descendants("NWL").Single();
        return nwl.ToString(SaveOptions.DisableFormatting);
    }

    /// <summary>THE ORACLE, AND IT IS THIS SUITE'S OWN COPY NOW.
    ///
    /// <para>This read <c>test/TwinCAT Project14/.../POU_PBD.TcPOU</c> — a file inside the LIVE e2e project,
    /// which <c>twincat-instances.ps1</c> opens IN PLACE and which TwinCAT rewrites whenever that tier runs.
    /// An offline test's oracle cannot be a file another tier mutates: the identity this class asserts would
    /// have been re-baselined by a live run rather than broken by one. The committed fixture is byte-identical
    /// (10,997 bytes, verified at the move).</para></summary>
    private static string FixturePath() => Fixtures.Path("tc-pou", "POU_PBD.TcPOU");

    private static XElement Impl(string body) =>
        XElement.Parse(body, LoadOptions.PreserveWhitespace)
            .DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject");

    private static NetworkBody Read(string body) =>
        TcNetworkReader.Read(Impl(body), BodyLanguage.Fbd);

    // -- identity ----------------------------------------------------------------------------------

    /// <summary>THE gate. Parsing the vendor's archive and serializing it back must reproduce it exactly —
    /// whitespace included, because the archive's root carries <c>xml:space="preserve"</c> and a reader that
    /// trusts that is entitled to see what the writer left. Without this, every other test below is checking
    /// the shape of a document the IDE would already have rejected.</summary>
    [Fact]
    public void The_vendors_own_archive_survives_a_parse_and_serialize_unchanged()
    {
        var body = VendorBody();
        var again = XElement.Parse(body, LoadOptions.PreserveWhitespace).ToString(SaveOptions.DisableFormatting);
        Assert.Equal(body, again);
    }

    /// <summary>A push of exactly what is already there writes NOTHING. Returning the document would rewrite
    /// ids and vendor members for no change at all, and "no change" is the most common push there is.</summary>
    [Fact]
    public void A_push_of_the_unchanged_body_is_not_written_back()
    {
        var body = VendorBody();
        Assert.Null(TcNetworkWriter.Apply(body, Read(body)));
    }

    /// <summary>The read is not lossy in the direction that matters: what the reader saw is what a re-read of
    /// the writer's output sees. This is the round trip the corrupt files failed.</summary>
    [Fact]
    public void An_edit_round_trips_through_the_reader()
    {
        var body = VendorBody();
        var model = Read(body);
        var edited = model with { Networks = new[] { model.Networks[0] with { Title = "Interlock" } }
                                    .Concat(model.Networks.Skip(1)).ToList() };

        var written = TcNetworkWriter.Apply(body, edited);
        Assert.NotNull(written);
        Assert.Equal("Interlock", Read(written!).Networks[0].Title);
    }

    // -- the rule: nothing is created --------------------------------------------------------------

    /// <summary>The corruption in one assertion. Every element in the written document must carry EXACTLY the
    /// members the IDE gave it — no member added, none dropped, none reordered. The unopenable files failed
    /// this on four counts at once: no <c>Id</c>, no <c>InputFlags</c>, an invented <c>Flags</c> on a
    /// <c>BoxTreeOperand</c>, and a missing <c>Instance</c>.</summary>
    [Fact]
    public void An_edit_changes_no_elements_member_set_anywhere()
    {
        var body = VendorBody();
        var model = Read(body);
        var edited = model with { Networks = new[] { model.Networks[0] with { Title = "Interlock" } }
                                    .Concat(model.Networks.Skip(1)).ToList() };

        var written = TcNetworkWriter.Apply(body, edited);
        Assert.NotNull(written);
        Assert.Equal(Skeleton(body), Skeleton(written!));
    }

    /// <summary>Every element's type and member names, in document order, with the VALUES left out. Two
    /// documents with the same skeleton differ only in what an engineer typed.</summary>
    private static List<string> Skeleton(string body) =>
        XElement.Parse(body).DescendantsAndSelf()
            .Select(e => $"{e.Name.LocalName}[{(string?)e.Attribute("t")}|{(string?)e.Attribute("n")}|" +
                         $"{(string?)e.Attribute("cet")}]")
            .ToList();

    /// <summary>Ids are the archive's internal wiring. Volt does not model them, so it must not disturb
    /// them — a renumbered graph is a different graph.</summary>
    [Fact]
    public void An_edit_disturbs_no_ids()
    {
        var body = VendorBody();
        var model = Read(body);
        var edited = model with { Networks = new[] { model.Networks[0] with { Comment = "checked" } }
                                    .Concat(model.Networks.Skip(1)).ToList() };

        var written = TcNetworkWriter.Apply(body, edited);
        Assert.NotNull(written);
        Assert.Equal(Ids(body), Ids(written!));
    }

    private static List<string> Ids(string body) =>
        XElement.Parse(body).Descendants("v")
            .Where(v => (string?)v.Attribute("n") == "Id").Select(v => v.Value).ToList();

    // -- values that CAN be edited -----------------------------------------------------------------

    /// <summary>Renaming an operand is the edit this whole transport exists for, and it is expressible in
    /// place: the member is already there, only its text changes.</summary>
    [Fact]
    public void An_operand_can_be_renamed_in_place()
    {
        var body = VendorBody();
        var model = Read(body);
        var written = TcNetworkWriter.Apply(body, Rename(model, "FALSE", "bGuardClosed"));

        Assert.NotNull(written);
        Assert.Equal(Skeleton(body), Skeleton(written!));
        Assert.Contains("\"bGuardClosed\"", written);
        Assert.DoesNotContain("\"FALSE\"", written);
    }

    /// <summary>Disabling a network is a boolean the IDE already wrote. The fixture's second network is
    /// already out-commented, so this also proves the flag is read and written as one value and not
    /// inverted.</summary>
    [Fact]
    public void A_network_can_be_disabled_and_re_enabled()
    {
        var body = VendorBody();
        var model = Read(body);
        Assert.False(model.Networks[0].Disabled);
        Assert.True(model.Networks[1].Disabled);

        var flipped = model with { Networks = model.Networks.Select(n => n with { Disabled = !n.Disabled }).ToList() };
        var written = TcNetworkWriter.Apply(body, flipped);

        Assert.NotNull(written);
        var back = Read(written!);
        Assert.True(back.Networks[0].Disabled);
        Assert.False(back.Networks[1].Disabled);
    }

    // -- shape changes are refused -----------------------------------------------------------------

    [Fact]
    public void Adding_a_network_is_refused()
    {
        var body = VendorBody();
        var model = Read(body);
        var grown = model with { Networks = model.Networks.Append(model.Networks[0]).ToList() };

        var ex = Assert.Throws<NotSupportedException>(() => TcNetworkWriter.Apply(body, grown));
        Assert.Contains("number of networks changes (2 -> 3)", ex.Message);
    }

    [Fact]
    public void Adding_an_input_to_a_box_is_refused()
    {
        var body = VendorBody();
        var model = Read(body);
        var box = (Box)model.Networks[0].Trees[0];
        var grown = Replace(model, box with { Inputs = box.Inputs.Append(box.Inputs[0]).ToList() });

        var ex = Assert.Throws<NotSupportedException>(() => TcNetworkWriter.Apply(body, grown));
        Assert.Contains("from 2 to 3 input(s)", ex.Message);
    }

    /// <summary>A box's type is what the IDE resolved <c>CallType</c>, <c>InputParam</c> and
    /// <c>OutputParam</c> from. Retyping it in the text would leave an archive describing one call with
    /// another call's signature.</summary>
    [Fact]
    public void Retyping_a_box_is_refused()
    {
        var body = VendorBody();
        var model = Read(body);
        var box = (Box)model.Networks[0].Trees[0];
        var retyped = Replace(model, box with { Type = "OR" });

        var ex = Assert.Throws<NotSupportedException>(() => TcNetworkWriter.Apply(body, retyped));
        Assert.Contains("box changes from 'AND' to 'OR'", ex.Message);
    }

    /// <summary>A newly created POU has no implementation at all, so a push of a brand-new graphical body
    /// lands here. It has to REFUSE in the engineer's vocabulary rather than surface an XML parse error from
    /// deep inside the adapter - the archive is not something they ever see.</summary>
    [Fact]
    public void Creating_a_graphical_body_from_nothing_is_refused()
    {
        var model = Read(VendorBody());
        var ex = Assert.Throws<NotSupportedException>(() => TcNetworkWriter.Apply("", model));
        Assert.Contains("creates a graphical body where the IDE has none", ex.Message);
    }

    /// <summary>Turning an ST body into a ladder is the same construction by another route.</summary>
    [Fact]
    public void Replacing_a_textual_body_with_a_graphical_one_is_refused()
    {
        var model = Read(VendorBody());
        var ex = Assert.Throws<NotSupportedException>(() => TcNetworkWriter.Apply("a := b;", model));
        Assert.Contains("replaces a textual body with a graphical one", ex.Message);
    }

    /// <summary>The refusal is the same one an engineer sees, so it has to say what to do instead. A message
    /// that only says "unsupported" leaves them with a file they cannot get their edit into.</summary>
    [Fact]
    public void A_refusal_says_where_the_change_belongs()
    {
        var body = VendorBody();
        var model = Read(body);
        var grown = model with { Networks = model.Networks.Append(model.Networks[0]).ToList() };

        var ex = Assert.Throws<NotSupportedException>(() => TcNetworkWriter.Apply(body, grown));
        Assert.Contains("Make this change in the IDE and pull it.", ex.Message);
    }

    // -- helpers -----------------------------------------------------------------------------------

    private static NetworkBody Replace(NetworkBody body, Node tree) =>
        body with
        {
            Networks = new[] { body.Networks[0] with { Trees = new List<Node> { tree } } }
                .Concat(body.Networks.Skip(1)).ToList(),
        };

    private static NetworkBody Rename(NetworkBody body, string from, string to) =>
        body with { Networks = body.Networks.Select(n => n with { Trees = n.Trees.Select(t => Rename(t, from, to)).ToList() }).ToList() };

    private static Node Rename(Node n, string from, string to) => n switch
    {
        Leaf l => l with { Operand = Rename(l.Operand, from, to) },
        Box b => b with { Inputs = b.Inputs.Select(i => i with { Value = Rename(i.Value, from, to) }).ToList() },
        _ => n,
    };

    private static Operand Rename(Operand o, string from, string to) =>
        o.Text == from ? o with { Text = to } : o;

    /// <summary>A BOX NAMED IN A DIFFERENT CASE IS THE SAME BOX. IEC 61131-3 identifiers are case-insensitive,
    /// and every other identity compare on this vendor's write path was deliberately moved off ordinal for
    /// exactly that reason — <c>BeckhoffDriver.WriteContent</c> calls its Ordinal predecessor "the last Ordinal
    /// IDENTITY compare left on the wire" and names the analogue that broke it (<c>METHOD Calc</c> renamed to
    /// <c>METHOD calc</c> passed every gate above and then threw NOT_FOUND). This compare was the one left.
    ///
    /// <para>What it costs: a case-only edit of a box or instance name makes <c>Apply</c> refuse a body nobody
    /// retyped. On the push path that refusal discards the whole network to <c>RebuildNetwork</c>, regenerating
    /// the very <c>Id</c>/<c>Fixed</c>/<c>ILLines</c> this in-place writer exists to preserve — and where the
    /// network holds more than one rung the rebuild refuses outright, reporting a shape change that never
    /// happened.</para></summary>
    [Theory]
    [InlineData("and")]
    [InlineData("And")]
    [InlineData("aNd")]
    public void A_box_named_in_a_different_case_is_the_same_box(string recased)
    {
        var body = VendorBody();
        var model = Read(body);

        var edited = model with
        {
            Networks = model.Networks
                .Select(n => n with { Trees = n.Trees.Select(t => Recase(t, recased)).ToList() })
                .ToList(),
        };

        // No refusal: the box was never retyped, only spelled differently.
        var written = TcNetworkWriter.Apply(body, edited);

        // …and because nothing actually changed, the writer has nothing to write back.
        Assert.Null(written);
    }

    /// <summary>A GENUINE RETYPE IS STILL REFUSED — the case fix must not turn the guard off. `OR` is a
    /// different operator from `AND`, and the archive's CallType/InputParam/OutputParam were resolved from the
    /// old one, so rewriting the name alone would leave an archive describing one call with another's signature.</summary>
    [Fact]
    public void A_real_retype_is_still_refused()
    {
        var body = VendorBody();
        var model = Read(body);

        var edited = model with
        {
            Networks = model.Networks
                .Select(n => n with { Trees = n.Trees.Select(t => Recase(t, "OR")).ToList() })
                .ToList(),
        };

        Assert.Throws<System.NotSupportedException>(() => TcNetworkWriter.Apply(body, edited));
    }

    /// <summary>Respell every AND box's type, leaving everything else alone.</summary>
    private static Node Recase(Node n, string spelling) => n switch
    {
        Box b when string.Equals(b.Type, "AND", System.StringComparison.OrdinalIgnoreCase) =>
            b with { Type = spelling, Inputs = b.Inputs.Select(i => i with { Value = Recase(i.Value, spelling) }).ToList() },
        Box b => b with { Inputs = b.Inputs.Select(i => i with { Value = Recase(i.Value, spelling) }).ToList() },
        Assign a => a with { Value = a.Value == null ? null : Recase(a.Value, spelling) },
        _ => n,
    };
}
