using System;
using System.Collections;
using System.Linq;
using Volt.Engine.Item;
using Xunit;
using Volt.Tests.Shared;
using static Volt.Ide.Codesys.Tests.CodesysContainerRefusalTests;
using H = Volt.Ide.Codesys.Tests.CodesysHiddenBodyWriteTests;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>The library manager's interface, by the vendor's NAME (the classifier and <c>GetLibraryRefs</c> find it so):
    /// <c>GetAllLibraries</c> is invoked through the interface's own MethodInfo.</summary>
    public interface ILibManObject { IEnumerable GetAllLibraries(bool includeHidden); }

    /// <summary>
    /// AN ABSENT VENDOR MEMBER IS NOT AN UNREAD VALUE, AND AN UNREADABLE ONE HOLDS BACK ITS ITEM, NEVER THE OP (openspec
    /// <c>environment-dependency-audit</c> 2.0). On CODESYS 3.5.18.30 the library manager's archive does not name
    /// <c>ParameterTable</c>; the read threw, nothing in the walk caught it, and every op that walks — refs, fetch, pull,
    /// push, the lifecycle — failed (212 of 218 failures of the 2026-10-13 SP18 e2e matrix, one message). The member's
    /// availability per platform is a measured table (<c>MemberAvailability</c>, DIALECT V7): absent where the census says
    /// the version lacks it, the fact it would carry does not exist (no parameter values to name); absent anywhere else,
    /// or present and failing, the MANAGER is named unreadable and the walk goes on.
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // the object-manager double is process-wide
    public class CodesysMemberAvailabilityTests
    {
        /// <summary>A library manager as the vendor's <c>LibManObject</c> answers it: one placeholder reference, no
        /// redirection, and an archive that names <c>ParameterTable</c> only when the test says so.</summary>
        public sealed class LibManObject : H.IObject, ILibManObject
        {
            public LibManObject() : base("", null) { }
            public bool ArchivesParameterTable { get; init; }
            public bool ParameterTableThrows { get; init; }
            /// <summary>The references it holds — by default one placeholder that archives no parameter values.</summary>
            public object[] Libraries { get; init; } = { new ArchivedItem() };
            public IEnumerable GetAllLibraries(bool includeHidden) => Libraries;
            /// <summary>Its placeholder redirections — placeholder → resolution; none by default.</summary>
            public System.Collections.Generic.Dictionary<string, string> Redirects { get; init; } = new();
            public IEnumerable GetRedirectedPlaceholderNames() => Redirects.Keys.ToArray();
            public string GetRedirectedPlaceholderResolution(string name) => Redirects[name];
            /// <summary>Its archived <c>ParameterTable</c> entries (<see cref="ParameterTableEntry"/>); none by default.</summary>
            public object[] ParameterTable { get; init; } = Array.Empty<object>();
            public string[] SerializableValueNames => ArchivesParameterTable
                ? new[] { "Items", "ParameterTable", "PlaceholderRedirectionTable" }
                : new[] { "Items", "PlaceholderRedirectionTable" };
            public object? GetSerializableValue(string name) => name switch
            {
                "ParameterTable" when ParameterTableThrows => throw new InvalidOperationException("the vendor's getter failed"),
                "ParameterTable" => new ArrayList(ParameterTable),
                _ => throw new ArgumentException(name),
            };
        }

        /// <summary>One archived <c>ParameterTable</c> entry: the library it belongs to, and the values the project sets.</summary>
        public sealed class ParameterTableEntry
        {
            public string Name { get; init; } = "";
            public object[] Values { get; init; } = Array.Empty<object>();
            public string[] SerializableValueNames => new[] { "Name", "Values" };
            public object? GetSerializableValue(string name) => name switch
            {
                "Name" => Name,
                "Values" => Values,
                _ => throw new ArgumentException(name),
            };
        }

        /// <summary>A library reference as <c>AbstractLibManItem</c> archives it. Up to 3.5.18.30 the library parameter
        /// values the project sets live HERE, per reference — the archived <c>Params</c> (<c>ParametersToSerialize</c>, a
        /// <c>ParameterInfo[]</c>, null when none is set); from 3.5.19 the manager's <c>ParameterTable</c> holds them, and
        /// <c>LibManObject.AfterDeserialize</c> moves each reference's <c>Params</c> there (<c>MoveParameterListFromItem</c>)
        /// — measured from both platforms' <c>LibManObject.plugin.dll</c> (DIALECT V7).</summary>
        public sealed class ArchivedItem : CodesysWireParityTests.PlaceholderItem
        {
            public bool ArchivesParams { get; init; } = true;
            public object[]? Params { get; init; }
            public string[] SerializableValueNames => ArchivesParams
                ? new[] { "Id", "Namespace", "Params", "PlaceholderName" }
                : new[] { "Id", "Namespace", "PlaceholderName" };
            public object? GetSerializableValue(string name) =>
                name == "Params" ? Params : throw new ArgumentException(name);
        }

        internal const string Manager = "Library Manager";

        internal static WalkResult Walk(LibManObject libMan, string? platform, bool gated = true)
        {
            var root = new TreeNode("<project>", null, null,
                new TreeNode(Manager, libMan, null),
                new TreeNode("Kept", new Dut("TYPE Kept :\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE"), null));
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new Manager(root);
            try
            {
                var walk = new CodesysDriver(new Projects(root), CodesysPlatform.ReadHostExe, platform).WalkItems();
                return gated ? walk.Gated() : walk;
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }

        private static void AssertManagerUnreadable(WalkResult walk, params string[] reasonHolds)
        {
            var named = Assert.Single(walk.UnreadableObjects);
            Assert.Equal(Manager, named.Name);
            Assert.Equal("", named.Folder);
            foreach (var r in reasonHolds) Assert.Contains(r, named.Reason);
            // The rest of the walk ran, and only the manager's own folder is unread: a .library file there is not
            // removed, and absence beside the manager still means deleted.
            Assert.Contains(walk.Items, i => i.Name == "Kept");
            Assert.Equal(new[] { Manager }, walk.UnwalkedFolders);
        }

        /// <summary>The version the census measured without the member: nothing to spell, nothing reported — the
        /// references materialize and the walk is complete.</summary>
        [Fact]
        public void A_member_the_platform_does_not_have_is_no_unread_value()
        {
            var walk = Walk(new LibManObject { ArchivesParameterTable = false }, "3.5.18.30");

            Assert.Empty(walk.UnreadableObjects);
            Assert.True(walk.Complete);
            Assert.Contains(walk.Items, i => i.KindCode == ItemKind.PlcLibRef && i.Folder == Manager);
            Assert.Contains(walk.Items, i => i.Name == "Kept");
        }

        /// <summary>A version no census measured: an absent member may be a rename, so the manager is held back by name —
        /// member, type and version — and the op is not.</summary>
        [Fact]
        public void An_absent_member_on_an_unmeasured_platform_holds_back_the_manager_not_the_walk()
            => AssertManagerUnreadable(Walk(new LibManObject { ArchivesParameterTable = false }, "3.5.17.20"),
                                       "ParameterTable", "LibManObject", "3.5.17.20");

        /// <summary>A measured version that HAS the member, whose archive does not name it: the census says otherwise, so
        /// it is no version fact — the manager is held back by name.</summary>
        [Fact]
        public void An_absent_member_where_the_census_measured_it_holds_back_the_manager()
            => AssertManagerUnreadable(Walk(new LibManObject { ArchivesParameterTable = false }, "3.5.21.40"),
                                       "ParameterTable", "LibManObject", "3.5.21.40");

        /// <summary>No platform version read at all is no measured version.</summary>
        [Fact]
        public void An_absent_member_with_no_platform_version_holds_back_the_manager()
            => AssertManagerUnreadable(Walk(new LibManObject { ArchivesParameterTable = false }, null), "ParameterTable");

        /// <summary>The member is there and its read fails: that item, with its reason — never the op.</summary>
        [Fact]
        public void A_present_member_whose_read_fails_holds_back_the_manager_not_the_walk()
            => AssertManagerUnreadable(Walk(new LibManObject { ArchivesParameterTable = true, ParameterTableThrows = true }, "3.5.21.40"),
                                       "the vendor's getter failed");

        /// <summary>The Task Configuration as 3.5.18.30 archives it — no <c>StackSize</c>, no <c>UseConfigurableStackSize</c>
        /// (census, DIALECT V7).</summary>
        public sealed class TaskConfigObject : H.IObject, ITaskConfigObject
        {
            public TaskConfigObject() : base("", null) { }
            public string[] SerializableValueNames => new[] { "alSysEventList" };
            public object? GetSerializableValue(string name) =>
                name == "alSysEventList" ? new ArrayList() : throw new ArgumentException(name);
        }

        private static WalkResult WalkTaskConfig(string? platform)
        {
            var root = new TreeNode("<project>", null, null,
                new TreeNode("Task Configuration", new TaskConfigObject(), null,
                    new TreeNode("Kept", new Dut("TYPE Kept :\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE"), null)));
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new Manager(root);
            try { return new CodesysDriver(new Projects(root), CodesysPlatform.ReadHostExe, platform).WalkItems().Gated(); }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }

        /// <summary>The Task Configuration's stack settings are absent on 3.5.18.30: no setting to name there, and what it
        /// holds is walked (it read as unreadable, so every task under it was held back).</summary>
        [Fact]
        public void Stack_settings_the_platform_does_not_have_hold_nothing_back()
        {
            var walk = WalkTaskConfig("3.5.18.30");

            Assert.Empty(walk.UnreadableObjects);
            Assert.Contains(walk.Items, i => i.Name == "Kept");
        }

        /// <summary>The same archive on a platform no census measured is named, member and version.</summary>
        [Fact]
        public void Stack_settings_absent_on_an_unmeasured_platform_name_the_task_configuration()
        {
            var named = Assert.Single(WalkTaskConfig("3.5.19.0").UnreadableObjects);
            Assert.Equal("Task Configuration", named.Name);
            Assert.Contains("TaskConfigObject.StackSize", named.Reason);
            Assert.Contains("3.5.19.0", named.Reason);
        }

        /// <summary>WHERE THE MANAGER HAS NO <c>ParameterTable</c> THE FACT IS NOT GONE — IT IS ON THE REFERENCES (gate 2a
        /// review). 3.5.18.30 archives a reference's parameter values in its own <c>Params</c>; reading the manager's absence
        /// as "no values to name" dropped them silently where 3.5.21.40 names the manager in the pull report. The same line
        /// names them here, per library.</summary>
        [Fact]
        public void On_a_platform_without_the_table_the_references_parameter_values_are_named()
        {
            var walk = Walk(new LibManObject
            {
                ArchivesParameterTable = false,
                Libraries = new object[] { new ArchivedItem { Params = new object[] { new object(), new object() } } },
            }, "3.5.18.30");

            var named = Assert.Single(walk.UnreadableObjects);
            Assert.Equal(Manager, named.Name);
            Assert.Contains("sets 2 library parameter value(s)", named.Reason);
            Assert.Contains(new CodesysWireParityTests.PlaceholderItem().Name, named.Reason);
            // A report line, not a refusal: the references still materialize and the walk is complete.
            Assert.True(walk.Complete);
            Assert.Contains(walk.Items, i => i.KindCode == ItemKind.PlcLibRef && i.Folder == Manager);
        }

        /// <summary>…and a reference whose archive names no <c>Params</c> there is no version fact either: the manager is
        /// held back by name, member and version — never read as "no values".</summary>
        [Fact]
        public void On_a_platform_without_the_table_a_reference_without_params_holds_back_the_manager()
            => AssertManagerUnreadable(Walk(new LibManObject
            {
                ArchivesParameterTable = false,
                Libraries = new object[] { new ArchivedItem { ArchivesParams = false } },
            }, "3.5.18.30"), "Params", nameof(ArchivedItem), "3.5.18.30");

        /// <summary>And where it is there and reads, nothing changes: an empty table names nothing.</summary>
        [Fact]
        public void A_present_member_that_reads_walks_plain()
        {
            var walk = Walk(new LibManObject { ArchivesParameterTable = true }, "3.5.21.40");

            Assert.Empty(walk.UnreadableObjects);
            Assert.True(walk.Complete);
            Assert.Contains(walk.Items, i => i.KindCode == ItemKind.PlcLibRef);
        }
    }
}
