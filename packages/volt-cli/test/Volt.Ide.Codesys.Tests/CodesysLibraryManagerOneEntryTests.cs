using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Volt.Tests.Shared;
using Xunit;
using static Volt.Ide.Codesys.Tests.CodesysMemberAvailabilityTests;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>
    /// THE LIBRARY MANAGER IS ONE NODE, SO IT IS ONE <c>unreadableNodes</c> ENTRY (openspec
    /// <c>library-manager-one-node-entry</c> A; PLC Assist, Pro2193 on 0.1.17884). A manager holding stray redirections
    /// AND parameter values was listed twice — one entry per kind of fact no manifest spells — and took two version slots.
    /// Every other container joins its reasons into one entry.
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // the object-manager double is process-wide
    public class CodesysLibraryManagerOneEntryTests
    {
        private static LibManObject Holding(bool strays, bool parameters) => new()
        {
            ArchivesParameterTable = true,
            Redirects = strays ? new Dictionary<string, string> { ["a"] = "A, 1.0 (X)", ["b"] = "B, 1.0 (X)" } : new(),
            ParameterTable = parameters
                ? new object[] { new ParameterTableEntry { Name = "Util", Values = new object[] { new object(), new object() } } }
                : new object[0],
        };

        /// <summary>The walk WITHOUT its gate (<see cref="OneEntryPerNode"/>), so each assertion here is red on its own.</summary>
        private static WalkResult WalkUngated(LibManObject libMan) => Walk(libMan, "3.5.21.40", gated: false);

        /// <summary>The gate itself refuses a node listed twice, and lets one entry per node through.</summary>
        [Fact]
        public void The_gate_refuses_a_node_listed_twice()
        {
            WalkResult Of(params UnreadableObject[] o) => new(new List<ProjectItem>(), new List<string>(), o, new List<string>());
            var once = new UnreadableObject(Manager, "", "x", ItemKind.Kinds.Folder, Code: BridgeErrorCodes.Unsupported);

            Assert.ThrowsAny<Xunit.Sdk.XunitException>(() => Of(once, once with { Reason = "y" }).Gated());
            Of(once).Gated();
            // Two objects of one name whose kinds differ, or are unknown, stay two entries.
            Of(once, once with { Kind = ItemKind.Kinds.Library }).Gated();
            Of(once with { Kind = null }, once with { Kind = null }).Gated();
        }

        /// <summary>…and the walk of a manager holding both kinds of unspelled fact passes it.</summary>
        [Fact]
        public void A_manager_holding_strays_and_parameter_values_passes_the_gate()
            => Walk(Holding(strays: true, parameters: true), "3.5.21.40");

        [Fact]
        public void A_manager_with_strays_and_parameter_values_is_one_entry_naming_both()
        {
            var walk = WalkUngated(Holding(strays: true, parameters: true));

            var named = Assert.Single(walk.UnreadableObjects);
            Assert.Equal((Manager, "", ItemKind.Kinds.Folder), (named.Name, named.Folder, named.Kind));
            Assert.Contains("(a, b)", named.Reason);
            Assert.Contains("sets 2 library parameter value(s) (Util)", named.Reason);
            Assert.Contains(" and ", named.Reason);
            Assert.True(walk.Complete);
        }

        [Fact]
        public void A_manager_whose_only_unspelled_fact_is_a_stray_names_it_once()
        {
            var named = Assert.Single(WalkUngated(Holding(strays: true, parameters: false)).UnreadableObjects);
            Assert.Equal(Manager, named.Name);
            Assert.Contains("(a, b)", named.Reason);
            Assert.DoesNotContain("parameter", named.Reason);
        }

        /// <summary>…and the project version counts it once: one slot for the node.</summary>
        [Fact]
        public void The_project_version_counts_the_manager_once()
        {
            var walk = WalkUngated(Holding(strays: true, parameters: true));
            var versions = new Dictionary<string, string>();

            var (items, nodes) = Versioning.CountUnclassifiable(walk.ToHostWalk(), versions,
                Volt.Engine.Seam.Catalog.Of(new CodesysDriver(projects: null).Declaration).Kinds);

            Assert.Empty(items);
            Assert.Equal(new[] { Manager }, nodes.Select(n => n.Name));
            Assert.Single(versions.Keys, k => k.Contains(Manager));
        }
    }
}
