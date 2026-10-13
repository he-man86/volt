using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.St;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// THE <c>%</c>-LINES, both directions (openspec <c>bridge-one-to-one</c> §1.2): <see cref="PropertyLines"/> — what a
/// property line is, its one canonical spelling, every value form read back exactly — and where the ST reader and writer
/// put them on every kind of object (an item under its boundary line, a DUT / GVL / interface closing its declaration, a
/// member after its <c>%FOLDER</c>, a property and an interface member closing theirs).
/// </summary>
public class PropertyLinesTests
{
    private static ObjectProperties P(
        ObjectClass? cls = null, bool exclude = false, bool linkAlways = false, bool external = false, bool systemCall = false,
        int reserve = 0, string? defines = null, string[]? undefines = null, string? comment = null, bool parameterList = false,
        NetVarSetting[]? netVar = null, FileLink? fileLink = null) =>
        new(cls, exclude, linkAlways, external, systemCall, reserve, defines, undefines ?? Array.Empty<string>(), comment,
            parameterList, netVar ?? Array.Empty<NetVarSetting>(), fileLink);

    // ── what a property line is ─────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("%CLASS CHECK CheckBounds", "CLASS")]
    [InlineData("%EXCLUDE_FROM_BUILD", "EXCLUDE_FROM_BUILD")]
    [InlineData("  %LINK_ALWAYS  ", "LINK_ALWAYS")]
    [InlineData("%FOLDER Sub/Deep", "FOLDER")]
    [InlineData("%NETVAR Interval: T#50ms", "NETVAR")]
    public void A_closed_key_ending_at_a_space_or_the_line_end_is_a_property_line(string line, string key) =>
        Assert.Equal(key, PropertyLines.KeyOf(line));

    /// <summary>Every other line opening with <c>%</c> is CODE: a direct address (4 in the corpora), a key in another
    /// case, a key that runs on, a bare <c>%FOLDER</c> with no path (as the push always read it).</summary>
    [Theory]
    [InlineData("%QB1 := 5;")]
    [InlineData("%IX0.0 := TRUE;")]
    [InlineData("%class CHECK CheckBounds")]
    [InlineData("%CLASSIC := 1;")]
    [InlineData("%EXCLUDE_FROM_BUILDS")]
    [InlineData("%FOLDER")]
    [InlineData("x := 1; %EXCLUDE_FROM_BUILD")]
    public void Any_other_percent_line_is_code(string line) => Assert.Null(PropertyLines.KeyOf(line));

    // ── one spelling, read back exactly ─────────────────────────────────────────────────────────────────────────

    public static IEnumerable<object[]> Spelled() => new[]
    {
        new object[] { P(cls: new ObjectClass(ObjectClass.Check, "CheckDivInt32")), new[] { "%CLASS CHECK CheckDivInt32" } },
        new object[] { P(cls: new ObjectClass(ObjectClass.Persistent, null)), new[] { "%CLASS PERSISTENT" } },
        new object[] { P(cls: new ObjectClass(ObjectClass.TextListEnum, null)), new[] { "%CLASS TEXTLIST_ENUM" } },
        new object[] { P(cls: new ObjectClass(ObjectClass.Nvl, null), netVar: new[] { new NetVarSetting("TaskName", "LogicTask") }),
                       new[] { "%CLASS NVL", "%NETVAR TaskName: LogicTask" } },
        new object[] { P(exclude: true, linkAlways: true, external: true, systemCall: true, reserve: 200),
                       new[] { "%EXCLUDE_FROM_BUILD", "%LINK_ALWAYS", "%EXTERNAL", "%ENABLE_SYSTEM_CALL", "%ONLINE_CHANGE_RESERVE 200" } },
        new object[] { P(defines: "A, B", undefines: new[] { "X", "Y" }), new[] { "%COMPILER_DEFINES 'A, B'", "%UNDEFINE 'X'", "%UNDEFINE 'Y'" } },
        new object[] { P(comment: "line one\nline 'two' $5\ttab"), new[] { "%COMMENT 'line one$Nline $'two$' $$5$Ttab'" } },
        new object[] { P(comment: "bell\u0007"), new[] { "%COMMENT 'bell$07'" } },
        new object[] { P(parameterList: true), new[] { "%PARAMETER_LIST" } },
        new object[] { P(netVar: new[] { new NetVarSetting("EventVariable", ""), new NetVarSetting("Interval", "T#50ms") }),
                       new[] { "%NETVAR EventVariable: ''", "%NETVAR Interval: T#50ms" } },
        new object[] { P(fileLink: new FileLink("ExportBeforeCompile", @"C:\io\gvl.txt")), new[] { @"%FILE_LINK ExportBeforeCompile 'C:\io\gvl.txt'" } },
    };

