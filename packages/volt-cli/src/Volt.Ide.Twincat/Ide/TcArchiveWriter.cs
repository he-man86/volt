using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace Volt.Ide.Twincat;

/// <summary>
/// TwinCAT's <c>&lt;XmlArchive&gt;</c> written from its OBJECT GRAPH — the <see cref="XElement"/> tree
/// <see cref="TcArchive"/> reads — back to the exact text the IDE writes (openspec twincat-inproc-host 2.1).
///
/// <para><b>Byte identity first.</b> The first hand-built archive broke a load (attempt 1, a <c>cet</c> on a mixed
/// list), and the version before that wrote twenty unopenable <c>.TcPOU</c> files (DIALECT N4). So this writer has to
/// reproduce every archive TwinCAT wrote, byte for byte, before it may write one Volt built
/// (<c>TcArchiveIdentityTests</c>). Every rule below was learned from a mismatch on a vendor archive, never assumed:</para>
/// <list type="number">
/// <item><b>Indentation.</b> The archive object is <c>xml:space="preserve"</c>, so its whitespace is CONTENT and the IDE
/// stores what it was handed. One member per line, two spaces deeper than its owner; the object's own members start
/// at <c>indent + 2</c>. <c>indent</c> is where the archive was first written (12 for a POU body, 14 for a member's,
/// 16 for deeper ones), and it is kept, never re-derived from where the archive sits now.</item>
/// <item><b>Newlines.</b> One newline string throughout: CRLF in every archive TwinCAT wrote.</item>
/// <item><b>Scalars.</b> <c>&lt;v&gt;</c> is always open + text + close on one line, empty or not; the text is the
/// vendor's lexical form, kept verbatim (<c>"a"</c> quoted strings, <c>true</c>, <c>15L</c> for an Int64, <c>15</c> for
/// an Int32, an enum member bare under <c>t="Operator"</c>). Only <c>&amp; &lt; &gt;</c> are escaped, and a CR as
/// <c>&amp;#xD;</c>: this gate's own parse folds a raw one into the LF beside it, and the XAE reads either spelling as the
/// same CR, handing it back raw (DIALECT N42 f).</item>
/// <item><b>Nulls.</b> <c>&lt;n n="Name" /&gt;</c> for a null member, <c>&lt;n /&gt;</c> for a null list element.</item>
/// <item><b>Containers</b> (<c>o l l2 a d d2</c>): no children is self-closing with a space, <c>&lt;l2 n="X" /&gt;</c>;
/// otherwise open, one child per line, close on its own line at the owner's indent.</item>
/// <item><b>No blank lines, and no <c>cet</c> on an empty list.</b> An empty list is <c>&lt;l2 n="X" /&gt;</c>, never
/// <c>&lt;l2 n="X" cet="T"&gt;</c> with nothing in it. Every archive that holds either was EDITED AS TEXT by Volt and
/// stored verbatim by TwinCAT (which keeps <c>ImplementationText</c> as handed over, through save and reload — measured
/// 2026-10-16): <c>TcNetworkWriter.DropImporterBoxOutputs</c> removed an <c>&lt;o&gt;</c> from a typed list and left its
/// line and the <c>cet</c> behind (<c>importer-max</c>, <c>importer-unwired</c>, <c>VipWire2</c>). The writer refuses both,
/// so the gate tells such an archive from one TwinCAT serialized.</item>
/// <item><b>Attribute order</b> is <c>xml:space n t cet ckt cvt</c>.</item>
/// <item><b><c>TypeList</c></b> names every type the object uses — each <c>t</c>, <c>cet</c>, <c>ckt</c> and
/// <c>cvt</c>, plus the type of every named scalar written without a <c>t</c> (<c>"…"</c> String, <c>true/false</c>
/// Boolean, <c>NL</c> Int64, <c>N</c> Int32, <c>{guid}</c> Guid) — once, ordered ordinal-ignore-case (<c>Network</c> before
/// <c>NWLImplementationObject</c>). Each name's GUID is the vendor's (<see cref="NwlTypes"/>).</item>
/// </list>
/// <para>What the gate does NOT cover, because no vendor archive holds it yet: a string with a newline in it.</para>
/// </summary>
internal static class TcArchiveWriter
{
    /// <summary>The indentation a POU body's archive is written at by the IDE, and the newline it writes.</summary>
    public const int BodyIndent = 12;
    public const string Newline = "\r\n";

    private static readonly string[] AttributeOrder = { "space", "n", "t", "cet", "ckt", "cvt" };

