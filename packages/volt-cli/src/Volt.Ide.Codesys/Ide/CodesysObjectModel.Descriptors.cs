using System;
using System.Collections;
using System.Globalization;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Volt.Contracts;
using Volt.Engine.Library;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Settings;
using Volt.Engine.Format.St;
using Volt.Engine.Format.Task;

namespace Volt.Ide.Codesys
{
    internal sealed partial class CodesysObjectModel
    {
        // ── device descriptor ───────────────────────────────────────────────
        /// <summary>The vendor-neutral device descriptor for a device-tree instance — the same fields CODESYS
        /// shows on a device's Information tab (Name/Vendor/Type/ID/Version/Order number/Description), read from
        /// the device-repository <c>DeviceInfo</c> + <c>get_device_identification</c>. No build needed. This is
        /// the read-only <c>.device</c> file body (the extension identifies the kind — no marker needed); the LSP
        /// registers the instance NAME (the filename) as a known global so source references resolve, without
        /// pretending to know the device's internal members.</summary>
        public string DeviceDescriptor(object node)
        {
            var dev = Facet(node, "ScriptDeviceObject");
            var info = GetMember(InvokeMethod(dev, "GetReadable"), "DeviceInfo");
            var devId = InvokeMethod(dev, "get_device_identification");
            // THE NAMED VENDOR MEMBER, one per line (openspec bridge-one-to-one §1.1 "Non-source items"; gate review of step
            // 3, finding 10): the identification is the scripting `IDeviceId` — `type`, `id`, `version` (SP21, ScriptEngine3
            // 4.2.0.0) — and the device info `DeviceInfo`'s `Name` / `Vendor` / `OrderNumber` / `Description`. Each line
            // is asked under its ONE name, never a first-that-answers list. A member the object does not
            // declare is refused by name; one it holds empty is an empty value.
            string Field(object? o, string name)
            {
                if (o is null || !Declares(o.GetType(), name))
                    throw new Volt.Engine.BridgeException(BridgeErrorCodes.Unsupported,
                        $"CODESYS: the device '{GetName(node)}' answers no '{name}' on its {(o is null ? "(missing) object" : o.GetType().Name)} " +
                        "— Volt reads the named vendor member rather than another or none, so the descriptor is not read.");
                return Descriptor.Flatten(System.Convert.ToString(GetMember(o, name), CultureInfo.InvariantCulture));
            }
            static bool Declares(Type t, string name) =>
                t.GetProperty(name, BF) is not null || Array.Exists(t.GetInterfaces(), i => i.GetProperty(name) is not null);
            // The device OBJECT's own flags (`IDeviceObject.Disable` / `Exclude`; census §0.1 finding 11: Disable true on 2
            // of 159, Exclude on 0) — a disabled device read like an enabled one (openspec bridge-one-to-one §1.1
            // "Non-source items"). Spelled only where true, the absence being the measured value.
            var device = ReadObject(node);
            bool Flag(string member) => NwlInterop.Declared(device, member) is bool b
                ? b : throw new Volt.Engine.BridgeException(BridgeErrorCodes.Unsupported,
                    $"CODESYS: the device answers no {member} — refused rather than read as false");
            return new Descriptor(14)
                .Add("Name", Field(info, "Name"))
                .Add("Vendor", Field(info, "Vendor"))
                .Add("Type", Field(devId, "type"))
                .Add("ID", Field(devId, "id"))
                .Add("Version", Field(devId, "version"))
                .Add("Order number", Field(info, "OrderNumber"))
                .Add("Description", Field(info, "Description"))
                .Add("Disabled", Flag("Disable") ? "true" : null)
                .Add("Excluded", Flag("Exclude") ? "true" : null)
                .ToString();
        }

        /// <summary>The read-only descriptor for the project's "Project Information" node — the standard
        /// <c>IProjectInfoObject</c> metadata (Title/Version/Company/Author/Namespace/Description) CODESYS shows
        /// in Project → Project Information, read from its <c>ScriptProjectInfo</c> facet. The <c>.projectinfo</c>
        /// file body; not referenced by source, so the LSP just carries it as project context.</summary>
        public string ProjectInfoDescriptor(object node) => FacetDescriptor(node, "ScriptProjectInfo",
            ("Title", "title"), ("Version", "version"), ("Company", "company"), ("Author", "author"),
            ("Default namespace", "default_namespace"), ("Released", "released"), ("Description", "description"));

