using System.Xml.Linq;

namespace Volt.Ide.Twincat;

/// <summary>
/// The XML namespaces a PLCopen document is written in — spelled ONCE.
///
/// <para><b>Why this is a type and not three string literals.</b> A body written into the wrong namespace is not
/// a compile error; it is a document the vendor's importer quietly declines to understand, which surfaces much
/// later as an empty POU. These were spelled at nine sites across five files before a <c>Namespaces</c> existed,
/// and nine independent spellings of one fact drift. The class went with the PLCopen transport when that was
/// deleted; it comes back with the one thing PLCopen is still used for — CREATING a graphical body — and
/// <c>WireVocabularyGuardTests</c> enforces that these literals live only here.</para>
/// </summary>
internal static class Namespaces
{
    /// <summary>PLCopen TC6, the document's own namespace.
    /// <para>Previously this was deliberately absent from the vocabulary, because a write took the namespace
    /// from the element it was writing INTO — a document declares its own version, and inheriting it is safer
    /// than asserting it. That reasoning still holds for editing. It cannot hold for CREATION: a document being
    /// authored from nothing has no element to inherit from, so the version is stated here, once.</para></summary>
    public static readonly XNamespace Tc6 = "http://www.plcopen.org/xml/tc6_0200";

    /// <summary>XHTML, used by PLCopen for the human-readable text of a vendor element.</summary>
    public static readonly XNamespace Xhtml = "http://www.w3.org/1999/xhtml";

    /// <summary>The 3S extension prefix. Every vendor-specific <c>addData</c> block is named by appending to
    /// this — the call type, the FBD implementation attributes, the resolved parameter types.</summary>
    public const string PlcOpenExt = "http://www.3s-software.com/plcopenxml/";
}
