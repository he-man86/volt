using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;

namespace Volt.Engine.Body
{
    /// <summary>
    /// How one body LANGUAGE moves between its workspace TEXT and its PLCopen ELEMENT.
    /// <para>This is the concept that replaces "graphical vs textual". There is no such split: a body has a
    /// language, and a language has a codec. ST's codec is the identity one — the text goes into
    /// <c>&lt;ST&gt;&lt;xhtml&gt;</c> verbatim and the IDE's compiler is the judge. FBD/LD's pivots on
    /// <c>GraphBody</c> and can reject its input, because the IDE never sees network text and an unparseable body
    /// cannot be transmitted at all. CFC/SFC's has a read but no write. Same interface, different answers.</para>
    /// <para><b>A codec owns its element's LOCATION, not just its name</b> — measured, after being inferred wrongly
    /// once. PLCopen TC6 defines ST, IL, FBD, LD and SFC as body languages, so each is a direct <c>&lt;body&gt;</c>
    /// child whose element NAME is the language. CFC alone is a CODESYS extension and lives in
    /// <c>&lt;body&gt;/&lt;addData&gt;/&lt;data name="…/cfc"&gt;</c>, beside an EMPTY <c>&lt;ST&gt;</c> the schema
    /// still wants — the decoy that once made a direct-children scan call a CFC body textual. See
    /// <c>PlcOpen/DIALECT.md</c> for the table and the fixture behind each row.</para>
    /// <para><b>Read-only-ness and placement are INDEPENDENT.</b> SFC is read-only and direct; CFC is read-only
    /// and nested; FBD is writable and direct. Fusing them back into one "is graphical" flag is exactly the
    /// mistake this type exists to prevent.</para>
    /// </summary>
    public abstract class BodyCodec
    {
        /// <summary>The language this codec speaks, as it appears as an element name (`ST`, `FBD`, `CFC`, …).</summary>
        public abstract string Language { get; }

        /// <summary>Can a push WRITE this language? False for CFC/SFC, which have no text form to write back —
        /// which is all "read-only" means.</summary>
        public virtual bool ReadOnly => false;

        /// <summary>The body element this codec owns inside <paramref name="body"/>, or null. Default: a direct
        /// child named for the language — the TC6 shape. <see cref="CfcCodec"/> overrides it.</summary>
        public virtual XElement? Locate(XElement body) =>
            body.Elements().FirstOrDefault(e => e.Name.LocalName == Language);

        /// <summary>Element → the workspace text for this body.</summary>
        public abstract string Decode(XElement element);

        /// <summary>Does this body element record NO language decision — so changing the language loses nothing?
        /// <para>Load-bearing for the language-mismatch rule, and deliberately asymmetric. A newly created POU
        /// comes into the world with an empty <c>&lt;ST&gt;</c> whatever language it is destined for (CODESYS
        /// takes the language from the imported body element, not from creation), so "the IDE says ST, the push
        /// says FBD" is the NORMAL create rather than a conflict.</para>
        /// <para>Only ST answers true, and only when blank. An empty <c>&lt;FBD/&gt;</c> is NOT the same thing:
        /// someone made that POU graphical, and overwriting it with ST would discard that decision silently. ST
        /// is the default, so a blank one is indistinguishable from "not decided yet"; every other language is
        /// there because it was chosen.</para></summary>
        public virtual bool IsUncommitted(XElement element) => false;

        /// <summary>Write <paramref name="text"/> into <paramref name="body"/>, replacing or patching whatever
        /// this codec owns there. Returns true when anything actually changed, so a no-op write can hand back the
        /// ORIGINAL document bytes — the property that makes splicing safer than regenerating.
        /// <para><paramref name="declaration"/> is the declaration text the body's FB INSTANCES resolve against.
        /// Network text does not carry an instance's TYPE — only its name — so the FBD/LD codec has to restore
        /// each <c>typeName</c> from the declaration, exactly as <see cref="NetworkCode.Write"/> does on the
        /// per-transport path. Textual codecs ignore it. It is NOT optional and has NO default: this parameter
        /// exists because the one-document path passed no resolver at all and silently rewrote every FB box as
        /// <c>typeName=""</c>, destroying the type the export had.</para></summary>
        public abstract bool Encode(XElement body, string text, string? declaration);

        // ── the registry ────────────────────────────────────────────────────────────────────────────────
        private static readonly BodyCodec[] All =
        {
            new StCodec(), new NetworkCodec("FBD"), new NetworkCodec("LD"),
            // IL is READ-ONLY, not a textual language Volt round-trips. Volt writes ST and FBD/LD and nothing
            // else, so an IL body has no text form Volt can produce or accept — the same situation as SFC, and
            // handled by the same codec rather than by a bespoke one that differed only in its throw message.
            // It matters at the READ end: an IL body used to materialize as its raw text, indistinguishable from
            // ST source, so the engineer got an editable-looking file and a push then rewrote their IL body as
            // ST. Now it materializes as the read-only marker and the push leaves it alone.
            new ReadOnlyCodec("IL"), new ReadOnlyCodec("SFC"), new CfcCodec(),
        };

