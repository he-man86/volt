using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;

namespace Volt.Engine.PlcOpen;

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
        var langEl = bodyEl is null ? null : LangIn(bodyEl).element;
        return (langEl?.Value.Trim() ?? "", DeclFromElement(acc));
    }

    private static (string? language, XElement? element) FindBody(XElement pou, XNamespace ns)
    {
        var bodyEl = pou.Element(ns + "body");
        return bodyEl == null ? default : LangIn(bodyEl);
    }

    /// <summary>For CODESYS addData children, the body element may not use the PLCopen namespace.</summary>
    private static (string? language, XElement? element) FindBodyChild(XElement parent)
    {
        var bodyEl = parent.Elements().FirstOrDefault(e => e.Name.LocalName == "body");
        return bodyEl == null ? default : LangIn(bodyEl);
    }

    /// <summary>The ONE body-language lookup, matched by LOCAL name so it serves both callers — CODESYS
    /// addData bodies may not be in the PLCopen namespace, and the namespaced case matches by local name
    /// too. Keeping the six-language list in one place is the point: it was edited in two.</summary>
    private static (string? language, XElement? element) LangIn(XElement bodyEl)
    {
        // The NESTED graphical body wins, and must be looked for FIRST — see NestedGraphicalBody. A body that
        // carries one also carries an EMPTY sibling <ST>, so a direct-children scan answers "ST" and reports a
        // read-only diagram as textual.
        if (NestedGraphicalBody(bodyEl) is { } nested) return (nested.Name.LocalName, nested);
        foreach (var lang in new[] { "ST", "IL", "FBD", "LD", "CFC", "SFC" })
        {
            var langEl = bodyEl.Elements().FirstOrDefault(e => e.Name.LocalName == lang);
            if (langEl != null) return (lang, langEl);
        }
        return default;
    }

    /// <summary>A graphical body that is NOT a direct <c>&lt;body&gt;</c> child but hangs off
    /// <c>&lt;body&gt;/&lt;addData&gt;/&lt;data name="…/cfc"&gt;</c>, or null.
    /// <para>This is how CODESYS exports a real CFC body — verified against the recorded
    /// <c>codesys-pou/FB_GraphicalChild.plcopen.xml</c>, captured from a hand-authored IDE project because no test
    /// can create a CFC POU (CFC is read-only, so Volt never creates one). CFC and SFC are not TC6 body languages,
    /// so the schema has nowhere to put them but an <c>addData</c>.</para>
    /// <para>Load-bearing, not cosmetic: the export ALSO carries an empty sibling <c>&lt;ST&gt;</c>, so scanning
    /// direct children alone classified the item as TEXTUAL. Everything downstream then went wrong quietly — the
    /// body materialized as empty ST instead of the graphical marker, and the read-only-CFC push refusal could not
    /// fire from that signal. The synthetic <c>&lt;body&gt;&lt;CFC/&gt;&lt;/body&gt;</c> in older tests is a shape
    /// no vendor produces, which is why the suite stayed green.</para></summary>
    private static XElement? NestedGraphicalBody(XElement bodyEl) =>
        bodyEl.Elements().Where(e => e.Name.LocalName == "addData")
            .SelectMany(a => a.Elements().Where(d => d.Name.LocalName == "data"))
            .SelectMany(d => d.Elements())
            .FirstOrDefault(e => e.Name.LocalName is "CFC" or "SFC" or "FBD" or "LD");

    /// <summary>The body element's graphical language for an item in an export, or null when the body is textual —
    /// the ONE answer to that question, shared with the driver's <c>BodyLanguage</c> gate so a body cannot be
    /// graphical to one caller and textual to the other.</summary>
    /// <summary>The body's language when it is anything OTHER than ST, else null.
    /// <para>Fails CLOSED, and that is the whole change: this used to enumerate <c>FBD/LD/CFC/SFC</c>, so any
    /// language missing from the list was reported as "textual" and a textual push then overwrote it. IL was
    /// exactly that case — Volt does not support IL any more than CFC or SFC, but the list said otherwise.
    /// Asking "is it ST?" means a language nobody has thought about yet is refused rather than flattened.</para></summary>
    internal static string? NonStLanguageOf(XElement bodyEl) =>
        LangIn(bodyEl).language is { } l && !string.Equals(l, "ST", StringComparison.OrdinalIgnoreCase) ? l : null;

    // A child member (method/action/property/accessor, or a nested pou) exports its OWN InterfaceAsPlainText —
    // e.g. a TwinCAT FB's method sits under <addData>/<Method>/<InterfaceAsPlainText>. It must NOT be mistaken
    // for the enclosing POU's declaration (a TC FB itself carries a structured <interface><localVars> with no
    // own IAPT, so grabbing the method's IAPT made an FB materialize as kind "method" → ExtFor threw).
    // GetAccessor/SetAccessor are here for the same reason the rest are: an ACCESSOR carries its own
    // InterfaceAsPlainText, and without them a property's declaration read would pick up its getter's.
    private static readonly HashSet<string> ChildDeclContainers =
        new(StringComparer.OrdinalIgnoreCase)
        { "pou", "Method", "Action", "Property", "get", "set", "GetAccessor", "SetAccessor" };

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
