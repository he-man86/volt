using Volt.Engine.Item;
using Xunit;
using static Volt.Ide.Codesys.Tests.CodesysHiddenBodyWriteTests;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>
    /// A LINE IS THE BOUNDARY ONLY WHEN IT IS ONE (openspec <c>bridge-refusal-review</c> D9, task 4.9). An ST body the IDE
    /// holds with <c>Implementation</c> on a line of its own — the identifier, in a wrapped expression; CODESYS compiles
    /// it with <c>implementation : BOOL;</c> declared (1.2) — is pulled as written. Its line used to have the keyword's
    /// SHAPE, and the read refused the whole item (<c>RequireStBody</c>).
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // SystemInstances.ObjectMgr is process-wide
    public class CodesysStBodyLineTests
    {
        const string Decl = "FUNCTION_BLOCK FB\nVAR\n\ta, b, x, implementation : BOOL;\nEND_VAR";

        [Theory]
        [InlineData("x := a OR\n  Implementation;")]
        [InlineData("x := a\nImplementation OR b;")]
        [InlineData("x := a OR\nIMPLEMENTATION")]
        public void An_ST_body_holding_the_identifier_on_its_own_line_is_pulled_as_written(string body)
        {
            var st = new _3S.CoDeSys.STObject.STImplementationObject();
            var throws = Nwl.TextDocument.ThrowsAfterInsert;
            Nwl.TextDocument.ThrowsAfterInsert = false;
            st.TextDocument.Insert(0, body);
            Nwl.TextDocument.ThrowsAfterInsert = throws;
            var pou = new Node("FB", 1, new Pou(Decl, st));
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new ObjectManager(new[] { pou });
            try
            {
                var read = new CodesysDriver(projects: null).ReadContent(new ItemRef(pou));
                Assert.Equal(body, read.Body);
                Assert.Equal(StatedLanguage.St, read.Stated);
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }
    }
}
