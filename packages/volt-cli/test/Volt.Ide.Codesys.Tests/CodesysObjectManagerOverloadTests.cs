using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Item;
using Xunit;
using static Volt.Ide.Codesys.Tests.CodesysHiddenBodyWriteTests;

namespace Volt.Ide.Codesys.Tests
{
    // A text-list-backed enumeration, as CODESYS SP21 classifies SER_OperationModeType / enumRecipeCommandResult /
    // IQSlices (measured, openspec codesys-refs-guid-int32 1.3): it is NOT an IDUTObject.
    internal interface ITextListEnumerationObject { }
    internal interface IDUTObject { }

    /// <summary>
    /// THE OBJECT MANAGER HAS TWO 2-ARG READS, AND THE BRIDGE MUST CALL THE ONE IT MEANS (openspec
    /// <c>codesys-refs-guid-int32</c>).
    ///
    /// <para>SP21's <c>IObjectManager</c> declares <c>GetObjectToRead(int nProjectHandle, int nIndex)</c> AND
    /// <c>GetObjectToRead(int nProjectHandle, Guid objectGuid)</c> — the same pair for <c>GetObjectToModify</c>. The
    /// bridge's reflection helper bound by name and ARGUMENT COUNT, taking "the first such overload", on the stated
    /// belief that no CODESYS surface has two of the same arity. Which one is first is the runtime's
    /// <c>GetMethods()</c> order, and that is not stable inside one IDE: measured on a Pro2193 copy, a fresh session
    /// lists <c>(Int32, Guid)</c> first (#128) and, after one scripting read, <c>(Int32, Int32)</c> first (#87). From
    /// then on every read passed a Guid where an index belongs and <c>refs</c> answered
    /// <c>INTERNAL_ERROR Object of type 'System.Guid' cannot be converted to type 'System.Int32'</c>.</para>
    ///
    /// <para>The double declares the pair in the order that failed — the index overload FIRST, as the vendor's own
    /// interface declares it — so the test does not depend on the runtime's mood.</para>
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // the object-manager double is process-wide
    public class CodesysObjectManagerOverloadTests
    {
        public sealed class TextListEnum : IObject, ITextListEnumerationObject { public TextListEnum(string d) : base(d, null) { } }
        public sealed class Dut : IObject, IDUTObject { public Dut(string d) : base(d, null) { } }

        /// <summary>A scripting tree node keyed by GUID — every node of one project shares the project HANDLE (all
        /// four measured objects reported handle 0), so the handle alone identifies nothing.</summary>
        public sealed class GuidNode
        {
            private readonly string _name;
            private readonly List<GuidNode> _children;
            public GuidNode(string name, IObject? obj, params GuidNode[] children)
            {
                _name = name; Object = obj; _children = children.ToList();
            }
            public int handle => 0;
            public Guid guid { get; } = Guid.NewGuid();
            public bool is_folder => Object == null;
            public IObject? Object { get; }
            public string get_name(bool _) => _name;
            public IEnumerable<GuidNode> get_children(bool _) => _children;
        }

        public sealed class Projects { public Projects(object primary) => this.primary = primary; public object primary { get; } }

        /// <summary>SP21's overload pair, index overload declared first. A read of an object listed in
        /// <see cref="Faulting"/> throws, as a vendor read of a broken object does.</summary>
        public sealed class VendorObjectManager
        {
            private readonly Dictionary<Guid, (string Name, IObject Obj)> _byGuid = new();
            public HashSet<string> Faulting { get; } = new(StringComparer.Ordinal);
            public int Commits { get; private set; }
            public VendorObjectManager(IEnumerable<GuidNode> nodes)
            {
                foreach (var n in nodes) if (n.Object != null) _byGuid[n.guid] = (n.get_name(false), n.Object);
            }
            public Meta GetObjectToRead(int nProjectHandle, int nIndex) =>
                throw new InvalidOperationException($"read by INDEX {nIndex} - Volt never means this overload");
            public Meta GetObjectToRead(int nProjectHandle, Guid objectGuid)
            {
                var (name, obj) = _byGuid[objectGuid];
                if (Faulting.Contains(name)) throw new InvalidOperationException($"the vendor could not read '{name}'");
                return new Meta(obj);
            }
            public Meta GetObjectToModify(int nProjectHandle, int nIndex) =>
                throw new InvalidOperationException($"modify by INDEX {nIndex} - Volt never means this overload");
            public Meta GetObjectToModify(int nProjectHandle, Guid objectGuid) => new(_byGuid[objectGuid].Obj);
            public Meta GetObjectToModify(Meta metaObject) => metaObject;
            public void SetObject(Meta _, bool success, object? __) { if (success) Commits++; }
        }

