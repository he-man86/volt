using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;

namespace VoltBridge.Core.Fbd;

/// <summary>
/// Parses the TwinCAT <c>.TcPOU</c> <c>&lt;NWL&gt;&lt;XmlArchive&gt;</c> serialization
/// of an FBD/LD body into <see cref="FbdBody"/>.
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
        ListItems(net, "NetworkItems").Select(ReadNetworkItem).ToList());

    /// <summary>A network item is either a <c>BoxTreeBox</c> (the box is the item, its own
    /// OutputItems are the wired targets) or a <c>BoxTreeAssign</c> (an assignment whose
    /// OutputItems are the l-value targets and whose <c>RValue</c> is the source box —
    /// e.g. <c>xtest := (FALSE AND TRUE)</c>).</summary>
    private static FbdBox ReadNetworkItem(XElement item)
    {
        var rvalue = Field(item, "RValue");
        if (rvalue is null) return ReadBox(item);                 // BoxTreeBox: the box is the item
        var targets = ReadOutputs(item);                          // BoxTreeAssign: l-value targets
        // RValue is a box (var := (a OP b)) or a plain operand (var := someValue).
        return (string?)rvalue.Attribute("t") == "BoxTreeBox"
            ? ReadBox(rvalue) with { Outputs = targets }
            : new FbdBox("", null, new[] { ReadSource(rvalue) }, targets);   // direct operand assignment
    }

    private static FbdBox ReadBox(XElement box)
    {
        var type = Scalar(box, "BoxType") ?? "";
        var inst = Field(box, "Instance");
        var instance = inst is null ? null : Empty(Scalar(inst, "Operand"));
        var inputs = ListItems(box, "InputItems").Select(ReadSource).ToList();
        var outputs = ReadOutputs(box);
        return new FbdBox(type, instance, inputs, outputs)
        {
            InputPins = ReadParamNames(box, "InputParam"),
            OutputPins = ReadParamNames(box, "OutputParam"),
        };
    }

    /// <summary>The formal pin names from a box's <c>InputParam</c>/<c>OutputParam</c>
    /// <c>ParamList.Names</c> — these are unquoted strings (e.g. <c>&lt;v&gt;IN&lt;/v&gt;</c>),
    /// unlike the quoted scalar fields. Empty when the box carries no named pins (operators).</summary>
    private static IReadOnlyList<string> ReadParamNames(XElement box, string paramField)
    {
        var param = Field(box, paramField);
        var names = param?.Elements("l2").FirstOrDefault(l => (string?)l.Attribute("n") == "Names");
        if (names is null) return Array.Empty<string>();
        return names.Elements("v").Select(v => v.Value).ToList();
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

    private static string NormLang(string s) => s.ToUpperInvariant();
}
