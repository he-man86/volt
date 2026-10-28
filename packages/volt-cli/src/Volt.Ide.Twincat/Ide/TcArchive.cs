using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.St;
using Volt.Contracts;
using Volt.Engine;

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
/// engineer did not edit. A deserialize/reserialize round trip would rewrite all of it.</para>
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

    /// <summary>The language of a graphical body Volt does not read — the wrapper element, <c>&lt;CFC&gt;</c> or
    /// <c>&lt;SFC&gt;</c> — or null when the body is textual (ST is not XML at all). Asked of a body that is not an
    /// NWL archive with an implementation object (<see cref="Root"/>).
    /// <para>Any other XML root is a graphical body Volt has never seen (or an NWL archive with no implementation
    /// object), and its line names the root, upper case — <c>%LANGUAGE UML UNSUPPORTED</c> — as CODESYS names an
    /// unknown aspect (<c>CodesysDriver.UnreadLanguage</c>; <see cref="PropertyLines.VendorLanguage"/>). Neither
    /// a refusal (thrown outside <c>NetworkText.Pulled</c>, it would take the whole POU out of refs and fetch — D27,
    /// openspec bridge-refusal-review 2.34) nor null (the vendor's XML would fall through as TEXT, pulled under
    /// <c>%LANGUAGE ST</c>).</para></summary>
    public static string? UnreadLanguage(string raw)
    {
        XElement el;
        try { el = XElement.Parse(raw); } catch (System.Xml.XmlException) { return null; }   // textual ST is not XML
        return el.Name.LocalName switch
        {
            "CFC" => "CFC",
            "SFC" => "SFC",
            var root => PropertyLines.VendorLanguage(root),
        };
    }

    /// <summary>An archive as the IDE handed it, parsed WITHOUT XML's end-of-line normalization: the XAE hands a value's
    /// CR LF raw (measured 2026-10-17, DIALECT N42 f), and the normalizing parse folded it into a bare LF — which the next
    /// write handed back, changing every untouched multi-line value of the body (a network comment, an EXECUTE box's ST
    /// lines). The in-place writer edits this tree and writes it back with <see cref="Text"/>.</summary>
    internal static XElement Parse(string archive)
    {
        using var r = new System.Xml.XmlTextReader(new System.IO.StringReader(archive))
        {
            Normalization = false,
            WhitespaceHandling = System.Xml.WhitespaceHandling.All,
            DtdProcessing = System.Xml.DtdProcessing.Prohibit,
        };
        return XElement.Load(r, LoadOptions.PreserveWhitespace);
    }

    /// <summary>An archive as the IDE is handed it: every VALUE written exactly as it holds it — a CR LF raw, a bare LF
    /// bare, as the XAE hands them (DIALECT N42 f: it keeps a value's characters, an entitized <c>&amp;#xD;</c> and a raw CR
    /// alike, and hands the CR back raw). <c>XNode.ToString</c> wrote every LF as the platform's new line (CR LF on
    /// Windows), turning each bare LF of the whole body into CR LF in the IDE (2R.3 review).
    /// <para><b>The white space BETWEEN elements is no value: it is the archive's layout</b>, which TwinCAT stores as
    /// handed (DIALECT N42 a). It is written raw, every line break as the handed archive's own (CR LF in every archive
    /// TwinCAT wrote), so an untouched element stays byte for byte and a network spliced in — laid out in memory — sits
    /// in the same layout (<c>A_body_edited_with_built_networks_keeps_the_vendor_layout</c>).</para></summary>
    internal static string Text(XNode doc, string handed)
    {
        var newline = System.Text.RegularExpressions.Regex.Match(handed, ">(\r?\n) *<").Groups[1] is { Success: true } g ? g.Value : "\r\n";
        var sb = new System.Text.StringBuilder();
        var settings = new System.Xml.XmlWriterSettings
        {
            OmitXmlDeclaration = true,
            Indent = false,
            NewLineHandling = System.Xml.NewLineHandling.None,
            ConformanceLevel = System.Xml.ConformanceLevel.Auto,
        };
        using (var w = System.Xml.XmlWriter.Create(sb, settings)) WriteNode(w, doc, newline);
        return sb.ToString();
    }

    private static void WriteNode(System.Xml.XmlWriter w, XNode node, string newline)
    {
        switch (node)
        {
            case XDocument d:
                foreach (var n in d.Nodes()) WriteNode(w, n, newline);
                break;
            case XElement e:
                w.WriteStartElement(e.Name.LocalName, e.Name.NamespaceName);
                foreach (var a in e.Attributes())
                    if (!a.IsNamespaceDeclaration) w.WriteAttributeString(a.Name.LocalName, a.Name.NamespaceName, a.Value);
                foreach (var n in e.Nodes()) WriteNode(w, n, newline);
                if (e.IsEmpty) w.WriteEndElement(); else w.WriteFullEndElement();
                break;
            case XText t when t is not XCData && string.IsNullOrWhiteSpace(t.Value) && t.Parent is { } owner && owner.Elements().Any():
                w.WriteRaw(t.Value.Replace("\r\n", "\n").Replace("\n", newline));   // the layout between elements
                break;
            default:
                node.WriteTo(w);   // a value: as it holds it
                break;
        }
    }

    /// <summary>A named object member: <c>&lt;o n="Name"&gt;</c>. An explicit <c>&lt;n n="Name"/&gt;</c> is a
    /// null and yields null.</summary>
    public static XElement? Obj(XElement? owner, string name) =>
        owner?.Elements("o").FirstOrDefault(e => (string?)e.Attribute("n") == name);

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

    /// <summary>The items of an ARRAY member — <c>&lt;a n="..." cet="..."&gt;</c>, which is a different
    /// serialization from the <c>&lt;l2&gt;</c> list <see cref="List"/> reads.
    ///
    /// <para>The archive uses both, and the distinction is the vendor's, not a style choice: an Execute box's
    /// <c>TextLines</c> is an array of <c>TextLine</c>, while a network's <c>NetworkItems</c> is an l2 list.
    /// Reading one with the other's accessor answers EMPTY, which is how an Execute box's ST could look like a
    /// box with no code rather than like a member read by the wrong name.</para></summary>
    public static IReadOnlyList<XElement> Items(XElement? owner, string name)
    {
        var a = owner?.Elements("a").FirstOrDefault(e => (string?)e.Attribute("n") == name);
        return a == null ? Array.Empty<XElement>() : a.Elements("o").ToList();
    }

    /// <summary>The items of a named list, with nulls (<c>&lt;n/&gt;</c>) dropped.</summary>
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
            throw new UnsupportedException(
                $"TwinCAT: {what} has no '{name}' list in the archive. Refusing rather than reading it as an " +
                "empty one — a member this reader cannot find is a body it cannot represent, not a body with " +
                "nothing in it.");
        return l.Elements("o").ToList();
    }

    /// <summary>A named object member that MUST be there. Same rule as <see cref="RequireList"/>, for the
    /// holder rather than the list inside it.</summary>
    public static XElement RequireObj(XElement? owner, string name, string what) =>
        Obj(owner, name)
        ?? throw new UnsupportedException(
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
    /// <para>True here means the create door: nothing is lost by building the whole body natively.
    /// False means the in-place writer, where every id, every <c>Fixed</c> and every unmodelled member the IDE
    /// wrote survives exactly as it wrote it.</para></summary>
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

    // There is no lenient Bool / Int / FlagBits: each answered an absent member as false / 0, a value the IDE did not
    // state (zero-fallback review 2026-10-28). The strict reads below are the only ones.

    // ── strict scalars (zero-fallback) ────────────────────────────────────────────────────────────
    //
    // `Str`, `Bool`, `Int` and `FlagBits` answer an ABSENT member as null / false / 0 — the same answer as a member the
    // IDE wrote holding nothing, `""`, false or 0. Where the vendor writes the member on every object of a class (the
    // censuses below each caller), its absence is an archive shape no TwinCAT was measured to write, so these refuse it by
    // name instead (owner 2026-10-23: a default the IDE did not state is a defect).

    /// <summary>The member's raw <c>&lt;v&gt;</c> text; null where the IDE wrote the explicit null <c>&lt;n n="name" /&gt;</c>.
    /// An absent member is refused by name.</summary>
    public static string? RequireRaw(XElement owner, string name, string what)
    {
        foreach (var m in owner.Elements())
            if ((string?)m.Attribute("n") == name)
                return m.Name.LocalName switch
                {
                    "v" => m.Value,
                    "n" => null,
                    _ => throw new UnsupportedException(
                        $"TwinCAT: {what} holds '{name}' as an <{m.Name.LocalName}>, where the archive writes a scalar. " +
                        "Refusing rather than reading it as absent."),
                };
        throw new UnsupportedException(
            $"TwinCAT: {what} has no '{name}' member in the archive, which TwinCAT writes on every one. Refusing rather " +
            "than reading the gap as a value the IDE did not state.");
    }

    /// <summary>A string member the IDE writes as a quoted string — unquoted, <c>""</c> kept as <c>""</c> (never folded into
    /// null as <see cref="Str"/> folds it). The explicit null and an absent member are both refused by name.</summary>
    public static string RequireText(XElement owner, string name, string what)
    {
        var v = RequireRaw(owner, name, what)
                ?? throw new UnsupportedException(
                    $"TwinCAT: {what} holds no value in '{name}' (an explicit null), where TwinCAT writes a string. " +
                    "Refusing rather than reading it as an empty one.");
        if (v.Length < 2 || v[0] != '"' || v[v.Length - 1] != '"')
            throw new UnsupportedException($"TwinCAT: {what}'s '{name}' is '{v}', not the quoted string TwinCAT writes.");
        return v.Substring(1, v.Length - 2);
    }

    /// <summary>A boolean member: <c>true</c> or <c>false</c> exactly as TwinCAT writes it; anything else, or nothing, refused.</summary>
    public static bool RequireBool(XElement owner, string name, string what) =>
        RequireRaw(owner, name, what) switch
        {
            "true" => true,
            "false" => false,
            var v => throw new UnsupportedException(
                $"TwinCAT: {what}'s '{name}' is '{v ?? "(null)"}', where TwinCAT writes true or false."),
        };

    /// <summary>An integer member (<c>0</c>, <c>15L</c>); a null, absent or unparsable one is refused, never read as 0.</summary>
    public static int RequireInt(XElement owner, string name, string what)
    {
        var v = RequireRaw(owner, name, what);
        var digits = v?.TrimEnd('L');
        return int.TryParse(digits, NumberStyles.Integer, CultureInfo.InvariantCulture, out var i) ? i
            : throw new UnsupportedException($"TwinCAT: {what}'s '{name}' is '{v ?? "(null)"}', where TwinCAT writes an integer.");
    }

    /// <summary>The flag bits of an object that HOLDS a <c>Flags</c> member — a box, an assignment, a terminator, an operand
    /// (every one in every archive, census below <see cref="TcNetworkReader"/>). Its absence is refused, never read as none.</summary>
    public static int RequireFlagBits(XElement owner, string what) =>
        RequireInt(RequireObj(owner, "Flags", what), "Flags", what + "'s Flags");

    /// <summary>The flag bits of <paramref name="flags"/> — the ONE flag→bit encoding, for the in-place writer and the
    /// builder alike. Coil storage is encoded per TARGET (<c>Flags.VendorCoilBits()</c>), so a RESET reaching this is a
    /// modifier the model should never have produced: Volt's own invariant.</summary>
    public static int Bits(Volt.Engine.Format.Network.Flags? flags)
    {
        if (flags is not { } f || f.IsNone) return 0;
        if (f.Reset)
            throw new VoltInvariantException(
                "TwinCAT: a RESET reached the generic flag write. Coil storage is encoded per TARGET via " +
                "Flags.VendorCoilBits(); a Reset anywhere else is a modifier the model should never have produced.");
        var bits = 0;
        if (f.Negated) bits |= FlagNegation;
        if (f.Set) bits |= FlagSet;
        if (f.Jump) bits |= FlagJump;
        if (f.Return) bits |= FlagReturn;
        if (f.Rising) bits |= FlagRtrig;
        if (f.Falling) bits |= FlagFtrig;
        return bits;
    }

    /// <summary>There is deliberately NO construction here. <c>TcNetworkWriter</c> assigns to members the IDE
    /// already wrote and never builds an element, so an accessor layer is all this needs to be - see that
    /// file's header for why building an archive element is out of reach.</summary>
}