    [Theory]
    [MemberData(nameof(Spelled))]
    public void Every_property_is_spelled_once_and_read_back_exactly(ObjectProperties props, string[] lines)
    {
        Assert.Equal(lines, PropertyLines.Write(props));
        var (back, folder) = PropertyLines.Read(lines, "'X'", 5, folderAllowed: false);
        Assert.Equal(props, back);
        Assert.Null(folder);
    }

    [Fact]
    public void The_measured_absence_of_every_property_writes_no_line() =>
        Assert.Empty(PropertyLines.Write(ObjectProperties.None));

    [Fact]
    public void A_members_class_comes_before_its_folder_and_the_rest_after()
    {
        var lines = PropertyLines.Write(P(cls: new ObjectClass(ObjectClass.Persistent, null), exclude: true), "Sub");
        Assert.Equal(new[] { "%CLASS PERSISTENT", "%FOLDER Sub", "%EXCLUDE_FROM_BUILD" }, lines);
        var (props, folder) = PropertyLines.Read(lines, "'M'", 1, folderAllowed: true);
        Assert.Equal("Sub", folder);
        Assert.True(props.ExcludeFromBuild);
    }

    // ── refused by line, naming the key ─────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(new[] { "%LINK_ALWAYS", "%EXCLUDE_FROM_BUILD" }, "%EXCLUDE_FROM_BUILD", "line 8")]
    [InlineData(new[] { "%COMMENT 'a'", "%COMMENT 'b'" }, "written twice", "line 8")]
    [InlineData(new[] { "%EXTERNAL yes" }, "takes no value", "line 7")]
    [InlineData(new[] { "%ONLINE_CHANGE_RESERVE" }, "takes a value", "line 7")]
    [InlineData(new[] { "%ONLINE_CHANGE_RESERVE 0" }, "positive whole number", "line 7")]
    [InlineData(new[] { "%ONLINE_CHANGE_RESERVE -5" }, "positive whole number", "line 7")]
    [InlineData(new[] { "%CLASS SPECIAL" }, "%CLASS names one of", "line 7")]
    [InlineData(new[] { "%CLASS CHECK" }, "names the check", "line 7")]
    [InlineData(new[] { "%CLASS NVL extra" }, "takes no argument", "line 7")]
    [InlineData(new[] { "%COMMENT ''" }, "absence", "line 7")]
    [InlineData(new[] { "%COMMENT unquoted" }, "ST string", "line 7")]
    [InlineData(new[] { "%COMMENT 'it's'" }, "written $'", "line 7")]
    [InlineData(new[] { "%COMMENT 'bad $Z'" }, "no ST string escape", "line 7")]
    [InlineData(new[] { "%NETVAR NoColon" }, "<member>: <value>", "line 7")]
    [InlineData(new[] { "%FILE_LINK ExportBeforeCompile" }, "<link type> '<path>'", "line 7")]
    [InlineData(new[] { "%FOLDER Sub" }, "member's block", "line 7")]
    public void A_line_out_of_the_grammar_is_refused_naming_it_and_its_line(string[] lines, string why, string at)
    {
        var ex = Assert.Throws<BridgeException>(() => PropertyLines.Read(lines, "'FB'", 7, folderAllowed: false));
        Assert.Contains(why, ex.Message);
        Assert.Contains("'FB', " + at, ex.Message);
        Assert.Equal(Volt.Contracts.BridgeErrorCodes.InvalidSt, ex.ErrorCode);
    }

