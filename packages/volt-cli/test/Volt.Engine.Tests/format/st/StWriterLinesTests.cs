using System.Linq;
using Volt.Engine.Format.St;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// <c>StWriter.Lines</c> states where each vendor object stands in the written text (wire-final-shape 3.6b). It is a second
/// reading of the writer's layout, so it is pinned against the text the writer writes: every entry's declaration lines ARE
/// the object's declaration, and its code lines ARE its ST code — property lines, the <c>IMPLEMENTATION</c> line, blank
/// separators and END lines in between included.
/// </summary>
public class StWriterLinesTests
{
    private const string Fb =
        "FUNCTION_BLOCK Motor\nVAR\n\tx : INT;\nEND_VAR\n\n" +
        "IMPLEMENTATION ST\n%EXCLUDE_FROM_BUILD\nx := 1;\n\ny := 2;\n\nEND_FUNCTION_BLOCK\n\n" +
        "METHOD Compute : INT\nVAR_INPUT\n\td : INT;\nEND_VAR\nIMPLEMENTATION ST\n%FOLDER Sub\nCompute := d;\nEND_METHOD\n\n" +
        "METHOD Empty : BOOL\nIMPLEMENTATION ST\nEND_METHOD\n\n" +
        "ACTION Act\nIMPLEMENTATION ST\nx := 1;\nx := 2;\nEND_ACTION\n\n" +
        "PROPERTY Prop : INT\nGET\nIMPLEMENTATION ST\nProp := x;\nEND_GET\nEND_PROPERTY\n";

    [Fact]
    public void Every_entry_names_the_lines_the_writer_wrote()
    {
        var item = StReader.Read(Fb, ItemKind.Kinds.Pou, "Motor");
        var text = StWriter.Write(item);
        Assert.Equal(Fb, text);
        var lines = text.Split('\n');
        string Span(int start, int count) => string.Join("\n", lines.Skip(start - 1).Take(count));

        var found = StWriter.Lines(item);
        Assert.Equal(new string?[] { null, "Compute", "Empty", "Act" }, found.Select(o => o.Member).ToArray());

        var self = found[0];
        Assert.Equal(item.Declaration, Span(self.DeclarationStart, self.DeclarationLines));
        Assert.Equal("x := 1;\n\ny := 2;", Span(self.CodeStart, self.CodeLines));

        var compute = found[1];
        Assert.Equal("METHOD Compute : INT\nVAR_INPUT\n\td : INT;\nEND_VAR", Span(compute.DeclarationStart, compute.DeclarationLines));
        Assert.Equal("Compute := d;", Span(compute.CodeStart, compute.CodeLines));

        Assert.Equal(0, found[2].CodeStart);   // no code: no vendor line past the declaration is placed

        var act = found[3];
        Assert.Equal(0, act.DeclarationLines);   // an action has no declaration object
        Assert.Equal("x := 1;\nx := 2;", Span(act.CodeStart, act.CodeLines));
    }

    [Fact]
    public void A_declaration_only_item_is_its_declaration()
    {
        const string Gvl = "VAR_GLOBAL\n\ta : INT;\nEND_VAR\n";
        var item = StReader.Read(Gvl, ItemKind.Kinds.Gvl, "G");
        var only = Assert.Single(StWriter.Lines(item));
        Assert.Equal((1, 3, 0), (only.DeclarationStart, only.DeclarationLines, only.CodeStart));
        Assert.Equal(2, only.LineOf(2));
        Assert.Null(only.LineOf(4));
    }
}
