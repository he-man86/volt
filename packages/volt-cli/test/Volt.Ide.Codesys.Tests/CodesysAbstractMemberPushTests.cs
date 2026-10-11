using System.Collections.Generic;
using Volt.Engine.Format.St;
using Volt.Engine.Item;
using Xunit;
using static Volt.Ide.Codesys.Tests.CodesysHiddenBodyWriteTests;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>
    /// AN ABSTRACT MEMBER PULLED FROM CODESYS CAN BE PUSHED BACK (openspec <c>abstract-member-push</c>; DIALECT C2n,
    /// found by the <c>vendor-facts</c> probe 2026-10-11).
    ///
    /// <para>CODESYS holds an abstract method as an <c>AbstractPOUMethodObject</c> with NO <c>Implementation</c> aspect.
    /// The pull reads its body as null, <c>StWriter</c> writes the boundary line <c>IMPLEMENTATION ST</c> for it anyway
    /// (an empty body gets the line), <c>StReader</c> reads that back as <c>""</c>, and the push sends <c>""</c> at a
    /// slot the object does not have — which <c>RequireSlot</c> (openspec <c>bridge-refusal-review</c> D26) refuses:
    /// <c>UNSUPPORTED: CODESYS: 'TakePicture' has no Implementation</c>. So no edit of an owner holding an abstract
    /// member can be pushed: 12 <c>ABSTRACT</c> member texts in the six corpora, all pro2193 (11 METHOD, 1 PROPERTY,
    /// 7 owner files). D26 names the fix: the PRODUCER, not a driver table. The driver cannot tell today: an empty ST
    /// body and a missing slot both read null.</para>
    ///
    /// <para>Un-skip this when <c>abstract-member-push</c> lands; it is the assertion the fix has to satisfy. It is red
    /// today with exactly the refusal above (run it with the Skip removed).</para>
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // SystemInstances.ObjectMgr is process-wide
    public class CodesysAbstractMemberPushTests
    {
        [Fact(Skip = "KNOWN + measured (openspec abstract-member-push): the pull's null body comes back as \"\" and " +
                     "RequireSlot refuses it — fixing it decides how a missing slot is told from an empty body.")]
        public void A_pulled_owner_with_an_abstract_method_takes_a_declaration_edit()
        {
            var body = new _3S.CoDeSys.STObject.STImplementationObject();
            try { body.TextDocument.Insert(0, "x := x + 1;"); } catch (System.InvalidOperationException) { }   // lands, then throws (NwlDoubles)
            var method = new Node("TakePicture", 2, new Method("METHOD ABSTRACT TakePicture : INT", null!));
            var pou = new Node("FB_Base", 1, new Pou("FUNCTION_BLOCK ABSTRACT FB_Base\nVAR\n\tx : INT;\nEND_VAR", body), method);
            var manager = new ObjectManager(new[] { pou, method });
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = manager;
            try
            {
                var driver = new CodesysDriver(projects: null);
                var pulled = StWriter.Write(driver.ReadContent(new ItemRef(pou)));
                var edited = pulled.Replace("METHOD ABSTRACT TakePicture : INT",
                                            "METHOD ABSTRACT TakePicture : INT\n// edited in the workspace");
                Assert.NotEqual(pulled, edited);

                driver.WriteContent(new ItemRef(pou), StReader.Read(edited, ItemKind.Kinds.Pou),
                                    System.Array.Empty<Volt.Engine.Ide.PushedNetworkBody>());

                Assert.Contains("// edited in the workspace", method.Object.Interface.TextDocument.Text);
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }
    }
}
