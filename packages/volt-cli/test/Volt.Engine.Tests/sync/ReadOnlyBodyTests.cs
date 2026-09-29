using System.Collections.Generic;
using System.Linq;
using Xunit;

using Volt.Contracts;
using Volt.Engine.Format.St;
using Volt.Engine.Item;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

/// <summary>
/// A BODY VOLT DOES NOT SHOW IS <c>IMPLEMENTATION &lt;LANG&gt; UNSUPPORTED</c>, AND NOTHING ELSE (openspec
/// <c>implementation-keyword</c>, sections 2b and 3b — owner decisions 2026-09-28).
///
/// <para>A CFC, SFC or IL body, and an LD/FBD body network text has no spelling for, pulls as
/// <c>IMPLEMENTATION CFC|SFC|IL|LD|FBD UNSUPPORTED</c> over an EMPTY body: Volt shows no implementation code for it.
/// The item's DECLARATION stays fully editable and is pushed as usual, and the IDE's body is NEVER written — a push that
/// touches such an item leaves the body the IDE holds exactly as it was. Neither pull nor push is blocked by one. A bare
/// <c>IMPLEMENTATION CFC</c> (section 2b's spelling, reversed by 3b) is no line a body can state, and is refused by
/// name.</para>
///
/// <para>No <c>(* @volt-… *)</c> comment is left in the file: the old <c>(* @volt-graphical: CFC *)</c> carried the
/// reason in the file, and the reason for an LD/FBD body now travels to the pull message instead. Pushing the file back
/// unchanged is the ordinary no-op; code under the line has nowhere to go and is refused by name; a member's
/// <c>%FOLDER</c> follows the line; and a pushed file still holding a <c>(* @volt-… *)</c> comment is a file from before
/// the change, refused naming <c>volt pull</c>.</para>
/// </summary>
public class ReadOnlyBodyTests
{
    private const string Decl = "FUNCTION_BLOCK FB_Chart\nVAR\n\tx : INT;\nEND_VAR";

    /// <summary>What the IDE holds for a body Volt does not show — a chart, an archive, bytes no workspace file carries.
    /// The tests that say a push never WROTE a body compare the IDE's stored body against this.</summary>
    private static string Held(string lang) => $"<the IDE's own {lang} body>";

    private static FakeIde.Item Pou(string? lang, string? unsupported = null, params string[] children) =>
        new("FB_Chart", ItemKind.PlcPouFb, "", true, Decl, lang is null ? "" : Held(lang), lang, null,
            children.Length == 0 ? null : children, unsupported);

    private static FakeIde.Item Method(string name, string? lang, string? unsupported = null, string folder = "") =>
        new(name, ItemKind.PlcMethod, folder, false, $"METHOD {name} : BOOL", lang is null ? "" : Held(lang), lang, null,
            null, unsupported);

    /// <summary>The one line a hidden body pulls as, whatever its language (section 3b).</summary>
    private static string Line(string language) => $"IMPLEMENTATION {language} UNSUPPORTED";

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

    /// <summary>Every body Volt does not show, with the reason a driver hands up for it: none for CFC, SFC and IL, whose
    /// language is the whole reason, and what network text has no spelling for, for LD and FBD.</summary>
    public static IEnumerable<object?[]> HiddenBodies() => new[]
    {
        new object?[] { "CFC", null }, new object?[] { "SFC", null }, new object?[] { "IL", null },
        new object?[] { "LD", "a vendor split point" }, new object?[] { "FBD", "a flag on a box input pin" },
    };

    // ── pull ──────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Section 3b: UNSUPPORTED is the one word for "no implementation shown", on every language — so a CFC,
    /// SFC or IL body pulls with it too, and not as section 2b's bare <c>IMPLEMENTATION CFC</c>.</summary>
    [Theory]
    [MemberData(nameof(HiddenBodies))]
    public void A_hidden_body_pulls_as_its_language_and_UNSUPPORTED_over_an_empty_body(string language, string? unsupported)
    {
        var ide = new FakeIde(Pou(language, unsupported, "Step"), Method("Step", language, unsupported));

        var text = Pulled(ide);

        Assert.Equal(
            $"{Decl}\n{Line(language)}\n\nEND_FUNCTION_BLOCK\n" +
            $"\nMETHOD Step : BOOL\n{Line(language)}\nEND_METHOD\n", text);
        Assert.DoesNotContain(Held(language), text);           // no implementation code is shown
        if (unsupported is not null) Assert.DoesNotContain(unsupported, text);   // the reason is the pull message's
        Assert.DoesNotContain("@volt", text);
    }

