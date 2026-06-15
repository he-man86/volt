using System;
using System.IO;

namespace VoltBridge.Beckhoff
{
    /// <summary>
    /// TwinCAT's PLCopenXML transport — <c>ITcPlcIECProject.PlcOpenExport</c> /
    /// <c>PlcOpenImport</c> on the PLC-project tree node. These are FILE-based, so we round-trip
    /// through a temp file. This is the TwinCAT analogue of CODESYS's object-model
    /// ExportXml/ImportXml; both feed the same shared <c>PlcOpenReader</c>/<c>PlcOpenWriter</c> path.
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

        /// <summary>Export <paramref name="selection"/> (PLC-project-relative item path(s),
        /// ';'-separated) to PLCopenXML; returns the document text.</summary>
        public static string Export(dynamic plcProject, string selection)
        {
            var tmp = Temp();
            try
            {
                plcProject.PlcOpenExport(tmp, selection);
                return File.ReadAllText(tmp);
            }
            finally { TryDelete(tmp); }
        }

        /// <summary>Import a PLCopenXML document into the project (same-named items replaced).</summary>
        public static void Import(dynamic plcProject, string xml)
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
