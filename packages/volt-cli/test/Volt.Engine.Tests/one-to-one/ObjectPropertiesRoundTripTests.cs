using System.Collections.Generic;
using Volt.Engine.Item;
using Xunit;
using static Volt.Engine.Tests.OneToOne.OneToOneSteps;

namespace Volt.Engine.Tests.OneToOne;

/// <summary>
/// FINDING 3 — OBJECT PROPERTIES ARE NEVER READ OR WRITTEN (openspec <c>bridge-one-to-one</c> proposal 3, design §1.1
/// "Object properties", §1.2 grammar and placement, §2.2).
///
/// <para>No source file names <c>ExcludeFromBuild</c>, <c>LinkAlways</c>, <c>External</c> or the object comment
/// (§0.2): the corpora hold 11 excluded source objects (7 of them METHODS), 3 link-always GVLs, 15 POUs with an
/// online-change reserve — every one pulls as a plain object and a migration pushes it back plain. The design spells
/// each as a <c>%</c>-line on <see cref="ItemContent"/> AND on <see cref="Member"/>: directly under the object's
/// <c>IMPLEMENTATION</c> line, else closing its declaration; <c>%CLASS</c> first, then a member's <c>%FOLDER</c>, then the
/// keys in the grammar's order.</para>
///
/// <para>Red until 3.1 (contract + text format) and 3.2 (the CODESYS driver). The direct-address guard at the end is
/// GREEN today and must stay so: a line opening with <c>%</c> that is not a closed key is code.</para>
/// </summary>
public class ObjectPropertiesRoundTripTests
{
    private const string Task = "3.1/3.2";

    private const string FbDecl = "FUNCTION_BLOCK FB_Excluded\nVAR\n\tn : INT;\nEND_VAR";
    private const string GvlDecl = "VAR_GLOBAL\n\tg : INT;\nEND_VAR";

    public static IEnumerable<object[]> ItemCases() => new[]
    {
        new object[] { "exclude", Props(exclude: true), new[] { "%EXCLUDE_FROM_BUILD" } },
        new object[] { "link-always", Props(linkAlways: true), new[] { "%LINK_ALWAYS" } },
        new object[] { "external", Props(external: true), new[] { "%EXTERNAL" } },
        new object[] { "system-call", Props(systemCall: true), new[] { "%ENABLE_SYSTEM_CALL" } },
        new object[] { "reserve", Props(reserve: 200), new[] { "%ONLINE_CHANGE_RESERVE 200" } },
        new object[] { "defines", Props(defines: "SIM, TRACE"), new[] { "%COMPILER_DEFINES 'SIM, TRACE'" } },
        new object[] { "undefines", Props(undefines: new[] { "A", "B" }), new[] { "%UNDEFINE 'A'", "%UNDEFINE 'B'" } },
        new object[] { "comment", Props(comment: "it's $5"), new[] { "%COMMENT 'it$'s $$5'" } },
        new object[] { "file-link", Props(fileLink: new FileLink("ExportBeforeCompile", @"C:\gvl\io.gvl")),
                       new[] { @"%FILE_LINK ExportBeforeCompile 'C:\gvl\io.gvl'" } },
        // Every key at once: one canonical order (§1.2 "Order").
        new object[] { "all", Props(exclude: true, linkAlways: true, reserve: 200, comment: "doc"),
                       new[] { "%EXCLUDE_FROM_BUILD", "%LINK_ALWAYS", "%ONLINE_CHANGE_RESERVE 200", "%COMMENT 'doc'" } },
    };

    /// <summary>A POU's properties stand directly under its <c>IMPLEMENTATION</c> line.</summary>
    [Theory, MemberData(nameof(ItemCases))]
    public void A_pou_pulls_its_properties_under_its_implementation_line(string key, ObjectProperties props, string[] lines)
    {
        ExpectRed.Until(Task, $"finding 3 ({key}): the pull drops the POU's properties", () =>
        {
            var ide = new FakeIde(new FakeIde.Item("FB_Excluded", ItemKind.PlcPou, "", true, FbDecl, "n := n + 1;", null, null)
                { Properties = props });
            var text = Pulled(ide, "FB_Excluded.pou");
            Assert.Equal(lines, After(text, "IMPLEMENTATION ST", lines.Length));
            Assert.Equal("n := n + 1;", After(text, "IMPLEMENTATION ST", lines.Length + 1)[lines.Length]);
        });
    }