    /// <summary>The reason leaves the file, so it has to reach the pull some other way: the fetch names every LD/FBD
    /// UNSUPPORTED body of an item it sends — the item's own and each member's — with its language and reason. A CFC,
    /// SFC or IL body carries none: its line states the language, and that is the whole reason.</summary>
    [Fact]
    public void The_fetch_names_every_LD_or_FBD_UNSUPPORTED_body_and_its_reason()
    {
        var ide = new FakeIde(Pou("LD", "a vendor split point", "Step", "Fine"),
                              Method("Step", "FBD", "an ENO output wired to a variable"),
                              Method("Fine", "CFC"));

        var item = Assert.Single(FetchService.Handle(ide, new FetchRequest { Init = true }).Changed);

        var bodies = item.Unsupported!.OrderBy(u => u.Member ?? "").ToList();
        Assert.Equal(2, bodies.Count);
        Assert.Null(bodies[0].Member);                         // the item's own body
        Assert.Equal("LD", bodies[0].Language);
        Assert.Equal("a vendor split point", bodies[0].Reason);
        Assert.Equal("Step", bodies[1].Member);
        Assert.Equal("FBD", bodies[1].Language);
        Assert.Equal("an ENO output wired to a variable", bodies[1].Reason);
    }

    [Fact]
    public void An_item_with_no_LD_or_FBD_UNSUPPORTED_body_names_none()
    {
        var ide = new FakeIde(Pou("CFC"));

        var item = Assert.Single(FetchService.Handle(ide, new FetchRequest { Init = true }).Changed);

        Assert.Null(item.Unsupported);
    }

