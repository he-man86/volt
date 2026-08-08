using System.IO;
using System.Linq;
using Volt.Engine.PlcOpen;
using Volt.Engine.Sync;
using Volt.Engine.Workspace;
using Volt.Engine.Workspace.SourceText;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// The BODY CODEC: one splice writes any body, dispatching on its LANGUAGE — there is no "graphical path".
/// <para>Every case here runs against a RECORDED CODESYS export with a real <c>&lt;FBD&gt;</c> body
/// (<c>VltFbd_FbdRoot.plcopen.xml</c>). Before the codec, a POU whose body was FBD took an entirely separate
/// write (<c>GraphicalCode.Write</c>) that wrote ONLY the body — so its declaration edits were silently
/// discarded and its dropped members silently kept. Those are not edge cases; they are what the fork cost.</para>
/// </summary>
public class BodyCodecTests
{
    private static string Fixture(string file) =>
        File.ReadAllText(Path.Combine(System.AppContext.BaseDirectory, "fixtures", "codesys-pou", file));

    private static string Fbd => Fixture("VltFbd_FbdRoot.plcopen.xml");

    private const string DeclA = "PROGRAM VltFbd\nVAR\n\ta : BOOL;\n\tb : BOOL;\nEND_VAR\n";
    private const string DeclB = "PROGRAM VltFbd\nVAR\n\ta : BOOL;\n\tb : BOOL;\n\tcAdded : INT;\nEND_VAR\n";

    /// <summary>The network text the fixture's own body renders to — the canonical form, so a push of it is a
    /// no-op on the body and isolates the declaration as the only thing under test.</summary>
    private static string BodyOfFixture()
    {
        var parsed = PouReader.Parse(Fbd);
        return Volt.Engine.Graphical.GraphicalCode.RenderBody(parsed.BodyElement!);
    }

    private static StSplitter.StSplitResult Split(string decl, string body) =>
        new(ItemKind.Kinds.Program, decl, body, new System.Collections.Generic.List<StSplitter.StChild>());

    /// <summary>DEFECT 1 — a declaration edit on a GRAPHICAL POU must land. It used to be discarded silently:
    /// the graphical write path took `declaration` only to resolve FB instance types and never wrote it, while
    /// the push still reported "updated". Measured live on CODESYS 3.5.21.40: a declaration change DOES land on
    /// an FBD-bodied POU through the merge import, body intact — so there was never a vendor reason for it.</summary>
    [Fact]
    public void A_declaration_edit_lands_on_a_graphical_POU()
    {
        var doc = PouDocument.Splice(Fbd, "VltFbd", Split(DeclB, BodyOfFixture()));

        Assert.Contains("cAdded", doc);
        Assert.Contains("<FBD", doc);          // …and the diagram is still a diagram
    }

    /// <summary>The body still round-trips through the codec — the declaration write must not disturb it.
    /// Pushing the body back unchanged leaves the same graph, which is the codec's identity law.</summary>
    [Fact]
    public void A_graphical_body_pushed_back_unchanged_stays_equivalent()
    {
        var doc = PouDocument.Splice(Fbd, "VltFbd", Split(DeclA, BodyOfFixture()));

        var before = PouReader.Parse(Fbd).BodyElement!;
        var after = PouReader.Parse(doc).BodyElement!;
        Assert.Equal("FBD", after.Name.LocalName);
        Assert.Equal(Volt.Engine.Graphical.GraphicalCode.RenderBody(before),
                     Volt.Engine.Graphical.GraphicalCode.RenderBody(after));
    }

    /// <summary>DEFECT 5 — an IL body is refused as a LANGUAGE MISMATCH, by the body writer, with a message that
    /// names the language. It used to slip past the graphical-only narrowing as "textual", then get refused two
    /// layers down by a different rule with a different message — the one case handled by accident.</summary>
    [Fact]
    public void An_IL_body_is_refused_as_a_language_mismatch()
    {
        var il = Fbd.Replace("<FBD>", "<IL>").Replace("</FBD>", "</IL>");

        var ex = Assert.Throws<System.InvalidOperationException>(
            () => PouDocument.Splice(il, "VltFbd", Split(DeclA, "n := 1;")));

        Assert.Contains("IL", ex.Message);
    }
}
