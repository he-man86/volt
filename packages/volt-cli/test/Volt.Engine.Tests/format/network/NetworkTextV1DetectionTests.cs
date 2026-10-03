using Xunit;
using Volt.Engine.Format.Network;

namespace Volt.Engine.Tests;

/// <summary>
/// <see cref="NetworkText.FileHoldsV1"/>: the ONE answer to "does this file still hold network text v1", which the
/// pull's migration note asks. It looks where the reader would meet v1 — inside a graphical BODY — and only there: a
/// body that IS v1 (its first line a <c>NETWORK &lt;n&gt;</c> header), or a v2 body a clean git merge left v1
/// constructs in (a numbered header, a <c>LET</c> statement). A line spelled like a v1 header anywhere else (a
/// declaration's comment, ST) is no v1 text.
/// </summary>
public class NetworkTextV1DetectionTests
{
    /// <summary>A PROGRAM whose body is <paramref name="body"/>, as a pull writes it: a graphical body opens with its own
    /// <c>IMPLEMENTATION LD|FBD</c> line, any other body follows <c>IMPLEMENTATION ST</c>.</summary>
    private static bool Holds(string body) => NetworkText.FileHoldsV1("P.pou",
        "PROGRAM P\nVAR\nEND_VAR\n" +
        (body.StartsWith("IMPLEMENTATION ", System.StringComparison.Ordinal) ? "" : "IMPLEMENTATION ST\n") +
        body + "\n\nEND_PROGRAM\n");

    /// <summary>WHICH FILES CAN HOLD NETWORK TEXT is a question about the file's NAME, answered here once — the wire
    /// name IS the file name, so a client asks by name and knows no kind. Only a kind with an implementation to
    /// separate (a POU and its members) can hold a body; a GVL, a DUT, an interface, a descriptor
    /// and a name no kind claims cannot. The CLI's pull note (`V1Note`) asked this with its own kind logic —
    /// `KindForWireName`, `IsSourceKind`, `ItemKind.ShapeOf` — before it asked the engine.</summary>
    [Theory]
    [InlineData("X.pou", true)]
    [InlineData("X.pou", true)]
    [InlineData("X.pou", true)]
    [InlineData("X.gvl", false)]
    [InlineData("X.dut", false)]
    [InlineData("X.struct", false)]
    [InlineData("X.itf", false)]
    [InlineData("X.task", false)]
    [InlineData("X", false)]
    [InlineData("X.Dut", false)]
    public void Whether_a_file_can_hold_network_text_is_asked_by_its_name(string wireName, bool can) =>
        Assert.Equal(can, NetworkText.CanHold(wireName));

    /// <summary>…and the v1 question is asked by the same name, so the caller never resolves a kind to pass in.</summary>
    [Fact]
    public void The_v1_question_is_asked_by_the_files_name() =>
        Assert.True(NetworkText.FileHoldsV1("P.pou",
            "PROGRAM P\nVAR\nEND_VAR\nIMPLEMENTATION LD\nNETWORK 0 LD\n  out := a;\nEND_NETWORK\n\nEND_PROGRAM\n"));

    [Fact]
    public void A_v1_body_holds_v1() =>
        Assert.True(Holds("IMPLEMENTATION LD\nNETWORK 0 LD\n  out := a;\nEND_NETWORK"));

    [Fact]
    public void A_v2_body_does_not() =>
        Assert.False(Holds(
            "IMPLEMENTATION LD\nNETWORK\n  VAR_TEMP g0 : BOOL; END_VAR\n  g0 := a;\n  out := g0;\nEND_NETWORK"));

    [Fact]
    public void A_v2_body_with_a_merged_in_v1_network_holds_v1() =>
        Assert.True(Holds(
            "IMPLEMENTATION LD\nNETWORK\n  out := a;\nEND_NETWORK\n" +
            "NETWORK 3 LD\n  y := c;\nEND_NETWORK"));

    [Fact]
    public void A_v2_body_with_a_merged_in_LET_holds_v1() =>
        Assert.True(Holds(
            "IMPLEMENTATION LD\nNETWORK TITLE: \"Digital inputs\"\n// read\nLET en1 := TRUE;\nout := en1;\nEND_NETWORK"));

