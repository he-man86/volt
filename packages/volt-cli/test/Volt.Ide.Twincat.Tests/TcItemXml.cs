using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security;
using Volt.Engine.Item;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// What EVERY TwinCAT tree item answers to <c>ProduceXml</c> (DIALECT C39, C40), for the doubles that model no build
/// property of their own: built, <c>LinkAlways</c>/<c>External</c> off, no <c>CompilerDefines</c> — and, for an object
/// with a saved file, that file's <c>FullPath</c>, written here. No TwinCAT tree item answers no automation XML, so the
/// driver has no branch for one (T2): a double that left the member out was the only object that did.
/// </summary>
internal static class TcItemXml
{
    private static readonly string Dir = Path.Combine(Path.GetTempPath(), "volt-tc-tests-saved");

    /// <summary>The item XML of a built item with no build flag set; <paramref name="file"/> its saved file, if any.</summary>
    public static string Built(string name, string? file = null) =>
        $"<TreeItem><ItemName>{SecurityElement.Escape(name)}</ItemName><VSProperties>" +
        Property("Exclude", "False") + Property("LinkAlways", "False") + Property("External", "False") +
        Property("CompilerDefines", "") +
        (file is null ? "" : $"<VSProperty category=\"Misc\" readonly=\"true\"><Name>FullPath</Name><Value>{SecurityElement.Escape(file)}</Value></VSProperty>") +
        "</VSProperties></TreeItem>";

    private static string Property(string name, string value) =>
        $"<VSProperty category=\"Advanced\"><Name>{name}</Name><Value>{value}</Value></VSProperty>";

    /// <summary>The item XML of an object of <paramref name="itemType"/> saved as TwinCAT saves a plain one: no special
    /// function, no object property, and — for an interface — each property accessor in <paramref name="accessors"/> with
    /// the empty declaration a vendor-saved <c>.TcIO</c> holds (<c>fixtures/tc-pou/ITF1.TcIO</c>).</summary>
    public static string Saved(string name, int itemType, IEnumerable<(string Property, bool Get, bool Set)>? accessors = null) =>
        Built(name, SavedFile(name, itemType, accessors));

    /// <summary>A file holding the object element TwinCAT saves for <paramref name="itemType"/>, written once per call. A POU
    /// carries <c>SpecialFunc="None"</c>, as every vendor-written <c>.TcPOU</c> does.</summary>
    public static string SavedFile(string name, int itemType, IEnumerable<(string Property, bool Get, bool Set)>? accessors = null)
    {
        var (element, extension) = itemType switch
        {
            ItemKind.PlcItf => ("Itf", ".TcIO"),
            ItemKind.PlcGvl => ("GVL", ".TcGVL"),
            ItemKind.PlcDut or ItemKind.PlcDutEnum or ItemKind.PlcDutStruct or ItemKind.PlcDutUnion => ("DUT", ".TcDUT"),
            _ => ("POU", ".TcPOU"),
        };
        var properties = string.Concat((accessors ?? Array.Empty<(string, bool, bool)>()).Select(a =>
            $"<Property Name=\"{SecurityElement.Escape(a.Property)}\" Id=\"{{0}}\">" +
            (a.Get ? "<Get Name=\"Get\" Id=\"{0}\"><Declaration><![CDATA[]]></Declaration></Get>" : "") +
            (a.Set ? "<Set Name=\"Set\" Id=\"{0}\"><Declaration><![CDATA[]]></Declaration></Set>" : "") +
            "</Property>"));
        Directory.CreateDirectory(Dir);
        var file = Path.Combine(Dir, Guid.NewGuid().ToString("N") + extension);
        File.WriteAllText(file,
            "<?xml version=\"1.0\" encoding=\"utf-8\"?><TcPlcObject Version=\"1.1.0.1\">" +
            $"<{element} Name=\"{SecurityElement.Escape(name)}\" Id=\"{{0}}\"{(element == "POU" ? " SpecialFunc=\"None\"" : "")}>" +
            $"{properties}</{element}></TcPlcObject>");
        return file;
    }
}
