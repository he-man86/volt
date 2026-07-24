using System;
using System.Collections.Generic;
using System.Text;
using System.Xml.Linq;
using Volt.Engine.Workspace;

namespace Volt.Engine.Graphical;

/// <summary>Builds a PLCopen XML document from <see cref="Workspace.PouData"/>,
/// ready for CODESYS import_xml (or TwinCAT PlcOpenImport).
/// One call replaces per-child COM creates/writes.</summary>
public static class PouToXml
{
    private const string Ns = "http://www.plcopen.org/xml/tc6_0200";
    private const string XhtmlNs = "http://www.w3.org/1999/xhtml";
    private const string AddDataNs = "http://www.3s-software.com/plcopenxml/";

    public static string Convert(Workspace.PouData pou, string name)
    {
        var ns = XNamespace.Get(Ns);
        var xhtml = XNamespace.Get(XhtmlNs);

        var pouEl = new XElement(ns + "pou",
            new XAttribute("name", name),
            new XAttribute("pouType", PouTypeAttr(pou.Kind)));

        // Declaration
        if (!string.IsNullOrEmpty(pou.Declaration))
        {
            var iapt = new XElement("InterfaceAsPlainText",
                new XElement(xhtml + "xhtml", new XText(pou.Declaration)));
            pouEl.Add(new XElement(ns + "addData",
                new XElement(ns + "data",
                    new XAttribute("name", AddDataNs + "interfaceasplaintext"),
                    new XAttribute("handleUnknown", "implementation"),
                    iapt)));
        }

        // Body
        if (!string.IsNullOrEmpty(pou.BodyText))
        {
            var bodyEl = new XElement(ns + "body");
            var lang = pou.BodyLanguage ?? "ST";
            bodyEl.Add(new XElement(ns + lang, new XText(pou.BodyText)));
            pouEl.Add(bodyEl);
        }

        // Children: methods and actions as CODESYS addData
        var methodAddData = new XElement(ns + "addData");
        foreach (var c in pou.Children)
        {
            if (c.Kind is not (ItemKind.Kinds.Method or ItemKind.Kinds.Action)) continue;
            var childEl = new XElement(c.Kind == ItemKind.Kinds.Method ? "Method" : "Action",
                new XAttribute("name", c.Name));

            // Child declaration
            if (!string.IsNullOrEmpty(c.Declaration))
            {
                childEl.Add(new XElement("InterfaceAsPlainText",
                    new XElement(xhtml + "xhtml", new XText(c.Declaration))));
            }
            // Child body
            if (!string.IsNullOrEmpty(c.BodyText))
            {
                var cBody = new XElement("body");
                var cLang = c.BodyLanguage ?? "ST";
                cBody.Add(new XElement(cLang, new XText(c.BodyText)));
                childEl.Add(cBody);
            }
            childEl.Add(new XElement("addData"));  // CODESYS requires this

            methodAddData.Add(new XElement(ns + "data",
                new XAttribute("name", AddDataNs + (c.Kind == ItemKind.Kinds.Method ? ItemKind.Kinds.Method : ItemKind.Kinds.Action)),
                new XAttribute("handleUnknown", "implementation"),
                childEl));
        }
        if (methodAddData.HasElements)
            pouEl.Add(methodAddData);

        var doc = new XDocument(new XDeclaration("1.0", "utf-8", null), pouEl);
        return doc.ToString();
    }

    private static string PouTypeAttr(string kind) => kind switch
    {
        "program" => "program",
        "function_block" => "functionBlock",
        "function" => "function",
        "interface" => "interface",
        _ => "functionBlock",
    };
}