    /// <summary>The words only count as the reader reads them: an ST snippet in an EXECUTE box is verbatim ST, and a
    /// <c>//</c> comment is a comment.</summary>
    [Fact]
    public void The_v1_words_inside_a_comment_or_an_EXECUTE_body_are_not_v1() =>
        Assert.False(Holds(
            "IMPLEMENTATION FBD\nNETWORK\n// NETWORK 3 was here\n// LET it be\nEXECUTE\n  LET := 1;\nEND_EXECUTE\nEND_NETWORK"));

    /// <summary>The reader refuses <c>LET</c> where a STATEMENT starts, and only there: a pin named <c>Let</c> in a
    /// box call laid over several lines is a pin, and the push accepts the body. Counting every line-start
    /// <c>LET</c> told the engineer to throw a pushable edit away.</summary>
    [Fact]
    public void A_pin_named_Let_on_its_own_line_is_not_v1()
    {
        const string decl = "PROGRAM P\nVAR\n  f : FB;\n  x : BOOL;\nEND_VAR\n";
        const string body = "IMPLEMENTATION FBD\nNETWORK\nf(\n  Let := x);\nEND_NETWORK";
        var scope = NetworkScope.FromDeclarations(decl,
            n => n == "FB" ? "FUNCTION_BLOCK FB\nVAR_INPUT\n  Let : BOOL;\nEND_VAR\n" : null,
            () => System.Array.Empty<string>(), n => n == "FB" ? Volt.Engine.Item.ItemKind.Kinds.Pou : null, Scopes.RefusedPouName);
        Assert.True(NetworkTextGate.Validate(body, scope).Ok);   // the premise: the push accepts it
        Assert.False(NetworkText.FileHoldsV1("P.pou", decl + body + "\n\nEND_PROGRAM\n"));
    }

    /// <summary>…and it refuses <c>LET</c> at a statement start that is not a line start.</summary>
    [Fact]
    public void A_LET_after_a_statement_on_the_same_line_holds_v1() =>
        Assert.True(Holds("IMPLEMENTATION FBD\nNETWORK\nx := a; LET g1 := b;\nEND_NETWORK"));

    /// <summary>The reader refuses a number ANYWHERE on a NETWORK header's line as a v1 header, not only right after
    /// the word.</summary>
    [Fact]
    public void A_number_later_on_a_header_line_holds_v1() =>
        Assert.True(Holds("IMPLEMENTATION FBD\nNETWORK TITLE: \"t\" 3\nx := a;\nEND_NETWORK"));

    /// <summary>A lexical error that swallows the rest of the text (an unclosed backtick) does not hide a v1
    /// construct on a later line: the push refuses the backtick first, and once it is fixed refuses the v1 — by which
    /// time a re-pull changes nothing, so the note must name the file now.</summary>
    [Fact]
    public void An_unclosed_backtick_does_not_hide_a_later_LET() =>
        Assert.True(Holds("IMPLEMENTATION LD\nNETWORK\n`abc\nLET x := 1;\nEND_NETWORK"));

