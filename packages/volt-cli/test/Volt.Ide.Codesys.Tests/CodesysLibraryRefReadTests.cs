using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Item;
using Xunit;
using static Volt.Ide.Codesys.Tests.CodesysContainerRefusalTests;
using static Volt.Ide.Codesys.Tests.CodesysMemberAvailabilityTests;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>
    /// A LIBRARY REFERENCE THAT CANNOT BE READ IS NAMED, AND ITS <c>.library</c> FILE IS KEPT (cli-bridges review B2).
    ///
    /// <para>The library walk caught a reference whose manifest it could not build — a member off its measured value, or
    /// one the reference does not answer — logged a Warn, and went on WITHOUT it. The walk then reported a complete
    /// manager with one reference fewer, so the client read that reference's <c>.library</c> file as deleted: exactly
    /// what <c>GetLibraryRefs</c>' own contract forbids ("a wrong answer here costs files"). The reference's name is
    /// readable, so it is named in the pull report with its kind, which keeps its file (<c>Removal</c>).</para>
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // the object-manager double is process-wide
    public class CodesysLibraryRefReadTests
    {
        private const string Manager = "Library Manager";
        private const string Niche = "Niche, * (Somebody)";
        /// <summary>A placeholder reference is named by its placeholder name (<c>RefDisplayName</c>) — its file is
        /// <c>Niche.library</c>.</summary>
        private const string NichePlaceholder = "Niche";

        /// <summary>A placeholder reference that is <c>Optional</c> — off the value measured on all 264 corpus references,
        /// so the manifest has no line for it and <c>ToLibRef</c> refuses it by name.</summary>
        public sealed class OptionalItem : IPlaceholderLibManItem
        {
            public string Name => Niche;
            public string Namespace => "Niche";
            public string PlaceholderName => NichePlaceholder;
            public bool SystemLibrary => false;
            public bool LinkAllContent => false;
            public bool QualifiedOnly => false;
            public bool Optional => true;
            public bool HideWhenReferencedAsDependency => false;
            public bool PublishSymbolsInContainer => false;
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
            var walk = Walk(new LibManObject { ArchivesParameterTable = true, Libraries = new object[] { new ArchivedItem(), new OptionalItem() } });

            // The readable reference materializes, beside the manager.
            Assert.Single(walk.Items, i => i.KindCode == ItemKind.PlcLibRef && i.Folder == Manager);
            // The other is named — its folder, its kind, the vendor member and value that refused it.
            var niche = Assert.Single(walk.UnreadableObjects);
            Assert.Equal((NichePlaceholder, Manager), (niche.Name, niche.Folder));
            Assert.Equal(new[] { ItemKind.Kinds.Library }, niche.Kinds);
            Assert.Contains("Optional", niche.Reason);

            // …so the client does not delete its file.
            var file = NichePlaceholder + "." + ItemKind.Kinds.Library;
            var kinds = new Dictionary<string, HashSet<string>>(System.StringComparer.Ordinal);
            Volt.Engine.Sync.Versioning.CountUnclassifiable(walk, new Dictionary<string, string>(), kinds);
            var removed = Volt.Engine.Sync.Removal.Removed(new[] { file },
                new Dictionary<string, string> { { file, Manager } },
                new HashSet<string>(), kinds, walk.UnwalkedFolders);
            Assert.Empty(removed);
        }
    }
}
