using Volt.Cli.Core.Ide;
using Volt.Cli.Core.Workspace;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// Regression (BOTH vendors): a graphical (FBD/LD/CFC/SFC) method child must materialize with ITS OWN
/// declaration, not the parent POU's. Both CODESYS and TwinCAT export the ENCLOSING POU for a graphical
/// child, wrapped with a plaintext interface (<c>InterfaceAsPlainText</c>) that comes FIRST — so deriving
/// the child's declaration from the export (DeclFromExport → first InterfaceAsPlainText) yielded the
/// PARENT POU's declaration. A CFC-bodied FB then assembled every child block as "{parent decl}\n
/// (* @volt-graphical: CFC *)\nEND_METHOD", which does not parse (repeated FUNCTION_BLOCK headers closed
/// by END_METHOD) and would corrupt the item on push. This exercises the shared Core path (vendor-agnostic
/// FakeIde), so it guards the fix for both; the fix reads the child declaration from its own aspect.
/// </summary>
public class MaterializerChildDeclTests
{
    private const string Ns = "http://www.plcopen.org/xml/tc6_0200";

    // A CFC method export as CODESYS shapes it: the containing POU's plaintext interface (the PARENT's
    // declaration) appears FIRST — the exact trap DeclFromExport fell into.
    private static string MethodExportWithParentInterfaceFirst(string parentDecl) =>
        $"<pou xmlns=\"{Ns}\" name=\"P\"><interface/><body><CFC/></body>" +
        "<addData><data name=\"http://www.3s-software.com/plcopenxml/interfaceasplaintext\" handleUnknown=\"implementation\">" +
        $"<InterfaceAsPlainText><xhtml xmlns=\"http://www.w3.org/1999/xhtml\">{System.Security.SecurityElement.Escape(parentDecl)}</xhtml></InterfaceAsPlainText></data></addData></pou>";

    [Fact]
    public void Cfc_method_child_materializes_with_its_own_declaration_not_the_parents()
    {
        const string parentDecl = "FUNCTION_BLOCK P\nVAR\n\ta : BOOL;\nEND_VAR";
        const string childDecl = "METHOD PRIVATE DoWork : BOOL\nVAR_INPUT\n\tn : INT;\nEND_VAR";

        // Child method: a correct declaration on its Interface aspect, but a CFC body whose export nests
        // the PARENT's plaintext interface first.
        var child = new FakeIde.Item("DoWork", ItemKind.PlcMethod, "", false,
            childDecl, null, "CFC", MethodExportWithParentInterfaceFirst(parentDecl));
        // Parent FB (textual body) owning the one CFC method child.
        var parent = new FakeIde.Item("P", ItemKind.PlcPouFb, "", true,
            parentDecl, null, null, null, Children: new[] { "DoWork" });

        var ide = new FakeIde(parent, child);
        var text = Materializer.Materialize(ide, "P", "function_block", new ItemRef("P")).Text;

        // The child block carries the METHOD signature and the read-only graphical marker.
        Assert.Contains("METHOD PRIVATE DoWork : BOOL", text);
        Assert.Contains("(* @volt-graphical: CFC *)", text);
        Assert.Contains("END_METHOD", text);
        // The parent's declaration appears ONCE (its own header) — never re-emitted as the child's decl.
        Assert.Equal(1, CountOccurrences(text, "FUNCTION_BLOCK P"));
    }

    private static int CountOccurrences(string haystack, string needle)
    {
        int n = 0, i = 0;
        while ((i = haystack.IndexOf(needle, i, System.StringComparison.Ordinal)) >= 0) { n++; i += needle.Length; }
        return n;
    }
}