    /// <summary>A <c>%NETVAR</c> value the line cannot carry EXACTLY — surrounding blanks (the reader trims the line), a
    /// line break (it would break the file), or the literal <c>''</c> (it reads back as empty) — is refused by name, never
    /// written to read back different (gate review of step 3, finding 8: a value with a trailing blank read back without it,
    /// and every push of that list was then refused as "a %NETVAR change"). 0 in the corpora.</summary>
    [Theory]
    [InlineData("a.gvl ")]
    [InlineData(" a.gvl")]
    [InlineData("two\nlines")]
    [InlineData("''")]
    public void A_netvar_value_the_line_cannot_carry_is_refused_by_name(string value)
    {
        var nv = new NetVarSetting("ImportFileName", value);
        Assert.NotNull(PropertyLines.Unspellable(nv));
        var ex = Assert.Throws<BridgeException>(() => PropertyLines.Write(P(netVar: new[] { nv })));
        Assert.Contains("ImportFileName", ex.Message);
    }

    /// <summary>…and every value it can carry reads back exactly.</summary>
    [Theory]
    [InlineData("a.gvl")]
    [InlineData("")]
    [InlineData("T#50ms")]
    [InlineData("k1=v1; k2=v 2")]
    public void A_netvar_value_the_line_carries_reads_back_exactly(string value)
    {
        var nv = new NetVarSetting("ImportFileName", value);
        Assert.Null(PropertyLines.Unspellable(nv));
        var (read, _) = PropertyLines.Read(PropertyLines.Write(P(netVar: new[] { nv })), "'G'", 0, folderAllowed: false);
        Assert.Equal(value, Assert.Single(read.NetVar).Value);
    }

    // ── where they stand: the reader and the writer, every kind ─────────────────────────────────────────────────

    private static readonly ObjectProperties Excluded = P(exclude: true, comment: "doc");

    public static IEnumerable<object[]> Placed()
    {
        yield return new object[] { "pou",
            new ItemContent(ItemKind.Kinds.Pou, "FUNCTION_BLOCK F\nVAR\nEND_VAR", "x := 1;", new List<Member>(), Excluded),
            "FUNCTION_BLOCK F\nVAR\nEND_VAR\nIMPLEMENTATION ST\n%EXCLUDE_FROM_BUILD\n%COMMENT 'doc'\nx := 1;\n\nEND_FUNCTION_BLOCK\n" };
        yield return new object[] { "dut",
            new ItemContent(ItemKind.Kinds.Dut, "TYPE E :\n(\n\tA\n);\nEND_TYPE", null, new List<Member>(),
                            P(cls: new ObjectClass(ObjectClass.TextListEnum, null))),
            "TYPE E :\n(\n\tA\n);\nEND_TYPE\n%CLASS TEXTLIST_ENUM\n" };
        yield return new object[] { "gvl",
            new ItemContent(ItemKind.Kinds.Gvl, "VAR_GLOBAL\nEND_VAR", null, new List<Member>(), P(linkAlways: true)),
            "VAR_GLOBAL\nEND_VAR\n%LINK_ALWAYS\n" };
        yield return new object[] { "interface",
            new ItemContent(ItemKind.Kinds.Interface, "INTERFACE I", null,
                new List<Member> { new(ItemKind.Kinds.InterfaceMethod, "M", "METHOD M : BOOL", null, P(exclude: true), "Cmds") },
                P(comment: "doc")),
            "INTERFACE I\n%COMMENT 'doc'\n\nMETHOD M : BOOL\n%FOLDER Cmds\n%EXCLUDE_FROM_BUILD\nEND_METHOD\n\nEND_INTERFACE\n" };
        yield return new object[] { "members",
            new ItemContent(ItemKind.Kinds.Pou, "FUNCTION_BLOCK F\nVAR\nEND_VAR", "", new List<Member>
            {
                new(ItemKind.Kinds.Method, "M", "METHOD M : BOOL", "M := TRUE;", P(exclude: true), "Sub"),
                new(ItemKind.Kinds.Property, "P", "PROPERTY P : INT", null, P(exclude: true), "Props",
                    new Accessor("", "P := 1;"), null),
            }, ObjectProperties.None),
            "FUNCTION_BLOCK F\nVAR\nEND_VAR\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n\n" +
            "METHOD M : BOOL\nIMPLEMENTATION ST\n%FOLDER Sub\n%EXCLUDE_FROM_BUILD\nM := TRUE;\nEND_METHOD\n\n" +
            "PROPERTY P : INT\n%FOLDER Props\n%EXCLUDE_FROM_BUILD\nGET\nIMPLEMENTATION ST\nP := 1;\nEND_GET\nEND_PROPERTY\n" };
    }

