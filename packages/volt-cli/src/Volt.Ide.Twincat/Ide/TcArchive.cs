using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Xml.Linq;

namespace Volt.Ide.Twincat;

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

    /// <summary>The same body with its view set to <paramref name="mode"/> ("Fbd" / "Ld"), or NULL when it
    /// already says that — so an unchanged push writes nothing at all.
    ///
    /// <para><b>This is how a ladder becomes a ladder.</b> `CreateChild` cannot make an "LD" (DIALECT C6): it
    /// makes an FBD, and the graph goes in through PLCopen as FBD too, because that is the only shape the
    /// importer accepts — an &lt;LD&gt; body of FBD-shaped elements makes it throw. The vendor does not treat a
    /// ladder as a different program in the first place; FBD, LD and IL are three VIEWS of one network. So the
    /// difference between the two languages, for everything Volt can express, is exactly this one string.</para>
    ///
    /// <para>The parse preserves whitespace and the serialization adds none, so every byte the IDE wrote other
    /// than this value survives.</para></summary>
    public static string? WithViewMode(string? bodyXml, string mode)
    {
        if (string.IsNullOrWhiteSpace(bodyXml)) return null;

        XElement doc;
        try { doc = XElement.Parse(bodyXml, LoadOptions.PreserveWhitespace); }
        catch (System.Xml.XmlException) { return null; }

        var impl = doc.DescendantsAndSelf("o")
                      .FirstOrDefault(o => (string?)o.Attribute("t") == "NWLImplementationObject");
        if (impl == null) return null;

        var slot = impl.Elements("v").FirstOrDefault(e => (string?)e.Attribute("n") == "DefaultViewMode");
        if (slot == null) return null;                 // creates nothing - the same rule the writer follows

        var want = "\"" + mode + "\"";
        if (slot.Value == want) return null;
        slot.Value = want;
        return doc.ToString(SaveOptions.DisableFormatting);
    }

    /// <summary>A named object member: <c>&lt;o n="Name"&gt;</c>. An explicit <c>&lt;n n="Name"/&gt;</c> is a
    /// null and yields null.</summary>
    public static XElement? Obj(XElement? owner, string name) =>
        owner?.Elements("o").FirstOrDefault(e => (string?)e.Attribute("n") == name);

    /// <summary>The items of a named list, with nulls (<c>&lt;n/&gt;</c>) dropped.</summary>
    /// <summary>A list WITH ITS HOLES: one entry per SLOT, null where the archive wrote <c>&lt;n /&gt;</c>.
    ///
    /// <para><see cref="List"/> and <see cref="RequireList"/> return <c>Elements("o")</c>, so a null slot
    /// simply disappears — right for a list read for its CONTENT, and wrong for one read by POSITION. A box's
    /// <c>OutputItems</c> is index-aligned with <c>OutputParam/Names</c>, and its <c>ENO</c> slot is a null
    /// (measured on CODESYS's live model: the ENO slot is null on every box that has one). Compacting it away
    /// shifts every later pin one place against its name, so a pin is read under its neighbour's name or, when
    /// only one is wired, dropped entirely. <c>CodesysNetworkReader.ReadBoxOutputs</c> reads raw for exactly
    /// this reason; this is the same rule through the archive's spelling.</para></summary>
    public static IReadOnlyList<XElement?> Slots(XElement? owner, string name)
    {
        var l = owner?.Elements("l2").FirstOrDefault(e => (string?)e.Attribute("n") == name);
        return l == null
            ? Array.Empty<XElement?>()
            : l.Elements().Select(e => e.Name == "o" ? e : null).ToList();
    }

    public static IReadOnlyList<XElement> List(XElement? owner, string name)
    {
        var l = owner?.Elements("l2").FirstOrDefault(e => (string?)e.Attribute("n") == name);
        return l == null ? Array.Empty<XElement>() : l.Elements("o").ToList();
    }

    /// <summary>The items of a list that MUST be there — the strict twin of <see cref="List"/>.
    ///
    /// <para><b>Absent and empty are different answers, and the archive spells them differently.</b> A resolved
    /// box legitimately has no output items, and the vendor writes that as a PRESENT but empty list
    /// (<c>&lt;o n="OutputItems"&gt;&lt;l2 n="OutputItems" /&gt;&lt;/o&gt;</c>). A list that is not there at all
    /// means this code is reading by a name the object model does not use — which is not a body with no
    /// outputs, it is a body Volt cannot read.</para>
    ///
    /// <para><see cref="List"/> answered empty for both, so the whole class of wrong-member-name bugs
    /// materialized here as a SILENTLY EMPTY body rather than an error. That is not hypothetical: the box enable
    /// was read as <c>"En"</c> for as long as this reader has existed while every archive spells it <c>EN</c>.
    /// CODESYS's reader has always failed loud on the same conditions (<c>NwlInterop.Require</c>), and its
    /// message names the loaded assembly version because "member missing" is a version story.</para></summary>
    public static IReadOnlyList<XElement> RequireList(XElement? owner, string name, string what)
    {
        var l = owner?.Elements("l2").FirstOrDefault(e => (string?)e.Attribute("n") == name);
        if (l == null)
            throw new NotSupportedException(
                $"TwinCAT: {what} has no '{name}' list in the archive. Refusing rather than reading it as an " +
                "empty one — a member this reader cannot find is a body it cannot represent, not a body with " +
                "nothing in it.");
        return l.Elements("o").ToList();
    }

    /// <summary>A named object member that MUST be there. Same rule as <see cref="RequireList"/>, for the
    /// holder rather than the list inside it.</summary>
    public static XElement RequireObj(XElement? owner, string name, string what) =>
        Obj(owner, name)
        ?? throw new NotSupportedException(
               $"TwinCAT: {what} has no '{name}' member in the archive. Refusing rather than treating it as " +
               "absent content — this reader is looking by a name the object model does not use.");

    /// <summary>The SCALAR items of a named list: <c>&lt;l2 n="Names" cet="String"&gt;&lt;v&gt;IN&lt;/v&gt;</c>.
    /// <para><see cref="List"/> returns only the <c>&lt;o&gt;</c> children, which is right for a list of objects
    /// and blind to a list of values - and a box's pin NAMES are values.</para></summary>
    /// <summary>Does this body hold NOTHING an engineer drew?
    ///
    /// <para>This is the create/edit fork, and it is not the same question as "is the body blank". Measured
    /// live: <c>CreateChild</c> with a graphical language mints a COMPLETE archive — implementation object,
    /// <c>TypeList</c>, one <c>Network</c> — whose <c>NetworkItems</c> is empty. A freshly created POU therefore
    /// arrives with a body that is fully present and entirely blank, and a blankness check misses it.</para>
    ///
    /// <para>True here means the import door: nothing is lost by letting TwinCAT build the body from PLCopen.
    /// False means the in-place writer, where every id, every <c>Fixed</c> and every unmodelled member the IDE
    /// wrote survives exactly as it wrote it.</para></summary>
    /// <summary>Does this body hold a CODESYS Execute box — a box whose call is raw ST?
    ///
    /// <para>Asked BEFORE the node walk, so the body can materialize as a marker instead of the walk throwing
    /// and taking the whole item out of the workspace with it. <c>ProvidesSTSnippet</c> is the vendor's own
    /// flag for it (DIALECT N4's measured <c>BoxTreeBox</c> member set) and is <c>false</c> on every ordinary
    /// box in every fixture, so this is narrow: it fires on the shape it names and nothing else.</para></summary>
    public static bool HasExecuteBox(XElement? impl) =>
        impl != null && impl.Descendants("v").Any(v =>
            (string?)v.Attribute("n") == "ProvidesSTSnippet" &&
            string.Equals(v.Value.Trim(), "true", StringComparison.OrdinalIgnoreCase));

    public static bool HasNoItems(XElement? impl)
    {
        if (impl == null) return true;
        foreach (var network in List(impl, "NetworkList"))
            if (List(network, "NetworkItems").Count > 0) return false;
        return true;
    }

    public static IReadOnlyList<string> Strings(XElement? owner, string name)
    {
        var l = owner?.Elements("l2").FirstOrDefault(e => (string?)e.Attribute("n") == name);
        return l == null ? Array.Empty<string>() : l.Elements("v").Select(v => v.Value).ToList();
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

    /// <summary>There is deliberately NO construction here. <c>TcNetworkWriter</c> assigns to members the IDE
    /// already wrote and never builds an element, so an accessor layer is all this needs to be - see that
    /// file's header for why building an archive element is out of reach.</summary>
}