    /// <summary>A GVL has no body: its properties close its declaration.</summary>
    [Theory, MemberData(nameof(ItemCases))]
    public void A_gvl_pulls_its_properties_closing_its_declaration(string key, ObjectProperties props, string[] lines)
    {
        ExpectRed.Until(Task, $"finding 3 ({key}): the pull drops the GVL's properties", () =>
        {
            var ide = new FakeIde(new FakeIde.Item("GVL_Io", ItemKind.PlcGvl, "", true, GvlDecl, null, null, null)
                { Properties = props });
            var text = Pulled(ide, "GVL_Io.gvl");
            Assert.Equal(lines, AfterLast(text, "END_VAR", lines.Length));
        });
    }

    /// <summary>A push carrying the lines APPLIES them — onto an object that had none — and writes none of them into
    /// the IDE's text.</summary>
    [Theory, MemberData(nameof(ItemCases))]
    public void A_push_applies_the_properties_and_writes_no_property_line(string key, ObjectProperties props, string[] lines)
    {
        ExpectRed.Until(Task, $"finding 3 ({key}): the push does not apply the properties", () =>
        {
            var ide = new FakeIde(new FakeIde.Item("FB_Excluded", ItemKind.PlcPou, "", true, FbDecl, "n := n + 1;", null, null));
            var text = FbDecl + "\nIMPLEMENTATION ST\n" + string.Join("\n", lines) + "\nn := n + 2;\n\nEND_FUNCTION_BLOCK\n";

            AcceptedOk(Update(ide, "FB_Excluded.pou", text));

            Assert.Equal(props, ide.PropertiesOf("FB_Excluded"));
            HoldsNoPropertyLine(ide.StoredImplementation("FB_Excluded"));
            Assert.StartsWith("n := n + 2;", ide.StoredImplementation("FB_Excluded"));
        });
    }

    /// <summary>A push whose text DROPS the lines clears them: the absence of a line is the measured value
    /// (false / 0 / empty), so an excluded POU pushed without <c>%EXCLUDE_FROM_BUILD</c> is built again.</summary>
    [Fact]
    public void A_push_without_the_lines_clears_the_properties()
    {
        ExpectRed.Until(Task, "finding 3: the push does not clear an object's properties", () =>
        {
            var ide = new FakeIde(new FakeIde.Item("FB_Excluded", ItemKind.PlcPou, "", true, FbDecl, "n := n + 1;", null, null)
                { Properties = Props(exclude: true, reserve: 200) });

            AcceptedOk(Update(ide, "FB_Excluded.pou", FbDecl + "\nIMPLEMENTATION ST\nn := n + 2;\n\nEND_FUNCTION_BLOCK\n"));

            Assert.Equal(ObjectProperties.None, ide.PropertiesOf("FB_Excluded"));
        });
    }

    /// <summary>A MEMBER carries properties too (7 excluded methods in the corpora): under its <c>IMPLEMENTATION</c>
    /// line, after its <c>%FOLDER</c>.</summary>
    [Fact]
    public void A_member_pulls_its_properties_after_its_folder()
    {
        ExpectRed.Until(Task, "finding 3: the pull drops a member's properties", () =>
        {
            var ide = new FakeIde(
                new FakeIde.Item("FB_Owner", ItemKind.PlcPou, "", true, "FUNCTION_BLOCK FB_Owner\nVAR\nEND_VAR", ";", null, null,
                                 Children: new[] { "Calc" }),
                new FakeIde.Item("Calc", ItemKind.PlcMethod, "Helpers", false, "METHOD Calc : INT", "Calc := 1;", null, null)
                    { Properties = Props(exclude: true) });
            var text = Pulled(ide, "FB_Owner.pou");
            var block = text.Substring(text.IndexOf("METHOD Calc : INT", System.StringComparison.Ordinal));
            Assert.Equal(new[] { "%FOLDER Helpers", "%EXCLUDE_FROM_BUILD", "Calc := 1;" }, After(block, "IMPLEMENTATION ST", 3));
        });
    }

