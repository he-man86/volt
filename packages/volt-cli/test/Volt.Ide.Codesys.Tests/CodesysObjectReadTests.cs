using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Item;
using Xunit;
using static Volt.Ide.Codesys.Tests.CodesysContainerRefusalTests;
using H = Volt.Ide.Codesys.Tests.CodesysHiddenBodyWriteTests;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>
    /// AN OBJECT THE IDE ANSWERS NO <c>IObject</c> FOR IS NAMED, NEVER WALKED AS A FOLDER (cli-bridges review B1).
    ///
    /// <para><c>CodesysObjectModel.ReadObject</c> answered <c>GetObjectToRead(…).Object ?? meta</c>: a read checkout with no
    /// object handed back the IMetaObject ITSELF, which implements none of the classifier's interfaces, so the node read
    /// as a generic container — walked for children, emitted as nothing, reported as nothing. Its file in the workspace
    /// then read as DELETED. Nine callers each guarded the null half of the same read with their own throw; the walk's
    /// classification path had no guard at all.</para>
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // the object-manager double is process-wide
    public class CodesysObjectReadTests
    {
        /// <summary>A tree node that is NOT a folder and whose read checkout answers no object.</summary>
        public sealed class Node
        {
            private readonly List<Node> _children;
            public Node(string name, H.IObject? obj, bool folder, params Node[] children)
            {
                Name = name; Obj = obj; is_folder = folder; _children = children.ToList();
            }
            public string Name { get; }
            public H.IObject? Obj { get; }
            public int handle => 0;
            public Guid guid { get; } = Guid.NewGuid();
            public bool is_folder { get; }
            public string get_name(bool _) => Name;
            public IEnumerable<Node> get_children(bool _) => _children;
            public IEnumerable<Node> Self() => new[] { this }.Concat(_children.SelectMany(c => c.Self()));
        }

        /// <summary>A read checkout: its object (null when the IDE answers none) and no properties.</summary>
        public sealed class Meta
        {
            public Meta(object? o) => Object = o;
            public object? Object { get; }
            public object[] Properties => Array.Empty<object>();
        }

        public sealed class Manager
        {
            private readonly Dictionary<Guid, Node> _byGuid = new();
            public Manager(Node root) { foreach (var n in root.Self()) _byGuid[n.guid] = n; }
            public Meta GetObjectToRead(int nProjectHandle, Guid objectGuid) => new(_byGuid[objectGuid].Obj);
        }

        [Fact]
        public void A_node_whose_read_answers_no_object_is_named_unreadable_and_the_walk_goes_on()
        {
            var root = new Node("<project>", null, true,
                new Node("Kept", new Dut("TYPE Kept :\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE"), false),
                new Node("Ghost", null, false));
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new Manager(root);
            WalkResult walk;
            try { walk = new CodesysDriver(new Projects(root)).WalkItems(); }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }

            Assert.Contains(walk.Items, i => i.Name == "Kept");
            var ghost = Assert.Single(walk.UnreadableObjects);
            Assert.Equal(("Ghost", ""), (ghost.Name, ghost.Folder));
            Assert.Contains("no object", ghost.Reason);
        }
    }
}