    /// <summary>The GUID TwinCAT registers for each NWL archive type — measured on every NWL archive in the
    /// repository's fixtures (and the machine's samples); <c>TcArchiveIdentityTests</c> holds every vendor archive to
    /// it. A type not listed here has never been seen in a TwinCAT archive, and the writer refuses to name it.</summary>
    public static readonly IReadOnlyDictionary<string, string> NwlTypes = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["Boolean"] = "System.Boolean",
        ["BoxTreeAssign"] = "{9873c309-1f09-4ebf-9078-42d8057ef11b}",
        ["BoxTreeBox"] = "{acfc6f68-8e3a-4af5-bf81-3dd512095a46}",
        ["BoxTreeDemux"] = "{b1d55618-017c-4bc5-990a-55c2f27d9d3a}",
        ["BoxTreeOperand"] = "{9de7f100-1b87-424c-a62e-45b0cfc85ed2}",
        ["BoxTreeTerminator"] = "{5f9848d3-568d-4cc5-9e31-8e28e9607ff1}",
        ["Flags"] = "{668066f2-6069-46b3-8962-8db8d13d7db2}",
        ["Int32"] = "System.Int32",
        ["Int64"] = "System.Int64",
        ["Network"] = "{d9a99d73-b633-47db-b876-a752acb25871}",
        ["NWLImplementationObject"] = "{25e509de-33d4-4447-93f8-c9e4ea381c8b}",
        ["Operand"] = "{c9b2f165-48a2-4a45-8326-3952d8a3d708}",
        ["Operator"] = "{bffb3c53-f105-4e85-aba2-e30df579d75f}",
        ["OutputItemList"] = "{f40d3e09-c02c-4522-a88c-dac23558cfc4}",
        ["ParamList"] = "{71496971-9e0c-4677-a832-b9583b571130}",
        ["STImplementationObject"] = "{3b83b776-fb25-43b8-99f2-3c507c9143fc}",
        ["String"] = "System.String",
        ["STSnippet"] = "{b2131366-6917-4304-87a9-64c0585560a8}",
        ["TextDocument"] = "{f3878285-8e4f-490b-bb1b-9acbb7eb04db}",
        ["TextLine"] = "{a5de0b0b-1cb5-4913-ac21-9d70293ec00d}",
    };

    // ── parse ─────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The archive object (<c>&lt;o xml:space="preserve" …&gt;</c>) as a graph, whitespace dropped — refused
    /// where the whitespace is not the vendor's (rule 6). <paramref name="text"/> is the object alone.</summary>
    public static XElement ParseObject(string text) => Graph(XElement.Parse(text, LoadOptions.PreserveWhitespace));

    private static XElement Graph(XElement e)
    {
        var copy = new XElement(e.Name, e.Attributes());
        if (e.Name.LocalName == "v") { copy.Value = e.Value; return copy; }

        var nodes = e.Nodes().ToList();
        for (var i = 0; i < nodes.Count; i++)
        {
            switch (nodes[i])
            {
                case XElement child:
                    copy.Add(Graph(child));
                    break;
                case XText t when string.IsNullOrWhiteSpace(t.Value):
                    // One newline introduces each line. A second one is a blank line, which TwinCAT never writes: an
                    // element removed by a text edit left it (rule 6), or a member deleted by hand (`*.derived`).
                    if (t.Value.Count(c => c == '\n') > 1)
                        throw new FormatException($"TwinCAT archive: a blank line inside <{e.Name.LocalName} {Describe(e)}>, which TwinCAT never writes.");
                    break;
                case XText t:
                    throw new FormatException($"TwinCAT archive: text '{t.Value.Trim()}' inside <{e.Name}>, where only members are.");
            }
        }
        return copy;
    }

    private static string Describe(XElement e) =>
        string.Join(" ", e.Attributes().Select(a => $"{a.Name.LocalName}=\"{a.Value}\""));

    // ── write ─────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The <c>ImplementationText</c> form: <c>&lt;NWL&gt;&lt;XmlArchive&gt;&lt;Data&gt;</c>, the object at
    /// <paramref name="indent"/>, and its <c>TypeList</c> — no whitespace outside the object, as the IDE answers it.</summary>
    public static string WriteBody(XElement obj, int indent = BodyIndent, string newline = Newline) =>
        "<NWL><XmlArchive><Data>" + WriteObject(obj, indent, newline) + "</Data>" + WriteTypeList(obj) +
        "</XmlArchive></NWL>";

    /// <summary>The archive object alone, as the IDE writes it inside <c>&lt;Data&gt;</c>.</summary>
    public static string WriteObject(XElement obj, int indent, string newline)
    {
        var sb = new StringBuilder();
        Write(sb, obj, indent, newline);
        return sb.ToString();
    }

    /// <summary><c>&lt;TypeList&gt;</c> with the vendor's GUID for each type the object uses (rule 8).</summary>
    private static string WriteTypeList(XElement obj)
    {
        var sb = new StringBuilder("<TypeList>");
        foreach (var name in TypeNames(obj))
        {
            if (!NwlTypes.TryGetValue(name, out var guid))
                throw new NotSupportedException(
                    $"TwinCAT archive: the type '{name}' has never been seen in a TwinCAT NWL archive, so its GUID is " +
                    "unknown — refusing rather than naming a type the IDE may not resolve.");
            sb.Append("<Type n=\"").Append(name).Append("\">").Append(guid).Append("</Type>");
        }
        return sb.Append("</TypeList>").ToString();
    }

    /// <summary>The types the archive's <c>TypeList</c> names for this object, in the vendor's order (rule 8).</summary>
    public static IReadOnlyList<string> TypeNames(XElement obj)
    {
        var used = new HashSet<string>(StringComparer.Ordinal);
        foreach (var e in obj.DescendantsAndSelf())
        {
            foreach (var a in new[] { "t", "cet", "ckt", "cvt" })
                if ((string?)e.Attribute(a) is { } type) used.Add(type);
            if (e.Name.LocalName == "v" && e.Attribute("n") != null && e.Attribute("t") == null)
                used.Add(ScalarType(e.Value));
        }
        return used.OrderBy(n => n, StringComparer.OrdinalIgnoreCase).ToList();
    }

    private static readonly Regex Int64Form = new(@"^-?[0-9]+L$", RegexOptions.CultureInvariant);
    private static readonly Regex Int32Form = new(@"^-?[0-9]+$", RegexOptions.CultureInvariant);
    private static readonly Regex GuidForm = new(@"^\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}$", RegexOptions.CultureInvariant);

    private static string ScalarType(string raw) =>
        raw.StartsWith("\"", StringComparison.Ordinal) ? "String"
        : raw is "true" or "false" ? "Boolean"
        : Int64Form.IsMatch(raw) ? "Int64"
        : Int32Form.IsMatch(raw) ? "Int32"
        : GuidForm.IsMatch(raw) ? "Guid"
        : throw new NotSupportedException(
              $"TwinCAT archive: the scalar '{raw}' has no type attribute and is none of the measured lexical forms " +
              "(\"string\", true/false, NL, N, {guid}).");

    private static void Write(StringBuilder sb, XElement e, int indent, string newline)
    {
        var tag = e.Name.LocalName;

        sb.Append('<').Append(tag);
        foreach (var a in Ordered(e))
            sb.Append(' ').Append(a.Name == XNamespace.Xml + "space" ? "xml:space" : a.Name.LocalName)
              .Append("=\"").Append(EscapeAttribute(a.Value)).Append('"');

        if (tag == "v") { sb.Append('>').Append(EscapeText(e.Value)).Append("</v>"); return; }   // rule 3

        var children = e.Elements().ToList();
        if (children.Count == 0)                                        // rules 4 and 5
        {
            if (e.Attribute("cet") != null)                             // rule 6
                throw new NotSupportedException($"TwinCAT archive: an empty list <{tag} {Describe(e)}> carries an element type, which TwinCAT never writes.");
            sb.Append(" />");
            return;
        }

        sb.Append('>');
        var pad = new string(' ', indent + 2);
        foreach (var child in children)
        {
            sb.Append(newline).Append(pad);
            Write(sb, child, indent + 2, newline);
        }
        sb.Append(newline).Append(' ', indent).Append("</").Append(tag).Append('>');
    }

    private static IEnumerable<XAttribute> Ordered(XElement e)
    {
        var attributes = e.Attributes().ToList();
        foreach (var a in attributes)
            if (Array.IndexOf(AttributeOrder, a.Name.LocalName) < 0)
                throw new NotSupportedException($"TwinCAT archive: <{e.Name.LocalName}> carries the attribute '{a.Name}', which no vendor archive writes.");
        return attributes.OrderBy(a => Array.IndexOf(AttributeOrder, a.Name.LocalName), Comparer<int>.Default);
    }

    private static string EscapeText(string s) => s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\r", "&#xD;");

    private static string EscapeAttribute(string s) => EscapeText(s).Replace("\"", "&quot;");
}
