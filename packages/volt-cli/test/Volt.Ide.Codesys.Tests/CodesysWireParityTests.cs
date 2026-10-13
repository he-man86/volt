using System.Reflection;
using Volt.Engine.Format.St;
using Volt.Engine.Item;
using Volt.Tests.Shared;
using Xunit;
using H = Volt.Ide.Codesys.Tests.CodesysHiddenBodyWriteTests;

namespace Volt.Ide.Codesys.Tests
{
    // A placeholder library item is told apart by this interface's NAME (CodesysObjectModel.RefDisplayName / ToLibRef).
    internal interface IPlaceholderLibManItem { }

    /// <summary>
    /// THE WIRE-PARITY GATE, CODESYS'S OFFLINE HALF (openspec <c>bridge-one-to-one</c> §2.3): the CODESYS driver gives the
    /// text <see cref="WireParityCases"/> states for each case — the same constant <c>TcWireParityTests</c> asserts of the
    /// TwinCAT driver, so the two cannot drift apart in CI. The live half is <c>test/e2e/vendor-parity.test.ts</c>.
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // SystemInstances.ObjectMgr is process-wide
    public class CodesysWireParityTests
    {
        [Theory]
        [InlineData(ItemKind.Kinds.Visualization, WireParityCases.VisualizationStub)]
        [InlineData(ItemKind.Kinds.TextList, WireParityCases.TextListStub)]
        public void A_stub_manifest_is_the_kind_alone(string kind, string expected)
        {
            Assert.Equal(expected, new CodesysDriver(projects: null).ReadManifest(new ItemRef(new object()), kind));
        }

        /// <summary>The library's resolved version, as the vendor's managed library answers it.</summary>
        public sealed class ManagedLibrary
        {
            public string DisplayName =>
                $"{WireParityCases.LibraryName}, {WireParityCases.LibraryVersion} ({WireParityCases.LibraryDistributor})";
        }

        /// <summary>A placeholder reference as SP21 answers it (<c>LibManObject</c> items, census §0.1): name, namespace,
        /// placeholder name, its effective resolution, <c>SystemLibrary</c> false, no dependencies.</summary>
        public class PlaceholderItem : IPlaceholderLibManItem
        {
            public string Name => $"{WireParityCases.LibraryName}, * ({WireParityCases.LibraryDistributor})";
            public string Namespace => WireParityCases.LibraryName;
            public string PlaceholderName => WireParityCases.LibraryName;
            public virtual bool SystemLibrary => false;
            // The library-item members SP21 answers (AbstractLibManItem), at the value measured on all 264 corpus items.
            public bool LinkAllContent => false;
            public bool QualifiedOnly => false;
            public bool Optional => false;
            public bool HideWhenReferencedAsDependency => false;
            public bool PublishSymbolsInContainer => false;
            public object EffectiveResolution => new ManagedLibrary();
            public System.Collections.IEnumerable GetDependencies() => new object[0];
        }

        /// <summary>A manager that redirects no placeholder.</summary>
        private static readonly System.Collections.Generic.Dictionary<string, string> NoRedirects = new();

        /// <summary>A placeholder the library manager REDIRECTS (its <c>PlaceholderRedirectionTable</c>, 193 entries in the
        /// corpora) spells the redirection in its manifest (design §1.1: <c>REDIRECT &lt;placeholder&gt; &lt;resolution&gt;</c>;
        /// gate review of step 3, finding 4) — it was read by nothing.</summary>
        [Fact]
        public void A_redirected_placeholder_reference_spells_its_redirection()
        {
            var toLibRef = typeof(CodesysObjectModel).GetMethod("ToLibRef", BindingFlags.NonPublic | BindingFlags.Static);
            Assert.NotNull(toLibRef);
            var redirects = new System.Collections.Generic.Dictionary<string, string>
                { [WireParityCases.LibraryName] = "Util, 3.5.17.0 (System)" };
            var node = (LibRefNode)toLibRef!.Invoke(null, new object[] { new PlaceholderItem(), redirects })!;
            Assert.Contains($"\nREDIRECT {WireParityCases.LibraryName} Util, 3.5.17.0 (System)\nMATERIALIZATION ", node.Manifest);
        }

        [Fact]
        public void A_non_system_placeholder_reference_pulls_without_a_SYSTEM_line()
        {
            var toLibRef = typeof(CodesysObjectModel).GetMethod("ToLibRef", BindingFlags.NonPublic | BindingFlags.Static);
            Assert.NotNull(toLibRef);
            var node = (LibRefNode)toLibRef!.Invoke(null, new object[] { new PlaceholderItem(), NoRedirects })!;
            Assert.Equal(WireParityCases.PlaceholderLibrary, node.Manifest);
        }

        /// <summary>The same reference with <c>SystemLibrary</c> true (census: 142 of 264).</summary>
        public sealed class SystemPlaceholderItem : PlaceholderItem
        {
            public override bool SystemLibrary => true;
        }

        /// <summary>"Spelled only where it is TRUE" has two halves; the parity case pins the false one. This pins the
        /// true one, so dropping the SYSTEM line altogether (which turns the parity case green) loses nothing silently.</summary>
        [Fact]
        public void A_system_placeholder_reference_pulls_SYSTEM_true()
        {
            var toLibRef = typeof(CodesysObjectModel).GetMethod("ToLibRef", BindingFlags.NonPublic | BindingFlags.Static);
            Assert.NotNull(toLibRef);
            var node = (LibRefNode)toLibRef!.Invoke(null, new object[] { new SystemPlaceholderItem(), NoRedirects })!;
            Assert.Equal(WireParityCases.SystemPlaceholderLibrary, node.Manifest);
        }

        [Fact]
        public void An_interface_property_with_an_empty_GET_declaration_pulls_the_shared_text()
        {
            var getter = new H.Node("Get", 3, new H.AccessorObject("", null!));
            var property = new H.Node("Speed", 2, new CodesysInterfaceAccessorWriteTests.InterfaceProperty("PROPERTY Speed : INT"), getter);
            var itf = new H.Node("I_Motor", 1, new CodesysInterfaceAccessorWriteTests.Interface(WireParityCases.InterfaceDeclaration), property);
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new H.ObjectManager(new[] { itf, property, getter });
            try
            {
                var read = new CodesysDriver(projects: null).ReadContent(new ItemRef(itf));
                Assert.Equal(WireParityCases.InterfaceWithGetter, StWriter.Write(read));
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }
    }
}
