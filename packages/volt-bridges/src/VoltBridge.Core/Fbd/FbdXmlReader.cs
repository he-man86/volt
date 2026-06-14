using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;

namespace VoltBridge.Core.Fbd;

/// <summary>
/// Parses the TwinCAT <c>.TcPOU</c> <c>&lt;NWL&gt;&lt;XmlArchive&gt;</c> serialization
/// of an FBD/LD body into the neutral <see cref="FbdBody"/>. (CODESYS produces the same
/// model from its live object model — see the CODESYS front-end.)
///
/// The XmlArchive is a generic object graph:
///   <code>
///   &lt;o t="Type"&gt;             an object (t = its type)
///   &lt;v n="field"&gt;value&lt;/v&gt;  a scalar field (strings are "quoted")
///   &lt;o n="field" t="Type"&gt;   an object-valued field
///   &lt;l2 n="field" cet="E"&gt;   a list field; elements are &lt;o&gt;/&lt;n&gt;,
///                              and an element may override its type with t=
///   &lt;n n="field"/&gt; / &lt;n/&gt;   null
///   </code>
///
/// A nested box (a box wired into a parent box input) appears in <c>InputItems</c> as
/// <c>&lt;o t="BoxTreeBox"&gt;</c>; a plain wire is a <c>BoxTreeOperand</c>. Operators
/// (OR/AND/…) have a null <c>Instance.Operand</c>.
/// </summary>
public static class FbdXmlReader
{
    public static FbdBody Read(string xmlArchive)
    {
        var root = XElement.Parse(xmlArchive);
        var impl = (string?)root.Attribute("t") == "NWLImplementationObject"
            ? root
            : root.DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject");
        var lang = NormLang(Scalar(impl, "DefaultViewMode") ?? "FBD");
        var networks = ListItems(impl, "NetworkList").Select(ReadNetwork).ToList();
        return new FbdBody(lang, networks);
    }

    private static FbdNetwork ReadNetwork(XElement net) => new(
        Empty(Scalar(net, "Label")),
        Empty(Scalar(net, "Comment")),
        Scalar(net, "OutCommented") == "true",
        ListItems(net, "NetworkItems").Select(ReadBox).ToList());

    private static FbdBox ReadBox(XElement box)
    {
        var type = Scalar(box, "BoxType") ?? "";
        var inst = Field(box, "Instance");
        var instance = inst is null ? null : Empty(Scalar(inst, "Operand"));
        var inputs = ListItems(box, "InputItems").Select(ReadSource).ToList();
        var outputs = ReadOutputs(box);
        return new FbdBox(type, instance, inputs, outputs);
    }

    private static FbdSource ReadSource(XElement el)
    {
        if ((string?)el.Attribute("t") == "BoxTreeBox")
            return new FbdNestedBox(ReadBox(el));
        // BoxTreeOperand: <o><o n="Operand" t="Operand"><v n="Operand">…</v></o><v n="Id">…</v></o>
        var op = Field(el, "Operand");
        return new FbdOperand(op is null ? "" : Scalar(op, "Operand") ?? "");
    }

    private static IReadOnlyList<string> ReadOutputs(XElement box)
    {
        var outItems = Field(box, "OutputItems");
        var list = outItems?.Elements("l2").FirstOrDefault(l => (string?)l.Attribute("n") == "OutputItems");
        if (list is null) return Array.Empty<string>();
        return list.Elements()
            .Select(e => e.Name.LocalName == "n" ? "" : Scalar(e, "Operand") ?? "")
            .ToList();
    }

    // ── generic XmlArchive accessors ───────────────────────────────────
    private static XElement? Field(XElement o, string name) =>
        o.Elements().FirstOrDefault(e => (string?)e.Attribute("n") == name);

    private static string? Scalar(XElement o, string name)
    {
        var v = o.Elements("v").FirstOrDefault(e => (string?)e.Attribute("n") == name);
        return v is null ? null : Unquote(v.Value);
    }

    private static IEnumerable<XElement> ListItems(XElement o, string name)
    {
        var l = o.Elements("l2").FirstOrDefault(e => (string?)e.Attribute("n") == name);
        if (l is null) yield break;
        foreach (var e in l.Elements())
            if (e.Name.LocalName == "o") yield return e;   // skip <n/> nulls
    }

    private static string Unquote(string s) =>
        s.Length >= 2 && s[0] == '"' && s[s.Length - 1] == '"' ? s.Substring(1, s.Length - 2) : s;

    private static string? Empty(string? s) => string.IsNullOrEmpty(s) ? null : s;

    private static string NormLang(string s)
    {
        var u = s.ToUpperInvariant();
        return u is "FBD" or "LD" or "SFC" or "CFC" or "IL" or "ST" ? u : u;
    }
}
