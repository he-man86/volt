using System.Collections.Generic;
using System.Linq;
using Xunit;

using Volt.Contracts;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.St;
using Volt.Engine.Item;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

/// <summary>
/// ON PUSH, THE STATED LANGUAGE IS THE ONE SIGNAL (openspec <c>implementation-keyword</c>).
///
/// <para><c>IMPLEMENTATION ST</c> sends a body to the ST path and <c>IMPLEMENTATION LD|FBD</c> to network text;
/// nothing else decides. A missing language, or a language no body can state, is REFUSED BY NAME — the member and what
/// it stated — before anything is written. The body is never sniffed for the other language (openspec
/// <c>bridge-refusal-review</c> 1.1, 2.3): an ST body is ST whatever it holds, and an LD/FBD body that is no network is
/// the network reader's NETWORK_PARSE. A file that still carries the retired <c>(* @volt-implementation *)</c> comment
/// has no boundary line at all and gets the "pull the project once" refusal, naming the comment.</para>
///
/// <para>Every refusal here is a CREATE into an empty project, so "nothing written" is directly observable: no item
/// created, no content written.</para>
///
/// <para>A refusal is asserted to carry the whole stated LINE (<c>IMPLEMENTATION ST</c>), never a bare language
/// token: "ST" or "LD" is inside any upper-case word ("STATED", "FIELD"), so a substring check on it proves
/// nothing about whether the refusal names what the file stated.</para>
/// </summary>
public class ImplementationLanguagePushTests
{
    private const string Decl = "FUNCTION_BLOCK FB_Motor\nVAR\n\ta : BOOL;\n\tout : BOOL;\nEND_VAR";
    private const string Network = "NETWORK\n  out := a;\nEND_NETWORK";

    /// <summary>The motor with one method, <c>DoReset</c>, whose implementation is <paramref name="methodImpl"/> —
    /// its boundary line and body, exactly as they stand in the file.</summary>
    private static string Motor(string methodImpl) =>
        $"{Decl}\nIMPLEMENTATION ST\nout := a;\n\nEND_FUNCTION_BLOCK\n\nMETHOD DoReset : BOOL\n{methodImpl}\nEND_METHOD\n";