        // ── project settings (compiler warnings + compile options) ──────────
        /// <summary>The project's COMPILER SETTINGS as a read-only <c>.projectsettings</c> descriptor — the
        /// three-state compiler-warning configuration (off / warning / error) and the compile options, i.e.
        /// CODESYS's Project Settings dialog.
        ///
        /// <para>Unlike every other descriptor here, this one does NOT read its node: the scripting api exposes
        /// nothing for Project Settings (<c>get_project_settings()</c> is null, <c>IScriptProjectSettings</c>
        /// carries only <c>available_download_content</c>/<c>project_defines</c>) — which is why this node was a
        /// known-skip. The settings live in the language model instead:</para>
        /// <code>
        /// APEnvironment.LMServiceProvider -> ConfigurationService -> WarningConfiguration / CompileOptions
        /// </code>
        /// <para>The APEnvironment host is deliberately <c>_3S.CoDeSys.Engine</c>: every plugin has one and they
        /// all return the SAME provider singleton, but <c>Compiler35210</c> and friends are SP-pinned and would
        /// break on a CODESYS upgrade. Verified live on SP21 (3.5.21.40).</para>
        ///
        /// <para><b>That singleton is a session service over PER-PROJECT state, and the read is sound</b>
        /// (DIALECT C24, <c>git show b2496efb4b:packages/volt-cli/scripts/probe-projectsettings-scope.py</c>). The standing doubt was whether one
        /// project's descriptor reports what the previously-opened project left behind — a real hazard, because
        /// the service is not a property of the node being described. Measured as a SWITCH rather than a single
        /// read, on a pair disagreeing in two fields: open A → <c>C0371</c>/UTF-8 off, close, open B →
        /// none/UTF-8 ON, open A again → <c>C0371</c>/UTF-8 off. Both track the load, both directions, while the
        /// service object stays one instance throughout.</para>
        ///
        /// <para>With NO project open it answers null and defaults — which is what the headless miss that
        /// opened `project-settings-sync` actually was, an ordering artifact rather than a scope bug. It cannot
        /// reach a pull: <c>volt init</c> refuses on "the bridge has no PLC project loaded" before any
        /// descriptor is built.</para>
        ///
        /// <para>Only the DEVIATIONS from default are emitted. CODESYS's <c>WarningsSet</c> is the dialog's ~75
        /// ROWS, not "the ones that are on" — every row defaults to warning — so listing all of them would churn
        /// the file on any version that adds an id, while telling a reader nothing. Absent from both lists means
        /// warning, which is what the LSP already defaults to.</para></summary>
        public string ProjectSettingsDescriptor(object node)
        {
            var provider = GetStaticMember("_3S.CoDeSys.Engine.APEnvironment", "LMServiceProvider")
                // Absent on SP18 (3.5.18.30, measured 2026-10-10): that version does not expose the settings to Volt.
                ?? throw new InvalidOperationException(
                    "CODESYS: this CODESYS version cannot give Volt its Project Settings (compiler warnings, compile " +
                    "options) — APEnvironment.LMServiceProvider is not there. Volt reads them on CODESYS V3.5 SP21 or " +
                    "later; until then the LSP uses the default warning set.");
            var config = GetMember(provider, "ConfigurationService")
                ?? throw new InvalidOperationException("CODESYS: ILMServiceProvider.ConfigurationService unavailable");
            return ProjectSettingsFormat.Write(ReadProjectSettings(
                GetMember(config, "WarningConfiguration"), GetMember(config, "CompileOptions")));
        }

