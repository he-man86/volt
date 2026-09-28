using System.Collections.Generic;
using System.Linq;
using Xunit;

using Volt.Contracts;
using Volt.Engine.Format.St;
using Volt.Engine.Item;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

/// <summary>
/// A BODY VOLT CANNOT WRITE STATES ITS LANGUAGE ON THE KEYWORD LINE, AND NOTHING ELSE (openspec
/// <c>implementation-keyword</c>, section 2b — owner decision 2026-09-28).
///
/// <para>A CFC, SFC or IL body pulls as <c>IMPLEMENTATION CFC|SFC|IL</c>; an LD/FBD body network text has no spelling
/// for pulls as <c>IMPLEMENTATION LD|FBD UNSUPPORTED</c>. Either way the body under the line is EMPTY and read-only,
/// and no <c>(* @volt-… *)</c> comment is left in the file: the old <c>(* @volt-graphical: CFC *)</c> carried the
/// reason in the file, and the reason now travels to the pull message instead (the file says only that the body is
/// read-only, which is the one thing an editor of the file needs to know).</para>
///
/// <para>Pushing the file back unchanged is the ordinary no-op; code under the line has nowhere to go and is refused
/// by name; a member's <c>%FOLDER</c> follows the line; and a pushed file still holding a <c>(* @volt-… *)</c>
/// comment is a file from before the change, refused naming <c>volt pull</c>.</para>
/// </summary>
public class ReadOnlyBodyTests
{
    private const string Decl = "FUNCTION_BLOCK FB_Chart\nVAR\n\tx : INT;\nEND_VAR";

    private static FakeIde.Item Pou(string? lang, string? unsupported = null, params string[] children) =>
        new("FB_Chart", ItemKind.PlcPouFb, "", true, Decl, "", lang, null,
            children.Length == 0 ? null : children, unsupported);

    private static FakeIde.Item Method(string name, string? lang, string? unsupported = null, string folder = "") =>
        new(name, ItemKind.PlcMethod, folder, false, $"METHOD {name} : BOOL", "", lang, null, null, unsupported);

    private static string Pulled(FakeIde ide) =>
        Materializer.Materialize(ide, "FB_Chart", ItemKind.Kinds.FunctionBlock, new ItemRef("FB_Chart")).Text;