        public static BodyCodec For(string language) =>
            All.FirstOrDefault(c => string.Equals(c.Language, language, StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidOperationException($"no body codec for language '{language}'");

        /// <summary>The codec present in this body together with the element it found, or null for a body with
        /// none (an interface member, a DUT, a GVL — all measured to emit no <c>&lt;body&gt;</c> content at all).
        /// The element is what answers <see cref="IsUncommitted"/>.
        /// <para>Order matters: the nested CFC is tried BEFORE the direct children, because a CFC body ships an
        /// empty <c>&lt;ST&gt;</c> sibling that would otherwise win.</para></summary>
        public static (BodyCodec Codec, XElement Element)? PresentWith(XElement body)
        {
            foreach (var c in All.OrderByDescending(x => x is CfcCodec))
                if (c.Locate(body) is { } el) return (c, el);
            return null;
        }
    }

    /// <summary>ST — the IDENTITY codec. Text in, text out; the IDE's compiler is the judge. Both halves were
    /// already one-liners before this type existed, which is the clearest evidence ST was never a different KIND
    /// of thing from the others.</summary>
    internal sealed class StCodec : BodyCodec
    {
        public override string Language => "ST";
        public override string Decode(XElement element) => element.Value;
        public override bool IsUncommitted(XElement element) => string.IsNullOrWhiteSpace(element.Value);

        public override bool Encode(XElement body, string text, string? declaration)
        {
            var ns = body.Name.Namespace;
            XNamespace xh = "http://www.w3.org/1999/xhtml";
            var st = Locate(body);
            if (st is null)
            {
                // No ST element yet — this body held another language, or nothing. Replacing the whole content is
                // right: the element NAME is the language, so a language change is an element change.
                body.RemoveNodes();
                body.Add(new XElement(ns + "ST", new XElement(xh + "xhtml", text)));
                return true;
            }
            // Patch the inner <xhtml> in place, keeping the vendor's wrapper and its namespace, so the only bytes
            // that move are the code itself.
            var inner = st.Elements().FirstOrDefault(e => e.Name.LocalName == "xhtml");
            if (inner is null)
            {
                if (st.Value == text) return false;
                st.ReplaceNodes(new XElement(xh + "xhtml", text));
                return true;
            }
            if (inner.Value == text) return false;
            inner.ReplaceNodes(text);
            return true;
        }
    }

    /// <summary>IL — textual like ST, and carried verbatim. It exists as its own codec so an IL body is refused
    /// as a LANGUAGE MISMATCH by the one rule, rather than slipping through a graphical-only narrowing as
    /// "textual" and being silently rewritten as ST two layers down.</summary>
    /// <summary>FBD / LD — the network-text codec, pivoting on <see cref="GraphBody"/>. It may REJECT its input:
    /// the IDE never sees network text, so an unparseable body cannot be transmitted at all. That is not a check
    /// ST is missing — ST's equivalent is vacuous because ST is stored verbatim.</summary>
    internal sealed class NetworkCodec : BodyCodec
    {
        public NetworkCodec(string language) => Language = language;
        public override string Language { get; }
        public override string Decode(XElement element) => NetworkCode.RenderBody(element);

        public override bool Encode(XElement body, string text, string? declaration)
        {
            var graph = NetworkCode.Validate(text);                     // parse + canonical + convergence gates
            // The resolver is the WHOLE point of `declaration`: network text names an FB instance but not its
            // type, so without this every FB box was re-imported as typeName="" — silent, on every push.
            var types = Text.InstanceTypes.Of(declaration);
            var replacement = GraphWriter.WriteBody(graph, inst => types.TryGetValue(inst, out var t) ? t : null);
            var existing = Locate(body) ?? body.Elements()
                .FirstOrDefault(e => e.Name.LocalName is "FBD" or "LD");  // a language change swaps the element
            if (existing is null) { body.RemoveNodes(); body.Add(replacement); return true; }
            GraphSplice.RequireReplaceable(existing);             // refuse to drop what network text cannot represent
            if (XNode.DeepEquals(existing, replacement)) return false;
            existing.ReplaceWith(replacement);
            return true;
        }
    }

    /// <summary>SFC — read-only, and a DIRECT body child (it is a TC6 language, unlike CFC). Reads as the marker;
    /// there is no write.</summary>
    internal class ReadOnlyCodec : BodyCodec
    {
        public ReadOnlyCodec(string language) => Language = language;
        public override string Language { get; }
        public override bool ReadOnly => true;
        public override string Decode(XElement element) => Workspace.Materializer.GraphicalBodyMarker(Language);
        public override bool Encode(XElement body, string text, string? declaration) =>
            throw new InvalidOperationException(
                $"'{Language}' is a read-only body — edit it in the IDE, not via push.");
    }

    /// <summary>CFC — read-only like SFC, but NOT a direct body child. It is a CODESYS extension with no place in
    /// the TC6 schema, so it lives in <c>&lt;body&gt;/&lt;addData&gt;/&lt;data name="…/cfc"&gt;</c>. This override
    /// IS the bug fix: scanning direct children found the empty <c>&lt;ST&gt;</c> beside it and reported a
    /// read-only diagram as textual.</summary>
    internal sealed class CfcCodec : ReadOnlyCodec
    {
        public CfcCodec() : base("CFC") { }

        public override XElement? Locate(XElement body) =>
            // The addData nesting FIRST — it is the recorded CODESYS shape, and it must beat the empty <ST>
            // sibling that ships with it. Then a direct child as a fallback: nothing measured emits one, but the
            // reader stays liberal in what it accepts. Being strict here would mean a CFC body we failed to
            // RECOGNISE gets treated as textual and written over — the exact data loss this codec exists to stop,
            // so tolerance is the safe direction to err in.
            body.Elements().Where(e => e.Name.LocalName == "addData")
                .SelectMany(a => a.Elements().Where(d => d.Name.LocalName == "data"))
                .SelectMany(d => d.Elements())
                .FirstOrDefault(e => e.Name.LocalName == "CFC")
            ?? base.Locate(body);
    }
}
