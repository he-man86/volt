using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Format.Network;
using Volt.Engine.Item;
using Volt.Engine.Library;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// GREP SEARCHES THE TEXT FETCH SHIPS AND ANSWERS LINES (openspec <c>grep-item-sources</c>).
///
/// <para>Every expectation about a line is taken from <c>fetch</c>'s own <c>sourceText</c> for the item, never typed
/// out here: the claim under test is that a match IS the fetched line at that number, so the fetched text is the
/// oracle. Run over both vendors' tree shapes — a CODESYS application under <c>Device/Plc Logic</c>, a TwinCAT PLC
/// project node — because the path is the identity and the two spell it differently.</para>
/// </summary>
public class GrepServiceTests
{
    public static TheoryData<string> Vendors => new() { "codesys", "twincat" };

    private static string App(string vendor) => vendor == "twincat"
        ? "TwinCAT Project1/PLC/Line/Line Project"
        : "Device/Plc Logic/Application";

    private const string MotorDecl = "FUNCTION_BLOCK FB_Motor\nVAR\n\tbRunning : BOOL;\n\txErrorActive\t\t: BOOL;\nEND_VAR";
    private const string MotorBody = "IF xErrorActive THEN\n\txErrorActive\t\t:= TRUE;\nEND_IF";
    private const string PrgDecl = "PROGRAM PLC_PRG\nVAR\n\tfbMotor : FB_Motor;\n\tlamp : BOOL;\nEND_VAR";
    private const string PrgBody = "fbMotor();\nIF fbMotor.bRunning THEN\n\tlamp := fbMotor.bRunning;\nEND_IF";

    private static FakeIde Project(string vendor, params FakeIde.Item[] extra)
    {
        var app = App(vendor);
        var items = new List<FakeIde.Item>
        {
            new("FB_Motor", ItemKind.PlcPou, app + "/POUs", true, MotorDecl, MotorBody, null, null, new[] { "Start" }),
            new("Start", ItemKind.PlcMethod, "", false, "METHOD Start : BOOL\nVAR\nEND_VAR", "Start := NOT xErrorActive;", null, null),
            FakeIde.Item.TextualPou("PLC_PRG", PrgDecl, PrgBody, app),
            FakeIde.Item.TextualPou("GVL_IO", "VAR_GLOBAL\n\txEnable : BOOL;\nEND_VAR", "", app),
            FakeIde.Item.Library("Util", "LIBRARY Util\nNAMESPACE Util\nRESOLUTION bRunning, 1.0.0.0 (x)\n", app + "/Library Manager"),
        };
        items.AddRange(extra);
        var ide = new FakeIde(items.ToArray()) { HealthPlatform = vendor };
        ide.ContainerKinds[app] = ItemKind.Application;
        return ide;
    }

    private static GrepResponse Grep(FakeIde ide, string pattern, Action<GrepRequest>? with = null)
    {
        var req = new GrepRequest { Pattern = pattern };
        with?.Invoke(req);
        return GrepService.Handle(ide, req);
    }

    private static Dictionary<string, string> Fetched(FakeIde ide) =>
        FetchService.Handle(ide, new FetchRequest { Init = true }).Changed.ToDictionary(c => c.Name, c => c.SourceText);

    /// <summary>The fetched text's line <paramref name="number"/> (1-based), without its line ending.</summary>
    private static string FetchedLine(string text, int number) => text.Split('\n')[number - 1];

    private static BridgeException Refused(Func<object> run) => Assert.Throws<BridgeException>(run);

    // ── 2.1 three places, versions ──────────────────────────────────────────────────────────────────