        private static (GuidNode Root, GuidNode Enum, GuidNode Dut, VendorObjectManager Mgr) Pro2193Shape()
        {
            var en = new GuidNode("SER_OperationModeType", new TextListEnum("TYPE SER_OperationModeType :\n(\n\tAuto := 0,\n\tManual\n);\nEND_TYPE"));
            var dut = new GuidNode("PlcDataType", new Dut("TYPE PlcDataType :\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE"));
            var root = new GuidNode("<project>", null, new GuidNode("Data", null, en, dut));
            return (root, en, dut, new VendorObjectManager(new[] { en, dut }));
        }

        [Fact]
        public void The_walk_reads_each_object_by_its_guid_not_by_an_index()
        {
            var (root, _, _, mgr) = Pro2193Shape();
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = mgr;
            try
            {
                var walk = new CodesysDriver(new Projects(root)).WalkItems();

                Assert.Empty(walk.UnreadableObjects);
                Assert.True(walk.Complete);
                Assert.Equal(new[] { ("PlcDataType", ItemKind.PlcDut, "Data"), ("SER_OperationModeType", ItemKind.PlcDut, "Data") },
                             walk.Items.Select(i => (i.Name, i.KindCode, i.Folder)).OrderBy(x => x.Name, StringComparer.Ordinal));
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }

        [Fact]
        public void A_write_checks_the_object_out_by_its_guid_not_by_an_index()
        {
            var (root, en, _, mgr) = Pro2193Shape();
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = mgr;
            try
            {
                const string decl = "TYPE SER_OperationModeType :\n(\n\tAuto := 0,\n\tManual,\n\tService\n);\nEND_TYPE";
                new CodesysDriver(new Projects(root)).WriteContent(new ItemRef(en),
                    new ItemContent(ItemKind.Kinds.Dut, decl, null, new List<Member>()), new Dictionary<string, string>());

                Assert.Equal(decl, en.Object!.Interface.TextDocument.Text);
                Assert.Equal(1, mgr.Commits);
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }

        /// <summary>Task 2.2, the driver half: one object whose read FAILS is named, by its name and folder, and the
        /// walk returns every other object instead of throwing out of <c>WalkItems</c>.</summary>
        [Fact]
        public void One_object_that_cannot_be_read_is_named_and_the_walk_goes_on()
        {
            var (root, _, _, mgr) = Pro2193Shape();
            mgr.Faulting.Add("SER_OperationModeType");
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = mgr;
            try
            {
                var walk = new CodesysDriver(new Projects(root)).WalkItems();

                Assert.Equal(new[] { "PlcDataType" }, walk.Items.Select(i => i.Name));
                var lost = Assert.Single(walk.UnreadableObjects);
                Assert.Equal(("SER_OperationModeType", "Data"), (lost.Name, lost.Folder));
                Assert.Contains("could not read 'SER_OperationModeType'", lost.Reason);
                Assert.Equal(new[] { "Data", "Data/SER_OperationModeType" }, walk.UnwalkedFolders);
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }

        /// <summary>A ROOT child that cannot be read — CODESYS's root children are the Device node(s) and the
        /// POUs-view folders — marks its own subtree as not walked, under the one root spelling (<c>""</c>). Only its
        /// parent was marked, and for a root child that is the root, which protected nothing beneath the object: every
        /// known item under <c>Device/...</c> read as deleted.</summary>
        [Fact]
        public void A_root_child_that_cannot_be_read_marks_its_own_subtree_not_walked()
        {
            var main = new GuidNode("Main", new Dut("TYPE Main :\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE"));
            var device = new GuidNode("Device", new Dut("TYPE Device :\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE"),
                new GuidNode("Plc Logic", null, main));
            var mgr = new VendorObjectManager(new[] { device, main });
            mgr.Faulting.Add("Device");
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = mgr;
            try
            {
                var walk = new CodesysDriver(new Projects(new GuidNode("<project>", null, device))).WalkItems();

                var lost = Assert.Single(walk.UnreadableObjects);
                Assert.Equal(("Device", ""), (lost.Name, lost.Folder));
                Assert.Equal(new[] { "", "Device" }, walk.UnwalkedFolders);
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }

        /// <summary>A root whose children cannot be enumerated is reported under the SAME root spelling as every other
        /// root-level path (<c>""</c>) — not a <c>"&lt;root&gt;"</c> token no known folder can ever be under.</summary>
        [Fact]
        public void A_root_whose_children_cannot_be_read_is_unwalked_as_the_root()
        {
            var walk = new CodesysDriver(new Projects(new ThrowingRoot())).WalkItems();
            Assert.Equal(new[] { "" }, walk.UnwalkedFolders);
        }

        public sealed class ThrowingRoot
        {
            public int handle => 0;
            public Guid guid { get; } = Guid.NewGuid();
            public bool is_folder => true;
            public string get_name(bool _) => "<project>";
            public IEnumerable<GuidNode> get_children(bool _) => throw new InvalidOperationException("children unreadable");
        }

        /// <summary>An object manager whose 2-arg reads are AMBIGUOUS for (int, Guid) — neither overload is more
        /// specific. That is the binder failing, not one object: it would fail for every object, and it must fail the
        /// walk BY NAME, never come back as a successful walk listing every object unreadable.</summary>
        public sealed class AmbiguousObjectManager
        {
            public Meta GetObjectToRead(int nProjectHandle, object objectGuid) => throw new InvalidOperationException("never bound");
            public Meta GetObjectToRead(object nProjectHandle, Guid objectGuid) => throw new InvalidOperationException("never bound");
        }

        /// <summary>An object manager no 2-arg read of which takes (int, Guid) — an SP that changed the surface.</summary>
        public sealed class ChangedObjectManager
        {
            public Meta GetObjectToRead(int nProjectHandle, int nIndex) => throw new InvalidOperationException("never bound");
            public Meta GetObjectToRead(int nProjectHandle, string objectName) => throw new InvalidOperationException("never bound");
        }

        [Fact]
        public void An_ambiguous_read_overload_fails_the_walk_by_name()
        {
            var (root, _, _, _) = Pro2193Shape();
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new AmbiguousObjectManager();
            try { Assert.Throws<System.Reflection.AmbiguousMatchException>(() => new CodesysDriver(new Projects(root)).WalkItems()); }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }

        [Fact]
        public void A_read_overload_that_takes_no_guid_fails_the_walk_by_name()
        {
            var (root, _, _, _) = Pro2193Shape();
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new ChangedObjectManager();
            try
            {
                var ex = Assert.Throws<MissingMethodException>(() => new CodesysDriver(new Projects(root)).WalkItems());
                Assert.Contains("GetObjectToRead", ex.Message);
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }
    }

    /// <summary>
    /// <c>NwlInterop.Call</c> binds by the arguments' TYPES on the concrete type AND on each interface it implements
    /// (DIALECT C26). A concrete method of the same name and arity that cannot take the arguments is not the method
    /// meant: the call goes on to the interface that can, rather than refusing a valid graphical push.
    /// </summary>
    public class NwlInteropCallTests
    {
        public interface INode { }
        public sealed class Node : INode { }
        public interface IDemux { string SetInputTree(int index, INode node); }

        /// <summary>The vendor shape: a public concrete overload taking a string, and the node overload implemented
        /// explicitly on the interface.</summary>
        public sealed class Demux : IDemux
        {
            public string SetInputTree(int index, string text) => "string";
            string IDemux.SetInputTree(int index, INode node) => "node";
        }

        [Fact]
        public void A_concrete_method_that_cannot_take_the_arguments_does_not_hide_the_interface_method_that_can()
        {
            Assert.Equal("node", NwlInterop.Call(new Demux(), "SetInputTree", 0, new Node()));
            Assert.Equal("string", NwlInterop.Call(new Demux(), "SetInputTree", 0, "x"));
        }

        [Fact]
        public void A_call_no_overload_anywhere_can_take_fails_by_name()
        {
            var ex = Assert.Throws<MissingMethodException>(() => NwlInterop.Call(new Demux(), "SetInputTree", 0, 1.5));
            Assert.Contains("SetInputTree", ex.Message);
        }
    }
}
