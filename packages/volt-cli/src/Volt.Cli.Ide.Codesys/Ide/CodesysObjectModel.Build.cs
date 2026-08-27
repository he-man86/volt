using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Volt.Contracts;
using Volt.Engine.Library;
using Volt.Engine.Source.Body;

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
            // "I could not READ the diagnostics" must never read as "there were NONE". Build() above derives
            // success from this list — no error-severity message means success — so an empty list from an
            // unreachable MessageStorage reported a project that does not compile as building CLEANLY. A
            // reflective miss here is the likeliest symptom of a CODESYS version change, which is exactly when a
            // silent pass is most dangerous. So the failure to read becomes an ERROR diagnostic: visible in the
            // build output, and enough on its own to make Build() answer false.
            if (store == null) return Unreadable("CODESYS MessageStorage is unreachable");
            // GetMessages takes an IMessageCategory; enumerate all categories.
            if (GetMember(store, "Categories") is not IEnumerable categories)
                return Unreadable("CODESYS MessageStorage exposes no Categories");
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

        /// <summary>A single error-severity diagnostic standing in for a diagnostic list that could not be read.
        /// Never an empty list: empty means "the build was clean", and that is the one thing this does not know.</summary>
        private static List<object> Unreadable(string why) => new List<object>
        {
            new Dictionary<string, object?>
            {
                ["severity"] = Volt.Contracts.Severity.Error,
                ["message"] = $"volt could not read the build diagnostics ({why}) — the build result is UNKNOWN, " +
                              "not clean. Check the IDE's own message view.",
                ["line"] = 0,
                ["column"] = 0,
            },
        };
    }
}
