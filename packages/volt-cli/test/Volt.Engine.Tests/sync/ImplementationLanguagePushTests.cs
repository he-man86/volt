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

    private static PushResponse Create(FakeIde ide, string source)
    {
        var refs = RefsService.Handle(ide);
        return PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = "FB_Motor.fb", SourceText = source, IfVersion = null } },
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
}