        /// <summary>The settings, as data, from the language model's two objects — the vendor half; the FILE LAYOUT
        /// is the engine's (<see cref="ProjectSettingsFormat"/>), shared with the TwinCAT driver so the rows both
        /// vendors carry are byte-identical (openspec <c>twincat-project-settings</c>). Split from the static walk
        /// above so it runs offline against doubles of the two objects (<c>ProjectSettingsParityTests</c>).
        /// CODESYS sources all eight rows.</summary>
        internal static ProjectSettings ReadProjectSettings(object? warnings, object? options) => new ProjectSettings(
            DisabledWarnings: Ids(warnings, "GetDisabledWarningIds"),
            WarningsAsErrors: Ids(warnings, "GetWarningAsErrorIds"),
            ReplaceConstants: GetMember(options, "ReplaceConstants") as bool?,
            UnicodeIdentifiers: GetMember(options, "UnicodeIdentifiers") as bool?,
            Utf8Encoding: GetMember(options, "UTF8Encoding") as bool?,
            MaxCompilerWarnings: System.Convert.ToString(GetMember(options, "MaxCompilerWarnings"), CultureInfo.InvariantCulture),
            BreakpointLogging: GetMember(options, "EnableBreakpointLogging") as bool?,
            ProjectDefines: System.Convert.ToString(GetMember(options, "ProjectDefines"), CultureInfo.InvariantCulture));

        /// <summary>One warning-id set as the vendor's integers. The ids come back as BARE INTEGERS (371, not C0371)
        /// and the collection is <c>null</c> — not empty — when nothing is configured, which is the vendor's
        /// representation of "none", not a missing value to guard against.</summary>
        private static List<int>? Ids(object? warnings, string getter)
        {
            if (InvokeMethod(warnings, getter) is not IEnumerable ids) return null;
            var codes = new List<int>();
            foreach (var id in ids)
            {
                if (id == null) continue;
                if (int.TryParse(System.Convert.ToString(id, CultureInfo.InvariantCulture), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n)) codes.Add(n);
            }
            return codes;
        }

        /// <summary>A trace/recording configuration (`.trace`): which task/trigger/resolution records what.
        /// Read from the `ScriptTraceObject` facet. The per-diagram traced-variable expressions are not exposed
        /// as scripting properties, so this captures the recording config (the reproducible part).</summary>
        public string TraceDescriptor(object node) => FacetDescriptor(node, "ScriptTraceObject",
            ("Task", "task_name"), ("Record", "record_name"), ("Resolution", "resolution"),
            ("Post-trigger samples", "post_trigger_samples"), ("Every N cycles", "every_n_cycles"),
            ("Auto start", "auto_start"), ("Trigger enabled", "trigger_enabled"),
            ("Trigger variable", "trigger_variable"), ("Comment", "comment"));

        /// <summary>The read-only descriptor for a task (`.task`): its scheduling — task type, cycle interval,
        /// priority, watchdog, and the POUs it calls each cycle. Read from the `ScriptTaskObject` facet (whose
        /// `watchdog` is a nested object and `pous` yields the called-POU names). The `.task` file body; not
        /// referenced by source, so the LSP carries it as project context ("PLC_PRG runs on MainTask @ t#20ms").</summary>
        public string TaskDescriptor(object node) => TaskDescriptorFormat.Write(ReadTask(node));

        /// <summary>The symbol-configuration flags (`.symbols`): which access features a project exposes
        /// (OPC UA, direct I/O, attribute filter). The resolved exposed-symbol LIST is compiled-model state,
        /// not in the scripting facet — this captures the configuration.</summary>
        public string SymbolConfigDescriptor(object node) => FacetDescriptor(node, "ScriptSymbolConfigObject",
            ("Features", "content_feature_flags"), ("Direct I/O access", "enable_direct_io_access"),
            ("Attribute filter", "symbol_attribute_filter_type"));

        /// <summary>A recipe definition (`.recipe`): the list of PLC variables the recipe reads/writes, each as
        /// `variable : type (recipe column name)`. Read from the `ScriptRecipeDefinitionObject` facet.</summary>
        public string RecipeDescriptor(object node)
        {
            var f = Facet(node, "ScriptRecipeDefinitionObject");
            var sb = new System.Text.StringBuilder();
            if (GetMember(f, "variables") is IEnumerable vars)
                foreach (var v in vars)
                {
                    if (v == null) continue;
                    var name = System.Convert.ToString(GetMember(v, "variablename"), CultureInfo.InvariantCulture)?.Trim() ?? "";
                    if (name.Length == 0) continue;
                    var type = System.Convert.ToString(GetMember(v, "type"), CultureInfo.InvariantCulture)?.Trim() ?? "";
                    var col = System.Convert.ToString(GetMember(v, "name"), CultureInfo.InvariantCulture)?.Trim() ?? "";
                    sb.Append(name);
                    if (type.Length > 0) sb.Append(" : ").Append(type);
                    if (col.Length > 0) sb.Append("  (").Append(col).Append(')');
                    sb.Append('\n');
                }
            return sb.ToString();
        }