    [Theory]
    [MemberData(nameof(Vendors))]
    public void An_identifier_used_in_three_places_is_three_matches_at_the_fetched_lines(string vendor)
    {
        var ide = Project(vendor);
        var fetched = Fetched(ide);
        var refs = RefsService.Handle(ide);
        var motor = $"{App(vendor)}/POUs/FB_Motor.pou";
        var prg = $"{App(vendor)}/PLC_PRG.pou";

        var r = Grep(ide, "bRunning");

        // Ordinal path order: `PLC_PRG.pou` sorts before `POUs/`.
        Assert.Equal(new[] { prg, prg, motor }, r.Matches.Select(m => m.Name));
        Assert.All(r.Matches, m => Assert.Equal(FetchedLine(fetched[m.Name], m.Line), m.Text));
        Assert.Equal(new[] { "IF fbMotor.bRunning THEN", "\tlamp := fbMotor.bRunning;", "\tbRunning : BOOL;" },
                     r.Matches.Select(m => m.Text));
        Assert.Equal(new Dictionary<string, string> { [motor] = refs.Items[motor], [prg] = refs.Items[prg] }, r.Items);
        Assert.Equal(3, r.TotalMatches);
        Assert.False(r.Truncated);
        Assert.Empty(r.NotSearched);
        // Every item but the library is searched: FB_Motor, PLC_PRG, GVL_IO.
        Assert.Equal(3, r.Searched);
    }

    [Fact]
    public void Matches_are_in_path_order_then_line_order()
    {
        var r = Grep(Project("codesys"), "x");

        var keys = r.Matches.Select(m => (m.Name, m.Line)).ToList();
        Assert.Equal(keys.OrderBy(k => k.Name, StringComparer.Ordinal).ThenBy(k => k.Line), keys);
    }

    // ── 2.2 case ──────────────────────────────────────────────────────────────────────────────────

    private static FakeIde Cased() => new(FakeIde.Item.TextualPou("GVL_Case",
        "VAR_GLOBAL\n\ta : FB_Motor;\n\tb : fb_motor;\n\tc : FB_MOTOR;\n\td : fbMotor;\n\tÄnderung : INT;\n\t电机控制 : FB_电机;\nEND_VAR", ""));

    /// <summary>Case, not spelling: <c>fbMotor</c> is another identifier than <c>FB_Motor</c> in IEC 61131-3, and does
    /// not match it.</summary>
    [Fact]
    public void Case_is_ignored_by_default()
    {
        var r = Grep(Cased(), "fb_motor");

        Assert.Equal(new[] { "\ta : FB_Motor;", "\tb : fb_motor;", "\tc : FB_MOTOR;" }, r.Matches.Select(m => m.Text));
    }

    [Fact]
    public void Case_sensitive_matches_exact_case_only()
    {
        var r = Grep(Cased(), "FB_Motor", q => q.CaseSensitive = true);

        Assert.Equal(new[] { "\ta : FB_Motor;" }, r.Matches.Select(m => m.Text));
    }

    [Fact]
    public void A_non_ASCII_letter_folds_and_a_CJK_identifier_matches()
    {
        Assert.Equal(new[] { "\tÄnderung : INT;" }, Grep(Cased(), "änderung").Matches.Select(m => m.Text));
        Assert.Equal(new[] { "\t电机控制 : FB_电机;" }, Grep(Cased(), "电机控制").Matches.Select(m => m.Text));
    }

    // ── 2.3 literal, invalid, catastrophic ────────────────────────────────────────────────────────

    [Fact]
    public void A_literal_with_regex_metacharacters_matches_as_text()
    {
        var r = Grep(Project("codesys"), "fbMotor(", q => q.Literal = true);

        Assert.Equal(new[] { "fbMotor();" }, r.Matches.Select(m => m.Text));
    }

    [Fact]
    public void An_invalid_regular_expression_is_a_BAD_REQUEST_naming_it_and_nothing_is_walked()
    {
        var ide = Project("codesys");

        var ex = Refused(() => Grep(ide, "fbMotor("));

        Assert.Equal(BridgeErrorCodes.BadRequest, ex.ErrorCode);
        Assert.Contains("not a valid regular expression", ex.Message);
        Assert.Contains("fbMotor(", ex.Message);
        Assert.Equal(0, ide.WalkCalls);
    }