    [Theory]
    [MemberData(nameof(Placed))]
    public void Each_kind_spells_them_in_its_place_and_reads_them_back(string _, ItemContent item, string text)
    {
        Assert.Equal(text, StWriter.Write(item));
        var back = StReader.Read(text, item.Kind, "X");
        Assert.Equal(item.Properties, back.Properties);
        Assert.Equal(item.Declaration, back.Declaration);
        Assert.Equal(item.Members.Select(m => (m.Name, m.Properties, m.Folder)), back.Members.Select(m => (m.Name, m.Properties, m.Folder)));
    }

    /// <summary>A line that LOOKS like a property inside a comment closing a declaration is the comment's.</summary>
    [Fact]
    public void A_property_lookalike_inside_a_closing_comment_is_the_comments()
    {
        const string text = "VAR_GLOBAL\nEND_VAR\n(*\n%LINK_ALWAYS\n*)\n";
        var read = StReader.Read(text, ItemKind.Kinds.Gvl, "G");
        Assert.Equal(ObjectProperties.None, read.Properties);
        Assert.EndsWith("*)", read.Declaration);
    }

    /// <summary>A property line INSIDE a declaration — anywhere but closing it — is refused by name, on a GVL as on a POU.</summary>
    [Fact]
    public void A_property_line_inside_a_gvl_declaration_is_refused_by_name()
    {
        var ex = Assert.Throws<BridgeException>(() =>
            StReader.Read("VAR_GLOBAL\n%LINK_ALWAYS\n\tg : INT;\nEND_VAR\n", ItemKind.Kinds.Gvl, "G"));
        Assert.Contains("%LINK_ALWAYS", ex.Message);
        Assert.Contains("'G'", ex.Message);
    }

    // ── every text verbatim (bridge-one-to-one §1.1, trailing-newline-cache) ────────────────────────────────────

    public static IEnumerable<object[]> Verbatim() => new[]
    {
        new object[] { "FUNCTION_BLOCK F\nVAR\nEND_VAR\n\n", "x := 1;\n\n\n" },
        new object[] { "FUNCTION_BLOCK F\nVAR\nEND_VAR", "\n" },
        new object[] { "FUNCTION_BLOCK F\nVAR\nEND_VAR\n", "" },
        new object[] { "FUNCTION_BLOCK F\nVAR\nEND_VAR  ", "x := 1;  " },
    };

    /// <summary>Both vendors keep a declaration's and a body's trailing newlines across a reload (measured,
    /// <c>trailing-newline-cache</c>), so the file spells them and the round trip gives them back — on a POU, a method, a
    /// property's accessor, a DUT.</summary>
    [Theory]
    [MemberData(nameof(Verbatim))]
    public void Trailing_newlines_survive_the_round_trip_everywhere(string decl, string body)
    {
        var item = new ItemContent(ItemKind.Kinds.Pou, decl, body, new List<Member>
        {
            new(ItemKind.Kinds.Method, "M", "METHOD M : BOOL" + decl.Substring(decl.TrimEnd('\n').Length), body, ObjectProperties.None),
            new(ItemKind.Kinds.Property, "P", "PROPERTY P : INT\n", null, ObjectProperties.None, null,
                new Accessor("VAR\nEND_VAR\n\n", body), null),
        }, ObjectProperties.None);
        var back = StReader.Read(StWriter.Write(item), ItemKind.Kinds.Pou, "F");
        Assert.Equal(decl, back.Declaration);
        Assert.Equal(body, back.Body);
        var m = back.Members.Single(x => x.Name == "M");
        Assert.Equal(item.Members[0].Declaration, m.Declaration);
        Assert.Equal(body, m.Body);
        var p = back.Members.Single(x => x.Name == "P");
        Assert.Equal("PROPERTY P : INT\n", p.Declaration);
        Assert.Equal("VAR\nEND_VAR\n\n", p.Getter!.Declaration);
        Assert.Equal(body, p.Getter.Body);

        var dut = new ItemContent(ItemKind.Kinds.Dut, "TYPE T :\nSTRUCT\nEND_STRUCT\nEND_TYPE" + decl.Substring(decl.TrimEnd('\n').Length),
                                  null, new List<Member>(), ObjectProperties.None);
        Assert.Equal(dut.Declaration, StReader.Read(StWriter.Write(dut), ItemKind.Kinds.Dut, "T").Declaration);
    }
}
