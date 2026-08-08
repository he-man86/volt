using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Item;
using Volt.Engine.Text;
using Volt.Engine.Workspace;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// <see cref="StWriter"/> and <see cref="StReader"/> are an INVERSE PAIR over <see cref="ItemContent"/>, and this
/// is what makes that claim checkable instead of a folder arrangement. Both halves now speak the same record, so
/// `read(write(x)) == x` is a statement that can be written down at all — while the read path had `PouData` and
/// the write path had `StSplitResult` it could not even be typed.
/// <para><b>Why it matters beyond tidiness:</b> this text IS the workspace file. Anything the writer emits that
/// the reader does not recover is content that survives a pull and vanishes on the next push — silently, because
/// both halves individually look correct. The two golden-text tests (ChildDirectiveTests, InterfaceRoundTripTests)
/// pin the exact bytes for two shapes; this pins the LAW for every shape.</para>
/// <para>Round-tripping the TEXT (not the record) is the honest formulation: `write` normalises — it trims, it
/// orders members, it drops an empty body. So the fixed point is reached after one pass, and the law is
/// `write(read(write(x))) == write(x)`. Asserting `read(write(x)) == x` on the record instead would fail on
/// normalisation the workspace deliberately wants.</para>
/// </summary>
public class StFormatRoundTripTests
{
    private static Member Method(string name, string body = "n := 1;", string? folder = null) =>
        new(ItemKind.Kinds.Method, name, $"METHOD {name} : INT\nVAR_INPUT\n\td : INT;\nEND_VAR", body, folder);

    private static Member Action(string name, string body = "x := 1;", string? folder = null) =>
        new(ItemKind.Kinds.Action, name, $"ACTION {name}", body, folder);

    private static Member Property(string name, Accessor? get, Accessor? set, string? folder = null) =>
        new(ItemKind.Kinds.Property, name, $"PROPERTY {name} : INT", null, folder, get, set);

    public static TheoryData<string, ItemContent> Shapes => new()
    {
        { "bare program",
          new ItemContent(ItemKind.Kinds.Program, "PROGRAM P\nVAR\n\tn : INT;\nEND_VAR", "n := 1;", new()) },

        { "program with no body",
          new ItemContent(ItemKind.Kinds.Program, "PROGRAM P\nVAR\n\tn : INT;\nEND_VAR", null, new()) },

        { "function block with every member kind",
          new ItemContent(ItemKind.Kinds.FunctionBlock, "FUNCTION_BLOCK FB\nVAR\n\tx : INT;\nEND_VAR", "x := 0;",
              new() { Method("Go"), Action("Start"),
                      Property("Speed", new Accessor(null, "Speed := x;"), new Accessor(null, "x := Speed;")) }) },

        { "members in folders",
          new ItemContent(ItemKind.Kinds.FunctionBlock, "FUNCTION_BLOCK FB\nVAR\nEND_VAR", "",
              new() { Method("Go", folder: "Sub/Deep"), Action("Start", folder: "Other") }) },

        { "GET-only property",
          new ItemContent(ItemKind.Kinds.FunctionBlock, "FUNCTION_BLOCK FB\nVAR\n\tx : INT;\nEND_VAR", "",
              new() { Property("Ready", new Accessor(null, "Ready := x;"), null) }) },

        // The interface case the model change was riskiest for: an accessor that EXISTS and holds no code. It
        // must survive as an accessor, not collapse into "no accessor".
        { "interface with a bodiless property",
          new ItemContent(ItemKind.Kinds.Interface, "INTERFACE ITest", null,
              new() { Method("DoIt", body: ""),
                      Property("Ready", new Accessor(null, ""), new Accessor(null, "")) }) },

        { "a network-text body",
          new ItemContent(ItemKind.Kinds.Program, "PROGRAM P\nVAR\n\ta : BOOL;\n\tout : BOOL;\nEND_VAR",
              "NETWORK 0 FBD\n  out := NOT (a);\nEND_NETWORK", new()) },

        { "a read-only CFC marker body",
          new ItemContent(ItemKind.Kinds.Program, "PROGRAM P\nVAR\nEND_VAR", "(* @volt-graphical: CFC *)", new()) },

        { "DUT — declaration only",
          new ItemContent(ItemKind.Kinds.Dut, "TYPE D :\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE", null, new()) },

        { "GVL — declaration only",
          new ItemContent(ItemKind.Kinds.Gvl, "VAR_GLOBAL\n\tg : INT;\nEND_VAR", null, new()) },

        // ── the shapes that LOOK like structure, which is where a regex/state-machine reader earns its keep ──

        { "pragma and comment above the header",
          new ItemContent(ItemKind.Kinds.FunctionBlock,
              "{attribute 'no_check'}\n(* what it does *)\nFUNCTION_BLOCK FB\nVAR\nEND_VAR", "", new()) },

        { "EXTENDS and IMPLEMENTS on the header",
          new ItemContent(ItemKind.Kinds.FunctionBlock,
              "FUNCTION_BLOCK FB EXTENDS Base IMPLEMENTS IOne, ITwo\nVAR\nEND_VAR", "", new()) },

        { "a body whose COMMENT contains END_FUNCTION_BLOCK",
          new ItemContent(ItemKind.Kinds.FunctionBlock, "FUNCTION_BLOCK FB\nVAR\nEND_VAR",
              "(* not really END_FUNCTION_BLOCK here *)\nx := 1;", new()) },

        { "a body whose STRING contains METHOD",
          new ItemContent(ItemKind.Kinds.FunctionBlock, "FUNCTION_BLOCK FB\nVAR\n\ts : STRING;\nEND_VAR",
              "s := 'METHOD Go';", new()) },

        { "accessors that carry their own declaration",
          new ItemContent(ItemKind.Kinds.FunctionBlock, "FUNCTION_BLOCK FB\nVAR\n\tx : INT;\nEND_VAR", "",
              new() { Property("Speed",
                  new Accessor("VAR\n\ttmp : INT;\nEND_VAR", "Speed := x;"),
                  new Accessor("VAR\n\told : INT;\nEND_VAR", "x := Speed;")) }) },

        { "a property in a folder WITH accessors",
          new ItemContent(ItemKind.Kinds.FunctionBlock, "FUNCTION_BLOCK FB\nVAR\n\tx : INT;\nEND_VAR", "",
              new() { Property("Speed", new Accessor(null, "Speed := x;"), null, folder: "Props/Deep") }) },

        { "many members, emitted in the canonical order",
          new ItemContent(ItemKind.Kinds.FunctionBlock, "FUNCTION_BLOCK FB\nVAR\n\tx : INT;\nEND_VAR", "",
              new() { Action("Zed"), Method("Alpha"), Property("Yankee", new Accessor(null, "Yankee := x;"), null),
                      Method("Beta"), Action("Charlie") }) },

        { "a multi-line method body with blank lines",
          new ItemContent(ItemKind.Kinds.FunctionBlock, "FUNCTION_BLOCK FB\nVAR\nEND_VAR", "",
              new() { Method("Go", "IF d > 0 THEN\n\n\tGo := d;\n\nEND_IF") }) },
    };

