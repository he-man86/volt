using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Network;
using Volt.Engine.PlcOpen;
using Volt.Engine.Format.Body;

namespace Volt.Engine.PlcOpen
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
    /// <c>Document/DIALECT.md</c> for the table and the fixture behind each row.</para>
    /// <para><b>Support and placement are INDEPENDENT.</b> SFC is unsupported and direct; CFC is unsupported and
    /// nested; FBD is writable and direct. Fusing them back into one "is graphical" flag is exactly the mistake
    /// this type exists to prevent — and no codec answers the placement question itself any more: that is
    /// <see cref="BodyElement"/>, which the READER shares, because a body only survives if both halves find it.</para>
    /// </summary>
    public abstract class BodyCodec
    {
        /// <summary>The language this codec speaks, as it appears as an element name (`ST`, `FBD`, `CFC`, …).</summary>
        public abstract string Language { get; }

        /// <summary>Is this language UNSUPPORTED — no text form Volt can produce or accept, in either direction?
        /// True for CFC, SFC and IL.
        /// <para>It used to be called <c>ReadOnly</c>, and that name oversold it. Nothing here is readable: the
        /// body materializes as <see cref="BodyMarker"/>, a stand-in carrying none of the content.
        /// Volt round-trips ST, FBD and LD; everything else it declines to touch, and declining IS the feature —
        /// an unsupported body must come back out of a push exactly as it went in.</para></summary>
        public virtual bool Unsupported => false;

        /// <summary>The body element this codec owns inside <paramref name="body"/>, or null.
        /// <para>Not virtual, and no codec overrides it: WHERE a language sits is a property of the language, not
        /// of what its codec can do with the text once found, and <see cref="BodyElement"/> is the one place that
        /// answers it — for the reader too. CFC used to override this with its own copy of the nested scan, which
        /// is precisely how the two halves came to disagree about SFC.</para></summary>
        public XElement? Locate(XElement body) => BodyElement.Of(body, Language);

        /// <summary>Element → the workspace text for this body.</summary>
        public abstract string Decode(XElement element);

        /// <summary>Does this body element record NO language decision — so changing the language loses nothing?
        /// <para>Load-bearing for the language-mismatch rule, and deliberately asymmetric. ON CODESYS a newly
        /// created POU comes into the world with an empty <c>&lt;ST&gt;</c> whatever language it is destined for
        /// (its <c>create_pou</c> ignores the language; the imported body element sets it), so "the IDE says ST,
        /// the push says FBD" is the NORMAL create rather than a conflict.</para>
        /// <para>Only ST answers true, and only when blank. An empty <c>&lt;FBD/&gt;</c> is not the same thing BY
        /// CONTENT: as far as the document can tell, someone made that POU graphical, and overwriting it with ST
        /// would discard that decision silently.</para>
        /// <para><b>Vendor-specific, and the qualifier is the whole point.</b> This sentence used to read as a
        /// both-vendor fact and it is false on TwinCAT, where <c>CreateChild</c> IS handed the pushed language
        /// and refuses "LD" (DIALECT C6) — so it seeds <c>&lt;FBD/&gt;</c>, and an empty FBD frequently means
        /// "Volt created this microseconds ago", not "an engineer chose graphical". Believing it here failed
        /// EVERY LD create on that vendor. The document cannot tell the two apart, which is why the caller says
        /// so instead: see <c>PouSplice.SetBody</c>'s <c>establishing</c> parameter.</para></summary>
        public virtual bool IsUncommitted(XElement element) => false;

        /// <summary>Write <paramref name="text"/> into <paramref name="body"/>, replacing or patching whatever
        /// this codec owns there. Returns true when anything actually changed, so a no-op write can hand back the
        /// ORIGINAL document bytes — the property that makes splicing safer than regenerating.
        /// <para><paramref name="declaration"/> is the declaration text the body's FB INSTANCES resolve against.
        /// Network text does not carry an instance's TYPE — only its name — so the FBD/LD codec has to restore
        /// each <c>typeName</c> from the declaration, exactly as <see cref="NetworkCodeIo.Write"/> does on the
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
            // ST. Now it materializes as the marker and the push leaves it alone.
            new UnsupportedCodec("IL"), new UnsupportedCodec("SFC"), new UnsupportedCodec("CFC"),
        };

        /// <summary>The codec for a language, or a refusal a USER can act on.
        /// <para>The message matters because this is now the only guard on the way in. A bad language token in
        /// network text (<c>NETWORK 0 BANANA</c>) used to be caught by the per-child transport, which said
        /// "unknown graphical language"; that arm is gone, so this throw reaches the push receipt instead. It
        /// names the token AND what Volt round-trips, rather than the internal word "codec".</para></summary>
        public static BodyCodec For(string language) =>
            All.FirstOrDefault(c => string.Equals(c.Language, language, StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidOperationException(
                $"unknown body language '{language}' — Volt round-trips ST, FBD and LD; " +
                "CFC, SFC and IL are not supported");

        /// <summary>The codec present in this body together with the element it found, or null for a body with
        /// none (an interface member, a DUT, a GVL — all measured to emit no <c>&lt;body&gt;</c> content at all).
        /// The element is what answers <see cref="IsUncommitted"/>.
        /// <para>Order matters: the nested CFC is tried BEFORE the direct children, because a CFC body ships an
        /// empty <c>&lt;ST&gt;</c> sibling that would otherwise win.</para></summary>
        public static (BodyCodec Codec, XElement Element)? PresentWith(XElement body)
        {
            foreach (var c in All.OrderByDescending(x => Languages.IsDiagram(x.Language)))
                if (c.Locate(body) is { } el) return (c, el);
            return null;
        }

        /// <summary>The language of a body element NO codec owns, or null. The write-side half of failing closed.
        /// <para><see cref="PresentWith"/> answers by asking each REGISTERED codec, so a body in a language Volt
        /// does not model matches none and comes back null — indistinguishable from a body with no language at
        /// all. The mismatch guard in <c>PouSplice.SetBody</c> then sees nothing present and writes straight over
        /// it. Fixing only the READ side (<c>PouReader.LangIn</c>, which now reports the language correctly)
        /// would have left this path exactly as it was: correctly identified, still flattened.</para></summary>
        public static string? UnmodelledLanguageIn(XElement body) =>
            PresentWith(body) is null && PouReader.LanguageOf(body) is { } lang ? lang : null;
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
            XNamespace xh = Namespaces.Xhtml;
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
            var existing = Locate(body) ?? body.Elements()
                .FirstOrDefault(e => Languages.IsNetwork(e.Name.LocalName));  // a language change swaps the element

            // NOTHING TO WRITE: the pushed text is exactly what a pull produced from the stored body.
            //
            // The DeepEquals guard below cannot cover this. It compares the stored element to the REGENERATED
            // one, and regeneration is lossy — measured over every recorded vendor export, original !=
            // regenerated on 9 of 9 — so on a real vendor document it never fires, and every push rewrote every
            // graphical body. That is not a rare path: a push restates EVERY member, so editing one line of a
            // declaration rewrote every diagram in the POU, discarding ids, vendor addData, comment boxes and
            // param-type payloads the engineer never touched.
            //
            // The comparison that works is against what the engineer actually HOLDS: `RenderBody(existing)` is
            // byte-for-byte the text a pull wrote into the repo. Equality is the whole test — there is no partial
            // match and no fallback, so this cannot carry the wrong thing. A language change needs no special
            // case either: the stored body renders a different `NETWORK n LANG` header, so it simply regenerates.
            var baseline = existing is null ? null : NetworkCode.RenderBody(existing);
            if (baseline == text) return false;

            // TWO sources, in this order. The body being replaced already carries every existing box's type,
            // written by the IDE — nothing is inferred from it. The declaration is a TEXT parse, and a text parse
            // of ST is an approximation forever, so it is asked only about boxes that are new in this push.
            // Reversing the order would put the guess ahead of the fact.
            var fromBody = InstanceTypes.FromBody(existing);
            var fromDecl = InstanceTypes.Of(declaration);
            var replacement = GraphWriter.WriteBody(graph,
                inst => fromBody.TryGetValue(inst, out var t) ? t
                      : fromDecl.TryGetValue(inst, out var d) ? d
                      : null);
            if (existing is null) { body.RemoveNodes(); body.Add(replacement); return true; }
            // Snapshot the stored networks BEFORE the carry, so the gate below can be scoped to the ones actually
            // being discarded.
            var storedNetworks = GraphReader.SplitNetworks(existing.Elements().ToList());

            // CARRY the networks the engineer did not touch. The whole-body no-op above catches "nothing changed
            // at all"; this catches the ordinary edit, where one network of several moved and regenerating the
            // rest would destroy their ids, vendor addData and comment boxes for nothing.
            //
            // Same identity channel, one level finer: a network whose rendered text is byte-identical to what the
            // push carries keeps its stored elements. Equality is the whole test, so nothing can be carried onto
            // the wrong network. See NetworkSplice.
            //
            // The language check is not a special case, it is the same equality: a stored FBD body renders
            // `NETWORK n FBD` and a pushed LD one says `NETWORK n LD`, so every network fails the comparison and
            // the whole body regenerates — which is required, because the wrapper element itself must change
            // (TwinCAT seeds <FBD/> even for a ladder, DIALECT C6, and ladder elements inside <FBD> are refused).
            var carried = NetworkSplice.Carry(existing, replacement, baseline, text);

            // The capability gate, scoped to what this write actually THROWS AWAY. A carried network keeps its
            // stored XML, so it loses nothing and refusing on its account would refuse a push with nothing to
            // refuse — the gate exists to stop a loss. Narrower in scope, identical in what it refuses: the same
            // constructs inside an EDITED network are still a hard refusal with the same message.
            BodySpliceGuard.RequireReplaceable(existing,
                storedNetworks.Where(g => !carried.Contains(g.Index)).SelectMany(g => g.Els).ToList());

            if (carried.Count > 0)
                // The carried halves are held to the SAME rules as the regenerated ones. The leaf fan-out
                // refusal exists because TwinCAT's importer CRASHES on a shared leaf (DIALECT C4) — a global
                // property of the document, not of the half Volt happened to write this time.
                NetworkCode.Validate(NetworkTextWriter.Write(GraphReader.ReadBody(replacement)));

            if (XNode.DeepEquals(existing, replacement)) return false;
            existing.ReplaceWith(replacement);
            return true;
        }
    }

    /// <summary>CFC, SFC and IL — the languages Volt does not support, in ONE codec.
    /// <para>They differ in ways that turn out not to matter here: CFC is a vendor extension nested under
    /// <c>addData</c> while SFC is a TC6 direct child (<see cref="BodyElement"/> settles that, for the reader
    /// too), and IL is textual rather than a diagram. What they share is the only thing this type acts on —
    /// there is no text form to hand an engineer, and none to accept back. CFC had its own subclass purely to
    /// carry a second copy of the nested lookup; once that is shared, it adds nothing.</para>
    /// <para>IL matters at the READ end specifically. Being textual, it used to materialize as its raw source,
    /// indistinguishable from ST — the engineer got an editable-looking file and the next push rewrote their IL
    /// body as ST. The marker is what makes "unsupported" visible instead of silent.</para></summary>
    internal sealed class UnsupportedCodec : BodyCodec
    {
        public UnsupportedCodec(string language) => Language = language;
        public override string Language { get; }
        public override bool Unsupported => true;
        public override string Decode(XElement element) => BodyMarker.For(Language);
        public override bool Encode(XElement body, string text, string? declaration) =>
            throw new InvalidOperationException(
                $"'{Language}' is not a language Volt supports — edit this body in the IDE. " +
                "Volt round-trips ST, FBD and LD.");
    }
}
