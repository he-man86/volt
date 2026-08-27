using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Library;
using Volt.Engine.Source.Body;

namespace Volt.Engine.Source;

public static class PouReader
{
    public sealed record ParsedPou(
        string? Declaration,
        string? BodyLanguage,
        XElement? BodyElement,
        List<ParsedChild> Children,
        List<ParsedProperty> Properties
    );

    public sealed record ParsedChild(
        string Name,
        string PouType,
        string? Declaration,
        string? BodyLanguage,
        XElement? BodyElement
    )
    {
        /// <summary>The member SHAPE this child has in the document. Lives here because <c>PouType</c> is the
        /// TC6 <c>pouType</c> vocabulary, not Volt's wire kinds — the two coincide in spelling and must not be
        /// conflated, which is why the document layer never takes <c>ItemKind.Kinds</c>. Callers comparing what
        /// the document HAS against what a push WANTS need this, because the shapes are not interchangeable.</summary>
        public PouMember Shape => PouType == "action" ? PouMember.Action : PouMember.Method;
    }

    /// <summary>A property and its accessors, read from the export both vendors already produce.
    /// <para>Verified live on BOTH: a POU export carries <c>&lt;Property name&gt;</c> with
    /// <c>&lt;GetAccessor&gt;</c>/<c>&lt;SetAccessor&gt;</c>, each holding the accessor's <c>&lt;body&gt;&lt;ST&gt;</c>
    /// AND its <c>&lt;InterfaceAsPlainText&gt;</c> — TwinCAT `Speed := x` / `x := Speed`, CODESYS
    /// `uiComBrinkFanuc := ComBrinkFanuc;`. So the accessor bodies never needed the per-accessor COM walk.</para>
    /// <para>A null <see cref="GetterCode"/> means NO getter; an EMPTY one means a getter with no body — the
    /// interface-property case, where accessors are declaration-only stubs. That distinction is load-bearing:
    /// PushService uses null-vs-present to decide whether to REMOVE the accessor.</para></summary>
    public sealed record ParsedProperty(
        string Name,
        string? Declaration,
        string? GetterCode,
        string? GetterDeclaration,
        string? SetterCode,
        string? SetterDeclaration
    );

    public static ParsedPou Parse(string xml)
    {
        var doc = XDocument.Parse(xml);
        var ns = doc.Root!.GetDefaultNamespace();

        var rootPou = doc.Root.Name.LocalName == "pou"
            ? doc.Root
            : doc.Descendants().FirstOrDefault(e => e.Name.LocalName == "pou")
              // BOTH VENDORS export an INTERFACE (and its method signatures) under <addData>/<Interface> with NO
              // <pou> element. Treat that <Interface> node as the root: its own InterfaceAsPlainText
              // ("INTERFACE X") is the declaration, and its <Methods>/<Method> children are picked up by the
              // Method-descendant loop below.
              // This was documented as "TC-only … never changes the CODESYS path", on the belief that CODESYS
              // emits <pou pouType="interface">. It does not — verified against a live 3.5.21.40 export, which
              // contains zero <pou> elements (see CodesysInterfaceExportTests). The shape is COMMON, which is
              // what let the CODESYS driver drop its hand-built interface document and serve the IDE's own.
              ?? doc.Descendants().FirstOrDefault(e => e.Name.LocalName == "Interface")
              // The DECLARATION-ONLY kinds: no body, no members, one declaration in an interfaceasplaintext
              // addData. They parse to the SAME record with those fields empty, which is what lets every kind
              // take one write. There is no vendor reason they were excluded: PLCopen import/export is defined
              // for all of them, and each was measured to round-trip a declaration change on CODESYS 3.5.21.40.
              //
              // FOUR element names, not two, and the split is the TC6 schema's rather than the vendor's whim: a
              // struct, an enum and an ALIAS all fit <dataType> (all three are a baseType), so all three export
              // as <types>/<dataTypes>/<dataType>. A UNION has no TC6 equivalent at all, so CODESYS puts it in
              // its own <addData> extension block as <union> — the same treatment CFC gets for the same reason.
              // A GVL is likewise <globalVars> in an addData block. Measured (probe 14/16) after a union DUT
              // failed to parse; "it is a DUT so it is a dataType" was the wrong inference.
              ?? doc.Descendants().FirstOrDefault(PlcOpenDocument.IsItemElement)
              ?? throw new InvalidOperationException(
                  "PLCopen document has no <pou>, <Interface>, <dataType> or <globalVars> element");

        var declaration = DeclFromElement(rootPou);
        var (bodyLang, bodyEl) = FindBody(rootPou, ns);

        var children = new List<ParsedChild>();

        // A child <pou pouType="method"/"action"> loop used to sit here, for "standard PLCopen". There is no such
        // shape: TC6 restricts pouType to function|functionBlock|program (tc6_xml_v201.xsd), so a method or
        // action can never BE a <pou>, and none of the 30 recorded vendor exports contains one. Both vendors put
        // a method in <addData>/<data>/<Method> and an action in <actions>/<action> — read by the loop below.
        // The only things that ever exercised it were three tests carrying hand-written XML in that invented
        // shape, which is exactly how it survived as "tolerance for a vendor we have not met".

        // Vendor addData children: <Method>/<Action> (TwinCAT, and CODESYS's synthesized interface export) and
        // lowercase <method>/<action> (CODESYS POU exports). BOTH capitalizations are load-bearing — the
        // capital-case arms are what TwinCAT method extraction depends on; do not drop them as CODESYS legacy.
        foreach (var e in rootPou.Descendants().Where(e =>
            e.Name.LocalName is "Method" or "Action" or "method" or "action"))
        {
            var childName = (string?)e.Attribute("name");
            if (string.IsNullOrEmpty(childName)) continue;
            var local = e.Name.LocalName.ToLowerInvariant();
            var pouType = local == "method" ? "method" : "action";
            // No synthesized "ACTION x"/"METHOD x" fallback here: the Materializer already owns that decision
            // for the <pou>-child path above and must keep owning it for BOTH. One question, one answer.
            var childDecl = DeclFromElement(e);
            var (childLang, childEl) = FindBodyChild(e);
            children.Add(new ParsedChild(childName!, pouType, childDecl, childLang, childEl));
        }

        // Properties + their accessors, from the SAME document. Both vendors emit
        // <Property name>/<GetAccessor|SetAccessor>/<body><ST> plus each accessor's own InterfaceAsPlainText.
        var properties = new List<ParsedProperty>();
        foreach (var p in rootPou.Descendants().Where(e => e.Name.LocalName is "Property" or "property"))
        {
            var pname = (string?)p.Attribute("name");
            if (string.IsNullOrEmpty(pname)) continue;
            var (getCode, getDecl) = Accessor(p, "GetAccessor");
            var (setCode, setDecl) = Accessor(p, "SetAccessor");
            properties.Add(new ParsedProperty(pname!, DeclFromElement(p), getCode, getDecl, setCode, setDecl));
        }

        return new ParsedPou(declaration, bodyLang, bodyEl, children, properties);
    }

