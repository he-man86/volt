using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;

namespace Volt.Bridge.Core.Graphical;

public static class PlcOpenPouParser
{
    public sealed record ParsedPou(
        string? Declaration,
        string? BodyLanguage,
        XElement? BodyElement,
        List<ParsedChild> Children
    );

    public sealed record ParsedChild(
        string Name,
        string PouType,
        string? Declaration,
        string? BodyLanguage,
        XElement? BodyElement
    );

    public static ParsedPou Parse(string xml)
    {
        var doc = XDocument.Parse(xml);
        var ns = doc.Root!.GetDefaultNamespace();

        var rootPou = doc.Root.Name.LocalName == "pou"
            ? doc.Root
            : doc.Descendants().FirstOrDefault(e => e.Name.LocalName == "pou")
              ?? throw new InvalidOperationException("PLCopen document has no <pou> element");

        var declaration = DeclFromElement(rootPou);
        var (bodyLang, bodyEl) = FindBody(rootPou, ns);

        var children = new List<ParsedChild>();

        // Standard PLCopen: child <pou> elements (nested or siblings)
        foreach (var e in rootPou.Elements().Where(e => e.Name.LocalName == "pou")
            .Concat(rootPou.Parent?.Elements().Where(e => e.Name.LocalName == "pou" && e != rootPou)
                    ?? Enumerable.Empty<XElement>()))
        {
            var pouType = (string?)e.Attribute("pouType");
            if (pouType is not ("method" or "action")) continue;
            var childName = (string?)e.Attribute("name");
            if (string.IsNullOrEmpty(childName)) continue;
            var childDecl = DeclFromElement(e);
            var (childLang, childEl) = FindBody(e, ns);
            children.Add(new ParsedChild(childName, pouType, childDecl, childLang, childEl));
        }

        // CODESYS proprietary: <method>/<action> inside <addData> (lowercase in CODESYS exports)
        foreach (var e in rootPou.Descendants().Where(e =>
            e.Name.LocalName is "Method" or "Action" or "method" or "action"))
        {
            var childName = (string?)e.Attribute("name");
            if (string.IsNullOrEmpty(childName)) continue;
            var local = e.Name.LocalName.ToLowerInvariant();
            var pouType = local == "method" ? "method" : "action";
            var childDecl = DeclFromElement(e)
                ?? (pouType == "action" ? $"ACTION {childName}" : $"METHOD {childName}");
            var (childLang, childEl) = FindBodyChild(e);
            children.Add(new ParsedChild(childName, pouType, childDecl, childLang, childEl));
        }

        return new ParsedPou(declaration, bodyLang, bodyEl, children);
    }

    private static (string? language, XElement? element) FindBody(XElement pou, XNamespace ns)
    {
        var bodyEl = pou.Element(ns + "body");
        if (bodyEl == null) return default;
        return FindBodyLang(bodyEl, ns);
    }

    /// <summary>For CODESYS addData children, the body element may not use the PLCopen namespace.</summary>
    private static (string? language, XElement? element) FindBodyChild(XElement parent)
    {
        var bodyEl = parent.Elements().FirstOrDefault(e => e.Name.LocalName == "body");
        if (bodyEl == null) return default;
        // CODESYS addData bodies may not be in the PLCopen namespace
        foreach (var lang in new[] { "ST", "IL", "FBD", "LD", "CFC", "SFC" })
        {
            var langEl = bodyEl.Elements().FirstOrDefault(e => e.Name.LocalName == lang);
            if (langEl != null) return (lang, langEl);
        }
        return default;
    }

    private static (string? language, XElement? element) FindBodyLang(XElement bodyEl, XNamespace ns)
    {
        foreach (var lang in new[] { "ST", "IL", "FBD", "LD", "CFC", "SFC" })
        {
            var langEl = bodyEl.Element(ns + lang);
            if (langEl != null) return (lang, langEl);
        }
        return default;
    }

    private static string? DeclFromElement(XElement element)
    {
        var iapt = element.Elements()
            .Where(e => e.Name.LocalName != "pou")
            .SelectMany(e => e.DescendantsAndSelf())
            .FirstOrDefault(e => e.Name.LocalName == "InterfaceAsPlainText");
        if (iapt == null) return null;
        var inner = iapt.Elements().FirstOrDefault(e => e.Name.LocalName == "xhtml") ?? iapt;
        var text = inner.Value;
        return string.IsNullOrEmpty(text) ? null : text;
    }
}