    [Fact]
    public void A_catastrophic_pattern_times_out_as_a_BAD_REQUEST_with_no_answer()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("GVL_Long",
            "VAR_GLOBAL\n\t(*" + new string('a', 5000) + "b*)\nEND_VAR", ""));

        var ex = Refused(() => Grep(ide, "(a+)+$"));

        Assert.Equal(BridgeErrorCodes.BadRequest, ex.ErrorCode);
        Assert.Contains("timed out", ex.Message);
        Assert.Contains("(a+)+$", ex.Message);
    }

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    public void An_empty_pattern_is_a_BAD_REQUEST(string? pattern)
    {
        var ide = Project("codesys");

        var ex = Refused(() => GrepService.Handle(ide, new GrepRequest { Pattern = pattern! }));

        Assert.Equal(BridgeErrorCodes.BadRequest, ex.ErrorCode);
        Assert.Contains("pattern", ex.Message);
        Assert.Equal(0, ide.WalkCalls);
    }

    // ── 2.4 whitespace and members ────────────────────────────────────────────────────────────────

    [Theory]
    [MemberData(nameof(Vendors))]
    public void Tabs_are_kept_byte_for_byte(string vendor)
    {
        var ide = Project(vendor);
        var motor = $"{App(vendor)}/POUs/FB_Motor.pou";

        var hit = Grep(ide, "xErrorActive\t\t:= TRUE", q => q.Literal = true).Matches.Single();

        Assert.Equal("\txErrorActive\t\t:= TRUE;", hit.Text);
        Assert.Equal(FetchedLine(Fetched(ide)[motor], hit.Line), hit.Text);
    }

    [Theory]
    [MemberData(nameof(Vendors))]
    public void A_match_in_a_method_after_the_end_of_the_block_has_its_fetched_line_number(string vendor)
    {
        var ide = Project(vendor);
        var motor = $"{App(vendor)}/POUs/FB_Motor.pou";
        var lines = Fetched(ide)[motor].Split('\n');

        var hit = Grep(ide, "Start := NOT", q => q.Literal = true).Matches.Single();

        Assert.Equal(motor, hit.Name);
        Assert.Equal(lines[hit.Line - 1], hit.Text);
        Assert.True(hit.Line - 1 > Array.IndexOf(lines, "END_FUNCTION_BLOCK"), "the method's line is after END_FUNCTION_BLOCK");
    }

    [Fact]
    public void A_line_longer_than_the_cap_is_cut_with_an_ellipsis()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("GVL_Long", "VAR_GLOBAL\n\tx : INT; (*" + new string('y', 900) + "*)\nEND_VAR", ""));

        var match = Grep(ide, "x : INT").Matches.Single();

        Assert.Equal(GrepService.TextCap + 1, match.Text.Length);
        Assert.EndsWith("…", match.Text);
        Assert.True(match.Cut);
    }

    /// <summary>A whole line says so by having no <c>cut</c> (design B23): a client tells a cut text from one that ends
    /// in <c>…</c> by the flag, not by the character.</summary>
    [Fact]
    public void A_whole_line_ending_in_an_ellipsis_is_not_cut()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("GVL_Dots", "VAR_GLOBAL\n\tx : INT; (* wait *)…\nEND_VAR", ""));

        var match = Grep(ide, "x : INT").Matches.Single();

        Assert.Equal("\tx : INT; (* wait *)…", match.Text);
        Assert.Null(match.Cut);
    }

    // ── 2.5 path globs ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_kind_glob_searches_only_that_kind()
    {
        var r = Grep(Project("codesys"), "x", q => q.Paths = new List<string> { "**/*.gvl" });

        Assert.Equal(1, r.Searched);
        Assert.All(r.Matches, m => Assert.EndsWith(".gvl", m.Name));
        Assert.NotEmpty(r.Matches);
    }

    [Fact]
    public void An_application_glob_answers_nothing_from_another_application()
    {
        const string line1 = "Line1/Plc Logic/App", line2 = "Line2/Plc Logic/App";
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "xEnable := TRUE;", line1),
            FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "xEnable := TRUE;", line2));

        var r = Grep(ide, "xEnable", q => q.Paths = new List<string> { "Line1/**" });

        Assert.Equal(new[] { $"{line1}/PLC_PRG.pou" }, r.Matches.Select(m => m.Name));
        Assert.Equal(1, r.Searched);
    }

    [Fact]
    public void A_glob_matches_the_escaped_path_ignoring_case()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("A/B", "PROGRAM A\nVAR\nEND_VAR", "xEnable := TRUE;", "POUs"));
        Assert.Contains("POUs/A%2FB.pou", RefsService.Handle(ide).Items.Keys);

        var r = Grep(ide, "xEnable", q => q.Paths = new List<string> { "pous/a%2fb.POU" });

        Assert.Equal(new[] { "POUs/A%2FB.pou" }, r.Matches.Select(m => m.Name));
    }

    [Fact]
    public void A_glob_matching_nothing_searches_nothing_and_is_no_error()
    {
        var r = Grep(Project("codesys"), "x", q => q.Paths = new List<string> { "**/*.nothing" });

        Assert.Equal(0, r.Searched);
        Assert.Empty(r.Matches);
        Assert.Empty(r.NotSearched);
    }

    [Fact]
    public void A_star_stays_within_one_segment()
    {
        var r = Grep(Project("codesys"), "x", q => q.Paths = new List<string> { "Device/*/FB_Motor.pou" });

        Assert.Equal(0, r.Searched);
    }

    // ── 2.6 scope = what fetch ships as text ──────────────────────────────────────────────────────

    [Fact]
    public void A_network_text_body_is_searched_as_fetch_ships_it()
    {
        var ide = Project("codesys",
            new FakeIde.Item("PRG_Lamp", ItemKind.PlcPou, "POUs", true, "PROGRAM PRG_Lamp\nVAR\n\tlamp : BOOL;\nEND_VAR",
                             "lamp := start;", "FBD", null));
        var text = Fetched(ide)["POUs/PRG_Lamp.pou"];
        Assert.Contains("%LANGUAGE FBD", text);

        var r = Grep(ide, "lamp := start", q => { q.Literal = true; q.Paths = new List<string> { "POUs/PRG_Lamp.pou" }; });

        var hit = r.Matches.Single();
        Assert.Equal(FetchedLine(text, hit.Line), hit.Text);
        Assert.Empty(r.NotSearched);
    }

    [Fact]
    public void A_CFC_body_is_named_not_searched_while_the_declaration_still_matches()
    {
        var ide = Project("codesys",
            new FakeIde.Item("PRG_Conveyor", ItemKind.PlcPou, "POUs", true, "PROGRAM PRG_Conveyor\nVAR\n\tbelt : BOOL;\nEND_VAR",
                             "belt", "CFC", null));

        var r = Grep(ide, "belt", q => q.Paths = new List<string> { "POUs/*" });

        Assert.Equal(new[] { "\tbelt : BOOL;" }, r.Matches.Select(m => m.Text));
        var entry = r.NotSearched.Single();
        Assert.Equal("POUs/PRG_Conveyor.pou", entry.Name);
        Assert.Contains("%LANGUAGE CFC UNSUPPORTED", entry.Reason);
        Assert.Equal(BridgeErrorCodes.Unsupported, entry.Code);
    }

    [Fact]
    public void An_LD_body_network_text_cannot_spell_is_named_with_its_reason()
    {
        var ide = new FakeIde(
            new FakeIde.Item("FB_Mix", ItemKind.PlcPou, "", true, "FUNCTION_BLOCK FB_Mix\nVAR\n\tx : INT;\nEND_VAR", "x := 1;", null, null,
                             new[] { "Rung" }),
            new FakeIde.Item("Rung", ItemKind.PlcMethod, "", false, "METHOD Rung : BOOL", "x := 2;", "LD", null, null,
                             "a vendor split point"));

        var entry = Grep(ide, "x").NotSearched.Single();

        Assert.Equal("FB_Mix.pou", entry.Name);
        Assert.Contains("'Rung'", entry.Reason);
        Assert.Contains("%LANGUAGE LD UNSUPPORTED", entry.Reason);
        Assert.Contains("a vendor split point", entry.Reason);
    }

    [Fact]
    public void With_network_text_off_an_LD_body_is_not_searched_and_named()
    {
        var ide = new FakeIde(new FakeIde.Item("PRG_Rung", ItemKind.PlcPou, "", true, "PROGRAM PRG_Rung\nVAR\n\tlamp : BOOL;\nEND_VAR",
                                               "lamp := start;", "LD", null));
        var was = NetworkTextSwitch.Enabled;
        NetworkTextSwitch.Enabled = false;
        try
        {
            var r = Grep(ide, "lamp");

            Assert.Equal(new[] { "\tlamp : BOOL;" }, r.Matches.Select(m => m.Text));
            Assert.Contains("%LANGUAGE LD UNSUPPORTED", r.NotSearched.Single(n => n.Name == "PRG_Rung.pou").Reason);
        }
        finally { NetworkTextSwitch.Enabled = was; }
    }

    [Fact]
    public void An_unreadable_item_is_named_with_the_reason_refs_gives()
    {
        var ide = Project("codesys", FakeIde.Item.MalformedGraphical("FB_Broken", "POUs"));
        var unread = RefsService.Handle(ide).Unreadable.Single();

        var r = Grep(ide, "x");

        Assert.Equal(new NotSearchedItem(unread.Name, unread.Code, unread.Reason), r.NotSearched.Single());
        Assert.Equal(BridgeErrorCodes.Unreadable, r.NotSearched.Single().Code);
        Assert.DoesNotContain(r.Matches, m => m.Name == unread.Name);
    }

    [Fact]
    public void An_unreadable_item_out_of_scope_is_not_named()
    {
        var ide = Project("codesys", FakeIde.Item.MalformedGraphical("FB_Broken", "POUs"));

        Assert.Empty(Grep(ide, "x", q => q.Paths = new List<string> { "**/*.gvl" }).NotSearched);
    }

    [Fact]
    public void Libraries_are_out_of_scope_and_unlisted()
    {
        var ide = Project("codesys");
        Assert.Contains(Fetched(ide), f => f.Key.EndsWith(".library", StringComparison.Ordinal) && f.Value.Contains("RESOLUTION bRunning"));

        var r = Grep(ide, "RESOLUTION");

        Assert.Empty(r.Matches);
        Assert.Empty(r.NotSearched);
    }

    [Fact]
    public void Unwalked_folders_are_passed_through_as_refs_answers_them()
    {
        var ide = Project("codesys");
        ide.UnwalkableFolders = new[] { "Device/Plc Logic/Application/POUs" };

        var r = Grep(ide, "bRunning");

        Assert.Equal(RefsService.Handle(ide).UnwalkedFolders, r.UnwalkedFolders);
        Assert.Equal(new[] { "Device/Plc Logic/Application/POUs" }, r.UnwalkedFolders);
        Assert.DoesNotContain(r.Matches, m => m.Name.Contains("FB_Motor"));
    }

    // ── 2.7 bounds ────────────────────────────────────────────────────────────────────────────────

    private static FakeIde Lines(int count) => new(FakeIde.Item.TextualPou("GVL_Many",
        "VAR_GLOBAL\n" + string.Concat(Enumerable.Range(0, count).Select(i => $"\tv{i} : INT;\n")) + "END_VAR", ""));

    [Fact]
    public void The_default_limit_answers_200_and_counts_the_rest()
    {
        var r = Grep(Lines(300), "INT");

        Assert.Equal(GrepService.DefaultLimit, r.Matches.Count);
        Assert.Equal(300, r.TotalMatches);
        Assert.True(r.Truncated);
    }

    [Fact]
    public void A_limit_is_respected()
    {
        var r = Grep(Lines(30), "INT", q => q.Limit = 5);

        Assert.Equal(5, r.Matches.Count);
        Assert.Equal(30, r.TotalMatches);
        Assert.True(r.Truncated);
    }

    [Fact]
    public void Counting_stops_at_the_cap()
    {
        var r = Grep(Lines(12_000), ".");

        Assert.Equal(GrepService.DefaultLimit, r.Matches.Count);
        Assert.Equal(GrepService.CountCap, r.TotalMatches);
        Assert.True(r.Truncated);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1001)]
    public void A_limit_out_of_range_is_a_BAD_REQUEST(int limit)
    {
        var ide = Lines(3);

        var ex = Refused(() => Grep(ide, "INT", q => q.Limit = limit));

        Assert.Equal(BridgeErrorCodes.BadRequest, ex.ErrorCode);
        Assert.Contains("limit", ex.Message);
        Assert.Equal(0, ide.WalkCalls);
    }

    // ── the guard ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_grep_bound_to_another_project_is_WRONG_PROJECT()
    {
        var ide = Project("codesys");

        var ex = Refused(() => Grep(ide, "x", q => { q.ExpectedPlatform = "codesys"; q.ExpectedProjectName = "Other"; }));

        Assert.Equal(BridgeErrorCodes.WrongProject, ex.ErrorCode);
    }
}