    /// <summary>One accessor: its body text and its own declaration. Returns <c>(null, null)</c> when the
    /// accessor is ABSENT — distinct from a present-but-bodiless accessor (<c>""</c>), which is what an
    /// interface property has and what the caller must not confuse with "no getter".</summary>
    private static (string? code, string? declaration) Accessor(XElement property, string tag)
    {
        var acc = property.Elements().FirstOrDefault(e => e.Name.LocalName == tag);
        if (acc is null) return (null, null);
        var bodyEl = acc.Elements().FirstOrDefault(e => e.Name.LocalName == "body");

        // Decoded through the accessor's own CODEC, like every other body. This used to be `langEl?.Value.Trim()`
        // — the raw concatenation of the element's text nodes — which for a diagram accessor materialized as
        // junk (measured: "", "about", "networktitleFALSETRUEoutpur…") straight into the engineer's workspace on
        // a plain pull, and never produced the @volt-graphical marker, so the guard that refuses to overwrite an
        // unsupported body could not fire for an accessor at all.
        //
        // `?? ""` stays, and is not a fallback: an accessor with no <body> EXISTS but holds no code, and null
        // means the accessor is absent. Collapsing those two deletes a user's getter on the next push.
        var found = bodyEl is null ? null : BodyCodec.PresentWith(bodyEl);
        return (found is { } f ? f.Codec.Decode(f.Element).Trim() : "", DeclFromElement(acc));
    }

    private static (string? language, XElement? element) FindBody(XElement pou, XNamespace ns)
    {
        var bodyEl = pou.Element(ns + "body");
        return bodyEl == null ? default : LangIn(bodyEl);
    }

    /// <summary>For CODESYS addData children, the body element may not use the PLCopen namespace — hence the
    /// match by LOCAL name.
    /// <para>DIALECT D7 (does TwinCAT nest a diagram the way CODESYS does?) used to be load-bearing right here,
    /// because the nested scan matched CODESYS's depth exactly and no TwinCAT CFC or SFC export has ever been
    /// captured. <see cref="BodyElement"/> now searches any depth, so it is no longer a question this code's
    /// correctness rests on. D7 stays open as a fact about the vendor; it has stopped being a risk.</para></summary>
    private static (string? language, XElement? element) FindBodyChild(XElement parent)
    {
        var bodyEl = parent.Elements().FirstOrDefault(e => e.Name.LocalName == "body");
        return bodyEl == null ? default : LangIn(bodyEl);
    }

