using System;
using System.IO;

namespace Volt.Cli.Ide.Twincat;

/// <summary>
/// TwinCAT's PLCopenXML transport — <c>ITcPlcIECProject.PlcOpenExport</c> /
/// <c>PlcOpenImport</c> on the PLC-project tree node. The interface is XML string in/out
/// (<c>ExportXmlString</c>/<c>ImportXmlString</c>, the TwinCAT analogue of CODESYS's object-model
/// methods of the same name), but TwinCAT's API is FILE-based, so internally we round-trip through
/// a temp file (CODESYS's is in-memory). Both feed the same shared
/// <c>PlcOpenReader</c>/<c>PlcOpenWriter</c> path.
///
/// SETTLED: the methods live on ITcPlcIECProject — a NON-default COM interface — and late-bound
/// dispatch on the dynamic RCW DOES reach them. The recorded fixtures in
/// <c>test/Volt.Engine.Tests/fixtures/tc-*</c> were captured through this exact call against a live
/// TcXaeShell, so no typed interop cast (TCatSysManagerLib) is needed. The note that used to stand
/// here said this "needs live verification"; it had already been verified by the act of producing
/// those fixtures, and leaving it made the TwinCAT read path read as riskier than it is.
///
/// STILL UNVERIFIED — the export SELECTION grammar (the '.'-separated project-relative path built by
/// <c>TcObjectModel.PouSelectionPath</c>) has not been exercised beyond the shapes those fixtures
/// cover. (Import semantics are settled — see <see cref="ImportXmlString"/>.)
/// </summary>
internal static class TcPlcOpen
{
    private const int PLCIMPORTOPTIONS_NONE = 0;

    /// <summary>Serialize <paramref name="selection"/> (PLC-project-relative item path(s),
    /// ';'-separated) to a PLCopenXML string; returns the document text. (File-based internally.)</summary>
    public static string ExportXmlString(dynamic plcProject, string selection)
    {
        var tmp = Temp();
        try
        {
            plcProject.PlcOpenExport(tmp, selection);
            return File.ReadAllText(tmp);
        }
        finally { TryDelete(tmp); }
    }

    /// <summary>Import a PLCopenXML string into the project. TwinCAT ADDS; it does NOT replace in place, and a
    /// name collision FAILS — so a caller replacing an item must delete the existing one first (see
    /// <c>BeckhoffDriver.WriteXml</c> → <c>Volt.Engine.Ide.PlcOpenTransport.ReplaceByReimport</c>, which owns
    /// that capture/delete/restore policy once). (File-based internally.)</summary>
    public static void ImportXmlString(dynamic plcProject, string xml)
    {
        var tmp = Temp();
        try
        {
            File.WriteAllText(tmp, xml);
            plcProject.PlcOpenImport(tmp, PLCIMPORTOPTIONS_NONE);
        }
        finally { TryDelete(tmp); }
    }

    private static string Temp() =>
        Path.Combine(Path.GetTempPath(), "volt_plcopen_" + Guid.NewGuid().ToString("N") + ".xml");

    private static void TryDelete(string path) { try { File.Delete(path); } catch { /* best effort */ } }
}
