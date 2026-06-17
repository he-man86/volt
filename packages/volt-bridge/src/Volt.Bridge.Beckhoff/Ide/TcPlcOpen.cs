using System;
using System.IO;

namespace Volt.Bridge.Beckhoff
{
    /// <summary>
    /// TwinCAT's PLCopenXML transport — <c>ITcPlcIECProject.PlcOpenExport</c> /
    /// <c>PlcOpenImport</c> on the PLC-project tree node. The interface is XML string in/out
    /// (<c>ExportXmlString</c>/<c>ImportXmlString</c>, the TwinCAT analogue of CODESYS's object-model
    /// methods of the same name), but TwinCAT's API is FILE-based, so internally we round-trip through
    /// a temp file (CODESYS's is in-memory). Both feed the same shared
    /// <c>PlcOpenReader</c>/<c>PlcOpenWriter</c> path.
    ///
    /// NEEDS LIVE VERIFICATION (cannot be exercised without a running, rebuilt bridge):
    ///   1. The methods live on ITcPlcIECProject — a NON-default COM interface. They are invoked
    ///      here by late-bound dispatch on the dynamic RCW. If the IDE's default IDispatch doesn't
    ///      surface them, a typed interop cast (TCatSysManagerLib) will be required instead.
    ///   2. The export SELECTION grammar and import REPLACE/conflict semantics must be confirmed
    ///      against a live project before the write path can be trusted.
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

        /// <summary>Import a PLCopenXML string into the project (same-named items replaced).
        /// (File-based internally.)</summary>
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
}