    /// <summary>A member's lines pushed apply to THAT member — not to its owner, not to a sibling.</summary>
    [Fact]
    public void A_push_applies_a_members_properties_to_that_member()
    {
        ExpectRed.Until(Task, "finding 3: the push does not apply a member's properties", () =>
        {
            var ide = new FakeIde(
                new FakeIde.Item("FB_Owner", ItemKind.PlcPou, "", true, "FUNCTION_BLOCK FB_Owner\nVAR\nEND_VAR", ";", null, null,
                                 Children: new[] { "Calc", "Other" }),
                new FakeIde.Item("Calc", ItemKind.PlcMethod, "", false, "METHOD Calc : INT", "Calc := 1;", null, null),
                new FakeIde.Item("Other", ItemKind.PlcMethod, "", false, "METHOD Other : INT", "Other := 1;", null, null));
            var text = Pulled(ide, "FB_Owner.pou")
                .Replace("METHOD Calc : INT\nIMPLEMENTATION ST\n", "METHOD Calc : INT\nIMPLEMENTATION ST\n%EXCLUDE_FROM_BUILD\n");

            AcceptedOk(Update(ide, "FB_Owner.pou", text));

            Assert.Equal(Props(exclude: true), ide.PropertiesOf("Calc"));
            Assert.True(ide.PropertiesOf("Other") is null || ide.PropertiesOf("Other") == ObjectProperties.None);
            Assert.True(ide.PropertiesOf("FB_Owner") is null || ide.PropertiesOf("FB_Owner") == ObjectProperties.None);
            HoldsNoPropertyLine(ide.StoredImplementation("Calc"));
        });
    }

    /// <summary>The reader refuses another order, a repeated key and a value on a flag, each by line (§1.2 "Order").</summary>
    [Theory]
    [InlineData("%LINK_ALWAYS\n%EXCLUDE_FROM_BUILD", "%EXCLUDE_FROM_BUILD")]
    [InlineData("%EXCLUDE_FROM_BUILD\n%EXCLUDE_FROM_BUILD", "%EXCLUDE_FROM_BUILD")]
    [InlineData("%EXCLUDE_FROM_BUILD TRUE", "%EXCLUDE_FROM_BUILD")]
    [InlineData("%ONLINE_CHANGE_RESERVE", "%ONLINE_CHANGE_RESERVE")]
    public void A_property_line_out_of_its_grammar_is_refused_by_line(string lines, string named)
    {
        ExpectRed.Until(Task, $"finding 3: the reader takes '{lines.Replace("\n", " / ")}'", () =>
        {
            var ide = new FakeIde(new FakeIde.Item("FB_Excluded", ItemKind.PlcPou, "", true, FbDecl, "n := n + 1;", null, null));
            var resp = Update(ide, "FB_Excluded.pou",
                              FbDecl + "\nIMPLEMENTATION ST\n" + lines + "\nn := n + 2;\n\nEND_FUNCTION_BLOCK\n");
            RefusedNaming(resp, named, "line");
        });
    }

    /// <summary>A property line anywhere else — inside the declaration — is refused by name, as a misplaced
    /// <c>%FOLDER</c> is today (§1.2 "Placement").</summary>
    [Fact]
    public void A_property_line_inside_a_declaration_is_refused_by_name()
    {
        ExpectRed.Until(Task, "finding 3: a misplaced property line is not refused", () =>
        {
            var ide = new FakeIde(new FakeIde.Item("FB_Excluded", ItemKind.PlcPou, "", true, FbDecl, "n := n + 1;", null, null));
            var resp = Update(ide, "FB_Excluded.pou",
                              "FUNCTION_BLOCK FB_Excluded\n%EXCLUDE_FROM_BUILD\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := 2;\n\nEND_FUNCTION_BLOCK\n");
            RefusedNaming(resp, "%EXCLUDE_FROM_BUILD");
        });
    }

    /// <summary>GREEN today, and it must stay green: a line opening with <c>%</c> and no closed key — a direct-address
    /// assignment, 4 in the corpora (bakon-nano <c>OutputControl.pou:50-54</c>) — is CODE, where properties are peeled
    /// too (§1.2 "What is a property line").</summary>
    [Theory]
    [InlineData("%QB1 := 5;")]
    [InlineData("%qx0.0 := TRUE;")]
    [InlineData("%CLASSIC := 1;")]
    public void A_direct_address_line_under_the_implementation_line_is_code(string line)
    {
        var ide = new FakeIde(new FakeIde.Item("FB_Out", ItemKind.PlcPou, "", true,
                                               "FUNCTION_BLOCK FB_Out\nVAR\nEND_VAR", line + "\nx := 1;", null, null));
        var text = Pulled(ide, "FB_Out.pou");
        Assert.Equal(new[] { line, "x := 1;" }, After(text, "IMPLEMENTATION ST", 2));

        AcceptedOk(Update(ide, "FB_Out.pou", text.Replace("x := 1;", "x := 2;")));
        Assert.StartsWith(line + "\nx := 2;", ide.StoredImplementation("FB_Out"));
    }
}
