using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Volt.Contracts;
using Volt.Engine.Library;
using Volt.Engine.Format.Body;

namespace Volt.Ide.Codesys
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
                    // THE IDENTITY IS ON THE MESSAGE, not in its prose. `IMessage` carries `ObjectGuid` (the
                    // object the diagnostic is about) and `IMessage4.Number` (the C-number, e.g. 32 for C0032);
                    // this used to read neither, and scraped `Line `/`Column ` out of `Text` instead. CODESYS
                    // does not put a position in the text: EVERY diagnostic in the recorded conformance corpus
                    // (packages/volt-lsp-iec/test/conformance/recordings/codesys.build.json) carries `line: 0`,
                    // while the TwinCAT recording of the same corpus carries real lines. So the client got a
                    // diagnostic anchored to nothing and could not place it in a file, let alone on a line.
                    //
                    // Members measured against the shipped assembly, not assumed — MessageStorage.dll,
                    // `_3S.CoDeSys.Core.Messages.IMessage` {ProjectHandle, ObjectGuid, Position, PositionOffset,
                    // Length, Text, Severity} and `IMessage4` {Icon, Number, Prefix}, CODESYS 3.5.21.40.
                    // `Position`/`PositionOffset` are deliberately NOT read here: their units are undocumented
                    // and unmeasured, and a wrong line number is worse than none. The guid alone lets a client
                    // open the right file, which is the gap that mattered.
                    var guid = GetMember(m, "ObjectGuid") is Guid g && g != Guid.Empty ? g : (Guid?)null;
                    outv.Add(new Dictionary<string, object?>
                    {
                        ["severity"] = Volt.Contracts.Severity.Of(GetMember(m, "Severity")?.ToString()),
                        ["message"] = text,
                        ["line"] = ParseLine(text),
                        ["column"] = ParseColumn(text),
                        ["objectGuid"] = guid,
                        ["code"] = MessageCode(m),
                    });
                }
            }
            return outv;
        }

        /// <summary>The vendor's own diagnostic number, rendered the way the IDE renders it (`C0032`).
        ///
        /// <para>`IMessage4.Number` is a nullable int and `Prefix` is the letter; a message with no number (a
        /// plain informational line) returns null rather than a fabricated code. Only `IMessage4` has these, so
        /// an older CODESYS that implements just `IMessage` answers null through the same reflective miss —
        /// which is why this reads the member rather than casting to the interface.</para></summary>
        private static string? MessageCode(object m)
        {
            if (GetMember(m, "Number") is not { } raw) return null;
            // Nullable<int> boxes as either null or the bare int, so a non-null box IS the value.
            if (raw is not int n) return null;
            var prefix = GetMember(m, "Prefix") as string;
            return string.IsNullOrEmpty(prefix) ? n.ToString() : $"{prefix}{n:0000}";
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
