using System.Collections.Generic;
using System.Linq;
using Xunit;

using Volt.Contracts;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.St;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Volt.Tests.Shared;

namespace Volt.Engine.Tests;

/// <summary>
/// ON PUSH, THE STATED LANGUAGE IS THE ONE SIGNAL (openspec <c>implementation-keyword</c>, <c>language-line</c>).
///
/// <para><c>%LANGUAGE ST</c> sends a body to the ST path and <c>%LANGUAGE LD|FBD</c> to network text;
/// nothing else decides. A missing language, or a language no body can state, is REFUSED BY NAME — the member and what
/// it stated — before anything is written. The body is never sniffed for the other language (openspec
/// <c>bridge-refusal-review</c> 1.1, 2.3): an ST body is ST whatever it holds, and an LD/FBD body that is no network is
/// the network reader's NETWORK_PARSE. A file that still carries the retired <c>(* @volt-implementation *)</c> comment
/// has no boundary line at all and gets the "pull the project once" refusal.</para>
///
/// <para>Every refusal here is a CREATE into an empty project, so "nothing written" is directly observable: no item
/// created, no content written.</para>
///
/// <para>A refusal is asserted to carry the whole stated LINE (<c>%LANGUAGE ST</c>), never a bare language
/// token: "ST" or "LD" is inside any upper-case word ("STATED", "FIELD"), so a substring check on it proves
/// nothing about whether the refusal names what the file stated.</para>
/// </summary>
public class LanguageLinePushTests
{
    private const string Decl = "FUNCTION_BLOCK FB_Motor\nVAR\n\ta : BOOL;\n\tout : BOOL;\nEND_VAR";
    private const string Network = "NETWORK\n  out := a;\nEND_NETWORK";

    /// <summary>One network in plain-ST network text (openspec network-text-st): what an LD/FBD body states.</summary>
    private const string PlainNetwork = "%NETWORK\nout := a;";

    /// <summary>The motor with one method, <c>DoReset</c>, whose implementation is <paramref name="methodImpl"/> —
    /// its boundary line and body, exactly as they stand in the file.</summary>
    private static string Motor(string methodImpl) =>
        $"{Decl}\n%LANGUAGE ST\nout := a;\n\nEND_FUNCTION_BLOCK\n\nMETHOD DoReset : BOOL\n{methodImpl}\nEND_METHOD\n";

