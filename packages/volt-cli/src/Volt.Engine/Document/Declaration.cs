using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;

namespace Volt.Engine.Document
{
    /// <summary>
    /// A declaration, in a PLCopen document — the ONE rule, wherever it sits.
    ///
    /// <para>There is nothing position-dependent about writing a declaration, but there used to be four rules
    /// anyway: the root POU and an existing child took every <c>&lt;InterfaceAsPlainText&gt;</c> the item owns and
    /// threw when there was none, a created child constructed one, and a property ACCESSOR took the FIRST direct
    /// child only and silently CREATED one when absent.</para>
    ///
    /// <para><b>First-only is a known-bad rule, not a variation.</b> <see cref="PlcOpenDocument"/> records why:
    /// once a POU declares any variable, CODESYS exports its declaration TWICE, and writing only the first goes
    /// to the copy the IDE is not reading — a write that reports success and changes nothing. DIALECT <b>A7</b>
    /// confirms it with two fixtures. The accessor path was running that rule.</para>
    ///
    /// <para>Nobody can point at the fixture that would have caught it: no recorded export has an accessor whose
    /// declaration declares a variable, so the two-copy shape has never occurred there (openspec
    /// `splice-graphical-body`, U21). That is the argument for one owner rather than four agreeing ones — the
    /// divergence was invisible precisely where it was wrong.</para>
    /// </summary>
    internal static class Declaration
    {
        /// <summary>Read the declaration an element OWNS — its own plaintext block, never a child member's.
        /// <para>Ownership is <see cref="PlcOpenDocument.OwnDescendants"/>, the same predicate the write uses.
        /// The read and the write asking two different questions is how a declaration could be found in one
        /// direction and missed in the other.</para></summary>
        public static string? Read(XElement owner) =>
            Blocks(owner).Select(Inner).FirstOrDefault()?.Value;

        /// <summary>Write <paramref name="declaration"/> into EVERY plaintext block the element owns. Returns
        /// true when anything actually changed, so a no-op write can hand back the original bytes.
        ///
        /// <para>Throws when there is none. A declaration write that silently did nothing is the failure this
        /// rule exists to remove, and inventing a block the vendor never emitted is the same failure wearing a
        /// different hat: it manufactures a document shape neither IDE produces, and the next read of it is
        /// answering a question about Volt's own output rather than the vendor's.</para>
        ///
        /// <paramref name="what"/> names the element in the error, so a refusal is actionable from the push
        /// receipt alone.</summary>
        public static bool Write(XElement owner, string declaration, string what)
        {
            var blocks = Blocks(owner).ToList();
            if (blocks.Count == 0)
                throw new InvalidOperationException(
                    $"{what} has no <InterfaceAsPlainText> to write the declaration into");

            var changed = false;
            foreach (var iapt in blocks)
            {
                var inner = Inner(iapt);
                if (inner.Value == declaration) continue;
                inner.ReplaceNodes(declaration);
                changed = true;
            }
            return changed;
        }

        /// <summary>Give an element Volt JUST CONSTRUCTED its plaintext block, so <see cref="Write"/> can stay
        /// strict.
        ///
        /// <para>Volt builds accessor elements itself — <c>PouSplice.AddChild</c> materializes the pair a property
        /// declaration implies, and <c>SetAccessor</c> creates one that a push introduces — and what it builds is
        /// <c>&lt;GetAccessor&gt;&lt;interface/&gt;&lt;/GetAccessor&gt;</c>, with no declaration block yet. So on
        /// that path an absent block means "this element is half-built", not "the vendor emitted a broken
        /// export".</para>
        ///
        /// <para>Those are different facts and they get different code. The old accessor writer fused them into
        /// one "create it if it is not there", which silently accepted a genuinely malformed vendor document as
        /// well. Construction is explicit here and happens exactly where Volt does the constructing; everywhere
        /// else, a missing block is still a refusal.</para></summary>
        public static void Establish(XElement owner, string declaration)
        {
            XNamespace ns = owner.Name.Namespace;
            XNamespace xh = Vocabulary.Namespaces.Xhtml;
            owner.Add(new XElement(ns + "InterfaceAsPlainText", new XElement(xh + "xhtml", declaration)));
        }

        /// <summary>Does this element carry no plaintext block at all — i.e. is it one Volt has constructed but
        /// not yet completed? See <see cref="Establish"/>.</summary>
        public static bool IsUnestablished(XElement owner) => !Blocks(owner).Any();

        /// <summary>The elements that own a declaration of their own — so a declaration found INSIDE one of
        /// these, while looking at an ancestor, belongs to the child and not to the ancestor.
        ///
        /// <para>ONE list, because the read and the write must answer this identically. There were two: the
        /// writer's was case-SENSITIVE over nine names, the reader's was case-insensitive over eleven (it also
        /// listed <c>get</c>/<c>set</c>). Two lists answering one question is a divergence waiting to be found in
        /// production — a declaration could be attributed to the item in one direction and to its child in the
        /// other, on the same document.</para>
        ///
        /// <para>The union resolves it, and each difference resolves the SAFE way. Case-insensitive, because a
        /// vendor spelling <c>Getaccessor</c> would slip past the case-sensitive list and let an accessor's
        /// declaration be read as its property's. <c>get</c>/<c>set</c> kept, because excluding a container that
        /// does not occur costs nothing while dropping one that does is a silent misattribution — and they do not
        /// occur: measured, ZERO across every recorded export on both vendors (U22). The schema's own spelling for
        /// an accessor is what the vendors emit, <c>GetAccessor</c>/<c>SetAccessor</c>.</para></summary>
        internal static readonly HashSet<string> OwnDeclContainers =
            new(StringComparer.OrdinalIgnoreCase)
            { "pou", "Method", "Action", "Property", "get", "set", "GetAccessor", "SetAccessor" };

        /// <summary>The plaintext blocks this element owns. ALL of them — see the type doc.</summary>
        private static IEnumerable<XElement> Blocks(XElement owner) =>
            PlcOpenDocument.OwnDescendants(owner, "InterfaceAsPlainText");

        /// <summary>The text node holder: <c>&lt;xhtml&gt;</c> when present, else the block itself. Both shapes
        /// occur — the xhtml wrapper is the schema's, and a bare block is what some exports carry.</summary>
        private static XElement Inner(XElement iapt) =>
            iapt.Elements().FirstOrDefault(e => e.Name.LocalName == "xhtml") ?? iapt;
    }
}
