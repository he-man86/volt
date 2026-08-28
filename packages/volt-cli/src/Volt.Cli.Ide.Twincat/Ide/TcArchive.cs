using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Xml.Linq;

namespace Volt.Cli.Ide.Twincat;

/// <summary>
/// TwinCAT's <c>&lt;XmlArchive&gt;</c> — a serialized OBJECT GRAPH, read and written as one.
///
/// <para><b>This is not a schema and must not be treated as one.</b> It is the 3S archive format holding the
/// same <c>NWLObject</c> graph CODESYS hands over live — the two vendors share the model, and only the access
/// differs. So this file is an ACCESSOR layer over the XML, not a parser producing a parallel structure:</para>
/// <code>
/// &lt;o t="Type"&gt;             an object; `t` only where the slot is not already typed
/// &lt;v n="Name"&gt;raw&lt;/v&gt;      a scalar - "quoted" string, true/false, 15L, 0
/// &lt;o n="Name" t="Type"&gt;     a named object member
/// &lt;l2 n="Name" cet="Elem"&gt;  a list; a child's own `t` wins over the list's `cet`
/// &lt;n n="Name" /&gt;           an explicit null
/// </code>
///
/// <para><b>Why accessors rather than deserialization.</b> Operating on the live <see cref="XElement"/> means
/// everything Volt does not model — <c>Id</c>, <c>Fixed</c>, <c>Extensible</c>, <c>FBDValid</c>,
/// <c>ILLines</c>, <c>Address</c> — stays exactly as the IDE wrote it, on every part of the document the
/// engineer did not edit. A deserialize/reserialize round trip would rewrite all of it, which is precisely the
/// loss the PLCopen transport was built on.</para>
/// </summary>
internal static class TcArchive
{
    /// <summary>The vendor's <c>IFlags</c> bit-field, which the archive stores as a NUMBER where the live
    /// object model exposes named booleans. The names come from <c>IFlags</c> itself, so this is a decoding
    /// of the vendor's own vocabulary rather than an invented one.</summary>
    public const int FlagNegation = 1;
    public const int FlagSet = 2;
    public const int FlagJump = 4;
    public const int FlagReturn = 8;
    public const int FlagRtrig = 16;
    public const int FlagFtrig = 32;

    // ── navigation ────────────────────────────────────────────────────────────────────────────────

    /// <summary>The <c>NWLImplementationObject</c> inside an <c>&lt;NWL&gt;</c> body, or null when the body is
    /// not an NWL archive.</summary>
    public static XElement? Root(string? bodyXml)
    {
        if (string.IsNullOrWhiteSpace(bodyXml)) return null;
        XElement el;
        try { el = XElement.Parse(bodyXml); } catch { return null; }   // textual ST is not XML
        if (el.Name.LocalName != "NWL") return null;
        return el.Descendants("o").FirstOrDefault(o => (string?)o.Attribute("t") == "NWLImplementationObject");
    }

    /// <summary>The body's language tag, as the archive spells it (<c>"Fbd"</c> / <c>"Ld"</c>).</summary>
    public static string? ViewMode(XElement impl) => Str(impl, "DefaultViewMode");

    /// <summary>A named object member: <c>&lt;o n="Name"&gt;</c>. An explicit <c>&lt;n n="Name"/&gt;</c> is a
    /// null and yields null.</summary>
    public static XElement? Obj(XElement? owner, string name) =>
        owner?.Elements("o").FirstOrDefault(e => (string?)e.Attribute("n") == name);

    /// <summary>The items of a named list, with nulls (<c>&lt;n/&gt;</c>) dropped.</summary>
    public static IReadOnlyList<XElement> List(XElement? owner, string name)
    {
        var l = owner?.Elements("l2").FirstOrDefault(e => (string?)e.Attribute("n") == name);
        return l == null ? Array.Empty<XElement>() : l.Elements("o").ToList();
    }

    /// <summary>An element's type: its own <c>t</c>, else the <c>cet</c> of the list holding it. A
    /// heterogeneous list carries <c>t</c> per child; a homogeneous one states it once.</summary>
    public static string? TypeOf(XElement e) =>
        (string?)e.Attribute("t") ?? (string?)e.Parent?.Attribute("cet");

    // ── scalars ───────────────────────────────────────────────────────────────────────────────────

