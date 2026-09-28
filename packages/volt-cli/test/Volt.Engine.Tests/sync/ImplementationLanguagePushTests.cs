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
/// nothing else decides. A body whose text contradicts its stated language, a missing language, or a language no
/// body can state is REFUSED BY NAME — the member and what it stated — before anything is written, and never re-read
/// as the other language. A file that still carries the retired <c>(* @volt-implementation *)</c> comment has no
/// boundary line at all and gets the existing "pull the project once" refusal.</para>
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

    private static PushResponse Create(FakeIde ide, string source, string name = "FB_Motor.fb")
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

    [Fact]
    public void Network_text_under_IMPLEMENTATION_ST_is_refused_naming_the_member_and_its_language()
    {
        var ide = new FakeIde();

        var reason = Reason(Create(ide, Motor($"IMPLEMENTATION ST\n{Network}")));

        Assert.Contains("DoReset", reason);
        Assert.Contains("IMPLEMENTATION ST", reason);
        Assert.DoesNotContain("volt pull", reason);   // the file is current; the body contradicts what it states
        AssertNothingWritten(ide);
    }

    [Theory]
    [InlineData("LD")]
    [InlineData("FBD")]
    public void ST_under_a_graphical_language_is_refused_naming_the_member_and_its_language(string language)
    {
        var ide = new FakeIde();

        var reason = Reason(Create(ide, Motor($"IMPLEMENTATION {language}\nDoReset := TRUE;")));

        Assert.Contains("DoReset", reason);
        Assert.Contains($"IMPLEMENTATION {language}", reason);
        AssertNothingWritten(ide);
    }

    [Fact]
    public void Network_text_under_IMPLEMENTATION_ST_on_the_POU_body_is_refused_naming_the_POU()
    {
        var ide = new FakeIde();

        var reason = Reason(Create(ide, $"{Decl}\nIMPLEMENTATION ST\n{Network}\n\nEND_FUNCTION_BLOCK\n"));

        Assert.Contains("FB_Motor", reason);
        Assert.Contains("IMPLEMENTATION ST", reason);
        AssertNothingWritten(ide);
    }

    [Theory]
    [InlineData("ST", Network)]                     // network text stated ST
    [InlineData("LD", "Running := out;")]           // ST stated LD
    public void A_getter_that_contradicts_its_language_is_refused_naming_the_property(string language, string code)
    {
        var ide = new FakeIde();
        var src = $"{Decl}\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n\n" +
                  $"PROPERTY Running : BOOL\nGET\nIMPLEMENTATION {language}\n{code}\nEND_GET\nEND_PROPERTY\n";

        var reason = Reason(Create(ide, src));

        Assert.Contains("Running", reason);
        Assert.Contains($"IMPLEMENTATION {language}", reason);
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

    // ── IMPLEMENTATION is reserved ────────────────────────────────────────────────────────────────

    /// <summary>The keyword joins the reserved-name set, so no workspace identifier can take it: a name the boundary
    /// line is spelled with could otherwise stand at the start of a line and be read as one. Refused by name, like
    /// every other refusal here — never renamed, never tolerated.</summary>
    [Theory]
    [InlineData("implementation")]
    [InlineData("IMPLEMENTATION")]
    [InlineData("Implementation")]
    public void A_variable_named_IMPLEMENTATION_is_refused_as_reserved(string name)
    {
        var ide = new FakeIde();
        var src = $"FUNCTION_BLOCK FB_Motor\nVAR\n\t{name} : INT;\nEND_VAR\nIMPLEMENTATION ST\n{name} := 1;\n\nEND_FUNCTION_BLOCK\n";

        var reason = Reason(Create(ide, src));

        Assert.Contains($"'{name}'", reason);
        Assert.Contains("reserved", reason, System.StringComparison.OrdinalIgnoreCase);
        AssertNothingWritten(ide);
    }

    private const string FbHead = "FUNCTION_BLOCK FB_Motor\nVAR\nEND_VAR\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n\n";

    /// <summary>Reserved means reserved EVERYWHERE a workspace file names something, not only in the POU's own VAR
    /// block: a check hung on one declaration path passes the row above and lets every other position through.</summary>
    [Theory]
    [InlineData("FB_Motor.fb", "Implementation",   // a method-local variable
        FbHead + "METHOD Run\nVAR\n\tImplementation : INT;\nEND_VAR\nIMPLEMENTATION ST\nImplementation := 1;\nEND_METHOD\n")]
    [InlineData("FB_Motor.fb", "Implementation",   // a method's name
        FbHead + "METHOD Implementation : BOOL\nIMPLEMENTATION ST\nImplementation := TRUE;\nEND_METHOD\n")]
    [InlineData("FB_Motor.fb", "implementation",   // an action's name
        FbHead + "ACTION implementation\nIMPLEMENTATION ST\n\nEND_ACTION\n")]
    [InlineData("FB_Motor.fb", "Implementation",   // a property's name
        FbHead + "PROPERTY Implementation : BOOL\nGET\nIMPLEMENTATION ST\nImplementation := TRUE;\nEND_GET\nEND_PROPERTY\n")]
    [InlineData("Implementation.fb", "Implementation",   // the POU's own name
        "FUNCTION_BLOCK Implementation\nVAR\nEND_VAR\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n")]
    [InlineData("E.enum", "IMPLEMENTATION",   // an enum value
        "TYPE E :\n(\n\tIMPLEMENTATION,\n\tB\n);\nEND_TYPE\n")]
    [InlineData("S.struct", "implementation",   // a struct member
        "TYPE S :\nSTRUCT\n\timplementation : INT;\nEND_STRUCT\nEND_TYPE\n")]
    public void IMPLEMENTATION_is_refused_as_reserved_in_every_naming_position(string op, string name, string source)
    {
        var ide = new FakeIde();

        var reason = Reason(Create(ide, source, op));

        Assert.Contains($"'{name}'", reason);
        Assert.Contains("reserved", reason, System.StringComparison.OrdinalIgnoreCase);
        AssertNothingWritten(ide);
    }

    // ── a body Volt cannot write ──────────────────────────────────────────────────────────────────

    /// <summary>A POU whose body the IDE holds in a language Volt cannot write (CFC, SFC) is pulled with its
    /// <see cref="BodyMarker"/> line as its statement — no <c>IMPLEMENTATION</c> line claiming a readable language
    /// (<c>ImplementationKeywordTests</c>). Pushing that file back unchanged is the ordinary no-op: it is accepted
    /// and the IDE keeps the body it had.</summary>
    [Theory]
    [InlineData("CFC")]
    [InlineData("SFC")]
    public void A_pulled_unsupported_body_pushes_back_as_a_no_op(string language)
    {
        const string decl = "FUNCTION_BLOCK K\nVAR\nEND_VAR";
        var ide = new FakeIde(new FakeIde.Item("K", ItemKind.PlcPouFb, "", true, decl, "", language, null));
        var src = $"{decl}\n{BodyMarker.For(language)}\n\nEND_FUNCTION_BLOCK\n";
        Assert.Equal(src, StWriter.Write(ide.ReadContent(new ItemRef("K"))));   // what the pull writes

        var refs = RefsService.Handle(ide);
        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = "K.fb", SourceText = src, IfVersion = refs.Items["K.fb"] } },
        });

        Assert.True(resp.Accepted, "push refused: " + Why(resp));
        Assert.Equal(BodyMarker.For(language), ide.ReadContent(new ItemRef("K")).Body);
    }

    private const string ChartDecl = "FUNCTION_BLOCK FB_Chart\nVAR\n\tx : INT;\nEND_VAR";

    /// <summary>The no-op above is only a no-op when nothing was ADDED. The marker line states the body has no text
    /// form, so code written under it, or after it on its own line, has nowhere to go: the drivers skip a marker
    /// body, so accepting the push drops that code silently and the next pull overwrites it in the working tree.
    /// It is refused by name instead, and the IDE keeps its chart.</summary>
    [Theory]
    [InlineData("CFC", "\nx := 1;")]
    [InlineData("CFC", " x := 1;")]
    [InlineData("SFC", "\n\nx := 1;")]
    public void Code_added_under_a_POUs_marker_line_is_refused_naming_the_POU(string language, string added)
    {
        var ide = new FakeIde(new FakeIde.Item("FB_Chart", ItemKind.PlcPouFb, "", true, ChartDecl, "", language, null));

        var reason = Reason(Update(ide, "FB_Chart.fb", $"{ChartDecl}\n{BodyMarker.For(language)}{added}\n\nEND_FUNCTION_BLOCK\n"));

        Assert.Contains("FB_Chart", reason);
        Assert.Empty(ide.WrittenContent);
        Assert.Equal(BodyMarker.For(language), ide.ReadContent(new ItemRef("FB_Chart")).Body);
    }

    [Fact]
    public void Code_added_under_a_members_marker_line_is_refused_naming_the_member()
    {
        var ide = new FakeIde(
            new FakeIde.Item("FB_Chart", ItemKind.PlcPouFb, "", true, ChartDecl, "", null, null, Children: new[] { "Sequence" }),
            new FakeIde.Item("Sequence", ItemKind.PlcMethod, "", false, "METHOD Sequence : BOOL", "", "SFC", null));
        var src = $"{ChartDecl}\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n\n" +
                  $"METHOD Sequence : BOOL\n{BodyMarker.For("SFC")}\nSequence := TRUE;\nEND_METHOD\n";

        var reason = Reason(Update(ide, "FB_Chart.fb", src));

        Assert.Contains("Sequence", reason);
        Assert.Empty(ide.WrittenContent);
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

    /// <summary>The exact pre-change shape of a body Volt cannot write — the retired comment, THEN the marker line —
    /// is what the corpora hold today (<c>VltFixtureCfc.fb</c>, <c>VltFixtureSfc.fb</c>, lenze-mid
    /// <c>Mach1_MIDS.prg</c>). A reader that accepts the marker line as a boundary finds one in that old file, and
    /// the retired comment lands at the end of the DECLARATION and is pushed into the IDE. It is a file from before
    /// the change like any other: refused, naming <c>volt pull</c>.</summary>
    [Theory]
    [InlineData("CFC")]
    [InlineData("SFC")]
    public void An_old_unsupported_POU_body_is_refused_naming_volt_pull(string language)
    {
        var ide = new FakeIde(new FakeIde.Item("FB_Chart", ItemKind.PlcPouFb, "", true, ChartDecl, "", language, null));

        var reason = Reason(Update(ide, "FB_Chart.fb",
            $"{ChartDecl}\n(* @volt-implementation *)\n{BodyMarker.For(language)}\n\nEND_FUNCTION_BLOCK\n"));

        Assert.Contains("volt pull", reason);
        Assert.Empty(ide.WrittenContent);
        Assert.Equal(ChartDecl, ide.ReadContent(new ItemRef("FB_Chart")).Declaration);
    }

    [Fact]
    public void An_old_unsupported_member_body_is_refused_naming_volt_pull()
    {
        var ide = new FakeIde();

        var reason = Reason(Create(ide, Motor($"(* @volt-implementation *)\n{BodyMarker.For("SFC")}")));

        Assert.Contains("volt pull", reason);
        AssertNothingWritten(ide);
    }
}
