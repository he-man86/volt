using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Volt.Wire;
using Volt.Contracts;
using Volt.Engine.Library;
using Volt.Engine.Manifest;
using Volt.Engine.Model;
using Volt.Engine.Vocabulary;

namespace Volt.Cli.Ide.Codesys
{
    internal sealed partial class CodesysObjectModel
    {
        // ── build / diagnostics ─────────────────────────────────────────────
        private static readonly Guid BuildActiveApplication = new Guid("A0DA4287-64ED-459e-81F0-98AB3667A58F");

        /// <summary>Compile the application by executing the IDE's "build active
        /// application" command (same as the scripting <c>app.build()</c>), then
        /// report success from the diagnostics (no error-severity messages).</summary>
        public bool Build(object applicationNode)
        {
            var cmdMgr = GetStaticMember("_3S.CoDeSys.ScriptDriverProjects.Common", "CommandManager")
                         ?? throw new InvalidOperationException("CODESYS CommandManager unavailable");
            var appGuid = GuidOf(applicationNode);
            InvokeMethod(cmdMgr, "ExecuteCommand", BuildActiveApplication,
                new[] { "--applicationGuid=" + appGuid.ToString() });
            foreach (var d in GetBuildDiagnostics())
                if (d is Dictionary<string, object?> dict && (dict["severity"] as string) == Volt.Contracts.Severity.Error) return false;
            return true;
        }

        public List<object> GetBuildDiagnostics()
        {
            var outv = new List<object>();
            var store = GetStaticMember("_3S.CoDeSys.ScriptDriverSystem.APEnvironment", "MessageStorage");
            if (store == null) return outv;
            // GetMessages takes an IMessageCategory; enumerate all categories.
            if (GetMember(store, "Categories") is not IEnumerable categories) return outv;
            foreach (var cat in categories)
            {
                if (InvokeMethod(store, "GetMessages", cat) is not IEnumerable msgs) continue;
                foreach (var m in msgs)
                {
                    var text = GetMember(m, "Text") as string ?? "";
                    outv.Add(new Dictionary<string, object?>
                    {
                        ["severity"] = Volt.Contracts.Severity.Of(GetMember(m, "Severity")?.ToString()),
                        ["message"] = text,
                        ["line"] = ParseLine(text),
                        ["column"] = ParseColumn(text),
                    });
                }
            }
            return outv;
        }
    }
}