    /// <summary>The ONE body-language lookup, matched by LOCAL name so it serves both callers — CODESYS
    /// addData bodies may not be in the PLCopen namespace, and the namespaced case matches by local name too.
    ///
    /// <para><b>Open-ended, and that is the whole point.</b> It used to iterate a hardcoded
    /// <c>{ ST, IL, FBD, LD, CFC, SFC }</c> and answer <c>default</c> for anything outside it — so an unmodelled
    /// body language read as NO language, which every caller takes to mean textual, and a textual push then
    /// overwrote it. That is precisely the flattening <see cref="NonStLanguageOf"/> promises cannot happen, and
    /// it is the failure IL already caused once: a closed list cannot fail closed.</para>
    ///
    /// <para>So the language is whatever element is THERE. That is SPECIFIED, not inferred: the normative schema
    /// at <c>docs/tc6_xml_v201.xsd:410-449</c> defines <c>body</c> as
    /// <c>sequence(choice(IL|ST|FBD|LD|SFC), addData?, documentation?)</c> — so <c>addData</c> and
    /// <c>documentation</c> are the ONLY two non-language children a conformant body can have, and they are the
    /// two skipped below. And it is corroborated: across every recorded export under <c>fixtures/</c> a body
    /// carries exactly one language element, and the only body with more than one child is the CFC/SFC shape
    /// (<c>ST</c> + <c>addData</c>) the nested lookup above already resolves first.</para>
    /// <para>An element outside that choice is a vendor extension the schema does not admit — which is precisely
    /// the case this method must not answer "textual" for. Reporting it AS the language is what lets the caller
    /// refuse it; guessing that it is not one is what flattened IL.</para></summary>
    private static (string? language, XElement? element) LangIn(XElement bodyEl)
    {
        // The NESTED diagram wins, and must be looked for FIRST — via BodyElement, the SAME scan the codecs
        // use, so the reader cannot recognise a body the writer then fails to find. A body carrying a nested
        // diagram also carries an EMPTY sibling <ST>, so a direct-children scan answers "ST" instead.
        if (BodyElement.NestedDiagramIn(bodyEl) is { } nested) return (nested.Name.LocalName, nested);
        var langEl = bodyEl.Elements().FirstOrDefault(e => !IsBodyMetadata(e.Name.LocalName));
        return langEl is null ? default : (langEl.Name.LocalName, langEl);
    }

    /// <summary>The <c>&lt;body&gt;</c> children that are NOT the body's language: TC6's own
    /// <c>documentation</c>, and <c>addData</c> (where CFC/SFC and every vendor extension live). Everything else
    /// under a body IS the language element, whether or not Volt models it.</summary>
    private static bool IsBodyMetadata(string localName) =>
        localName is "addData" or "documentation";

    /// <summary>The body element's graphical language for an item in an export, or null when the body is textual —
    /// the ONE answer to that question, shared with the driver's <c>BodyLanguage</c> gate so a body cannot be
    /// graphical to one caller and textual to the other.</summary>
    /// <summary>The body's language when it is anything OTHER than ST, else null.
    /// <para>Fails CLOSED, and that is the whole change: this used to enumerate <c>FBD/LD/CFC/SFC</c>, so any
    /// language missing from the list was reported as "textual" and a textual push then overwrote it. IL was
    /// exactly that case — Volt does not support IL any more than CFC or SFC, but the list said otherwise.
    /// Asking "is it ST?" means a language nobody has thought about yet is refused rather than flattened.</para></summary>
    /// <summary>The body's language, whatever it is — ST included, and a language Volt does not model included.
    /// Null only when the body holds no language element at all (an interface member, a DUT, a GVL).</summary>
    internal static string? LanguageOf(XElement bodyEl) => LangIn(bodyEl).language;

    internal static string? NonStLanguageOf(XElement bodyEl) =>
        LangIn(bodyEl).language is { } l && !string.Equals(l, "ST", StringComparison.OrdinalIgnoreCase) ? l : null;

    // A child member (method/action/property/accessor, or a nested pou) exports its OWN InterfaceAsPlainText —
    // e.g. a TwinCAT FB's method sits under <addData>/<Method>/<InterfaceAsPlainText>. It must NOT be mistaken
    // for the enclosing POU's declaration (a TC FB itself carries a structured <interface><localVars> with no
    // own IAPT, so grabbing the method's IAPT made an FB materialize as kind "method" → ExtFor threw).
    // GetAccessor/SetAccessor are here for the same reason the rest are: an ACCESSOR carries its own
    // InterfaceAsPlainText, and without them a property's declaration read would pick up its getter's.
    // The SAME list the write uses — see Declaration.OwnDeclContainers. These were two lists, and two lists
    // answering one question is how a declaration gets attributed to the item on read and to its child on write.
    private static readonly HashSet<string> ChildDeclContainers = Declaration.OwnDeclContainers;

    private static string? DeclFromElement(XElement element)
    {
        // The POU's OWN declaration: the first InterfaceAsPlainText that is NOT nested inside a child member.
        // Null when the POU has none (TC's structured decl) — the caller then falls back to the COM declaration.
        var iapt = element.Descendants()
            .Where(e => e.Name.LocalName == "InterfaceAsPlainText")
            .FirstOrDefault(e => !e.Ancestors().TakeWhile(a => a != element).Any(a => ChildDeclContainers.Contains(a.Name.LocalName)));
        if (iapt == null) return null;
        var inner = iapt.Elements().FirstOrDefault(e => e.Name.LocalName == "xhtml") ?? iapt;
        var text = inner.Value;
        return string.IsNullOrEmpty(text) ? null : text;
    }
}