    // ── push back ─────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [MemberData(nameof(HiddenBodies))]
    public void A_pulled_hidden_body_pushes_back_unchanged_as_a_no_op(string language, string? unsupported)
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
        Assert.Equal(Held(language), ide.StoredImplementation("FB_Chart"));
        Assert.Equal(Held(language), ide.StoredImplementation("Step"));
        Assert.Equal(text, Pulled(ide));
    }

    /// <summary>The same no-op with the line spelled as an engineer might retype it — spacing and case are free, as
    /// for every keyword line.</summary>
    [Theory]
    [InlineData("LD", "a vendor split point", "  implementation   ld   unsupported ")]
    [InlineData("CFC", null, "Implementation\tcfc Unsupported")]
    public void An_UNSUPPORTED_line_is_matched_in_any_case_and_spacing(string language, string? unsupported, string typed)
    {
        var ide = new FakeIde(Pou(language, unsupported));

        var resp = Update(ide, $"{Decl}\n{typed}\n\nEND_FUNCTION_BLOCK\n");

        Assert.True(resp.Accepted, "push refused: " + Why(resp));
        Assert.Equal(Line(language), ide.ReadContent(new ItemRef("FB_Chart")).Body);
        Assert.Equal(Held(language), ide.StoredImplementation("FB_Chart"));
    }

    // ── the declaration of a hidden body is editable; the body is never written (section 3b) ─────

    private const string AddedInput = "VAR_INPUT\n\tbStart : BOOL;\nEND_VAR\n";

    /// <summary>Spec, "the declaration of a hidden body is edited": the POU gains a <c>VAR_INPUT</c> and is pushed. The
    /// declaration lands, the body the IDE holds is exactly what it was — the drivers are handed the UNSUPPORTED line and
    /// write NO implementation for it — and the next pull reads back the file as pushed.</summary>
    [Theory]
    [MemberData(nameof(HiddenBodies))]
    public void Editing_a_hidden_POUs_declaration_pushes_it_and_never_writes_the_body(string language, string? unsupported)
    {
        var ide = new FakeIde(Pou(language, unsupported));
        var text = Pulled(ide);
        var edited = text.Replace("FUNCTION_BLOCK FB_Chart\n", "FUNCTION_BLOCK FB_Chart\n" + AddedInput);
        Assert.NotEqual(text, edited);

        var resp = Update(ide, edited);

        Assert.True(resp.Accepted, "push refused: " + Why(resp));
        Assert.Contains("bStart : BOOL;", ide.ReadContent(new ItemRef("FB_Chart")).Declaration);
        Assert.Equal(Held(language), ide.StoredImplementation("FB_Chart"));
        Assert.Equal(edited, Pulled(ide));
    }

    [Theory]
    [MemberData(nameof(HiddenBodies))]
    public void Editing_a_hidden_members_declaration_pushes_it_and_never_writes_the_body(string language, string? unsupported)
    {
        var ide = new FakeIde(Pou(null, null, "Step"), Method("Step", language, unsupported));
        var text = Pulled(ide);
        var edited = text.Replace("METHOD Step : BOOL\n", "METHOD Step : BOOL\n" + AddedInput);
        Assert.NotEqual(text, edited);

        var resp = Update(ide, edited);

        Assert.True(resp.Accepted, "push refused: " + Why(resp));
        Assert.Contains("bStart : BOOL;", ide.ReadContent(new ItemRef("FB_Chart")).Members.Single().Declaration);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("create:") || r.StartsWith("delete:"));
        Assert.Equal(Held(language), ide.StoredImplementation("Step"));
        Assert.Equal(edited, Pulled(ide));
    }

    /// <summary>Spec, "nothing in the IDE is overwritten": an item that merely HOLDS a hidden member is pushed like any
    /// other — its ST body edited here — and the hidden member's body is not written.</summary>
    [Theory]
    [MemberData(nameof(HiddenBodies))]
    public void A_push_editing_the_ST_beside_a_hidden_member_lands_and_never_writes_the_hidden_body(string language, string? unsupported)
    {
        var ide = new FakeIde(Pou(null, null, "Step"), Method("Step", language, unsupported));
        var text = Pulled(ide);
        var edited = text.Replace($"{Decl}\nIMPLEMENTATION ST\n", $"{Decl}\nIMPLEMENTATION ST\nx := 1;");
        Assert.NotEqual(text, edited);

        var resp = Update(ide, edited);

        Assert.True(resp.Accepted, "push refused: " + Why(resp));
        Assert.Equal("x := 1;", ide.ReadContent(new ItemRef("FB_Chart")).Body);
        Assert.Equal(Held(language), ide.StoredImplementation("Step"));
    }

    // ── a MOVE of a hidden item (spec: "nothing in the IDE is overwritten" — "its declaration edited, moved, or
    //    unchanged") ─────────────────────────────────────────────────────────────────────────────────

    /// <summary>A push that MOVES the item takes its own path — <c>MoveItem</c>: write, <c>ide.Move</c>, write again —
    /// and on TwinCAT that move is a delete-and-re-import of the item's whole document (DIALECT D4f), which invalidates
    /// every handle into it. The fake is told to behave so. Moved alone, moved with its declaration edited, and renamed
    /// and moved: each lands, and neither the POU's hidden body nor its hidden member's is written.</summary>
    public static IEnumerable<object?[]> HiddenMoves() =>
        from body in HiddenBodies()
        from shape in new[] { "moved", "moved+declaration", "renamed+moved" }
        select new[] { body[0], body[1], shape };

    [Theory]
    [MemberData(nameof(HiddenMoves))]
    public void Moving_a_hidden_item_lands_and_never_writes_a_hidden_body(string language, string? unsupported, string shape)
    {
        var ide = new FakeIde(Pou(language, unsupported, "Step"), Method("Step", language, unsupported))
        {
            InvalidatesHandlesOnMove = true,
            InvalidatesHandlesOnWrite = true,
        };
        var text = Pulled(ide);
        var pushed = shape == "moved+declaration"
            ? text.Replace("FUNCTION_BLOCK FB_Chart\n", "FUNCTION_BLOCK FB_Chart\n" + AddedInput)
            : text;
        var renamed = shape == "renamed+moved";
        if (renamed) pushed = pushed.Replace("FUNCTION_BLOCK FB_Chart\n", "FUNCTION_BLOCK FB_Moved\n");
        var refs = RefsService.Handle(ide);

        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp
                {
                    Name = "FB_Chart.fb", ToName = renamed ? "FB_Moved.fb" : null, ToFolder = "Sub",
                    SourceText = pushed, IfVersion = refs.Items["FB_Chart.fb"],
                },
            },
        });

        Assert.True(resp.Accepted, "push refused: " + Why(resp));
        var pou = renamed ? "FB_Moved" : "FB_Chart";
        Assert.Contains($"move:{pou}->Sub", ide.Recorded);                       // the move happened…
        Assert.Equal("Sub", RefsService.Handle(ide).Folders[pou + ".fb"]);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("create:" + pou) || r.StartsWith("delete:"));
        Assert.Equal(Held(language), ide.StoredImplementation(pou));             // …and wrote no hidden body
        Assert.Equal(Held(language), ide.StoredImplementation("Step"));
        if (shape == "moved+declaration")
            Assert.Contains("bStart : BOOL;", ide.ReadContent(new ItemRef(pou)).Declaration);
    }

    // ── a line that states no hidden body ────────────────────────────────────────────────────────

    /// <summary>Section 3b reverses 2b's bare <c>IMPLEMENTATION CFC|SFC|IL</c>: a body Volt does not show says so with
    /// UNSUPPORTED, on every language, so the bare line states no body at all. It is refused by name — the item, the line
    /// as written, and the line to write instead — and nothing is written, rather than read as the hidden body it once
    /// meant.</summary>
    [Theory]
    [InlineData("CFC")]
    [InlineData("SFC")]
    [InlineData("IL")]
    public void A_bare_CFC_SFC_or_IL_line_is_refused_naming_it_and_the_UNSUPPORTED_line(string language)
    {
        var ide = new FakeIde(Pou(language, null, "Step"), Method("Step", language));
        var bare = $"IMPLEMENTATION {language}";

        var pou = Reason(Update(ide, $"{Decl}\n{bare}\n\nEND_FUNCTION_BLOCK\n\nMETHOD Step : BOOL\n{Line(language)}\nEND_METHOD\n"));
        Assert.Contains("FB_Chart", pou);
        Assert.Contains($"'{bare}'", pou);
        Assert.Contains(Line(language), pou);

        var member = Reason(Update(ide, $"{Decl}\n{Line(language)}\n\nEND_FUNCTION_BLOCK\n\nMETHOD Step : BOOL\n{bare}\nEND_METHOD\n"));
        Assert.Contains("Step", member);
        Assert.Contains($"'{bare}'", member);

        Assert.Empty(ide.WrittenContent);
        Assert.Equal(Held(language), ide.StoredImplementation("FB_Chart"));
    }

    [Theory]
    [InlineData("CFC", null, "\nx := 1;")]
    [InlineData("IL", null, "\n\nx := 1;")]
    [InlineData("LD", "a vendor split point", "\nNETWORK\n  x := 1;\nEND_NETWORK")]
    [InlineData("SFC", null, " x := 1;")]                       // after the line, on it
    [InlineData("FBD", "a vendor split point", " x := 1;")]
    // A comment or pragma is text under the line too: no driver writes a hidden body, so it would be silently lost.
    // The LSP reports the same (`implementation-keyword-diagnostics.test.ts`).
    [InlineData("CFC", null, "\n(* note *)")]
    [InlineData("CFC", null, "\n// note")]
    [InlineData("SFC", null, "\n{attribute 'x'}")]
    public void Code_under_a_POUs_UNSUPPORTED_line_is_refused_naming_the_POU(string language, string? unsupported, string added)
    {
        var ide = new FakeIde(Pou(language, unsupported));
        var line = Line(language);
        var before = ide.ReadContent(new ItemRef("FB_Chart")).Body;

        var reason = Reason(Update(ide, $"{Decl}\n{line}{added}\n\nEND_FUNCTION_BLOCK\n"));

        Assert.Contains("FB_Chart", reason);
        Assert.Contains(line, reason);
        Assert.Empty(ide.WrittenContent);
        Assert.Equal(before, ide.ReadContent(new ItemRef("FB_Chart")).Body);
        Assert.Equal(Held(language), ide.StoredImplementation("FB_Chart"));
    }

    [Theory]
    [InlineData("SFC", null)]
    [InlineData("LD", "a vendor split point")]
    public void Code_under_a_members_UNSUPPORTED_line_is_refused_naming_the_member(string language, string? unsupported)
    {
        var ide = new FakeIde(Pou(null, null, "Sequence"), Method("Sequence", language, unsupported));
        var line = Line(language);
        var src = $"{Decl}\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n\nMETHOD Sequence : BOOL\n{line}\nSequence := TRUE;\nEND_METHOD\n";

        var reason = Reason(Update(ide, src));

        Assert.Contains("Sequence", reason);
        Assert.Contains(line, reason);
        Assert.Empty(ide.WrittenContent);
    }

    /// <summary>An ST body is always shown: <c>UNSUPPORTED</c> after <c>ST</c> states nothing a body can be, and neither
    /// does the word without a language. Each is refused naming the line.</summary>
    [Theory]
    [InlineData("IMPLEMENTATION ST UNSUPPORTED")]
    [InlineData("IMPLEMENTATION UNSUPPORTED")]
    public void UNSUPPORTED_after_ST_or_alone_is_refused_naming_the_line(string line)
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
    public void A_hidden_members_FOLDER_follows_its_keyword_line_and_round_trips(string language, string? unsupported)
    {
        var ide = new FakeIde(Pou(null, null, "Step"), Method("Step", language, unsupported, folder: "Sub/Deep"));
        var line = Line(language);

        var text = Pulled(ide);

        Assert.EndsWith($"\nMETHOD Step : BOOL\n{line}\n%FOLDER Sub/Deep\nEND_METHOD\n", text);
        var step = StReader.Read(text, ItemKind.Kinds.FunctionBlock, "FB_Chart").Members.Single();
        Assert.Equal("Sub/Deep", step.Folder);
        Assert.Equal("METHOD Step : BOOL", step.Declaration);
        Assert.Equal(line, step.Body);

        var resp = Update(ide, text);
        Assert.True(resp.Accepted, "push refused: " + Why(resp));
        Assert.Equal(text, Pulled(ide));
        Assert.Equal(Held(language), ide.StoredImplementation("Step"));
    }

    /// <summary>Every UNSUPPORTED line has the same SHAPE — "no implementation shown" — but each states a different
    /// LANGUAGE, and the stated language is the one signal for what a body is. A file stating one language over a body
    /// the IDE holds in another is mislabelled: accepted as a no-op, the IDE keeps its real body while the file (and the
    /// baseline the push records) says something else. So it is refused naming both, and nothing is written.</summary>
    [Theory]
    [InlineData("CFC", null, "SFC")]
    [InlineData("CFC", null, "LD")]
    [InlineData("LD", "a vendor split point", "FBD")]
    [InlineData("LD", "a vendor split point", "IL")]
    [InlineData("IL", null, "FBD")]
    public void An_UNSUPPORTED_line_stating_another_language_than_the_IDE_body_is_refused_naming_both(
        string language, string? unsupported, string stated)
    {
        var ide = new FakeIde(Pou(language, unsupported));
        var text = Pulled(ide);
        var mislabelled = text.Replace(Line(language) + "\n", Line(stated) + "\n");
        Assert.NotEqual(text, mislabelled);

        var reason = Reason(Update(ide, mislabelled));

        Assert.Contains(Line(language), reason);
        Assert.Contains(Line(stated), reason);
        Assert.Empty(ide.WrittenContent);
        Assert.Equal(text, Pulled(ide));
    }

    [Fact]
    public void An_UNSUPPORTED_member_line_stating_another_language_is_refused_naming_the_member()
    {
        var ide = new FakeIde(Pou(null, null, "Seq"), Method("Seq", "SFC"));
        var text = Pulled(ide);
        var mislabelled = text.Replace($"METHOD Seq : BOOL\n{Line("SFC")}\n", $"METHOD Seq : BOOL\n{Line("CFC")}\n");
        Assert.NotEqual(text, mislabelled);

        var reason = Reason(Update(ide, mislabelled));

        Assert.Contains("'Seq'", reason);
        Assert.Contains(Line("SFC"), reason);
        Assert.Contains(Line("CFC"), reason);
        Assert.Empty(ide.WrittenContent);
        Assert.Equal(text, Pulled(ide));
    }

    // ── no Volt comment survives ─────────────────────────────────────────────────────────────────

    /// <summary>A file that still holds a <c>(* @volt-… *)</c> comment ANYWHERE was written before the change —
    /// the pull writes none — and is refused naming <c>volt pull</c>, which rewrites it in the current format.
    /// Nothing is written.</summary>
    [Theory]
    [InlineData("FUNCTION_BLOCK FB_Chart\nVAR\n\tx : INT;\nEND_VAR\n(* @volt-graphical: CFC *)\n\nEND_FUNCTION_BLOCK\n")]
    [InlineData("FUNCTION_BLOCK FB_Chart\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION CFC UNSUPPORTED\n(* @volt-graphical: CFC *)\nEND_FUNCTION_BLOCK\n")]
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

    /// <summary>A declaration-only kind is NOT held to that rule: a GVL or a DUT is not read on a push at all (openspec
    /// <c>push-without-header-check</c>). The retired comment is a comment there — harmless text to the IDE — and it was
    /// only ever a hazard where it stated a boundary, which a GVL or a DUT does not have. This used to assert the
    /// refusal.</summary>
    [Theory]
    [InlineData("gvl", "VAR_GLOBAL\n\tn : INT; (* @volt-graphical: CFC *)\nEND_VAR")]
    [InlineData("struct", "TYPE ST_A :\nSTRUCT\n\t(* @volt-implementation *)\n\tn : INT;\nEND_STRUCT\nEND_TYPE")]
    public void A_volt_comment_in_a_declaration_only_kind_is_its_text_like_any_other(string ext, string source) =>
        Assert.Equal(source, StReader.Read(source + "\n", ext == "gvl" ? ItemKind.Kinds.Gvl : ItemKind.Kinds.Dut, "X").Declaration);

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

    // ── a hidden member NEW to an existing POU ───────────────────────────────────────────────────

    /// <summary>An UNSUPPORTED line on a member the IDE does not hold under that name and kind — a rename, a retype
    /// (which is a delete and a create), a member added by hand — is a CREATE of that member, and a create has no
    /// body to keep: the member would land as an empty ST body while the IDE lost the diagram it held. The item-level
    /// create was guarded (<see cref="CreateUnauthorableBodyTests"/>); the member level is guarded the same way,
    /// before anything is deleted or created.</summary>
    [Theory]
    [MemberData(nameof(HiddenBodies))]
    public void Renaming_a_hidden_member_is_refused_naming_it_and_the_IDE_keeps_its_body(string language, string? unsupported)
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
    [MemberData(nameof(HiddenBodies))]
    public void Retyping_a_hidden_member_is_refused_naming_it_and_the_IDE_keeps_its_body(string language, string? unsupported)
    {
        var ide = new FakeIde(Pou(null, null, "Seq"), Method("Seq", language, unsupported));
        var text = Pulled(ide);
        var line = Line(language);
        var retyped = text.Replace($"METHOD Seq : BOOL\n{line}\nEND_METHOD", $"ACTION Seq\n{line}\nEND_ACTION");
        Assert.NotEqual(text, retyped);

        var reason = Reason(Update(ide, retyped));

        Assert.Contains("'Seq'", reason);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("create:") || r.StartsWith("delete:"));
        Assert.Empty(ide.WrittenContent);
        Assert.Equal(text, Pulled(ide));
    }

    [Theory]
    [MemberData(nameof(HiddenBodies))]
    public void Adding_a_member_under_an_UNSUPPORTED_line_to_an_existing_POU_is_refused_naming_it(string language, string? unsupported)
    {
        _ = unsupported;
        var ide = new FakeIde(Pou(null, null, "Seq"), Method("Seq", "CFC"));
        var text = Pulled(ide);

        var reason = Reason(Update(ide, text + $"\nMETHOD Added : BOOL\n{Line(language)}\nEND_METHOD\n"));

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
    /// be written into a file: the file would read that line as the body's boundary — a hidden body, a network
    /// body, or a second boundary — so the body would come back in a language it is not. The driver knows the body
    /// is ST and refuses it by name (<see cref="ImplementationMarker.RequireStBody"/>) rather than hand the pull a
    /// text that states the wrong language.</summary>
    [Theory]
    [InlineData("IMPLEMENTATION CFC")]
    [InlineData("IMPLEMENTATION CFC UNSUPPORTED")]
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
                                               "(*\nIMPLEMENTATION CFC UNSUPPORTED\n*)\nx := 1;", null, null));

        Assert.Equal($"{Decl}\nIMPLEMENTATION ST\n(*\nIMPLEMENTATION CFC UNSUPPORTED\n*)\nx := 1;\n\nEND_FUNCTION_BLOCK\n", Pulled(ide));
    }
}
