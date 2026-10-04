using System;
using System.Collections.Generic;
using System.Linq;
using Xunit;
using static Volt.Ide.Codesys.Tests.CodesysHiddenBodyWriteTests;

// The message store is reached as `_3S.CoDeSys.ScriptDriverSystem.APEnvironment.MessageStorage`
// (`CodesysObjectModel.GetBuildDiagnostics` finds the type by its FULL name in the AppDomain), so the double carries
// the vendor's namespace - the names are the contract, as for `SystemInstances` beside it.
namespace _3S.CoDeSys.ScriptDriverSystem
{
    internal static class APEnvironment
    {
        public static object? MessageStorage { get; set; }
    }
}

namespace Volt.Ide.Codesys.Tests
{
    internal interface IActionObject { }
    internal interface ITransitionObject { }

    /// <summary>
    /// A DIAGNOSTIC INSIDE A METHOD, PROPERTY ACCESSOR, ACTION OR TRANSITION NAMES ITS PARENT ITEM, AND THE CHILD AS
    /// <c>member</c> (openspec <c>codesys-diagnostic-child-names</c>).
    ///
    /// <para>Measured live on SP21 3.5.21.40 (task 1.2, <c>probe-diagnostic-child-guid.py</c> (deleted; <c>git show b2496efb4b:packages/volt-cli/scripts/probe-diagnostic-child-guid.py</c>)): a build error in
    /// a METHOD body carries that METHOD's own <c>ObjectGuid</c> - not the FB's and not <c>Guid.Empty</c> - and so does
    /// one in a property GET accessor (<c>FB/Prop/Get</c>) and in an action. The driver resolved the guid against
    /// <c>WalkItems</c>, which lists TOP-LEVEL items only, so every such diagnostic was published with no name and the
    /// field client (PLCAssist, <c>c802b74d</c>) had to guess which of an FB's methods held five <c>C0578</c>s.</para>
    ///
    /// <para>The tree here has the vendor's shape: a child is its own object with its own guid under the POU's node, a
    /// POU-internal folder is a node with no object, and an accessor sits under its property.</para>
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // the object-manager and message-store doubles are process-wide
    public class CodesysDiagnosticChildNameTests
    {
        public sealed class Action : IObject, IActionObject { public Action(string d) : base(d, null) { } }
        public sealed class Transition : IObject, ITransitionObject { public Transition(string d) : base(d, null) { } }

        /// <summary>A scripting tree node keyed by GUID, counting how often its children are asked for.</summary>
        public sealed class TreeNode
        {
            private readonly string _name;
            private readonly List<TreeNode> _children;
            public TreeNode(string name, IObject? obj, params TreeNode[] children)
            {
                _name = name; Object = obj; _children = children.ToList();
            }
            public int handle => 0;
            public Guid guid { get; } = Guid.NewGuid();
            public bool is_folder => Object == null;
            public IObject? Object { get; }
            public int ChildReads { get; private set; }
            public string get_name(bool _) => _name;
            public IEnumerable<TreeNode> get_children(bool _) { ChildReads++; return _children; }
            public IEnumerable<TreeNode> Self() => new[] { this }.Concat(_children.SelectMany(c => c.Self()));
        }

        public sealed class Projects { public Projects(object primary) => this.primary = primary; public object primary { get; } }

        public sealed class ObjectManager
        {
            private readonly Dictionary<Guid, IObject> _byGuid = new();
            public ObjectManager(TreeNode root) { foreach (var n in root.Self()) if (n.Object != null) _byGuid[n.guid] = n.Object; }
            public Meta GetObjectToRead(int nProjectHandle, Guid objectGuid) => new(_byGuid[objectGuid]);
        }

        /// <summary>`IMessage` + `IMessage4`, the members the bridge reads (measured on SP21's MessageStorage.dll).</summary>
        public sealed class Message
        {
            public Message(Guid objectGuid, uint number, string text)
            {
                ObjectGuid = objectGuid; Number = number; Text = text;
            }
            public Guid ObjectGuid { get; }
            public uint? Number { get; }
            public string Prefix => "C";
            public string Text { get; }
            public string Severity => "Error";
        }

        public sealed class MessageStore
        {
            private readonly List<Message> _messages;
            public MessageStore(params Message[] messages) => _messages = messages.ToList();
            public IEnumerable<object> Categories => new object[] { new BuildCategory() };   // the build's own category (codesys-build-own-messages-only)
            public IEnumerable<Message> GetMessages(object category) => _messages;
        }

