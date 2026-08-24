using System;
using System.IO;

namespace Volt.Cli.Ide.Twincat;

/// <summary>
/// TwinCAT's PLCopenXML transport — <c>ITcPlcIECProject.PlcOpenExport</c> /
/// <c>PlcOpenImport</c> on the PLC-project tree node. The interface is XML string in/out
/// (<c>ExportXmlString</c>/<c>ImportXmlString</c>, the TwinCAT analogue of CODESYS's object-model
/// methods of the same name), but TwinCAT's API is FILE-based, so internally we round-trip through
/// a temp file (CODESYS's is in-memory). Both feed the same shared
/// <c>GraphReader</c>/<c>GraphWriter</c> path.
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
    // Measured live, DIALECT D4c — the options argument was hardcoded to NONE and never varied, which is what
    // made "TwinCAT cannot replace in place" look like a vendor limit for so long:
    //   0 (NONE)    -> FAILS on a name collision ("Import conflict!")
    //   1 (REPLACE) -> replaces IN PLACE: item count unchanged, no delete, and the content really lands
    //   2 / 4 / 8   -> each ADDS a copy
    private const int PLCIMPORTOPTIONS_NONE = 0;
    private const int PLCIMPORTOPTIONS_REPLACE = 1;

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

    /// <summary>Import a PLCopenXML string into the project, REPLACING a same-named item in place.
    /// <para>This used to pass <c>NONE</c> and say "TwinCAT ADDS; it does NOT replace in place, and a name
    /// collision FAILS — so a caller replacing an item must delete the existing one first". The first half was
    /// true only of <c>NONE</c>. The options argument had simply never been varied: under <c>REPLACE</c> the
    /// item is replaced with no delete, no duplicate, and the content genuinely lands (DIALECT D4c, measured
    /// live). The delete is what relocated a foldered POU to the PLC-project root — the "unrecoverable
    /// placement" of D4b — so removing it removes that failure, exactly as it did on CODESYS.</para>
    /// (File-based internally.)</summary>
    public static void ImportXmlString(dynamic plcProject, string xml)
    {
        var tmp = Temp();
        try
        {
            File.WriteAllText(tmp, xml);
            plcProject.PlcOpenImport(tmp, PLCIMPORTOPTIONS_REPLACE);
        }
        finally { TryDelete(tmp); }
    }

    private static string Temp() =>
        Path.Combine(Path.GetTempPath(), "volt_plcopen_" + Guid.NewGuid().ToString("N") + ".xml");

    private static void TryDelete(string path) { try { File.Delete(path); } catch { /* best effort */ } }
}