    /// <summary>Each v1 refusal the reader makes, the detector makes: the note and the push are one rule.</summary>
    [Theory]
    [InlineData("IMPLEMENTATION FBD\nNETWORK\nx := a; LET g1 := b;\nEND_NETWORK")]
    [InlineData("IMPLEMENTATION FBD\nNETWORK TITLE: \"t\" 3\nx := a;\nEND_NETWORK")]
    [InlineData("IMPLEMENTATION LD\nNETWORK\n// c\nLET g0 := a;\nEND_NETWORK")]
    [InlineData("IMPLEMENTATION LD\nNETWORK\nx := a;\nEND_NETWORK\nLET g0 := a;")]
    [InlineData("IMPLEMENTATION LD\nNETWORK\n  VAR_TEMP g0 : BOOL; END_VAR\n  LET g0 := a;\nEND_NETWORK")]
    // v1's own en-hoist line (its writer: `IF en THEN LET m := body; END_IF`), a LET after THEN.
    [InlineData("IMPLEMENTATION LD\nNETWORK\n  IF en2 THEN LET g1 := (b OR c); END_IF\n  out := g1;\nEND_NETWORK")]
    // v1 wrote `END_IF` and `JMP l` with no `;`: a missing `;` before a LET does not hide it.
    [InlineData("IMPLEMENTATION LD\nNETWORK\n  IF c THEN JMP l; END_IF\n  LET g1 := a;\nEND_NETWORK")]
    [InlineData("IMPLEMENTATION LD\nNETWORK\n  JMP l\n  LET g1 := a;\nEND_NETWORK")]
    // v1 allowed `//` anywhere: a comment after a statement does not hide the LET after it.
    [InlineData("IMPLEMENTATION FBD\nNETWORK\nx := a;\n// guard\nLET g1 := b;\nEND_NETWORK")]
    [InlineData("IMPLEMENTATION FBD\nNETWORK\nx := a; // why\nLET g1 := b;\nEND_NETWORK")]
    public void The_reader_refuses_as_v1_exactly_what_the_detector_names(string body)
    {
        var read = NetworkTextReader.Read(body, NetworkScope.Empty);
        Assert.Contains(read.Diagnostics, d => d.Message.Contains("network text v1"));
        Assert.True(Holds(body));
    }

    /// <summary>…and the other way round: what the reader does NOT refuse as v1, the note does not name — naming it
    /// tells the engineer to throw away an edit that is one ordinary fix from pushable.</summary>
    [Theory]
    // A pin named `Let` in a call that strayed between two networks: moved into one, it is valid v2.
    [InlineData("IMPLEMENTATION FBD\nNETWORK\nx := a;\nEND_NETWORK\nf(Let := x);\nNETWORK\ny := b;\nEND_NETWORK")]
    [InlineData("IMPLEMENTATION FBD\nNETWORK\nx := a;\nEND_NETWORK\nf(\n  Let := x);\nNETWORK\ny := b;\nEND_NETWORK")]
    // A number in a field's VALUE position is a malformed field, not a v1 header: `LABEL: l3` is v2.
    [InlineData("IMPLEMENTATION FBD\nNETWORK LABEL: 3\nx := a;\nEND_NETWORK")]
    // A label named `Let` is a legal IEC label; the statement after it spells `Let out :=`, and is no v1 LET.
    [InlineData("IMPLEMENTATION LD\nNETWORK LABEL: Let\nout := a;\nEND_NETWORK")]
    public void The_detector_names_nothing_the_reader_does_not_refuse_as_v1(string body)
    {
        var read = NetworkTextReader.Read(body, NetworkScope.Empty);
        Assert.DoesNotContain(read.Diagnostics, d => d.Message.Contains("network text v1"));
        Assert.False(Holds(body));
    }

    [Fact]
    public void An_ST_body_does_not() =>
        Assert.False(Holds("x := 1;\n(* NETWORK 2 drives the conveyor *)"));

    [Fact]
    public void A_source_file_is_judged_by_its_bodies_not_its_declaration()
    {
        const string decl = "PROGRAM P\n(*\nNETWORK 2 drives the conveyor\n*)\nVAR\nEND_VAR\n";
        Assert.False(NetworkText.FileHoldsV1("P.pou", decl + "IMPLEMENTATION ST\nx := 1;\n\nEND_PROGRAM\n"));
        Assert.True(NetworkText.FileHoldsV1("P.pou",
            decl + "IMPLEMENTATION LD\nNETWORK 0 LD\n  x := a;\nEND_NETWORK\n\nEND_PROGRAM\n"));
    }

    [Fact]
    public void A_members_body_counts_too()
    {
        const string src =
            "FUNCTION_BLOCK FB\nVAR\nEND_VAR\nIMPLEMENTATION ST\nx := 1;\n\nEND_FUNCTION_BLOCK\n\n" +
            "METHOD M\nVAR\nEND_VAR\nIMPLEMENTATION FBD\nNETWORK 0 FBD\n  x := a;\nEND_NETWORK\nEND_METHOD\n";
        Assert.True(NetworkText.FileHoldsV1("F.pou", src));
    }
}