    private static PushResponse Create(FakeIde ide, string source, string name = "FB_Motor.pou")
    {
        var refs = RefsService.Handle(ide);
        return PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = name, SourceText = source, IfVersion = null } },
        });
    }

    /// <summary>An UPDATE of an existing item at its current version — the push of a pulled file, edited or not.</summary>
    private static PushResponse Update(FakeIde ide, string name, string source)
    {
        var refs = RefsService.Handle(ide);
        return PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = name, SourceText = source, IfVersion = refs.Items[name] } },
        });
    }

    private static string Reason(PushResponse resp)
    {
        Assert.False(resp.Accepted, "the push must be refused");
        return Assert.Single(resp.Conflicts!).Reason;
    }

    private static void AssertNothingWritten(FakeIde ide)
    {
        Assert.Empty(ide.CreatedItems);
        Assert.Empty(ide.WrittenContent);
    }

    private static string Why(PushResponse resp) => resp.Conflicts is null
        ? "(none)"
        : string.Join(" | ", resp.Conflicts.Select(c => c.Reason));

    // ── what is accepted ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void An_ST_body_is_written_as_ST_without_its_keyword_line()
    {
        var ide = new FakeIde();

        var resp = Create(ide, Motor("IMPLEMENTATION ST\nDoReset := TRUE;"));

        Assert.True(resp.Accepted, "push refused: " + Why(resp));
        var written = ide.WrittenContent["FB_Motor"];
        Assert.Equal("out := a;", written.Body);
        Assert.Equal("DoReset := TRUE;", written.Members.Single(m => m.Name == "DoReset").Body);
        Assert.DoesNotContain("IMPLEMENTATION", FakeIde.AllText(written));
    }

    [Theory]
    [InlineData("LD")]
    [InlineData("FBD")]
    public void A_body_stated_LD_or_FBD_is_read_as_network_text(string language)
    {
        var ide = new FakeIde();

        var resp = Create(ide, Motor($"IMPLEMENTATION {language}\n{Network}"));

        Assert.True(resp.Accepted, "push refused: " + Why(resp));
        Assert.Contains("FB_Motor", ide.CreatedItems);

        // WHAT reached the IDE, not merely that something did: the method's body is network text in exactly the
        // language the file stated — not relabelled, not sent down the ST path as plain text — with its network
        // intact, and the POU's own ST body carries no keyword line.
        var written = ide.WrittenContent["FB_Motor"];
        Assert.Equal("out := a;", written.Body);
        var body = written.Members.Single(m => m.Name == "DoReset").Body ?? "";
        Assert.Equal(language, NetworkText.LanguageOf(body));
        var read = NetworkTextReader.Read(body, NetworkScope.Empty);
        Assert.True(read.Ok, string.Join("\n", read.Diagnostics.Select(d => d.Code + " " + d.Message)));
        Assert.Equal(language == "LD" ? BodyLanguage.Ld : BodyLanguage.Fbd, read.Body!.Language);
        Assert.Single(read.Body.Networks);
        Assert.Contains("out := a;", body);
    }

    /// <summary>"Push strips the line, so the IDE never sees it" holds for EVERY keyword line, not only the first.
    /// A second one outside any comment — a member pasted with its boundary line, say — is neither the boundary
    /// nor ST the IDE can compile, and stripping it would guess at what the engineer meant. It is refused by name
    /// with nothing written; a reader that takes the first match would write it into the IDE as code.</summary>
    [Theory]
    [InlineData("IMPLEMENTATION ST\nIMPLEMENTATION ST\nDoReset := TRUE;")]
    [InlineData("IMPLEMENTATION ST\nDoReset := TRUE;\nIMPLEMENTATION ST\nDoReset := FALSE;")]
    [InlineData("IMPLEMENTATION ST\nDoReset := TRUE;\n  implementation ld\n")]
    public void A_second_keyword_line_in_a_body_is_refused_naming_the_member(string methodImpl)
    {
        var ide = new FakeIde();

        var reason = Reason(Create(ide, Motor(methodImpl)));

        Assert.Contains("DoReset", reason);
        Assert.Contains("IMPLEMENTATION", reason);
        AssertNothingWritten(ide);
    }

    // ── 1.3 a body that contradicts its stated language ───────────────────────────────────────────

    /// <summary>NETWORK TEXT UNDER <c>IMPLEMENTATION ST</c> IS WRITTEN AS SENT (openspec <c>bridge-refusal-review</c>
    /// 1.1). The line states ST, so the body is ST: written into the ST implementation verbatim, and the IDE's build
    /// reports its <c>NETWORK</c> / <c>END_NETWORK</c> tokens. It used to be refused by a content sniff — a check on the
    /// CODE, which the bridge does not make.</summary>
    [Fact]
    public void Network_text_under_IMPLEMENTATION_ST_is_written_as_sent_as_an_ST_body()
    {
        var ide = new FakeIde();

        var resp = Create(ide, Motor($"IMPLEMENTATION ST\n{Network}"));

        Assert.True(resp.Accepted, "push refused: " + Why(resp));
        Assert.Equal(Network, ide.WrittenContent["FB_Motor"].Members.Single(m => m.Name == "DoReset").Body);
    }

    [Theory]
    [InlineData("LD")]
    [InlineData("FBD")]
    public void ST_under_a_graphical_language_is_refused_by_the_network_reader(string language)
    {
        var ide = new FakeIde();

        var resp = Create(ide, Motor($"IMPLEMENTATION {language}\nDoReset := TRUE;"));

        // The NETWORK READER answers (openspec bridge-refusal-review 2.3): a body stated LD/FBD is read as network text,
        // and ST is no network — NETWORK_PARSE, with the line. The ST reader's own sniffed copy of that rule is gone.
        Assert.False(resp.Accepted, "the push must be refused");
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal(Volt.Contracts.ConflictCodes.NetworkParse, conflict.Code);
        Assert.NotNull(conflict.Line);
        AssertNothingWritten(ide);
    }

    [Fact]
    public void Network_text_under_IMPLEMENTATION_ST_on_the_POU_body_is_written_as_sent()
    {
        var ide = new FakeIde();

        var resp = Create(ide, $"{Decl}\nIMPLEMENTATION ST\n{Network}\n\nEND_FUNCTION_BLOCK\n");

        Assert.True(resp.Accepted, "push refused: " + Why(resp));
        Assert.Equal(Network, ide.WrittenContent["FB_Motor"].Body);
    }

    [Fact]
    public void Network_text_in_a_getter_stated_ST_is_written_as_sent()
    {
        var ide = new FakeIde();
        var src = $"{Decl}\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n\n" +
                  $"PROPERTY Running : BOOL\nGET\nIMPLEMENTATION ST\n{Network}\nEND_GET\nEND_PROPERTY\n";

        var resp = Create(ide, src);

        Assert.True(resp.Accepted, "push refused: " + Why(resp));
        Assert.Equal(Network, ide.WrittenContent["FB_Motor"].Members.Single(m => m.Name == "Running").Getter!.Code);
    }

    [Theory]
    [InlineData("LD", "Running := out;")]           // ST stated LD
    public void A_getter_that_contradicts_its_language_is_refused_by_the_network_reader(string language, string code)
    {
        var ide = new FakeIde();
        var src = $"{Decl}\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n\n" +
                  $"PROPERTY Running : BOOL\nGET\nIMPLEMENTATION {language}\n{code}\nEND_GET\nEND_PROPERTY\n";

        var resp = Create(ide, src);

        Assert.False(resp.Accepted, "the push must be refused");
        Assert.Equal(Volt.Contracts.ConflictCodes.NetworkParse, Assert.Single(resp.Conflicts!).Code);
        AssertNothingWritten(ide);
    }

    // ── 1.4 a missing or unknown language ─────────────────────────────────────────────────────────

    [Fact]
    public void IMPLEMENTATION_without_a_language_is_refused_naming_the_member_and_the_missing_language()
    {
        var ide = new FakeIde();

        var reason = Reason(Create(ide, Motor("IMPLEMENTATION\nDoReset := TRUE;")));

        Assert.Contains("DoReset", reason);
        Assert.Contains("language", reason);
        Assert.DoesNotContain("volt pull", reason);   // not a stale file: the line is there, its language is not
        AssertNothingWritten(ide);
    }

    [Fact]
    public void A_missing_language_on_the_POU_itself_is_refused_naming_the_POU()
    {
        var ide = new FakeIde();

        var reason = Reason(Create(ide, $"{Decl}\nIMPLEMENTATION\nout := a;\n\nEND_FUNCTION_BLOCK\n"));

        Assert.Contains("FB_Motor", reason);
        Assert.Contains("language", reason);
        AssertNothingWritten(ide);
    }

    [Fact]
    public void A_missing_language_on_a_getter_is_refused_naming_the_property()
    {
        var ide = new FakeIde();
        var src = $"{Decl}\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n\n" +
                  "PROPERTY Running : BOOL\nGET\nIMPLEMENTATION\nRunning := out;\nEND_GET\nEND_PROPERTY\n";

        var reason = Reason(Create(ide, src));

        Assert.Contains("Running", reason);
        Assert.Contains("language", reason);
        AssertNothingWritten(ide);
    }

    [Theory]
    [InlineData("CFC")]
    [InlineData("SFC")]
    [InlineData("IL")]
    [InlineData("STX")]
    public void An_unknown_language_is_refused_by_name_and_never_guessed(string language)
    {
        var ide = new FakeIde();

        var reason = Reason(Create(ide, Motor($"IMPLEMENTATION {language}\nDoReset := TRUE;")));

        Assert.Contains("DoReset", reason);
        Assert.Contains($"IMPLEMENTATION {language}", reason);
        AssertNothingWritten(ide);
    }

    // ── IMPLEMENTATION as a name ──────────────────────────────────────────────────────────────────

    /// <summary>A NAME SPELLED LIKE THE BOUNDARY KEYWORD IS WRITTEN AS SENT (openspec <c>bridge-refusal-review</c> 1.2).
    /// IEC has no keyword <c>IMPLEMENTATION</c>; it is Volt's line, and only a line of that line's SHAPE could be misread
    /// as a boundary — those keep their owners' refusals (two such lines in one region; one in a declaration). A variable,
    /// an assignment to or from it, or a member called that is no such line: the IDE compiles it, so the push writes it.
    /// It used to be refused as "reserved" by a scan over the whole text's code — a check on the code.</summary>
    [Theory]
    [InlineData("implementation")]
    [InlineData("IMPLEMENTATION")]
    [InlineData("Implementation")]
    public void A_variable_named_IMPLEMENTATION_is_written_as_sent(string name)
    {
        var ide = new FakeIde();
        var src = $"FUNCTION_BLOCK FB_Motor\nVAR\n\t{name} : INT;\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\n{name} := 1;\nx := {name};\n\nEND_FUNCTION_BLOCK\n";

        var resp = Create(ide, src);

        Assert.True(resp.Accepted, "push refused: " + Why(resp));
        var written = ide.WrittenContent["FB_Motor"];
        Assert.Equal($"FUNCTION_BLOCK FB_Motor\nVAR\n\t{name} : INT;\n\tx : INT;\nEND_VAR", written.Declaration);
        Assert.Equal($"{name} := 1;\nx := {name};", written.Body);
    }

    private const string FbHead = "FUNCTION_BLOCK FB_Motor\nVAR\nEND_VAR\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n\n";

    /// <summary>…in every naming position a POU has: a member-local variable, a member's own name, the POU's name.</summary>
    [Theory]
    [InlineData("FB_Motor.pou", "Run",              // a method-local variable
        FbHead + "METHOD Run\nVAR\n\tImplementation : INT;\nEND_VAR\nIMPLEMENTATION ST\nImplementation := 1;\nEND_METHOD\n")]
    [InlineData("FB_Motor.pou", "Implementation",   // a method's name
        FbHead + "METHOD Implementation : BOOL\nIMPLEMENTATION ST\nImplementation := TRUE;\nEND_METHOD\n")]
    [InlineData("FB_Motor.pou", "implementation",   // an action's name
        FbHead + "ACTION implementation\nIMPLEMENTATION ST\n\nEND_ACTION\n")]
    [InlineData("FB_Motor.pou", "Implementation",   // a property's name
        FbHead + "PROPERTY Implementation : BOOL\nGET\nIMPLEMENTATION ST\nImplementation := TRUE;\nEND_GET\nEND_PROPERTY\n")]
    [InlineData("Implementation.pou", null,         // the POU's own name
        "FUNCTION_BLOCK Implementation\nVAR\nEND_VAR\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n")]
    public void IMPLEMENTATION_as_a_name_is_written_as_sent_in_every_naming_position(string op, string? member, string source)
    {
        var ide = new FakeIde();

        var resp = Create(ide, source, op);

        Assert.True(resp.Accepted, "push refused: " + Why(resp));
        var written = ide.WrittenContent[op.Substring(0, op.IndexOf('.'))];
        if (member is not null) Assert.Contains(written.Members, m => m.Name == member);
    }

    /// <summary>A line is the boundary only when it IS one — the keyword and a language a body states (openspec
    /// <c>bridge-refusal-review</c> D9). A wrapped variable list whose name stands alone on its line is CODE: it states no
    /// language, so the text does say which it is, and the declaration is written as sent. It used to be refused as a
    /// line of the keyword's SHAPE (the premise of this test before D9: "the text alone cannot say which it is").</summary>
    [Fact]
    public void A_bare_keyword_line_in_a_POUs_declaration_is_code_written_as_sent()
    {
        var ide = new FakeIde();

        var resp = Create(ide,
            "FUNCTION_BLOCK FB_Motor\nVAR\n\ta,\n\tIMPLEMENTATION\n\t: INT;\nEND_VAR\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n");

        Assert.True(resp.Accepted, "push refused: " + Why(resp));
        Assert.Contains("\tIMPLEMENTATION\n", ide.WrittenContent["FB_Motor"].Declaration);
    }

    /// <summary>…while a BOUNDARY line in a declaration is still refused (<c>RefuseLinesInDeclarations</c>): an interface
    /// member has no body to consume it, and the line would read back as the boundary. That refusal is a condition of
    /// the SPLIT, not a check on the code.</summary>
    [Fact]
    public void A_boundary_line_in_an_interface_members_declaration_is_still_refused_naming_the_line()
    {
        var ide = new FakeIde();

        var reason = Reason(Create(ide,
            "INTERFACE I_Motor\n\nMETHOD Run : BOOL\nVAR_INPUT\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nEND_METHOD\n\nEND_INTERFACE\n",
            "I_Motor.itf"));

        Assert.Contains("'IMPLEMENTATION ST'", reason);
        AssertNothingWritten(ide);
    }

    /// <summary>…in every file that HAS a boundary. A GVL or a DUT has none and is not read on a push at all (openspec
    /// <c>push-without-header-check</c>): a name spelled <c>IMPLEMENTATION</c> in one is the IDE's to judge, and the text
    /// is written as sent. These four rows used to sit in the theory above.</summary>
    [Theory]
    [InlineData("E.dut", "TYPE E :\n(\n\tIMPLEMENTATION,\n\tB\n);\nEND_TYPE")]             // an enum value
    [InlineData("S.dut", "TYPE S :\nSTRUCT\n\timplementation : INT;\nEND_STRUCT\nEND_TYPE")] // a struct member
    [InlineData("E.dut", "TYPE E :\n(\n\ta,\n\tIMPLEMENTATION\n);\nEND_TYPE")]               // alone on its line
    [InlineData("G.gvl", "VAR_GLOBAL\n\ta,\n\tIMPLEMENTATION\n\t: INT;\nEND_VAR")]             // a global alone on its line
    public void IMPLEMENTATION_in_a_gvl_or_a_dut_is_written_as_sent(string op, string source)
    {
        var ide = new FakeIde();

        var resp = Create(ide, source + "\n", op);

        Assert.True(resp.Accepted, resp.Conflicts is null ? "" : string.Join("; ", resp.Conflicts.Select(c => c.Reason)));
        Assert.Equal(source, ide.WrittenContent[op.Substring(0, op.IndexOf('.'))].Declaration);
    }

    // ── a body Volt cannot write ──────────────────────────────────────────────────────────────────

    // The pull, the no-op push back and code under a read-only line are ReadOnlyBodyTests' (section 2b). What stays
    // here is a stated READABLE language meeting a body the IDE holds read-only, and the files from before the change.

    private const string ChartDecl = "FUNCTION_BLOCK FB_Chart\nVAR\n\tx : INT;\nEND_VAR";

    /// <summary>An ST body stated over a chart the IDE holds read-only is no no-op: the chart cannot take an ST body,
    /// and the drivers write nothing for a read-only body, so accepting the push would drop <c>x := 1;</c> without a
    /// word. It is refused, naming the chart's language, and the IDE keeps it.</summary>
    [Theory]
    [InlineData("CFC", "IMPLEMENTATION ST\nx := 1;")]
    [InlineData("SFC", "IMPLEMENTATION ST\n\nx := 1;")]
    public void An_ST_body_over_a_read_only_chart_is_refused_and_the_chart_is_kept(string language, string impl)
    {
        var ide = new FakeIde(new FakeIde.Item("FB_Chart", ItemKind.PlcPou, "", true, ChartDecl, "", language, null));

        var reason = Reason(Update(ide, "FB_Chart.pou", $"{ChartDecl}\n{impl}\n\nEND_FUNCTION_BLOCK\n"));

        Assert.Contains(language, reason);
        Assert.Empty(ide.WrittenContent);
        Assert.Equal(ImplementationMarker.Unsupported(language), ide.ReadContent(new ItemRef("FB_Chart")).Body);
    }

    /// <summary>A read-only line under a language Volt reads is a contradiction, not a no-op: one says the body has no
    /// text form, the other that it is ST (or LD). Both are keyword lines, so the region holds two, and the refusal names
    /// the member and both lines.</summary>
    [Theory]
    [InlineData("ST", "IMPLEMENTATION CFC UNSUPPORTED")]
    [InlineData("LD", "IMPLEMENTATION LD UNSUPPORTED")]
    public void A_read_only_line_under_a_stated_language_is_refused_naming_the_member(string language, string readOnly)
    {
        var ide = new FakeIde();

        var reason = Reason(Create(ide, Motor($"IMPLEMENTATION {language}\n{readOnly}")));

        Assert.Contains("DoReset", reason);
        Assert.Contains($"IMPLEMENTATION {language}", reason);
        Assert.Contains(readOnly, reason);
        AssertNothingWritten(ide);
    }

    // ── 1.5 the retired comment ───────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("(* @volt-implementation *)\nout := a;")]
    [InlineData("(* @volt-implementation LD *)\n" + Network)]
    public void A_file_carrying_only_the_old_comment_is_refused_naming_volt_pull(string pouImpl)
    {
        var ide = new FakeIde();

        var reason = Reason(Create(ide, $"{Decl}\n{pouImpl}\n\nEND_FUNCTION_BLOCK\n"));

        Assert.Contains("volt pull", reason);
        Assert.Contains("IMPLEMENTATION", reason);   // the refusal names the line the file lacks
        Assert.Contains("(* @volt-implementation", reason);   // …and the retired comment, as the hint (2.1)
        AssertNothingWritten(ide);
    }

    [Fact]
    public void The_old_comment_on_a_member_is_refused_the_same_way()
    {
        var ide = new FakeIde();

        var reason = Reason(Create(ide, Motor("(* @volt-implementation *)\nDoReset := TRUE;")));

        Assert.Contains("volt pull", reason);
        AssertNothingWritten(ide);
    }

    /// <summary>The exact pre-change shape of a body Volt cannot write — the retired comment, THEN the old marker
    /// comment — is what the corpora hold today (<c>VltFixtureCfc.pou</c>, <c>VltFixtureSfc.pou</c>, lenze-mid
    /// <c>Mach1_MIDS.pou</c>). It is a file from before the change like any other: refused, naming <c>volt pull</c>.</summary>
    [Theory]
    [InlineData("CFC")]
    [InlineData("SFC")]
    public void An_old_unsupported_POU_body_is_refused_naming_volt_pull(string language)
    {
        var ide = new FakeIde(new FakeIde.Item("FB_Chart", ItemKind.PlcPou, "", true, ChartDecl, "", language, null));

        var reason = Reason(Update(ide, "FB_Chart.pou",
            $"{ChartDecl}\n(* @volt-implementation *)\n(* @volt-graphical: {language} *)\n\nEND_FUNCTION_BLOCK\n"));

        Assert.Contains("volt pull", reason);
        Assert.Empty(ide.WrittenContent);
        Assert.Equal(ChartDecl, ide.ReadContent(new ItemRef("FB_Chart")).Declaration);
    }

    /// <summary>The retired comment in a CURRENT file — one with its <c>IMPLEMENTATION</c> line — is a comment. Section 2b
    /// had every <c>(* @volt-… *)</c> comment anywhere refused naming <c>volt pull</c>, which refused current files holding
    /// one in an ST body or a declaration: a scan over the code, not a condition of the split (openspec
    /// <c>bridge-refusal-review</c> 2.1). The hint survives where it means something: inside the no-boundary refusal.</summary>
    [Theory]
    [InlineData("FUNCTION_BLOCK F\nVAR\nEND_VAR\nIMPLEMENTATION ST\nx := 1;\n(* @volt-implementation *)\n\nEND_FUNCTION_BLOCK\n")]
    [InlineData("FUNCTION_BLOCK F\nVAR\n(* @volt-implementation *)\nEND_VAR\nIMPLEMENTATION ST\nx := 1;\n\nEND_FUNCTION_BLOCK\n")]
    public void The_retired_comment_in_a_file_with_its_boundary_line_is_a_comment(string source)
    {
        var ide = new FakeIde();

        var resp = Create(ide, source, "F.pou");

        // openspec bridge-refusal-review 2.1: a file that HAS its IMPLEMENTATION line states its boundary, so a
        // `(* @volt-… *)` comment in it states nothing — it is a comment, written as sent. Only a file with no boundary
        // line is a file from before the keyword, and that refusal (Unmarked) names the comment as its hint.
        Assert.True(resp.Accepted, "push refused: " + Why(resp));
        Assert.Contains("(* @volt-implementation *)", FakeIde.AllText(ide.WrittenContent["F"]));
    }

    [Fact]
    public void An_old_unsupported_member_body_is_refused_naming_volt_pull()
    {
        var ide = new FakeIde();

        var reason = Reason(Create(ide, Motor("(* @volt-implementation *)\n(* @volt-graphical: SFC *)")));

        Assert.Contains("volt pull", reason);
        AssertNothingWritten(ide);
    }

    // ── section 2, data-lens review: a directive in a declaration ─────────────────────────────────

    /// <summary>The pre-change shape of a MEMBER Volt cannot write in a folder: the retired comment, <c>%FOLDER</c>, then
    /// the marker line (the old writer put the folder under the boundary comment). The directive sits between the
    /// comment and the marker, so a check that looks only at the line directly above the marker misses it: the comment
    /// and <c>%FOLDER Sub</c> land at the end of the member's DECLARATION, which the driver writes into the IDE, and the
    /// member's folder reads as none. It is a file from before the change: refused naming <c>volt pull</c>.</summary>
    [Fact]
    public void An_old_unsupported_member_body_in_a_folder_is_refused_naming_volt_pull()
    {
        var ide = new FakeIde(
            new FakeIde.Item("FB_X", ItemKind.PlcPou, "", true, "FUNCTION_BLOCK FB_X\nVAR\nEND_VAR", "", null, null, Children: new[] { "M" }),
            new FakeIde.Item("M", ItemKind.PlcMethod, "", false, "METHOD M : INT\nVAR\nEND_VAR", "", "CFC", null));
        var src = "FUNCTION_BLOCK FB_X\nVAR\nEND_VAR\nIMPLEMENTATION ST\nEND_FUNCTION_BLOCK\n\n" +
                  "METHOD M : INT\nVAR\nEND_VAR\n(* @volt-implementation *)\n%FOLDER Sub\n(* @volt-graphical: CFC *)\nEND_METHOD\n";

        var reason = Reason(Update(ide, "FB_X.pou", src));

        Assert.Contains("volt pull", reason);
        Assert.Empty(ide.WrittenContent);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("writecontent:", System.StringComparison.Ordinal));
    }

    /// <summary><c>%FOLDER</c> is Volt's directive, and its place is fixed: directly under a member's boundary (or
    /// marker) line, or as the last line of a property's (or an interface member's) declaration. Anywhere else in a
    /// declaration it is no directive — and a declaration is written into the IDE verbatim, so the line would reach
    /// the project as code while the member's folder silently read as none. Refused by name instead.</summary>
    [Theory]
    [InlineData("METHOD DoReset : BOOL\n%FOLDER Sub\nIMPLEMENTATION CFC UNSUPPORTED")]  // above an UNSUPPORTED line
    [InlineData("METHOD DoReset : BOOL\n%FOLDER Sub\nIMPLEMENTATION ST\nDoReset := TRUE;")] // above the keyword line
    [InlineData("METHOD DoReset : BOOL\nVAR\n%FOLDER Sub\nEND_VAR\nIMPLEMENTATION ST\nDoReset := TRUE;")]
    public void A_FOLDER_line_in_a_members_declaration_is_refused_naming_the_member(string member)
    {
        var ide = new FakeIde();
        var src = $"{Decl}\nIMPLEMENTATION ST\nout := a;\n\nEND_FUNCTION_BLOCK\n\n{member}\nEND_METHOD\n";

        var reason = Reason(Create(ide, src));

        Assert.Contains("DoReset", reason);
        Assert.Contains("%FOLDER Sub", reason);
        AssertNothingWritten(ide);
    }

    [Fact]
    public void A_FOLDER_line_in_a_POUs_own_declaration_is_refused_naming_the_POU()
    {
        var ide = new FakeIde();

        var reason = Reason(Create(ide, $"{Decl}\n%FOLDER Sub\nIMPLEMENTATION ST\nout := a;\n\nEND_FUNCTION_BLOCK\n"));

        Assert.Contains("FB_Motor", reason);
        Assert.Contains("%FOLDER Sub", reason);
        AssertNothingWritten(ide);
    }

    /// <summary>A property's <c>%FOLDER</c> is the LAST line of its declaration — where the writer puts it. One
    /// anywhere else in that declaration (above a comment that documents the property, say) is not the directive and
    /// is refused, rather than peeled as the folder from wherever it happened to stand.</summary>
    [Fact]
    public void A_FOLDER_line_elsewhere_in_a_property_declaration_is_refused_naming_the_property()
    {
        var ide = new FakeIde();
        var src = $"{Decl}\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n\n" +
                  "PROPERTY Running : BOOL\n%FOLDER Sub\n// the motor runs\nGET\nIMPLEMENTATION ST\nRunning := out;\nEND_GET\nEND_PROPERTY\n";

        var reason = Reason(Create(ide, src));

        Assert.Contains("Running", reason);
        Assert.Contains("%FOLDER Sub", reason);
        AssertNothingWritten(ide);
    }

    /// <summary>A keyword-shaped line in a DECLARATION (a wrapped variable list whose line reads <c>implementation ST</c>)
    /// and the real boundary below it: two lines of the keyword's shape, and the text alone cannot say which one the
    /// engineer meant as the boundary. The refusal names BOTH lines and both remedies — it used to take the first as
    /// the boundary and tell the engineer to remove the real one.</summary>
    [Fact]
    public void Two_keyword_lines_in_one_item_are_refused_naming_both()
    {
        var ide = new FakeIde();
        var src = "FUNCTION_BLOCK FB_Motor\nVAR\n\ta,\n\timplementation ST\n\t: BOOL;\nEND_VAR\nIMPLEMENTATION ST\na := TRUE;\n\nEND_FUNCTION_BLOCK\n";

        var reason = Reason(Create(ide, src));

        Assert.Contains("FB_Motor", reason);
        Assert.Contains("'implementation ST'", reason);
        Assert.Contains("'IMPLEMENTATION ST'", reason);
        Assert.Contains("reserved", reason, System.StringComparison.OrdinalIgnoreCase);
        AssertNothingWritten(ide);
    }
}