    /// <summary>THE LAW. One pass through the pair changes nothing that a second pass would change again.</summary>
    [Theory]
    [MemberData(nameof(Shapes))]
    public void A_the_format_is_a_fixed_point(string desc, ItemContent content)
    {
        var once = StWriter.Write(content);
        var twice = StWriter.Write(StReader.Read(once));

        Assert.Equal(once, twice);
    }

    /// <summary>The structure survives too — a fixed point of the TEXT would still be reachable by a reader that
    /// lost every member and a writer that emitted none. Kind, member names and folders are checked directly.</summary>
    [Theory]
    [MemberData(nameof(Shapes))]
    public void B_kind_members_and_folders_survive(string desc, ItemContent content)
    {
        var back = StReader.Read(StWriter.Write(content));

        Assert.Equal(content.Kind, back.Kind);
        Assert.Equal(content.Members.Select(m => m.Name).OrderBy(n => n),
                     back.Members.Select(m => m.Name).OrderBy(n => n));
        foreach (var m in content.Members.Where(m => m.Folder is not null))
            Assert.Equal(m.Folder, back.Members.Single(b => b.Name == m.Name).Folder);
    }

    /// <summary>The ONE asymmetry the pair actually has, pinned deliberately rather than left to be rediscovered:
    /// <c>%FOLDER</c> is an in-band directive, so a member body whose FIRST line is literally <c>%FOLDER x</c>
    /// comes back as a member IN folder x with that line consumed.
    /// <para>Left unescaped on purpose. <c>%</c> cannot begin a statement in IEC 61131-3, so no body a compiler
    /// accepts can start this way — the input is already invalid ST. Adding an escape would mean every reader and
    /// writer of the format carrying the rule forever to defend against source that cannot exist. Recorded here
    /// so the choice is visible; if a vendor ever emits such a line, this test is where the decision changes.</para></summary>
    [Fact]
    public void D_a_body_starting_with_the_FOLDER_directive_is_read_as_a_folder
        ()
    {
        var content = new ItemContent(ItemKind.Kinds.FunctionBlock, "FUNCTION_BLOCK FB\nVAR\nEND_VAR", "",
            new() { Method("Go", body: "%FOLDER Nope\nx := 1;") });

        var back = StReader.Read(StWriter.Write(content));
        var member = back.Members.Single(m => m.Name == "Go");

        Assert.Equal("Nope", member.Folder);      // consumed as a directive…
        Assert.Equal("x := 1;", member.Body);     // …and gone from the body
    }

    /// <summary>An accessor that exists with no code stays an accessor. This is the hazard the merged model
    /// created and <see cref="Accessor.Code"/> closes: on the write path a null body means "remove", so a
    /// bodiless getter collapsing to null would DELETE the user's getter on the next push.</summary>
    [Fact]
    public void C_a_bodiless_accessor_is_not_an_absent_one()
    {
        var content = new ItemContent(ItemKind.Kinds.Interface, "INTERFACE ITest", null,
            new() { Property("Ready", new Accessor(null, ""), null) });

        var back = StReader.Read(StWriter.Write(content));
        var prop = back.Members.Single(m => m.Name == "Ready");

        Assert.NotNull(prop.Getter);
        Assert.Equal("", prop.Getter!.Code);   // present, empty — never null
        Assert.Null(prop.Setter);              // and the one that was absent stays absent
    }
}
