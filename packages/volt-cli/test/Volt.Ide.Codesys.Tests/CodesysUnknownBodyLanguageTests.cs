using Volt.Engine.Item;
using Xunit;
using static Volt.Ide.Codesys.Tests.CodesysHiddenBodyWriteTests;

namespace NwlNoView
{
    /// <summary>A network aspect from an assembly whose type has no <c>DefaultViewMode</c> — the class name is the
    /// driver's dispatch key, the missing member is the point.</summary>
    public sealed class NWLImplementationObject { }
}

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>An implementation aspect of a language Volt has never seen — the class name is the contract
    /// (<c>CodesysDriver.ReadBody</c> dispatches on it).</summary>
    public sealed class UMLImplementationObject { }

    /// <summary>An aspect whose name spells a language Volt reads (LD) in a form it does not — no NWL aspect.</summary>
    public sealed class LDImplementationObject { }

    /// <summary>
    /// A BODY IN A LANGUAGE VOLT HAS NEVER SEEN IS HIDDEN, NOT A LOST POU (openspec <c>bridge-refusal-review</c> 2.23,
    /// 2.24, D27).
    ///
    /// <para>An unknown view mode or body aspect was a <c>NotSupportedException</c> thrown outside
    /// <c>NetworkText.Pulled</c>, so it reached <c>Versioning.SafeVersion</c>, which stamps the item UNREADABLE, and
    /// <c>FetchService</c> dropped the whole POU — declaration, body and every member — from refs and fetch. It is now
    /// the body's UNSUPPORTED line under the vendor's own name for the language, as a CFC chart is: the declaration
    /// still pulls and stays editable, and the push never writes the body.</para>
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]
    public class CodesysUnknownBodyLanguageTests
    {
        private static ItemContent Read(object implementation)
        {
            var pou = new Node("FB_Odd", 1, new Pou("FUNCTION_BLOCK FB_Odd\nVAR\n\tx : BOOL;\nEND_VAR", implementation));
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new ObjectManager(new[] { pou });
            try { return new CodesysDriver(projects: null).ReadContent(new ItemRef(pou)); }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }

        /// <summary>2.23: a fourth view mode beside LD, FBD and IL.</summary>
        [Fact]
        public void An_unknown_view_mode_is_the_UNSUPPORTED_line_naming_it_and_the_declaration_still_pulls()
        {
            var content = Read(new Nwl.NWLImplementationObject { DefaultViewMode = "Sequence" });

            Assert.Equal("IMPLEMENTATION SEQUENCE UNSUPPORTED", content.Body);
            Assert.Equal("FUNCTION_BLOCK FB_Odd\nVAR\n\tx : BOOL;\nEND_VAR", content.Declaration);
            Assert.Null(content.Unsupported);   // the line states the language, which is the whole reason (as for CFC)
        }

        /// <summary>A network aspect that states no view at all is not IL and not FBD: its language is unknown, and the
        /// line says what the body is — the vendor's network object, <c>NWL</c> — as TwinCAT says it of an archive with no
        /// <c>DefaultViewMode</c>.</summary>
        [Fact]
        public void A_network_aspect_with_no_view_mode_is_the_NWL_UNSUPPORTED_line()
        {
            var content = Read(new Nwl.NWLImplementationObject { DefaultViewMode = null });

            Assert.Equal("IMPLEMENTATION NWL UNSUPPORTED", content.Body);
        }

        /// <summary>A network aspect whose TYPE has no <c>DefaultViewMode</c> member at all is not "no view": SP21's
        /// <c>INWLImplementationObject</c> always declares it, so its absence is a different or unpinned vendor assembly (or a
        /// reflection miss) — a version story, refused naming the member and the assembly (review 2e+2g, medium). Read as
        /// "value null" it pulled every LD/FBD body of the project as a hidden body, with no reason and no log line.</summary>
        [Fact]
        public void A_network_aspect_whose_type_lacks_the_view_member_fails_loud_naming_it()
        {
            var ex = Assert.Throws<System.InvalidOperationException>(() => Read(new NwlNoView.NWLImplementationObject()));

            Assert.Contains("'DefaultViewMode'", ex.Message);
            Assert.Contains("NWLImplementationObject", ex.Message);
        }

        /// <summary>2.24: an aspect class Volt has never seen.</summary>
        [Fact]
        public void An_unknown_body_aspect_is_the_UNSUPPORTED_line_naming_it()
        {
            var content = Read(new UMLImplementationObject());

            Assert.Equal("IMPLEMENTATION UML UNSUPPORTED", content.Body);
            Assert.Equal("FUNCTION_BLOCK FB_Odd\nVAR\n\tx : BOOL;\nEND_VAR", content.Declaration);
        }

        /// <summary>An aspect NAMED like a language Volt reads, but not its NWL aspect, is the vendor's fact — hidden as an
        /// LD body Volt cannot represent is (<c>IMPLEMENTATION LD UNSUPPORTED</c>). It was an InvalidOperationException, "a
        /// Volt bug", thrown on the read path, which took the whole POU out of refs and fetch (review 2e+2g, low).</summary>
        [Fact]
        public void An_aspect_named_like_a_read_language_is_its_hidden_line()
        {
            var content = Read(new LDImplementationObject());

            Assert.Equal("IMPLEMENTATION LD UNSUPPORTED", content.Body);
            Assert.Equal("FUNCTION_BLOCK FB_Odd\nVAR\n\tx : BOOL;\nEND_VAR", content.Declaration);
        }
    }
}