        // FB_Motor with a method, a property with GET/SET, an action, a transition and a method filed in a POU-internal
        // folder; PLC_PRG beside it. The shape of the probe's FB_DcnMeth.
        private static (TreeNode Root, Dictionary<string, TreeNode> By) Project()
        {
            var execute = new TreeNode("Execute", new Method("METHOD Execute : BOOL", null!));
            var get = new TreeNode("Get", new AccessorObject("VAR\nEND_VAR", null!));
            var set = new TreeNode("Set", new AccessorObject("VAR\nEND_VAR", null!));
            var ready = new TreeNode("Ready", new Property("PROPERTY Ready : BOOL"), get, set);
            var act = new TreeNode("Act", new Action(""));
            var trans = new TreeNode("Trans", new Transition(""));
            var stop = new TreeNode("Stop", new Method("METHOD Stop : BOOL", null!));
            var internalFolder = new TreeNode("Commands", null, stop);
            var fb = new TreeNode("FB_Motor", new Pou("FUNCTION_BLOCK FB_Motor\nVAR\nEND_VAR", null!),
                                  execute, ready, act, trans, internalFolder);
            var prg = new TreeNode("PLC_PRG", new Pou("PROGRAM PLC_PRG\nVAR\nEND_VAR", null!));
            var root = new TreeNode("<project>", null, new TreeNode("POUs", null, fb, prg));
            var by = root.Self().Where(n => n.Object != null).ToDictionary(n => n.get_name(false));
            return (root, by);
        }

        private static List<Volt.Contracts.BridgeDiagnostic> Diagnose(TreeNode root, params Message[] messages)
        {
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new ObjectManager(root);
            _3S.CoDeSys.ScriptDriverSystem.APEnvironment.MessageStorage = new MessageStore(messages);
            try { return new CodesysDriver(new Projects(root)).GetBuildDiagnostics().ToList(); }
            finally
            {
                _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null;
                _3S.CoDeSys.ScriptDriverSystem.APEnvironment.MessageStorage = null;
            }
        }

        /// <summary>Task 2.1 - the c802b74d shape: `C0578 Unexpected statement` in a METHOD body.</summary>
        [Fact]
        public void A_diagnostic_whose_guid_is_a_method_names_the_parent_item_and_the_method()
        {
            var (root, by) = Project();

            var d = Assert.Single(Diagnose(root, new Message(by["Execute"].guid, 578, "Unexpected statement")));

            Assert.Equal(("FB_Motor", "Execute", "C0578"), (d.Name, d.Member, d.Code));
        }

        /// <summary>Task 2.2 - a property accessor names the PROPERTY (an accessor is read with its property, it is not
        /// a member of its own), an action and a transition name themselves, and a method in a POU-internal folder
        /// names the method, not the folder.</summary>
        [Theory]
        [InlineData("Get", "Ready")]
        [InlineData("Set", "Ready")]
        [InlineData("Ready", "Ready")]
        [InlineData("Act", "Act")]
        [InlineData("Trans", "Trans")]
        [InlineData("Stop", "Stop")]
        public void A_diagnostic_in_any_child_object_names_the_parent_item_and_the_member(string child, string member)
        {
            var (root, by) = Project();

            var d = Assert.Single(Diagnose(root, new Message(by[child].guid, 46, "Identifier 'zz' not defined")));

            Assert.Equal(("FB_Motor", member), (d.Name, d.Member));
        }

        /// <summary>The item's own guid: named, and no member - "about the item itself".</summary>
        [Fact]
        public void A_diagnostic_about_the_item_itself_has_no_member()
        {
            var (root, by) = Project();

            var d = Assert.Single(Diagnose(root, new Message(by["FB_Motor"].guid, 46, "Identifier 'zz' not defined")));

            Assert.Equal("FB_Motor", d.Name);
            Assert.Null(d.Member);
        }

        /// <summary>A guid that is nowhere in the project resolves to nothing, rather than to the nearest guess.</summary>
        [Fact]
        public void A_guid_that_is_nowhere_in_the_project_names_nothing()
        {
            var (root, _) = Project();

            var d = Assert.Single(Diagnose(root, new Message(Guid.NewGuid(), 46, "Identifier 'zz' not defined")));

            Assert.Null(d.Name);
            Assert.Null(d.Member);
        }

        /// <summary>Children are walked only for a guid the top-level walk did not place: a diagnostic on a top-level item
        /// opens no POU, so a build whose errors are all in item bodies costs exactly what it cost before.</summary>
        [Fact]
        public void Children_are_walked_only_when_a_guid_is_not_a_top_level_item()
        {
            var (root, by) = Project();

            Diagnose(root, new Message(by["FB_Motor"].guid, 46, "Identifier 'zz' not defined"));

            Assert.Equal(0, by["FB_Motor"].ChildReads);
            Assert.Equal(0, by["Ready"].ChildReads);
        }
    }
}
