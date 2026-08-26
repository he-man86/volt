using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Vocabulary;

namespace Volt.Engine.Document
{
    /// <summary>Where a body language's element SITS inside <c>&lt;body&gt;</c> — the one answer, shared by the
    /// reader (<see cref="PouReader"/>) and the writer (<see cref="BodyCodec"/>).
    ///
    /// <para><b>Sharing it is the fix, not a tidy-up.</b> The two halves used to carry their own copy of the same
    /// scan, and a body only survives a push if BOTH find it: the reader has to call it a diagram for the
    /// mismatch guard to fire, and <c>PresentWith</c> has to locate it or the empty sibling <c>&lt;ST&gt;</c>
    /// matches instead, reads as uncommitted, and the push overwrites a diagram that cannot be rebuilt from text.
    /// Reader-only recognition is not protection. That asymmetry is why the reader's nested scan had been
    /// narrowed to CFC alone — the only language whose codec also looked there — which left a nested SFC read as
    /// textual and silently flattened.</para>
    ///
    /// <para><b>Depth-independent on purpose.</b> Both copies matched the CODESYS shape exactly —
    /// <c>addData/data/CFC</c>, three levels — and no TwinCAT CFC or SFC export has ever been captured (DIALECT
    /// D7), so that depth was an assumption on the vendor whose shape nobody has seen. The two outcomes are not
    /// symmetric: searching too deep costs nothing, while missing the element destroys a diagram. So the scan
    /// takes any descendant of an <c>addData</c> block, and D7 stops being load-bearing.</para>
    ///
    /// <para>Scoped to <c>&lt;body&gt;</c>'s own <c>addData</c> children, which is what keeps the descendant walk
    /// safe: a POU's methods and actions hang off <c>&lt;pou&gt;/&lt;addData&gt;</c>, never off the body's — checked
    /// across every recorded fixture — so no member's body can be mistaken for its parent's.</para></summary>
    internal static class BodyElement
    {
        /// <summary>The element a codec for <paramref name="language"/> owns in this body, or null. Nested wins
        /// over direct: a body carrying a nested diagram ALSO carries an empty <c>&lt;ST&gt;</c> the schema still
        /// wants, and that decoy is what a direct-children scan finds first.</summary>
        public static XElement? Of(XElement body, string language) =>
            NestedDiagramIn(body, language)
            ?? body.Elements().FirstOrDefault(e => e.Name.LocalName == language);

        /// <summary>The diagram body hanging off <c>&lt;body&gt;/&lt;addData&gt;</c> at any depth, or null.
        /// Optionally restricted to one language, which is how a single codec asks about its own.
        ///
        /// <para>Diagrams are the languages that may appear here, and the rule is not arbitrary: CFC and SFC are
        /// the two with NO write path, so finding one can only ever lead to a refusal. FBD and LD are excluded
        /// for exactly that reason — Volt writes those, and recognising one in a position Volt would not write it
        /// back to is how the reader and writer disagreed in the first place.</para></summary>
        public static XElement? NestedDiagramIn(XElement body, string? language = null) =>
            body.Elements().Where(e => e.Name.LocalName == "addData")
                .Descendants()
                .FirstOrDefault(e => Languages.IsDiagram(e.Name.LocalName)
                                     && (language is null || e.Name.LocalName == language));
    }
}