    private static PushResponse Update(FakeIde ide, string source)
    {
        var refs = RefsService.Handle(ide);
        return PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = "FB_Chart.fb", SourceText = source, IfVersion = refs.Items["FB_Chart.fb"] } },
        });
    }

    private static string Reason(PushResponse resp)
    {
        Assert.False(resp.Accepted, "the push must be refused");
        return Assert.Single(resp.Conflicts!).Reason;
    }

    private static string Why(PushResponse resp) => resp.Conflicts is null
        ? "(none)"
        : string.Join(" | ", resp.Conflicts.Select(c => c.Reason));

    // ── pull ──────────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("CFC")]
    [InlineData("SFC")]
    [InlineData("IL")]
    public void A_body_in_a_language_Volt_does_not_read_pulls_as_its_keyword_line_over_an_empty_body(string language)
    {
        var ide = new FakeIde(Pou(language, null, "Step"), Method("Step", language));

        var text = Pulled(ide);

        Assert.Equal(
            $"{Decl}\nIMPLEMENTATION {language}\n\nEND_FUNCTION_BLOCK\n" +
            $"\nMETHOD Step : BOOL\nIMPLEMENTATION {language}\nEND_METHOD\n", text);
        Assert.DoesNotContain("@volt", text);
    }

    [Theory]
    [InlineData("LD")]
    [InlineData("FBD")]
    public void An_LD_or_FBD_body_network_text_cannot_represent_pulls_as_UNSUPPORTED_without_its_reason(string language)
    {
        const string why = "a vendor split point";
        var ide = new FakeIde(Pou(language, why, "Step"), Method("Step", language, why));

        var text = Pulled(ide);

        Assert.Equal(
            $"{Decl}\nIMPLEMENTATION {language} UNSUPPORTED\n\nEND_FUNCTION_BLOCK\n" +
            $"\nMETHOD Step : BOOL\nIMPLEMENTATION {language} UNSUPPORTED\nEND_METHOD\n", text);
        Assert.DoesNotContain(why, text);      // the reason is the pull message's, not the file's
        Assert.DoesNotContain("@volt", text);
    }

    /// <summary>The reason leaves the file, so it has to reach the pull some other way: the fetch names every
    /// UNSUPPORTED body of an item it sends — the item's own and each member's — with its language and reason.</summary>
    [Fact]
    public void The_fetch_names_every_UNSUPPORTED_body_and_its_reason()
    {
        var ide = new FakeIde(Pou("LD", "a vendor split point", "Step", "Fine"),
                              Method("Step", "FBD", "an ENO output wired to a variable"),
                              Method("Fine", "CFC"));

        var item = Assert.Single(FetchService.Handle(ide, new FetchRequest { Init = true }).Changed);

        var bodies = item.Unsupported!.OrderBy(u => u.Member ?? "").ToList();
        Assert.Equal(2, bodies.Count);                         // CFC is a language, not an unsupported shape
        Assert.Null(bodies[0].Member);                         // the item's own body
        Assert.Equal("LD", bodies[0].Language);
        Assert.Equal("a vendor split point", bodies[0].Reason);
        Assert.Equal("Step", bodies[1].Member);
        Assert.Equal("FBD", bodies[1].Language);
        Assert.Equal("an ENO output wired to a variable", bodies[1].Reason);
    }

    [Fact]
    public void An_item_with_no_UNSUPPORTED_body_names_none()
    {
        var ide = new FakeIde(Pou("CFC"));

        var item = Assert.Single(FetchService.Handle(ide, new FetchRequest { Init = true }).Changed);

        Assert.Null(item.Unsupported);
    }

    // ── push back ─────────────────────────────────────────────────────────────────────────────────

    public static IEnumerable<object?[]> ReadOnlyBodies() => new[]
    {
        new object?[] { "CFC", null }, new object?[] { "SFC", null }, new object?[] { "IL", null },
        new object?[] { "LD", "a vendor split point" }, new object?[] { "FBD", "a flag on a box input pin" },
    };

    [Theory]
    [MemberData(nameof(ReadOnlyBodies))]
    public void A_pulled_read_only_body_pushes_back_unchanged_as_a_no_op(string language, string? unsupported)
    {
        var ide = new FakeIde(Pou(language, unsupported, "Step"), Method("Step", language, unsupported));
        var text = Pulled(ide);
        var before = ide.ReadContent(new ItemRef("FB_Chart"));

        var resp = Update(ide, text);

        Assert.True(resp.Accepted, "push refused: " + Why(resp));
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("create:") || r.StartsWith("delete:"));
        var after = ide.ReadContent(new ItemRef("FB_Chart"));
        Assert.Equal(before.Body, after.Body);
        Assert.Equal(before.Members.Single().Body, after.Members.Single().Body);
        Assert.Equal(text, Pulled(ide));
    }

    /// <summary>The same no-op with the line spelled as an engineer might retype it — spacing and case are free, as
    /// for every keyword line.</summary>
    [Fact]
    public void A_read_only_line_is_matched_in_any_case_and_spacing()
    {
        var ide = new FakeIde(Pou("LD", "a vendor split point"));

        var resp = Update(ide, $"{Decl}\n  implementation   ld   unsupported \n\nEND_FUNCTION_BLOCK\n");

        Assert.True(resp.Accepted, "push refused: " + Why(resp));
        Assert.Equal("IMPLEMENTATION LD UNSUPPORTED", ide.ReadContent(new ItemRef("FB_Chart")).Body);
    }

    [Theory]
    [InlineData("CFC", null, "\nx := 1;")]
    [InlineData("IL", null, "\n\nx := 1;")]
    [InlineData("LD", "a vendor split point", "\nNETWORK\n  x := 1;\nEND_NETWORK")]
    [InlineData("SFC", null, " x := 1;")]                       // after the line, on it
    [InlineData("FBD", "a vendor split point", " x := 1;")]
    public void Code_under_a_POUs_read_only_line_is_refused_naming_the_POU(string language, string? unsupported, string added)
    {
        var ide = new FakeIde(Pou(language, unsupported));
        var line = unsupported is null ? $"IMPLEMENTATION {language}" : $"IMPLEMENTATION {language} UNSUPPORTED";
        var before = ide.ReadContent(new ItemRef("FB_Chart")).Body;

        var reason = Reason(Update(ide, $"{Decl}\n{line}{added}\n\nEND_FUNCTION_BLOCK\n"));

        Assert.Contains("FB_Chart", reason);
        Assert.Contains(line, reason);
        Assert.Empty(ide.WrittenContent);
        Assert.Equal(before, ide.ReadContent(new ItemRef("FB_Chart")).Body);
    }

    [Theory]
    [InlineData("SFC", null)]
    [InlineData("LD", "a vendor split point")]
    public void Code_under_a_members_read_only_line_is_refused_naming_the_member(string language, string? unsupported)
    {
        var ide = new FakeIde(Pou(null, null, "Sequence"), Method("Sequence", language, unsupported));
        var line = unsupported is null ? $"IMPLEMENTATION {language}" : $"IMPLEMENTATION {language} UNSUPPORTED";
        var src = $"{Decl}\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n\nMETHOD Sequence : BOOL\n{line}\nSequence := TRUE;\nEND_METHOD\n";

        var reason = Reason(Update(ide, src));

        Assert.Contains("Sequence", reason);
        Assert.Contains(line, reason);
        Assert.Empty(ide.WrittenContent);
    }

    /// <summary><c>UNSUPPORTED</c> belongs to LD and FBD alone — the two languages Volt reads, whose body this one
    /// could not be. On any other language it states nothing a body can be, and is refused naming the line.</summary>
    [Theory]
    [InlineData("IMPLEMENTATION ST UNSUPPORTED")]
    [InlineData("IMPLEMENTATION CFC UNSUPPORTED")]
    [InlineData("IMPLEMENTATION UNSUPPORTED")]
    public void UNSUPPORTED_on_a_language_other_than_LD_or_FBD_is_refused_naming_the_line(string line)
    {
        var ide = new FakeIde(Pou("CFC"));

        var reason = Reason(Update(ide, $"{Decl}\n{line}\n\nEND_FUNCTION_BLOCK\n"));

        Assert.Contains("FB_Chart", reason);
        Assert.Contains(line, reason);
        Assert.Empty(ide.WrittenContent);
    }

    // ── %FOLDER ───────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("CFC", null)]
    [InlineData("FBD", "a vendor split point")]
    public void A_read_only_members_FOLDER_follows_its_keyword_line_and_round_trips(string language, string? unsupported)
    {
        var ide = new FakeIde(Pou(null, null, "Step"), Method("Step", language, unsupported, folder: "Sub/Deep"));
        var line = unsupported is null ? $"IMPLEMENTATION {language}" : $"IMPLEMENTATION {language} UNSUPPORTED";

        var text = Pulled(ide);

        Assert.EndsWith($"\nMETHOD Step : BOOL\n{line}\n%FOLDER Sub/Deep\nEND_METHOD\n", text);
        var step = StReader.Read(text, ItemKind.Kinds.FunctionBlock, "FB_Chart").Members.Single();
        Assert.Equal("Sub/Deep", step.Folder);
        Assert.Equal("METHOD Step : BOOL", step.Declaration);
        Assert.Equal(line, step.Body);

        var resp = Update(ide, text);
        Assert.True(resp.Accepted, "push refused: " + Why(resp));
        Assert.Equal(text, Pulled(ide));
    }

    /// <summary>Every read-only line has the same SHAPE — "no text form" — but each states a different LANGUAGE, and
    /// the stated language is the one signal for what a body is. A file stating one read-only language over a body the
    /// IDE holds in another is mislabelled: accepted as a no-op, the IDE keeps its real body while the file (and the
    /// baseline the push records) says something else. So it is refused naming both, and nothing is written.</summary>
    [Theory]
    [InlineData("CFC", null, "IMPLEMENTATION CFC", "IMPLEMENTATION SFC")]
    [InlineData("CFC", null, "IMPLEMENTATION CFC", "IMPLEMENTATION LD UNSUPPORTED")]
    [InlineData("LD", "a vendor split point", "IMPLEMENTATION LD UNSUPPORTED", "IMPLEMENTATION FBD UNSUPPORTED")]
    [InlineData("LD", "a vendor split point", "IMPLEMENTATION LD UNSUPPORTED", "IMPLEMENTATION IL")]
    [InlineData("IL", null, "IMPLEMENTATION IL", "IMPLEMENTATION FBD UNSUPPORTED")]
    public void A_read_only_line_stating_another_language_than_the_IDE_body_is_refused_naming_both(
        string language, string? unsupported, string held, string stated)
    {
        var ide = new FakeIde(Pou(language, unsupported));
        var text = Pulled(ide);
        var mislabelled = text.Replace(held + "\n", stated + "\n");
        Assert.NotEqual(text, mislabelled);

        var reason = Reason(Update(ide, mislabelled));

        Assert.Contains(held, reason);
        Assert.Contains(stated, reason);
        Assert.Empty(ide.WrittenContent);
        Assert.Equal(text, Pulled(ide));
    }

    [Fact]
    public void A_read_only_member_line_stating_another_language_is_refused_naming_the_member()
    {
        var ide = new FakeIde(Pou(null, null, "Seq"), Method("Seq", "SFC"));
        var text = Pulled(ide);
        var mislabelled = text.Replace("METHOD Seq : BOOL\nIMPLEMENTATION SFC\n", "METHOD Seq : BOOL\nIMPLEMENTATION CFC\n");
        Assert.NotEqual(text, mislabelled);

        var reason = Reason(Update(ide, mislabelled));

        Assert.Contains("'Seq'", reason);
        Assert.Contains("IMPLEMENTATION SFC", reason);
        Assert.Contains("IMPLEMENTATION CFC", reason);
        Assert.Empty(ide.WrittenContent);
        Assert.Equal(text, Pulled(ide));
    }

    // ── no Volt comment survives ─────────────────────────────────────────────────────────────────

    /// <summary>A file that still holds a <c>(* @volt-… *)</c> comment ANYWHERE was written before the change —
    /// the pull writes none — and is refused naming <c>volt pull</c>, which rewrites it in the current format.
    /// Nothing is written.</summary>
    [Theory]
    [InlineData("FUNCTION_BLOCK FB_Chart\nVAR\n\tx : INT;\nEND_VAR\n(* @volt-graphical: CFC *)\n\nEND_FUNCTION_BLOCK\n")]
    [InlineData("FUNCTION_BLOCK FB_Chart\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION CFC\n(* @volt-graphical: CFC *)\nEND_FUNCTION_BLOCK\n")]
    [InlineData("FUNCTION_BLOCK FB_Chart\n(* @volt-graphical: kept *)\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nx := 1;\n\nEND_FUNCTION_BLOCK\n")]
    [InlineData("FUNCTION_BLOCK FB_Chart\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nx := 1; (*@volt-note*)\n\nEND_FUNCTION_BLOCK\n")]
    [InlineData("FUNCTION_BLOCK FB_Chart\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n\nMETHOD Step : BOOL\n(* @volt-graphical: SFC *)\nEND_METHOD\n")]
    [InlineData("FUNCTION_BLOCK FB_Chart\nVAR\n\tx : INT;\nEND_VAR\n(* @volt-implementation *)\nx := 1;\n\nEND_FUNCTION_BLOCK\n")]
    // NESTED inside a comment of the engineer's: comments nest, so the tag is a comment of its own inside the outer
    // one, and "no Volt comment survives" has no depth at which it stops holding.
    [InlineData("FUNCTION_BLOCK FB_Chart\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\n(* note (* @volt-graphical: CFC *) *)\nx := 1;\n\nEND_FUNCTION_BLOCK\n")]
    [InlineData("FUNCTION_BLOCK FB_Chart\nVAR\n\tx : INT; (* a\n\t(* b (* @volt-note *) *)\n\t*)\nEND_VAR\nIMPLEMENTATION ST\nx := 1;\n\nEND_FUNCTION_BLOCK\n")]
    public void A_pushed_file_holding_a_volt_comment_is_refused_naming_volt_pull(string source)
    {
        var ide = new FakeIde(Pou(null, null, "Step"), Method("Step", "SFC"));

        var reason = Reason(Update(ide, source));

        Assert.Contains("volt pull", reason);
        Assert.Contains("@volt", reason);                       // it names what it found
        Assert.Empty(ide.WrittenContent);
    }

    [Theory]
    [InlineData("gvl", "VAR_GLOBAL\n\tn : INT; (* @volt-graphical: CFC *)\nEND_VAR\n")]
    [InlineData("struct", "TYPE ST_A :\nSTRUCT\n\t(* @volt-implementation *)\n\tn : INT;\nEND_STRUCT\nEND_TYPE\n")]
    public void A_volt_comment_in_a_declaration_only_kind_is_refused_too(string ext, string source)
    {
        var ex = Assert.Throws<BridgeException>(() => StReader.Read(source, ext == "gvl" ? ItemKind.Kinds.Gvl : ItemKind.Kinds.Dut, "X"));
        Assert.Contains("volt pull", ex.Message);
    }

    /// <summary>A comment is what the rule is about. The same characters in a string literal, or after <c>//</c> (where
    /// <c>(*</c> opens nothing), are the engineer's text and are pushed like any other.</summary>
    [Theory]
    [InlineData("s := '(* @volt-graphical: CFC *)';")]
    [InlineData("x := 1; // (* @volt-graphical: CFC *)")]
    public void The_same_text_in_a_string_or_a_line_comment_is_no_volt_comment(string code)
    {
        var src = $"FUNCTION_BLOCK FB_S\nVAR\n\ts : STRING;\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\n{code}\n\nEND_FUNCTION_BLOCK\n";

        var item = StReader.Read(src, ItemKind.Kinds.FunctionBlock, "FB_S");

        Assert.Equal(code, item.Body);
    }

    // ── a read-only member NEW to an existing POU ────────────────────────────────────────────────

    /// <summary>A read-only line on a member the IDE does not hold under that name and kind — a rename, a retype
    /// (which is a delete and a create), a member added by hand — is a CREATE of that member, and a create has no
    /// body to keep: the member would land as an empty ST body while the IDE lost the diagram it held. The item-level
    /// create was guarded (<see cref="CreateUnauthorableBodyTests"/>); the member level is guarded the same way,
    /// before anything is deleted or created.</summary>
    [Theory]
    [MemberData(nameof(ReadOnlyBodies))]
    public void Renaming_a_read_only_member_is_refused_naming_it_and_the_IDE_keeps_its_body(string language, string? unsupported)
    {
        var ide = new FakeIde(Pou(null, null, "Seq"), Method("Seq", language, unsupported));
        var text = Pulled(ide);

        var reason = Reason(Update(ide, text.Replace("METHOD Seq : BOOL", "METHOD Seq2 : BOOL")));

        Assert.Contains("Seq2", reason);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("create:") || r.StartsWith("delete:"));
        Assert.Empty(ide.WrittenContent);
        Assert.True(ide.Exists("Seq"));
        Assert.False(ide.Exists("Seq2"));
        Assert.Equal(text, Pulled(ide));
    }

    [Theory]
    [MemberData(nameof(ReadOnlyBodies))]
    public void Retyping_a_read_only_member_is_refused_naming_it_and_the_IDE_keeps_its_body(string language, string? unsupported)
    {
        var ide = new FakeIde(Pou(null, null, "Seq"), Method("Seq", language, unsupported));
        var text = Pulled(ide);
        var line = unsupported is null ? $"IMPLEMENTATION {language}" : $"IMPLEMENTATION {language} UNSUPPORTED";
        var retyped = text.Replace($"METHOD Seq : BOOL\n{line}\nEND_METHOD", $"ACTION Seq\n{line}\nEND_ACTION");
        Assert.NotEqual(text, retyped);

        var reason = Reason(Update(ide, retyped));

        Assert.Contains("'Seq'", reason);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("create:") || r.StartsWith("delete:"));
        Assert.Empty(ide.WrittenContent);
        Assert.Equal(text, Pulled(ide));
    }

    [Theory]
    [MemberData(nameof(ReadOnlyBodies))]
    public void Adding_a_member_under_a_read_only_line_to_an_existing_POU_is_refused_naming_it(string language, string? unsupported)
    {
        var ide = new FakeIde(Pou(null, null, "Seq"), Method("Seq", "CFC"));
        var text = Pulled(ide);
        var line = unsupported is null ? $"IMPLEMENTATION {language}" : $"IMPLEMENTATION {language} UNSUPPORTED";

        var reason = Reason(Update(ide, text + $"\nMETHOD Added : BOOL\n{line}\nEND_METHOD\n"));

        Assert.Contains("Added", reason);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("create:") || r.StartsWith("delete:"));
        Assert.False(ide.Exists("Added"));
    }

    // ── what the IDE holds that a workspace file cannot carry ─────────────────────────────────────

    /// <summary>The pull writes no <c>(* @volt-… *)</c> comment — and that includes one the IDE itself holds (an older
    /// Volt pushed its marker into a body or a declaration). Pulled verbatim, the file would be refused on every
    /// push with "run volt pull", and the pull would write it straight back. So the item is not materialized: it is
    /// refused naming the comment and the fix, which is an edit in the IDE, and fetch lists it as unreadable (the
    /// file already in the workspace, if any, is left alone).</summary>
    [Theory]
    [InlineData(Decl, "(* @volt-graphical: kept from the old chart *)\nx := 1;")]
    [InlineData("FUNCTION_BLOCK FB_Chart\nVAR\n\tx : INT;\nEND_VAR\n(* @volt-implementation *)", "x := 1;")]
    [InlineData(Decl, "(* note (* @volt-graphical: CFC *) *)\nx := 1;")]
    public void An_IDE_item_holding_a_volt_comment_is_refused_on_pull_naming_the_comment(string declaration, string body)
    {
        var ide = new FakeIde(new FakeIde.Item("FB_Chart", ItemKind.PlcPouFb, "", true, declaration, body, null, null));

        var ex = Assert.Throws<BridgeException>(() => Pulled(ide));
        Assert.Contains("FB_Chart", ex.Message);
        Assert.Contains("@volt-", ex.Message);
        Assert.Contains("in the IDE", ex.Message);

        var fetch = FetchService.Handle(ide, new FetchRequest { Init = true });
        Assert.Empty(fetch.Changed);
        Assert.Contains("FB_Chart", fetch.Unreadable);
    }

    /// <summary>An ST body the IDE holds whose text has a line of the keyword's shape (outside every comment) cannot
    /// be written into a file: the file would read that line as the body's boundary — a read-only body, a network
    /// body, or a second boundary — so the body would come back in a language it is not. The driver knows the body
    /// is ST and refuses it by name (<see cref="ImplementationMarker.RequireStBody"/>) rather than hand the pull a
    /// text that states the wrong language.</summary>
    [Theory]
    [InlineData("IMPLEMENTATION CFC")]
    [InlineData("IMPLEMENTATION LD UNSUPPORTED")]
    [InlineData("x := 1;\nIMPLEMENTATION ST\ny := 2;")]
    public void An_ST_body_holding_a_keyword_line_is_refused_on_pull_not_relabelled(string body)
    {
        var ide = new FakeIde(new FakeIde.Item("FB_Chart", ItemKind.PlcPouFb, "", true, Decl, body, null, null));

        var ex = Assert.Throws<BridgeException>(() => Pulled(ide));
        Assert.Contains("IMPLEMENTATION", ex.Message);

        var fetch = FetchService.Handle(ide, new FetchRequest { Init = true });
        Assert.Empty(fetch.Changed);
        Assert.Contains("FB_Chart", fetch.Unreadable);
    }

    /// <summary>…and only a line OUTSIDE every comment: the same words in a comment are the engineer's text.</summary>
    [Fact]
    public void An_ST_body_with_the_keyword_in_a_comment_pulls_as_ST()
    {
        var ide = new FakeIde(new FakeIde.Item("FB_Chart", ItemKind.PlcPouFb, "", true, Decl,
                                               "(*\nIMPLEMENTATION CFC\n*)\nx := 1;", null, null));

        Assert.Equal($"{Decl}\nIMPLEMENTATION ST\n(*\nIMPLEMENTATION CFC\n*)\nx := 1;\n\nEND_FUNCTION_BLOCK\n", Pulled(ide));
    }
}