        /// <summary>Render a node's read-only descriptor from ONE scripting facet's scalar properties as
        /// aligned `Label: value` lines (empty values omitted). Shared by the project-info / trace / symbol
        /// descriptors; device (two facets), task (nested watchdog + POU list) and recipe (variable list)
        /// render bespoke because their fields are not flat scalars.</summary>
        private string FacetDescriptor(object node, string facetName, params (string Label, string Prop)[] fields)
        {
            var f = Facet(node, facetName);
            var d = new Descriptor();     // auto width: the widest DECLARED label + 2, blank fields included
            foreach (var fld in fields) d.Add(fld.Label, System.Convert.ToString(GetMember(f, fld.Prop), CultureInfo.InvariantCulture));
            return d.ToString();
        }

        /// <summary>The vendor's <c>KindOfTask</c> for a `.task` file's <c>Type:</c> line.
        ///
        /// <para><b>The type is written like every other scheduling field</b>: unwritten, a task pushed into a
        /// project that did not already have it keeps the vendor's default (<c>Freewheeling</c> where the file says
        /// <c>Cyclic</c> — a task running flat out instead of on a 10 ms cycle). Found by
        /// `scripts/corpus-migration.ts`.</para>
        ///
        /// <para>MEASURED (`git show b2496efb4b:packages/volt-cli/scripts/probe-task-kind.py`, live SP21): the member IS writable, and takes ONLY a
        /// real <c>_3S.CoDeSys.TaskConfig.KindOfTask</c>. A string raises `TypeError: expected KindOfTask, got
        /// str` and an int raises `Cannot convert numeric value 1 to KindOfTask` — the exact inverse of
        /// <c>priority</c>'s trap two lines up, and the reason both are written down rather than inferred. The
        /// legal names come from the enum itself: Cyclic, Freewheeling, Event, ExternalEvent, Status,
        /// ParentSynchron — which is also the vocabulary the READ side renders, so the file's `Type:` line and
        /// this lookup cannot drift.</para>
        ///
        /// <para><b>A type the enum does not NAME is the request's fault</b> — BAD_REQUEST, as <c>TcTaskSchedule</c>
        /// answers a malformed descriptor (openspec bridge-refusal-review 2.25) — never INTERNAL_ERROR, a Volt bug, for a
        /// typo in a `.task` file. And the lookup is by NAME only: <c>Enum.Parse</c> also takes a number, so
        /// <c>Type: 99</c> would be an undefined <c>KindOfTask</c> written into the task.</para></summary>
        internal static object TaskKind(string type)
        {
            var kinds = Reflection.FindEnum("KindOfTask")
                ?? throw new InvalidOperationException("CODESYS enum KindOfTask not found");
            var names = Enum.GetNames(kinds);
            if (Array.IndexOf(names, type) < 0)
                throw new Volt.Engine.BridgeException(BridgeErrorCodes.BadRequest,
                    $"CODESYS: '{type}' is not a task type. A `.task` file's `Type:` line must name one of " +
                    string.Join(", ", names) + ".");
            return Enum.Parse(kinds, type);
        }

        /// <summary>A named scripting facet of a node — device / project-info APIs live on the Extender's DLR
        /// extension list, not the base ScriptObject. Throws if the facet is absent (fail loud, no fallback).</summary>
        private object Facet(object node, string facetTypeName)
        {
            var ext = GetMember(Unwrap(node), "Extender");
            if (GetMember(ext, "Extensions") is IEnumerable facets)
                foreach (var f in facets)
                    if (f != null && f.GetType().Name == facetTypeName) return f;
            throw new InvalidOperationException($"node has no {facetTypeName} facet");
        }
    }
}