    private static string? Raw(XElement? owner, string name) =>
        owner?.Elements("v").FirstOrDefault(e => (string?)e.Attribute("n") == name)?.Value;

    /// <summary>A string scalar, unquoted. The archive writes <c>"text"</c>; an empty value is <c>""</c>.</summary>
    public static string? Str(XElement? owner, string name)
    {
        var v = Raw(owner, name);
        if (v == null) return null;
        if (v.Length >= 2 && v[0] == '"' && v[v.Length - 1] == '"') v = v.Substring(1, v.Length - 2);
        return v.Length == 0 ? null : v;
    }

    public static bool Bool(XElement? owner, string name) =>
        string.Equals(Raw(owner, name), "true", StringComparison.OrdinalIgnoreCase);

    /// <summary>An integer scalar. The archive suffixes 64-bit values with <c>L</c>.</summary>
    public static int Int(XElement? owner, string name)
    {
        var v = Raw(owner, name);
        if (string.IsNullOrEmpty(v)) return 0;
        v = v!.TrimEnd('L', 'l');
        return int.TryParse(v, NumberStyles.Integer, CultureInfo.InvariantCulture, out var i) ? i : 0;
    }

    /// <summary>The flag bits of a <c>Flags</c> member — the nested object's own numeric <c>Flags</c> value.</summary>
    public static int FlagBits(XElement? owner) => Int(Obj(owner, "Flags"), "Flags");

    // ── construction ──────────────────────────────────────────────────────────────────────────────

    public static XElement NewObject(string? type = null, string? name = null)
    {
        var e = new XElement("o");
        if (name != null) e.SetAttributeValue("n", name);
        if (type != null) e.SetAttributeValue("t", type);
        return e;
    }

    private static XElement NewList(string name, string? elementType = null)
    {
        var e = new XElement("l2");
        e.SetAttributeValue("n", name);
        if (elementType != null) e.SetAttributeValue("cet", elementType);
        return e;
    }

    public static XElement Value(string name, string raw) =>
        new XElement("v", new XAttribute("n", name), raw);

    public static XElement StringValue(string name, string? text) =>
        Value(name, "\"" + (text ?? "") + "\"");

    public static XElement BoolValue(string name, bool b) => Value(name, b ? "true" : "false");

    /// <summary>A <c>Flags</c> member carrying the given bits. <c>Fixed</c>/<c>Extensible</c> are part of the
    /// vendor's own shape and are written at their defaults for a NEW item; an item being edited in place keeps
    /// whatever the IDE had.</summary>
    public static XElement FlagsObject(int bits) =>
        NewObject("Flags", "Flags")
            .Add2(Value("Flags", bits.ToString(CultureInfo.InvariantCulture)))
            .Add2(BoolValue("Fixed", false))
            .Add2(BoolValue("Extensible", false));

    /// <summary>Replace a named list's contents, leaving the list element (and its <c>cet</c>) in place when it
    /// already exists — the archive keeps the element type on the list, and dropping it would change the
    /// document more than the edit did.</summary>
    public static void SetList(XElement owner, string name, string? elementType, IEnumerable<XElement> items)
    {
        var existing = owner.Elements("l2").FirstOrDefault(e => (string?)e.Attribute("n") == name);
        if (existing == null)
        {
            existing = NewList(name, elementType);
            owner.Add(existing);
        }
        existing.RemoveNodes();
        if (elementType != null) existing.SetAttributeValue("cet", elementType);
        foreach (var i in items) existing.Add(i);
    }

    /// <summary>Set a scalar in place, preserving document order — the archive is order-sensitive to read back
    /// on some builds, so a set must not move the member to the end.</summary>
    private static void SetScalar(XElement owner, string name, string raw)
    {
        var v = owner.Elements("v").FirstOrDefault(e => (string?)e.Attribute("n") == name);
        if (v == null) owner.Add(Value(name, raw));
        else v.Value = raw;
    }

    public static void SetString(XElement owner, string name, string? text) =>
        SetScalar(owner, name, "\"" + (text ?? "") + "\"");

    public static void SetBool(XElement owner, string name, bool b) =>
        SetScalar(owner, name, b ? "true" : "false");

    /// <summary>Fluent add — <see cref="XElement.Add(object)"/> returns void, which makes building a nested
    /// archive read badly.</summary>
    public static XElement Add2(this XElement e, XElement child)
    {
        e.Add(child);
        return e;
    }
}
