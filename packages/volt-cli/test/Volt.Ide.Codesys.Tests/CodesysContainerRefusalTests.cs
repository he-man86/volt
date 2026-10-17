using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Item;
using Xunit;
using static Volt.Ide.Codesys.Tests.CodesysHiddenBodyWriteTests;

namespace Volt.Ide.Codesys.Tests
{
    internal interface IApplicationObject { }
    internal interface ITaskConfigObject { }

    /// <summary>
    /// WHAT A NON-ITEM HOLDS IS REFUSED BY NAME IN THE PULL REPORT (openspec <c>bridge-one-to-one</c> §1.1; gate review of
    /// step 3, finding 3): a folder's build property, an application's compiler defines, the Task Configuration's system
    /// events and its stack settings off their measured value. Nothing read them, so an excluded folder's objects pulled
    /// and migrated as built ones, and the rest vanished without a word.
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // the object-manager double is process-wide
    public class CodesysContainerRefusalTests
    {
        public sealed class Application : IObject, IApplicationObject { public Application() : base("", null) { } }

        /// <summary>The Task Configuration, with the three archived members the census measured (design §0.1).</summary>
        public sealed class TaskConfigObject : IObject, ITaskConfigObject
        {
            public TaskConfigObject() : base("", null) { }
            public System.Collections.ArrayList Events { get; init; } = new();
            public int StackSize { get; init; }
            public bool UseConfigurableStackSize { get; init; }
            public string[] SerializableValueNames => new[] { "alSysEventList", "StackSize", "UseConfigurableStackSize" };
            public object? GetSerializableValue(string name) => name switch
            {
                "alSysEventList" => Events,
                "StackSize" => StackSize,
                "UseConfigurableStackSize" => UseConfigurableStackSize,
                _ => throw new ArgumentException(name),
            };
        }

        public sealed class Dut : IObject, IDUTObject { public Dut(string d) : base(d, null) { } }

        /// <summary>A tree node; a folder has no object (as the scripting tree's folders read), and its META holds the
        /// properties the test gives it.</summary>
        public sealed class TreeNode
        {
            private readonly string _name;
            private readonly List<TreeNode> _children;
            public TreeNode(string name, IObject? obj, object[]? props, params TreeNode[] children)
            {
                _name = name; Object = obj; Props = props ?? Array.Empty<object>(); _children = children.ToList();
            }
            public int handle => 0;
            public Guid guid { get; } = Guid.NewGuid();
            public bool is_folder => Object == null;
            public IObject? Object { get; }
            public object[] Props { get; }
            public string get_name(bool _) => _name;
            public IEnumerable<TreeNode> get_children(bool _) => _children;
            public IEnumerable<TreeNode> Self() => new[] { this }.Concat(_children.SelectMany(c => c.Self()));
        }

        public sealed class PropsMeta
        {
            public PropsMeta(IObject? o, object[] props) { Object = o; Properties = props; }
            public IObject? Object { get; }
            public object[] Properties { get; }
        }

        public sealed class Manager
        {
            private readonly Dictionary<Guid, TreeNode> _byGuid = new();
            public Manager(TreeNode root) { foreach (var n in root.Self()) _byGuid[n.guid] = n; }
            public PropsMeta GetObjectToRead(int nProjectHandle, Guid objectGuid) =>
                new(_byGuid[objectGuid].Object, _byGuid[objectGuid].Props);
        }

        public sealed class Projects { public Projects(object primary) => this.primary = primary; public object primary { get; } }

        private static WalkResult Walk(TreeNode root)
        {
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new Manager(root);
            try { return new CodesysDriver(new Projects(root)).WalkItems(); }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }

        private static TreeNode Type(string name) =>
            new(name, new Dut($"TYPE {name} :\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE"), null);

        /// <summary>An EXCLUDED FOLDER is refused by name, and the objects in it are not pulled as built ones — nor read as
        /// deleted: the walk did not read them.</summary>
        [Fact]
        public void An_excluded_folder_is_refused_by_name_and_its_objects_are_not_pulled_as_built()
        {
            var excluded = new _3S.CoDeSys.LanguageModelManager.BuildProperty { ExcludeFromBuild = true };
            var root = new TreeNode("<project>", null, null,
                new TreeNode("Sim", null, new object[] { excluded }, Type("SimType")),
                Type("Kept"));

            var walk = Walk(root);

            var refused = walk.UnreadableObjects.Single(o => o.Name == "Sim");
            Assert.Contains("ExcludeFromBuild", refused.Reason);
            Assert.DoesNotContain(walk.Items, i => i.Name == "SimType");
            Assert.Contains(walk.Items, i => i.Name == "Kept");
        }

