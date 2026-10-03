using System;
using System.Collections.Generic;
using Volt.Engine.Format.Network;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Xunit;
using static Volt.Ide.Codesys.Tests.CodesysLanguageChangeTests;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>
    /// THE WRITE TAKES THE MODEL, NEVER THE TEXT (openspec <c>bridge-refusal-review</c> D8/D12). The push pre-flight
    /// validates each network body once and hands the write its model and scope; the driver holds no copy of the
    /// validation. Proved by handing the write a body TEXT that does not read at all beside a valid model for its site: a
    /// driver that read the text again would refuse it; this one writes the model.
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // SystemInstances.ObjectMgr is process-wide
    public class CodesysWriteTakesModelTests
    {
        const string Decl = "PROGRAM P\nVAR\n\ta : BOOL;\n\tq : BOOL;\nEND_VAR";

        [Fact]
        public void A_network_body_is_written_from_the_model_it_was_handed()
        {
            var nwl = new Nwl.NWLImplementationObject { DefaultViewMode = "Ld" };
            var pou = new AnyNode("P", 1, new SwappablePou(Decl, nwl));
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new AnyManager(pou);
            try
            {
                var content = new ItemContent(ItemKind.Kinds.Pou, Decl, "IMPLEMENTATION FBD\nthis is no network text",
                                              new List<Member>(), Stated: StatedLanguage.Shown("FBD"));
                var model = new PushedNetworkBody(BodySite.Item,
                    new NetworkBody(BodyLanguage.Fbd, Array.Empty<Network>()), NetworkScope.Empty);

                new CodesysDriver(projects: null).WriteContent(new ItemRef(pou), content, new[] { model });

                Assert.Equal("Fbd", nwl.DefaultViewMode);   // the model's view, written
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }

        /// <summary>A network body with no model is Volt's bug — refused loud, naming the site. The driver does not fall
        /// back to reading the text.</summary>
        [Fact]
        public void A_network_body_with_no_model_is_refused_naming_the_site()
        {
            var nwl = new Nwl.NWLImplementationObject { DefaultViewMode = "Ld" };
            var method = new AnyNode("Step", 2, new SwappableMethod("METHOD Step : BOOL", new Nwl.NWLImplementationObject { DefaultViewMode = "Fbd" }));
            var pou = new AnyNode("P", 1, new SwappablePou(Decl, nwl), method);
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new AnyManager(pou, method);
            try
            {
                var content = new ItemContent(ItemKind.Kinds.Pou, Decl, null, new List<Member>
                {
                    new(ItemKind.Kinds.Method, "Step", "METHOD Step : BOOL", "IMPLEMENTATION FBD\nNETWORK\nEND_NETWORK",
                        Stated: StatedLanguage.Shown("FBD")),
                });

                var ex = Assert.Throws<InvalidOperationException>(() =>
                    new CodesysDriver(projects: null).WriteContent(new ItemRef(pou), content, Array.Empty<PushedNetworkBody>()));
                Assert.Contains("'Step'", ex.Message);
                Assert.Contains("no validated model", ex.Message);
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }
    }
}
