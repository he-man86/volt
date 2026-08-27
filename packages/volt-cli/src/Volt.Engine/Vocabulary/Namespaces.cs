using System.Xml.Linq;

namespace Volt.Engine.Vocabulary
{
    /// <summary>
    /// The XML namespaces a PLCopen document is written in — spelled ONCE.
    ///
    /// <para>These were respelled at nine sites across five files: the xhtml namespace five times, the 3S vendor
    /// root four (twice as a shared constant, twice inline with a suffix concatenated on). Nothing was wrong with
    /// any single one of them, which is the problem — nine independent spellings of one fact drift silently, and
    /// a body written into the wrong namespace is not a compile error, it is a document the vendor's importer
    /// quietly declines to understand.</para>
    ///
    /// <para>Level 0, next to <see cref="Languages"/>, which records the same fix for the language predicates:
    /// <i>"These predicates were spelled out at six sites across three namespaces."</i> Same folder, same
    /// reason.</para>
    ///
    /// <para>The TC6 namespace itself is deliberately NOT here. It is never written from a literal — every write
    /// takes it from the element it is writing into (<c>owner.Name.Namespace</c>), because a document declares
    /// its own version and Volt must write into the one the vendor used, not the one Volt was compiled against.
    /// A constant would invite exactly the wrong thing.</para>
    /// </summary>
    public static class Namespaces
    {
        /// <summary>XHTML — the wrapper PLCopen puts declaration and ST body text inside.</summary>
        public static readonly XNamespace Xhtml = "http://www.w3.org/1999/xhtml";

        /// <summary>The 3S (CODESYS) vendor-extension root. Vendor <c>addData</c> blocks are named by appending a
        /// suffix to it — see <see cref="ThreeSName"/>.</summary>
        public const string ThreeS = "http://www.3s-software.com/plcopenxml/";

        /// <summary>A 3S vendor <c>addData</c> name: the root plus its suffix (<c>objectid</c>,
        /// <c>fbdelementtype</c>, …). A method rather than a set of constants because the suffix set is the
        /// vendor's and open-ended; what must not vary is the ROOT.</summary>
        public static string ThreeSName(string suffix) => ThreeS + suffix;
    }
}
