using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// THE WRITE TAKES THE MODEL, NEVER THE TEXT (openspec <c>bridge-refusal-review</c> D8/D12): TwinCAT validates each body
/// once — in the engine's pre-flight — and its write takes the model and the scope it was read against. Proved by
/// handing the write a body TEXT that does not read at all beside the model of the live archive for its site, under a
/// declaration that does not even declare the archive's FB instance (only the handed scope does): a driver that read
/// the text again, or built a scope of its own, would refuse; this one sees no change and writes nothing.
/// </summary>
public class TcWriteTakesModelTests
{
    [Fact]
    public void A_network_body_is_written_from_the_model_and_scope_it_was_handed()
    {
        var xml = XDocument.Parse(Fixtures.Pou("importer-unwired.TcPOU"), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single().ToString(SaveOptions.DisableFormatting);
        var scope = NetworkScope.FromDeclarations("PROGRAM VltProbe_Max\nVAR\n  n : INT;\n  m : INT;\n  t1 : TON;\nEND_VAR",
                                                  _ => null, () => Array.Empty<string>(), Volt.Tests.Shared.Scopes.NoItem,
                                                  BeckhoffDriver.RefusedPouName);
        var model = NetworkText.Validate(
            NetworkTextWriter.Write(TcNetworkReader.Read(TcArchive.Root(xml)!, BodyLanguage.Ld), scope), scope);

        const string decl = "PROGRAM VltProbe_Max\nVAR\nEND_VAR";
        var pou = new TcHiddenBodyWriteTests.Node("VltProbe_Max", ItemKind.PlcPou, decl, xml);
        var content = new ItemContent(ItemKind.Kinds.Pou, decl, "IMPLEMENTATION LD\nthis is no network text",
                                      new List<Member>(), Stated: StatedLanguage.Shown("LD"));

        TcUntouchablePouTests.BoundDriver().WriteContent(new ItemRef(pou), content,
            new[] { new PushedNetworkBody(BodySite.Item, model, scope) });

        Assert.Equal(0, pou.ImplementationWrites);   // the archive already says exactly this model
        Assert.Equal(xml, pou.ImplementationText);
    }

    [Fact]
    public void A_network_body_with_no_model_is_refused_naming_the_site()
    {
        const string decl = "PROGRAM P\nVAR\nEND_VAR";
        var pou = new TcHiddenBodyWriteTests.Node("P", ItemKind.PlcPou, decl, "");
        var content = new ItemContent(ItemKind.Kinds.Pou, decl, "IMPLEMENTATION LD\nNETWORK\nEND_NETWORK",
                                      new List<Member>(), Stated: StatedLanguage.Shown("LD"));

        var ex = Assert.Throws<InvalidOperationException>(() =>
            TcUntouchablePouTests.BoundDriver().WriteContent(new ItemRef(pou), content, Array.Empty<PushedNetworkBody>()));
        Assert.Contains("the item", ex.Message);
        Assert.Equal(0, pou.ImplementationWrites);
    }
}