        /// <summary>…and the excluded folder blinds NOTHING beside it (gate review of step 3, finding 1). The walk read the
        /// folder's parent whole and knows the folder is a folder; recorded as an object of unknown kind it put the parent
        /// — the ROOT here — into <c>UnwalkedFolders</c>: no deletion was reported anywhere under it, <c>Complete</c> was
        /// false on every walk, so the push pre-flight's create checks never ran (<c>WillCreate</c>), and every status
        /// printed PARTIAL. The folder's objects are named one by one with their kind instead — so a known one is kept,
        /// never read as deleted, and an op on one is refused by name.</summary>
        [Fact]
        public void An_excluded_folder_leaves_the_walk_complete_and_names_its_objects_by_kind()
        {
            var excluded = new _3S.CoDeSys.LanguageModelManager.BuildProperty { ExcludeFromBuild = true };
            var root = new TreeNode("<project>", null, null,
                new TreeNode("Sim", null, new object[] { excluded }, Type("SimType"), new TreeNode("Deep", null, null, Type("DeepType"))),
                Type("Kept"));

            var walk = Walk(root);

            Assert.Empty(walk.UnwalkedFolders);
            Assert.True(walk.Complete);
            var inside = walk.UnreadableObjects.Single(o => o.Name == "SimType");
            Assert.Equal("Sim", inside.Folder);
            Assert.Equal(new[] { ItemKind.Kinds.Dut }, inside.Kinds);
            Assert.Contains("excluded", inside.Reason);
            Assert.Equal("Sim/Deep", walk.UnreadableObjects.Single(o => o.Name == "DeepType").Folder);
            // A DUT deleted in the IDE beside the excluded folder is reported removed; the excluded one is not.
            var kinds = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
            Volt.Engine.Sync.Versioning.CountUnclassifiable(walk, new Dictionary<string, string>(), kinds);
            var removed = Volt.Engine.Sync.Removal.Removed(new[] { "Gone.dut", "Sim/SimType.dut" },
                new HashSet<string> { "Kept.dut" }, kinds, walk.UnwalkedFolders, walk.Applications, walk.Applications);
            Assert.Equal(new[] { "Gone.dut" }, removed);
        }

        /// <summary>A folder whose build property is off its default for a reason OTHER than ExcludeFromBuild is listed by
        /// name and WALKED: its objects are built (gate review of step 3, finding 4).</summary>
        [Fact]
        public void A_folder_linked_always_is_listed_by_name_and_its_objects_still_walk()
        {
            var linked = new _3S.CoDeSys.LanguageModelManager.BuildProperty { LinkAlways = true };
            var root = new TreeNode("<project>", null, null, new TreeNode("Lib", null, new object[] { linked }, Type("LibType")));

            var walk = Walk(root);

            var listed = Assert.Single(walk.UnreadableObjects);
            Assert.Equal("Lib", listed.Name);
            Assert.Contains("LinkAlways", listed.Reason);
            Assert.DoesNotContain("excluded folder", listed.Reason);
            Assert.Contains(walk.Items, i => i.Name == "LibType");
            Assert.True(walk.Complete);
        }

        /// <summary>A folder whose build property is at its measured default holds nothing to refuse.</summary>
        [Fact]
        public void A_folder_with_a_defaulted_build_property_is_walked_plain()
        {
            var root = new TreeNode("<project>", null, null,
                new TreeNode("Sim", null, new object[] { new _3S.CoDeSys.LanguageModelManager.BuildProperty() }, Type("SimType")));

            var walk = Walk(root);

            Assert.Empty(walk.UnreadableObjects);
            Assert.Contains(walk.Items, i => i.Name == "SimType");
            Assert.True(walk.Complete);
        }

        /// <summary>An APPLICATION's compiler defines are listed by name; what the application holds is walked.</summary>
        [Fact]
        public void An_applications_compiler_defines_are_listed_by_name_and_its_items_still_walk()
        {
            var defines = new _3S.CoDeSys.LanguageModelManager.BuildProperty { CompilerDefines = "SIM" };
            var root = new TreeNode("<project>", null, null,
                new TreeNode("Application", new Application(), new object[] { defines }, Type("AppType")));

            var walk = Walk(root);

            var listed = Assert.Single(walk.UnreadableObjects);
            Assert.Equal("Application", listed.Name);
            Assert.Contains("CompilerDefines 'SIM'", listed.Reason);
            Assert.Contains(walk.Items, i => i.Name == "AppType");
            Assert.True(walk.Complete);
        }

        /// <summary>The Task Configuration's system events and its stack settings off their measured value are listed by
        /// name.</summary>
        [Fact]
        public void The_task_configurations_system_events_and_stack_settings_are_listed_by_name()
        {
            var config = new TaskConfigObject { Events = new System.Collections.ArrayList { "PrepareStart" }, StackSize = 4096 };
            var root = new TreeNode("<project>", null, null, new TreeNode("Task Configuration", config, null));

            var listed = Assert.Single(Walk(root).UnreadableObjects);
            Assert.Equal("Task Configuration", listed.Name);
            Assert.Contains("alSysEventList", listed.Reason);
            Assert.Contains("StackSize 4096", listed.Reason);
        }

        /// <summary>…and a Task Configuration at its measured values holds nothing to list.</summary>
        [Fact]
        public void A_task_configuration_at_its_measured_values_is_walked_plain() =>
            Assert.Empty(Walk(new TreeNode("<project>", null, null, new TreeNode("Task Configuration", new TaskConfigObject(), null)))
                .UnreadableObjects);
    }
}
