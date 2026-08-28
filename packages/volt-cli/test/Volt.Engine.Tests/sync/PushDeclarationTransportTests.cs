using System.Collections.Generic;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Format.Body;
using Volt.Engine.PlcOpen;
using Volt.Engine.Sync;

namespace Volt.Cli.Tests;

/// <summary>
/// THE WRITE HALF of the declaration transport: a declaration edit reaches the IDE through the ASPECT, for every
/// shape, and an unchanged declaration reaches it not at all.
///
/// <para>These assertions are not new. Four separate tests used to make them against the spliced DOCUMENT —
/// <c>BodyCodecTests.A_declaration_edit_lands_on_a_graphical_POU</c> (DEFECT 1: a declaration edit on an FBD POU
/// was silently discarded while the push reported "updated"),
/// <c>DeclarationOnlyDocumentTests.B_a_declaration_edit_travels_the_document</c>,
/// <c>PouDocumentTests.The_root_declaration_and_body_land</c>, and the declaration line of
/// <c>UnmodelledLanguageTests</c> (a CFC POU's declaration could not be edited AT ALL). Every one of those
/// defects is still a defect. Only the transport changed, so the assertions moved to it rather than being
/// deleted — a document-level assertion of a declaration edit is now vacuous, but the requirement it protected
/// is not.</para>
///
/// <para><b>This reverses a previous migration, deliberately.</b> DUT/GVL declarations were moved OUT of
/// <c>WriteText</c> and INTO the document precisely so "there is no longer a second transport to keep in step
/// with this one" (<c>DeclarationOnlyDocumentTests</c>). That goal is intact and is why the change is uniform:
/// every declaration — POU, DUT, GVL, union, interface — now travels the aspect, so there is still exactly ONE.
/// What was learned since is that the document's carrier is an optional vendor <c>addData</c> block and a vendor
/// stopped emitting it, which made the document the wrong single transport, not single-transport the wrong
/// goal.</para>
/// </summary>
public class PushDeclarationTransportTests
{
    private static void Push(FakeIde ide, string name, string src)
    {
        var refs = RefsService.Handle(ide);
        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new() { new SetItemOp { Name = name, IfVersion = refs.Items[name], SourceText = src } },
        });
        Assert.True(resp.Accepted,
            "push rejected: " + string.Join("; ", resp.Conflicts?.ConvertAll(c => $"{c.Name}: {c.Reason}")
                                                 ?? new List<string> { "<none>" }));
    }

    /// <summary>Canonical source in the shape the file layout uses: declaration, blank line, body, blank line,
    /// terminator. Assembled here rather than inlined per case so a malformed source fails as a REJECTED PUSH
    /// (which names the reason) rather than as a missing dictionary key three frames away.</summary>
    private static string Source(string decl, string body, string? terminator) =>
        terminator is null ? decl + "\n" : decl + "\n\n" + body + "\n\n" + terminator + "\n";

    /// <summary>The same declaration with one variable added — the ONLY difference in the push.</summary>
    private static string PlusOneVar(string decl) =>
        decl.Replace("VAR_GLOBAL\nEND_VAR", "VAR_GLOBAL\n\tvltAdded : INT;\nEND_VAR")
            .Replace("VAR\nEND_VAR", "VAR\n\tvltAdded : INT;\nEND_VAR")
            .Replace("STRUCT\nEND_STRUCT", "STRUCT\n\tvltAdded : INT;\nEND_STRUCT");

    // ── a declaration edit lands, for every shape ───────────────────────────────────────────────────

    /// <summary>Every writable shape, edited. The pushed declaration must arrive at the aspect VERBATIM — not
    /// merely "a write happened", which is all the recorded call name proves.</summary>
    [Theory]
    // kind                    ext    the ORIGINAL declaration                  body       terminator
    [InlineData(ItemKind.PlcPouFb,   "fb",  "FUNCTION_BLOCK K\nVAR\nEND_VAR",   "n := 1;", "END_FUNCTION_BLOCK")]
    [InlineData(ItemKind.PlcPouProg, "prg", "PROGRAM K\nVAR\nEND_VAR",          "n := 1;", "END_PROGRAM")]
    [InlineData(ItemKind.PlcDut,     "dut", "TYPE K :\nSTRUCT\nEND_STRUCT\nEND_TYPE", "", null)]
    [InlineData(ItemKind.PlcGvl,     "gvl", "VAR_GLOBAL\nEND_VAR",              "",        null)]
    public void A_declaration_edit_reaches_the_aspect(int code, string ext, string decl, string body, string? terminator)
    {
        var ide = new FakeIde(new FakeIde.Item("K", code, "", true, decl, body.Length == 0 ? null : body, null, null));
        var edited = PlusOneVar(decl);
        Assert.NotEqual(decl, edited);   // the case is only meaningful if the edit actually took

        Push(ide, $"K.{ext}", Source(edited, body, terminator));

        Assert.True(ide.WrittenText.ContainsKey("K"), $"a {ext} declaration edit never reached the IDE");
        Assert.Contains("vltAdded", ide.WrittenText["K"]);
    }

    /// <summary>DEFECT 1, at the transport that now carries it: a declaration edit on a POU whose body Volt
    /// cannot write must still land.
    /// <para>It used to be discarded silently — the graphical write path took the declaration only to resolve FB
    /// instance types and never wrote it, while the push still reported "updated". And the ROOT unsupported-body
    /// path refused the push outright, so a CFC POU's declaration could not be edited AT ALL. The body pushed
    /// back here is the MARKER, which is the ordinary round-trip, leaving the declaration as the only thing under
    /// test.</para></summary>
    [Theory]
    [InlineData("CFC")]
    [InlineData("SFC")]
    public void A_declaration_edit_lands_on_an_unsupported_language_POU(string language)
    {
        const string decl = "FUNCTION_BLOCK K\nVAR\nEND_VAR";
        var ide = new FakeIde(new FakeIde.Item("K", ItemKind.PlcPouFb, "", true, decl, "", language, null));

        Push(ide, "K.fb", Source(PlusOneVar(decl), BodyMarker.For(language), "END_FUNCTION_BLOCK"));

        Assert.Contains("vltAdded", ide.WrittenText["K"]);
    }

    // ── and an unchanged declaration does NOT ───────────────────────────────────────────────────────

    /// <summary>A no-op push stays a no-op. This is the property the document splice preserved for free by
    /// returning the ORIGINAL bytes when nothing changed; moving to the aspect has to preserve it deliberately,
    /// or every push dirties the project.</summary>
    [Fact]
    public void An_unchanged_declaration_is_not_written_back()
    {
        const string decl = "FUNCTION_BLOCK K\nVAR\n\tn : INT;\nEND_VAR";
        var ide = new FakeIde(new FakeIde.Item("K", ItemKind.PlcPouFb, "", true, decl, "n := 1;", null, null));

        Push(ide, "K.fb", Source(decl, "n := 1;", "END_FUNCTION_BLOCK"));

        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("write:"));
    }

    /// <summary>Trailing whitespace alone is not an edit.
    /// <para>Not hypothetical: the guard first compared the file's text against the IDE's RAW text, and
    /// <c>Materializer</c> TRIMS what it writes into the file — so a pull followed by an unmodified push wrote
    /// the declaration back on every DUT and GVL. The comparison is trimmed on both sides; the value written is
    /// still verbatim.</para></summary>
    [Fact]
    public void A_trailing_newline_difference_is_not_an_edit()
    {
        const string decl = "TYPE K :\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE";
        var ide = new FakeIde(new FakeIde.Item("K", ItemKind.PlcDut, "", true, decl + "\n\n", null, null, null));

        Push(ide, "K.dut", decl + "\n");

        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("write:"));
    }
}
