using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Item;
using Xunit;
using static Volt.Ide.Codesys.Tests.CodesysContainerRefusalTests;
using static Volt.Ide.Codesys.Tests.CodesysMemberAvailabilityTests;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>
    /// A LIBRARY REFERENCE THAT CANNOT BE READ IS NAMED, AND ITS <c>.library</c> FILE IS KEPT (cli-bridges review B2) —
    /// AND ONE THAT CAN IS MATERIALIZED, WHATEVER ITS FLAGS.
    ///
    /// <para>The library walk caught a reference whose manifest it could not build — a member off its measured value, or
    /// one the reference does not answer — logged a Warn, and went on WITHOUT it. The walk then reported a complete
    /// manager with one reference fewer, so the client read that reference's <c>.library</c> file as deleted: exactly
    /// what <c>GetLibraryRefs</c>' own contract forbids ("a wrong answer here costs files"). The reference's name is
    /// readable, so it is named in the pull report with its kind, which keeps its file (<c>Removal</c>).</para>
    ///
    /// <para>"Off its measured value" used to include <c>Optional</c>, <c>HideWhenReferencedAsDependency</c> and
    /// <c>PublishSymbolsInContainer</c>: false on all 264 corpus references, so the manifest had no line for them. The
    /// default live fixture holds two of them (<c>CmpCodeMeter</c> Optional; <c>CmpEventMgr Implementation</c>,
    /// <c>CmpEventMgr Interfaces</c>, <c>CmpIoMgr Implementation</c> PublishSymbolsInContainer), and
    /// <c>test/e2e/whole-project.test.ts</c> named all four unreadable. Each now has a line, spelled where true.</para>
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // the object-manager double is process-wide
    public class CodesysLibraryRefReadTests
    {
        private const string Manager = "Library Manager";
        private const string Niche = "Niche, * (Somebody)";
        /// <summary>A placeholder reference is named by its placeholder name (<c>RefDisplayName</c>) — its file is
        /// <c>Niche.library</c>.</summary>
        private const string NichePlaceholder = "Niche";

        /// <summary>A placeholder reference with the three dialog flags as the test sets them.</summary>
        public sealed class FlaggedItem : IPlaceholderLibManItem
        {
            public string Name => Niche;
            public string Namespace => "Niche";
            public string PlaceholderName => NichePlaceholder;
            public bool SystemLibrary => false;
            public bool LinkAllContent => false;
            public bool QualifiedOnly => false;
            public bool Optional { get; init; }
            public bool HideWhenReferencedAsDependency { get; init; }
            public bool PublishSymbolsInContainer { get; init; }
            public object EffectiveResolution => new CodesysWireParityTests.ManagedLibrary();
            public System.Collections.IEnumerable GetDependencies() => new object[0];
        }

        /// <summary>A placeholder reference that answers no <c>PublishSymbolsInContainer</c> — Volt reads a reference's
        /// members rather than assume them (<c>LibMember</c>), so <c>ToLibRef</c> refuses it by name.</summary>
        public sealed class UnansweringItem : IPlaceholderLibManItem
        {
            public string Name => Niche;
            public string Namespace => "Niche";
            public string PlaceholderName => NichePlaceholder;
            public bool SystemLibrary => false;
            public bool LinkAllContent => false;
            public bool QualifiedOnly => false;
            public bool Optional => false;
            public bool HideWhenReferencedAsDependency => false;
            public object EffectiveResolution => new CodesysWireParityTests.ManagedLibrary();
            public System.Collections.IEnumerable GetDependencies() => new object[0];
        }

        private static WalkResult Walk(LibManObject libMan)
        {
            var root = new TreeNode("<project>", null, null, new TreeNode(Manager, libMan, null));
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new CodesysContainerRefusalTests.Manager(root);
            try { return new CodesysDriver(new Projects(root), CodesysPlatform.ReadHostExe, "3.5.21.40").WalkItems(); }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }

        [Fact]
        public void A_reference_whose_manifest_cannot_be_built_is_named_and_its_file_is_not_read_as_deleted()
        {
            var walk = Walk(new LibManObject { ArchivesParameterTable = true, Libraries = new object[] { new ArchivedItem(), new UnansweringItem() } });

            // The readable reference materializes, beside the manager.
            Assert.Single(walk.Items, i => i.KindCode == ItemKind.PlcLibRef && i.Folder == Manager);
            // The other is named — its folder, its kind, the vendor member that refused it.
            var niche = Assert.Single(walk.UnreadableObjects);
            Assert.Equal((NichePlaceholder, Manager), (niche.Name, niche.Folder));
            Assert.Equal(new[] { ItemKind.Kinds.Library }, niche.Kinds);
            Assert.Contains("PublishSymbolsInContainer", niche.Reason);

            // …so the client does not delete its file.
            var file = NichePlaceholder + "." + ItemKind.Kinds.Library;
            var kinds = new Dictionary<string, HashSet<string>>(System.StringComparer.Ordinal);
            Volt.Engine.Sync.Versioning.CountUnclassifiable(walk, new Dictionary<string, string>(), kinds);
            var removed = Volt.Engine.Sync.Removal.Removed(new[] { file },
                new Dictionary<string, string> { { file, Manager } },
                new HashSet<string>(), kinds, walk.UnwalkedFolders);
            Assert.Empty(removed);
        }

        /// <summary>Each dialog flag, true, materializes the reference and spells its line — and nothing else changes.</summary>
        [Theory]
        [InlineData(true, false, false, "OPTIONAL\n")]
        [InlineData(false, true, false, "HIDEWHENREFERENCEDASDEPENDENCY\n")]
        [InlineData(false, false, true, "PUBLISHSYMBOLSINCONTAINER\n")]
        [InlineData(true, true, true, "OPTIONAL\nHIDEWHENREFERENCEDASDEPENDENCY\nPUBLISHSYMBOLSINCONTAINER\n")]
        public void A_flagged_reference_materializes_and_spells_its_flags(bool optional, bool hidden, bool published, string lines)
        {
            var walk = Walk(new LibManObject
            {
                ArchivesParameterTable = true,
                Libraries = new object[]
                {
                    new FlaggedItem { Optional = optional, HideWhenReferencedAsDependency = hidden, PublishSymbolsInContainer = published },
                },
            });

            Assert.Empty(walk.UnreadableObjects);
            var item = Assert.Single(walk.Items, i => i.KindCode == ItemKind.PlcLibRef && i.Folder == Manager);
            Assert.Equal(NichePlaceholder, item.Name);
            var manifest = new CodesysDriver(projects: null).ReadManifest(item.Item,ItemKind.Kinds.Library);
            Assert.Equal(
                $"LIBRARY {NichePlaceholder}\nNAMESPACE Niche\nRESOLUTION " +
                $"{Volt.Tests.Shared.WireParityCases.LibraryName}, {Volt.Tests.Shared.WireParityCases.LibraryVersion} " +
                $"({Volt.Tests.Shared.WireParityCases.LibraryDistributor})\nPLACEHOLDER true\n" + lines + "MATERIALIZATION 4\n",
                manifest);
        }
    }
}
