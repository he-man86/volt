using System.Collections.Generic;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Item;
using Xunit;
using H = Volt.Ide.Codesys.Tests.CodesysHiddenBodyWriteTests;

namespace Volt.Ide.Codesys.Tests
{
    internal interface IInterfaceObject { }
    internal interface IInterfacePropertyObject { }

    /// <summary>
    /// A CODESYS INTERFACE PROPERTY'S GET/SET (openspec <c>bridge-refusal-review</c> 3.6, D28; DIALECT D41). Both drivers
    /// refused any change to one on the strength of TwinCAT's crash (DIALECT D21); CODESYS was never measured. Measured
    /// (<c>scripts/interface-accessor-write.log</c>): the accessor's DECLARATION is written through the driver's own write and
    /// read back equal, the IDE keeps answering, and the build judges it ("Only inputs, outputs, and inouts allowed in
    /// interface methods" for a VAR block); the accessor has NO Implementation aspect, so a body has no slot. So on
    /// CODESYS the declaration is written and a body is refused by name; the TwinCAT refusal stands (its own tests).
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // SystemInstances.ObjectMgr is process-wide
    public class CodesysInterfaceAccessorWriteTests
    {
        public sealed class Interface : H.IObject, IInterfaceObject { public Interface(string d) : base(d, null) { } }
        public sealed class InterfaceProperty : H.IObject, IInterfacePropertyObject { public InterfaceProperty(string d) : base(d, null) { } }

        private static (H.Node Itf, H.Node Getter, H.ObjectManager Manager) Project(string getterDeclaration)
        {
            // An interface accessor: a declaration aspect and NO implementation aspect (measured).
            var getter = new H.Node("Get", 3, new H.AccessorObject(getterDeclaration, null!));
            var property = new H.Node("P", 2, new InterfaceProperty("PROPERTY P : INT"), getter);
            var itf = new H.Node("I_X", 1, new Interface("INTERFACE I_X"), property);
            return (itf, getter, new H.ObjectManager(new[] { itf, property, getter }));
        }

        private static ItemContent Content(Accessor getter) =>
            new(ItemKind.Kinds.Interface, "INTERFACE I_X", null, new List<Member>
            {
                new(ItemKind.Kinds.InterfaceProperty, "P", "PROPERTY P : INT", null, Getter: getter, Setter: null),
            });

        [Fact]
        public void A_changed_accessor_declaration_is_written()
        {
            var (itf, getter, manager) = Project("");
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = manager;
            try
            {
                new CodesysDriver(projects: null).WriteContent(new ItemRef(itf),
                    Content(new Accessor("VAR_INPUT\n\tn : INT;\nEND_VAR", null)), Volt.Engine.Ide.PushedDeclarations.None);

                Assert.Contains("n : INT;", getter.Object.Interface.TextDocument.Text);
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }

        [Fact]
        public void A_body_on_an_interface_accessor_is_refused_by_name_and_nothing_is_written()
        {
            var (itf, getter, manager) = Project("");
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = manager;
            try
            {
                var before = manager.Commits;
                var ex = Assert.Throws<BridgeException>(() => new CodesysDriver(projects: null).WriteContent(new ItemRef(itf),
                    Content(new Accessor("VAR_INPUT\n\tn : INT;\nEND_VAR", "P := 1;")), Volt.Engine.Ide.PushedDeclarations.None));

                Assert.Equal(BridgeErrorCodes.Unsupported, ex.ErrorCode);
                Assert.Contains("no implementation", ex.Message);
                Assert.DoesNotContain("n : INT;", getter.Object.Interface.TextDocument.Text);
                // NOTHING: the interface's and the property's declarations were committed before the accessor was
                // reached (review 3a+3b) — the refusal is decided from the text, so it comes first.
                Assert.Equal(before, manager.Commits);
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }

        /// <summary>The push pre-flight asks the same refusal (<c>ICodeStore.ValidateInterfaceAccessor</c>), from the
        /// text alone: a body refused, a declaration taken.</summary>
        [Fact]
        public void The_pre_flight_refuses_a_body_and_takes_a_declaration()
        {
            var driver = new CodesysDriver(projects: null);
            var ex = Assert.Throws<BridgeException>(() => driver.ValidateInterfaceAccessor(new Accessor(null, "P := 1;")));
            Assert.Equal(BridgeErrorCodes.Unsupported, ex.ErrorCode);
            driver.ValidateInterfaceAccessor(new Accessor("VAR_INPUT\n\tn : INT;\nEND_VAR", ""));
        }

        [Fact]
        public void An_unchanged_restatement_writes_nothing()
        {
            var (itf, getter, manager) = Project("VAR_INPUT\n\tn : INT;\nEND_VAR");
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = manager;
            try
            {
                var before = manager.Commits;
                new CodesysDriver(projects: null).WriteContent(new ItemRef(itf),
                    Content(new Accessor("VAR_INPUT\n\tn : INT;\nEND_VAR\n", "")), Volt.Engine.Ide.PushedDeclarations.None);

                // The interface's own declaration and the property's are written (one commit each); the accessor is not.
                Assert.Equal(before + 2, manager.Commits);
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }
    }
}