    private static PushResponse Create(FakeIde ide, string source, string name = "FB_Motor.pou")
    {
        var refs = RefsService.Handle(ide);
        return BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = name, SourceText = source, IfVersion = null } },
        });
    }

    /// <summary>An UPDATE of an existing item at its current version — the push of a pulled file, edited or not.</summary>
    private static PushResponse Update(FakeIde ide, string name, string source)
    {
        var refs = RefsService.Handle(ide);
        return BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = name, SourceText = source, IfVersion = refs.Items[name] } },
        });
    }

    private static string Reason(PushResponse resp)
    {
        Assert.False(resp.Landed(), "the push must be refused");
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

        var resp = Create(ide, Motor("%LANGUAGE ST\nDoReset := TRUE;"));

        Assert.True(resp.Landed(), "push refused: " + Why(resp));
        var written = ide.WrittenContent["FB_Motor"];
        Assert.Equal("out := a;", written.Body);
        Assert.Equal("DoReset := TRUE;", written.Members.Single(m => m.Name == "DoReset").Body);
        Assert.DoesNotContain("%LANGUAGE", FakeIde.AllText(written));
    }

    [Theory]
    [InlineData("LD")]
    [InlineData("FBD")]
    public void A_body_stated_LD_or_FBD_is_read_as_network_text(string language)
    {
        var ide = new FakeIde();

        var resp = Create(ide, Motor($"%LANGUAGE {language}\n{PlainNetwork}"));

        Assert.True(resp.Landed(), "push refused: " + Why(resp));
        Assert.Contains("FB_Motor", ide.CreatedItems);

        // WHAT reached the IDE, not merely that something did: the method's body is network text in exactly the
        // language the file stated — not relabelled, not sent down the ST path as plain text — with its network
        // intact, and the POU's own ST body carries no keyword line.
        var written = ide.WrittenContent["FB_Motor"];
        Assert.Equal("out := a;", written.Body);
        var body = written.Members.Single(m => m.Name == "DoReset").Body ?? "";
        Assert.Equal(language, NetworkText.LanguageOf(body));
        var read = StNetworkReader.Read(body, NetworkScope.Empty);
        Assert.Equal(language == "LD" ? BodyLanguage.Ld : BodyLanguage.Fbd, read.Language);
        Assert.Single(read.Networks);
        Assert.Contains("out := a;", body);
    }

    /// <summary>"Push strips the line, so the IDE never sees it" holds for EVERY <c>%LANGUAGE</c> line, not only the first.
    /// A second one outside any comment — a member pasted with its boundary line, say — is neither the boundary
    /// nor ST the IDE can compile, and stripping it would guess at what the engineer meant. It is refused by name
    /// with nothing written; a reader that takes the first match would write it into the IDE as code.</summary>
    [Theory]
    [InlineData("%LANGUAGE ST\n%LANGUAGE ST\nDoReset := TRUE;")]
    [InlineData("%LANGUAGE ST\nDoReset := TRUE;\n%LANGUAGE ST\nDoReset := FALSE;")]
    [InlineData("%LANGUAGE ST\nDoReset := TRUE;\n  %LANGUAGE ld\n")]
    public void A_second_keyword_line_in_a_body_is_refused_naming_the_member(string methodImpl)
    {
        var ide = new FakeIde();

        var reason = Reason(Create(ide, Motor(methodImpl)));

        Assert.Contains("DoReset", reason);
        Assert.Contains("more than one %LANGUAGE line", reason);
        AssertNothingWritten(ide);
    }

    // ── 1.3 a body that contradicts its stated language ───────────────────────────────────────────

    /// <summary>NETWORK TEXT UNDER <c>%LANGUAGE ST</c> IS WRITTEN AS SENT (openspec <c>bridge-refusal-review</c>
    /// 1.1). The line states ST, so the body is ST: written into the ST implementation verbatim, and the IDE's build
    /// reports its <c>NETWORK</c> / <c>END_NETWORK</c> tokens. It used to be refused by a content sniff — a check on the
    /// CODE, which the bridge does not make.</summary>
    [Fact]
    public void Network_text_under_LANGUAGE_ST_is_written_as_sent_as_an_ST_body()
    {
        var ide = new FakeIde();

        var resp = Create(ide, Motor($"%LANGUAGE ST\n{Network}"));

        Assert.True(resp.Landed(), "push refused: " + Why(resp));
        Assert.Equal(Network, ide.WrittenContent["FB_Motor"].Members.Single(m => m.Name == "DoReset").Body);
    }

    [Theory]
    [InlineData("LD")]
    [InlineData("FBD")]
    public void ST_under_a_graphical_language_is_refused_by_the_network_reader(string language)
    {
        var ide = new FakeIde();

        var resp = Create(ide, Motor($"%LANGUAGE {language}\nDoReset := TRUE;"));

        // The NETWORK READER answers (openspec bridge-refusal-review 2.3): a body stated LD/FBD is read as network text,
        // and ST is no network — NETWORK_PARSE, with the line. The ST reader's own sniffed copy of that rule is gone.
        Assert.False(resp.Landed(), "the push must be refused");
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal(Volt.Contracts.ConflictCodes.NetworkParse, conflict.Code);
        Assert.NotNull(conflict.Line);
        AssertNothingWritten(ide);
    }

    [Fact]
    public void Network_text_under_LANGUAGE_ST_on_the_POU_body_is_written_as_sent()
    {
        var ide = new FakeIde();

        var resp = Create(ide, $"{Decl}\n%LANGUAGE ST\n{Network}\n\nEND_FUNCTION_BLOCK\n");

        Assert.True(resp.Landed(), "push refused: " + Why(resp));
        Assert.Equal(Network, ide.WrittenContent["FB_Motor"].Body);
    }

    [Fact]
    public void Network_text_in_a_getter_stated_ST_is_written_as_sent()
    {
        var ide = new FakeIde();
        var src = $"{Decl}\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n\n" +
                  $"PROPERTY Running : BOOL\nGET\n%LANGUAGE ST\n{Network}\nEND_GET\nEND_PROPERTY\n";

        var resp = Create(ide, src);

        Assert.True(resp.Landed(), "push refused: " + Why(resp));
        Assert.Equal(Network, ide.WrittenContent["FB_Motor"].Members.Single(m => m.Name == "Running").Getter!.Code);
    }

    [Theory]
    [InlineData("LD", "Running := out;")]           // ST stated LD
    public void A_getter_that_contradicts_its_language_is_refused_by_the_network_reader(string language, string code)
    {
        var ide = new FakeIde();
        var src = $"{Decl}\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n\n" +
                  $"PROPERTY Running : BOOL\nGET\n%LANGUAGE {language}\n{code}\nEND_GET\nEND_PROPERTY\n";

        var resp = Create(ide, src);

        Assert.False(resp.Landed(), "the push must be refused");
        Assert.Equal(Volt.Contracts.ConflictCodes.NetworkParse, Assert.Single(resp.Conflicts!).Code);
        AssertNothingWritten(ide);
    }

    // ── 1.4 a missing or unknown language ─────────────────────────────────────────────────────────

    [Fact]
    public void LANGUAGE_without_a_language_is_refused_naming_the_member_and_the_missing_language()
    {
        var ide = new FakeIde();

        var reason = Reason(Create(ide, Motor("%LANGUAGE\nDoReset := TRUE;")));

        Assert.Contains("DoReset", reason);
        Assert.Contains("language", reason);
        Assert.DoesNotContain("volt pull", reason);   // not a stale file: the line is there, its language is not
        AssertNothingWritten(ide);
    }

    [Fact]
    public void A_missing_language_on_the_POU_itself_is_refused_naming_the_POU()
    {
        var ide = new FakeIde();

        var reason = Reason(Create(ide, $"{Decl}\n%LANGUAGE\nout := a;\n\nEND_FUNCTION_BLOCK\n"));

        Assert.Contains("FB_Motor", reason);
        Assert.Contains("language", reason);
        AssertNothingWritten(ide);
    }

    [Fact]
    public void A_missing_language_on_a_getter_is_refused_naming_the_property()
    {
        var ide = new FakeIde();
        var src = $"{Decl}\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n\n" +
                  "PROPERTY Running : BOOL\nGET\n%LANGUAGE\nRunning := out;\nEND_GET\nEND_PROPERTY\n";

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

        var reason = Reason(Create(ide, Motor($"%LANGUAGE {language}\nDoReset := TRUE;")));

        Assert.Contains("DoReset", reason);
        Assert.Contains($"%LANGUAGE {language}", reason);
        AssertNothingWritten(ide);
    }

    // ── IMPLEMENTATION as a name ──────────────────────────────────────────────────────────────────

    /// <summary>A NAME SPELLED <c>IMPLEMENTATION</c> IS WRITTEN AS SENT (openspec <c>bridge-refusal-review</c> 1.2). IEC
    /// has no such keyword, and the body's line is a <c>%</c>-line, which no name is: a variable, an assignment to or from
    /// it, or a member called that is code the IDE compiles, so the push writes it.</summary>
    [Theory]
    [InlineData("implementation")]
    [InlineData("IMPLEMENTATION")]
    [InlineData("Implementation")]
    public void A_variable_named_IMPLEMENTATION_is_written_as_sent(string name)
    {
        var ide = new FakeIde();
        var src = $"FUNCTION_BLOCK FB_Motor\nVAR\n\t{name} : INT;\n\tx : INT;\nEND_VAR\n%LANGUAGE ST\n{name} := 1;\nx := {name};\n\nEND_FUNCTION_BLOCK\n";

        var resp = Create(ide, src);

        Assert.True(resp.Landed(), "push refused: " + Why(resp));
        var written = ide.WrittenContent["FB_Motor"];
        Assert.Equal($"FUNCTION_BLOCK FB_Motor\nVAR\n\t{name} : INT;\n\tx : INT;\nEND_VAR", written.Declaration);
        Assert.Equal($"{name} := 1;\nx := {name};", written.Body);
    }

    private const string FbHead = "FUNCTION_BLOCK FB_Motor\nVAR\nEND_VAR\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n\n";

    /// <summary>…in every naming position a POU has: a member-local variable, a member's own name, the POU's name.</summary>
    [Theory]
    [InlineData("FB_Motor.pou", "Run",              // a method-local variable
        FbHead + "METHOD Run\nVAR\n\tImplementation : INT;\nEND_VAR\n%LANGUAGE ST\nImplementation := 1;\nEND_METHOD\n")]
    [InlineData("FB_Motor.pou", "Implementation",   // a method's name
        FbHead + "METHOD Implementation : BOOL\n%LANGUAGE ST\nImplementation := TRUE;\nEND_METHOD\n")]
    [InlineData("FB_Motor.pou", "implementation",   // an action's name
        FbHead + "ACTION implementation\n%LANGUAGE ST\n\nEND_ACTION\n")]
    [InlineData("FB_Motor.pou", "Implementation",   // a property's name
        FbHead + "PROPERTY Implementation : BOOL\nGET\n%LANGUAGE ST\nImplementation := TRUE;\nEND_GET\nEND_PROPERTY\n")]
    [InlineData("Implementation.pou", null,         // the POU's own name
        "FUNCTION_BLOCK Implementation\nVAR\nEND_VAR\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n")]
    public void IMPLEMENTATION_as_a_name_is_written_as_sent_in_every_naming_position(string op, string? member, string source)
    {
        var ide = new FakeIde();

        var resp = Create(ide, source, op);

        Assert.True(resp.Landed(), "push refused: " + Why(resp));
        var written = ide.WrittenContent[op.Substring(0, op.IndexOf('.'))];
        if (member is not null) Assert.Contains(written.Members, m => m.Name == member);
    }

    /// <summary>A wrapped variable list whose name <c>IMPLEMENTATION</c> stands alone on its line is code, written as sent:
    /// the body's line is the <c>%LANGUAGE</c> line.</summary>
    [Fact]
    public void A_bare_keyword_line_in_a_POUs_declaration_is_code_written_as_sent()
    {
        var ide = new FakeIde();

        var resp = Create(ide,
            "FUNCTION_BLOCK FB_Motor\nVAR\n\ta,\n\tIMPLEMENTATION\n\t: INT;\nEND_VAR\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n");

        Assert.True(resp.Landed(), "push refused: " + Why(resp));
        Assert.Contains("\tIMPLEMENTATION\n", ide.WrittenContent["FB_Motor"].Declaration);
    }

    /// <summary>…while a <c>%LANGUAGE</c> line in a declaration is refused: an interface member has no body to open, and
    /// the line would be written into the IDE as code. That refusal is a condition of the SPLIT, not a check on the
    /// code.</summary>
    [Fact]
    public void A_boundary_line_in_an_interface_members_declaration_is_still_refused_naming_the_line()
    {
        var ide = new FakeIde();

        var reason = Reason(Create(ide,
            "INTERFACE I_Motor\n\nMETHOD Run : BOOL\nVAR_INPUT\n\tx : INT;\nEND_VAR\n%LANGUAGE ST\nEND_METHOD\n\nEND_INTERFACE\n",
            "I_Motor.itf"));

        Assert.Contains("'%LANGUAGE ST'", reason);
        AssertNothingWritten(ide);
    }

    /// <summary>…and in a GVL or a DUT, which is not read on a push but for its property lines (openspec
    /// <c>push-without-header-check</c>): a name spelled <c>IMPLEMENTATION</c> in one is the IDE's to judge, and the text
    /// is written as sent.</summary>
    [Theory]
    [InlineData("E.dut", "TYPE E :\n(\n\tIMPLEMENTATION,\n\tB\n);\nEND_TYPE")]             // an enum value
    [InlineData("S.dut", "TYPE S :\nSTRUCT\n\timplementation : INT;\nEND_STRUCT\nEND_TYPE")] // a struct member
    [InlineData("E.dut", "TYPE E :\n(\n\ta,\n\tIMPLEMENTATION\n);\nEND_TYPE")]               // alone on its line
    [InlineData("G.gvl", "VAR_GLOBAL\n\ta,\n\tIMPLEMENTATION\n\t: INT;\nEND_VAR")]             // a global alone on its line
    public void IMPLEMENTATION_in_a_gvl_or_a_dut_is_written_as_sent(string op, string source)
    {
        var ide = new FakeIde();

        var resp = Create(ide, source + "\n", op);

        Assert.True(resp.Landed(), resp.Conflicts is null ? "" : string.Join("; ", resp.Conflicts.Select(c => c.Reason)));
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
    [InlineData("CFC", "%LANGUAGE ST\nx := 1;")]
    [InlineData("SFC", "%LANGUAGE ST\n\nx := 1;")]
    public void An_ST_body_over_a_read_only_chart_is_refused_and_the_chart_is_kept(string language, string impl)
    {
        var ide = new FakeIde(new FakeIde.Item("FB_Chart", ItemKind.PlcPou, "", true, ChartDecl, "", language, null));

        var reason = Reason(Update(ide, "FB_Chart.pou", $"{ChartDecl}\n{impl}\n\nEND_FUNCTION_BLOCK\n"));

        Assert.Contains(language, reason);
        Assert.Empty(ide.WrittenContent);
        Assert.Equal(PropertyLines.UnsupportedLine(language), ide.ReadContent(new ItemRef("FB_Chart")).Body);
    }

    /// <summary>A read-only line under a language Volt reads is a contradiction, not a no-op: one says the body has no
    /// text form, the other that it is ST (or LD). Both are keyword lines, so the region holds two, and the refusal names
    /// the member and both lines.</summary>
    [Theory]
    [InlineData("ST", "%LANGUAGE CFC UNSUPPORTED")]
    [InlineData("LD", "%LANGUAGE LD UNSUPPORTED")]
    public void A_read_only_line_under_a_stated_language_is_refused_naming_the_member(string language, string readOnly)
    {
        var ide = new FakeIde();

        var reason = Reason(Create(ide, Motor($"%LANGUAGE {language}\n{readOnly}")));

        Assert.Contains("DoReset", reason);
        Assert.Contains($"%LANGUAGE {language}", reason);
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
        Assert.Contains("%LANGUAGE", reason);   // the refusal names the line the file lacks
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

    /// <summary>The retired comment in a CURRENT file — one with its <c>%LANGUAGE</c> line — is a comment. Section 2b
    /// had every <c>(* @volt-… *)</c> comment anywhere refused naming <c>volt pull</c>, which refused current files holding
    /// one in an ST body or a declaration: a scan over the code, not a condition of the split (openspec
    /// <c>bridge-refusal-review</c> 2.1). The hint survives where it means something: inside the no-boundary refusal.</summary>
    [Theory]
    [InlineData("FUNCTION_BLOCK F\nVAR\nEND_VAR\n%LANGUAGE ST\nx := 1;\n(* @volt-implementation *)\n\nEND_FUNCTION_BLOCK\n")]
    [InlineData("FUNCTION_BLOCK F\nVAR\n(* @volt-implementation *)\nEND_VAR\n%LANGUAGE ST\nx := 1;\n\nEND_FUNCTION_BLOCK\n")]
    public void The_retired_comment_in_a_file_with_its_boundary_line_is_a_comment(string source)
    {
        var ide = new FakeIde();

        var resp = Create(ide, source, "F.pou");

        // openspec bridge-refusal-review 2.1: a file that HAS its %LANGUAGE line states its boundary, so a
        // `(* @volt-… *)` comment in it states nothing — it is a comment, written as sent. Only a file with no boundary
        // line is a file from before the keyword, and that refusal (Unmarked) names the comment as its hint.
        Assert.True(resp.Landed(), "push refused: " + Why(resp));
        Assert.Contains("(* @volt-implementation *)", FakeIde.AllText(ide.WrittenContent["F"]));
    }

    /// <summary>The same shape at a METHOD reads as a member with no body slot — its region holds nothing but comments
    /// after its declaration and states no line — and a member the push CREATES has a slot: refused, naming the line to
    /// state.</summary>
    [Fact]
    public void An_old_unsupported_member_body_is_refused_naming_the_line()
    {
        var ide = new FakeIde();

        var reason = Reason(Create(ide, Motor("(* @volt-implementation *)\n(* @volt-graphical: SFC *)")));

        Assert.Contains("'DoReset'", reason);
        Assert.Contains("%LANGUAGE ST", reason);
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
        var src = "FUNCTION_BLOCK FB_X\nVAR\nEND_VAR\n%LANGUAGE ST\nEND_FUNCTION_BLOCK\n\n" +
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
    [InlineData("METHOD DoReset : BOOL\n%FOLDER Sub\n%LANGUAGE CFC UNSUPPORTED")]  // above an UNSUPPORTED line
    [InlineData("METHOD DoReset : BOOL\n%FOLDER Sub\n%LANGUAGE ST\nDoReset := TRUE;")] // above the keyword line
    [InlineData("METHOD DoReset : BOOL\nVAR\n%FOLDER Sub\nEND_VAR\n%LANGUAGE ST\nDoReset := TRUE;")]
    public void A_FOLDER_line_in_a_members_declaration_is_refused_naming_the_member(string member)
    {
        var ide = new FakeIde();
        var src = $"{Decl}\n%LANGUAGE ST\nout := a;\n\nEND_FUNCTION_BLOCK\n\n{member}\nEND_METHOD\n";

        var reason = Reason(Create(ide, src));

        Assert.Contains("DoReset", reason);
        Assert.Contains("%FOLDER Sub", reason);
        AssertNothingWritten(ide);
    }

    [Fact]
    public void A_FOLDER_line_in_a_POUs_own_declaration_is_refused_naming_the_POU()
    {
        var ide = new FakeIde();

        var reason = Reason(Create(ide, $"{Decl}\n%FOLDER Sub\n%LANGUAGE ST\nout := a;\n\nEND_FUNCTION_BLOCK\n"));

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
        var src = $"{Decl}\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n\n" +
                  "PROPERTY Running : BOOL\n%FOLDER Sub\n// the motor runs\nGET\n%LANGUAGE ST\nRunning := out;\nEND_GET\nEND_PROPERTY\n";

        var reason = Reason(Create(ide, src));

        Assert.Contains("Running", reason);
        Assert.Contains("%FOLDER Sub", reason);
        AssertNothingWritten(ide);
    }

    /// <summary>A <c>%LANGUAGE</c> line in a DECLARATION and the real one below it: the text alone cannot say which one
    /// the engineer meant as the boundary, so the refusal names BOTH — it never takes the first and tells the engineer to
    /// remove the real one.</summary>
    [Fact]
    public void Two_LANGUAGE_lines_in_one_item_are_refused_naming_both()
    {
        var ide = new FakeIde();
        var src = "FUNCTION_BLOCK FB_Motor\nVAR\n\ta : BOOL;\n%LANGUAGE LD\nEND_VAR\n%LANGUAGE ST\na := TRUE;\n\nEND_FUNCTION_BLOCK\n";

        var reason = Reason(Create(ide, src));

        Assert.Contains("FB_Motor", reason);
        Assert.Contains("'%LANGUAGE LD'", reason);
        Assert.Contains("'%LANGUAGE ST'", reason);
        AssertNothingWritten(ide);
    }

    /// <summary>A file written before the line was renamed: its <c>IMPLEMENTATION</c> line is refused by name, saying to
    /// pull again — on a create and on an update alike, nothing written.</summary>
    [Fact]
    public void The_retired_IMPLEMENTATION_line_is_refused_saying_to_pull_again()
    {
        var ide = new FakeIde();

        var reason = Reason(Create(ide, $"{Decl}\nIMPLEMENTATION ST\nout := a;\n\nEND_FUNCTION_BLOCK\n"));

        Assert.Contains("'FB_Motor' holds 'IMPLEMENTATION ST': `IMPLEMENTATION` is no longer read — pull again (it is now `%LANGUAGE <LANG>`).", reason);
        AssertNothingWritten(ide);
    }
}
