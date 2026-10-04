using System;
using System.Collections;
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
            // First name that yields anything wins — the identification object spells these differently across
            // versions, which is why each is asked for under several names.
            string Field(object? o, params string[] names)
            {
                foreach (var n in names)
                {
                    var v = Descriptor.Flatten(System.Convert.ToString(GetMember(o, n)));
                    if (v.Length > 0) return v;
                }
                return "";
            }
            return new Descriptor(14)
                .Add("Name", Field(info, "Name"))
                .Add("Vendor", Field(info, "Vendor"))
                .Add("Type", Field(devId, "Type", "TypeId", "type"))
                .Add("ID", Field(devId, "Id", "Identification", "id"))
                .Add("Version", Field(devId, "Version", "version"))
                .Add("Order number", Field(info, "OrderNumber"))
                .Add("Description", Field(info, "Description"))
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
        /// (DIALECT C24, <c>probe-projectsettings-scope.py</c> (deleted; <c>git show b2496efb4b:packages/volt-cli/scripts/probe-projectsettings-scope.py</c>)). The standing doubt was whether one
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
                ?? throw new InvalidOperationException("CODESYS: APEnvironment.LMServiceProvider unavailable");
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
            MaxCompilerWarnings: System.Convert.ToString(GetMember(options, "MaxCompilerWarnings")),
            BreakpointLogging: GetMember(options, "EnableBreakpointLogging") as bool?,
            ProjectDefines: System.Convert.ToString(GetMember(options, "ProjectDefines")));

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
                if (int.TryParse(System.Convert.ToString(id), out var n)) codes.Add(n);
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

        /// <summary>A task's settings, as data. The vendor half — which facet, which member name — is
        /// irreducible and lives here; the FILE LAYOUT is the engine's
        /// (<see cref="TaskDescriptorFormat"/>), which is what lets the read and the write share one
        /// definition instead of two that agree by inspection.
        ///
        /// <para>An event task carries its trigger in one of two members and the vendor uses whichever suits
        /// the task kind, so both are read and the first non-empty wins.</para>
        ///
        /// <para>A DISABLED watchdog is reported as ABSENT rather than as its numbers: the vendor keeps stale
        /// values behind the flag, and rendering them would show a watchdog that does not run — then write
        /// them back on the next push as if it did.</para></summary>
        private TaskSettings ReadTask(object node)
        {
            var f = Facet(node, "ScriptTaskObject");
            var ev = System.Convert.ToString(GetMember(f, "event"));
            if (string.IsNullOrWhiteSpace(ev)) ev = System.Convert.ToString(GetMember(f, "external_event"));

            TaskWatchdog? watchdog = null;
            if (GetMember(f, "watchdog") is { } wd && GetMember(wd, "enabled") is bool on && on)
                watchdog = new TaskWatchdog(
                    Str(GetMember(wd, "time")), Str(GetMember(wd, "time_unit")), Str(GetMember(wd, "sensitivity")));

            var calls = new List<string>();
            if (GetMember(f, "pous") is IEnumerable pous)
                foreach (var p in pous)
                {
                    var n = System.Convert.ToString(p)?.Trim();
                    if (!string.IsNullOrEmpty(n)) calls.Add(n!);
                }

            return new TaskSettings(
                Str(GetMember(f, "kind_of_task")),
                Str(GetMember(f, "interval")),
                Str(GetMember(f, "interval_unit")),
                Str(GetMember(f, "priority")),
                string.IsNullOrWhiteSpace(ev) ? null : ev!.Trim(),
                watchdog,
                calls);
        }

        private static string Str(object? o) => System.Convert.ToString(o)?.Trim() ?? "";
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
                    var name = System.Convert.ToString(GetMember(v, "variablename"))?.Trim() ?? "";
                    if (name.Length == 0) continue;
                    var type = System.Convert.ToString(GetMember(v, "type"))?.Trim() ?? "";
                    var col = System.Convert.ToString(GetMember(v, "name"))?.Trim() ?? "";
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
            foreach (var fld in fields) d.Add(fld.Label, System.Convert.ToString(GetMember(f, fld.Prop)));
            return d.ToString();
        }

        /// <summary>A named scripting facet of a node — device / project-info APIs live on the Extender's DLR
        /// extension list, not the base ScriptObject. Throws if the facet is absent (fail loud, no fallback).</summary>
        /// <summary>Apply a task's settings to the vendor — the mirror of <see cref="TaskDescriptor"/>,
        /// member for member, so the pair cannot drift.
        ///
        /// <para>Every field written here is a real setter, MEASURED rather than assumed
        /// (`probe-task-writable.py` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/probe-task-writable.py`) and `probe-task-kind.py` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/probe-task-kind.py`), live SP21). Three carry a trap worth
        /// naming: <c>kind_of_task</c> takes ONLY the vendor enum (see <see cref="TaskKind"/>), <c>priority</c>
        /// is a STRING even though it reads as a number — handing it an int raises `TypeError: expected str, got
        /// int`, which looks exactly like a read-only property and is not — and <c>interval</c> /
        /// <c>interval_unit</c> are separate, so a TIME literal (`t#4ms`) carries no unit and writing one back
        /// would double it. The engine's format keeps the two apart for that reason.</para>
        ///
        /// <para>The CALL LIST is REBUILT rather than diffed. `ScriptPouObjectList` offers add/insert/remove/
        /// replace, and a positional diff would have to preserve per-entry comments Volt does not carry in the
        /// descriptor; rebuilding keeps the file the single source of truth for what runs and in what ORDER,
        /// which is the whole of what the `Calls:` line encodes.</para></summary>
        public void WriteTask(object node, TaskSettings t)
        {
            var f = Facet(node, "ScriptTaskObject");
            SetMember(f, "kind_of_task", TaskKind(t.Type));
            SetMember(f, "priority", t.Priority);
            SetMember(f, "interval", t.Interval);
            if (t.IntervalUnit.Length > 0) SetMember(f, "interval_unit", t.IntervalUnit);
            SetMember(f, "event", t.Event ?? "");

            // A disabled watchdog keeps stale numbers behind the flag, so the values are written only when it
            // is ON — writing them for an `off` watchdog would resurrect numbers the file does not show.
            if (GetMember(f, "watchdog") is { } wd)
            {
                SetMember(wd, "enabled", t.Watchdog != null);
                if (t.Watchdog is { } w)
                {
                    SetMember(wd, "time", w.Time);
                    if (w.Unit.Length > 0) SetMember(wd, "time_unit", w.Unit);
                    SetMember(wd, "sensitivity", w.Sensitivity);
                }
            }

            if (GetMember(f, "pous") is { } pous) WriteCallList(f, pous, t.Calls);
        }


        /// <summary>The vendor's <c>KindOfTask</c> for a `.task` file's <c>Type:</c> line.
        ///
        /// <para><b>The type was the one scheduling field WriteTask did not write.</b> Every other member was
        /// set and this one was not, so a task pushed into a project that did not already have it kept the
        /// vendor's default: `EdgePcTask` migrated out of pro2193 as <c>Freewheeling</c> where the file said
        /// <c>Cyclic</c> — a task running flat out instead of on a 10 ms cycle, reported by the push as success.
        /// Found by `scripts/corpus-migration.ts`.</para>
        ///
        /// <para>MEASURED (`probe-task-kind.py` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/probe-task-kind.py`), live SP21): the member IS writable, and takes ONLY a
        /// real <c>_3S.CoDeSys.TaskConfig.KindOfTask</c>. A string raises `TypeError: expected KindOfTask, got
        /// str` and an int raises `Cannot convert numeric value 1 to KindOfTask` — the exact inverse of
        /// <c>priority</c>'s trap two lines up, and the reason both are written down rather than inferred. The
        /// legal names come from the enum itself: Cyclic, Freewheeling, Event, ExternalEvent, Status,
        /// ParentSynchron — which is also the vocabulary the READ side renders, so the file's `Type:` line and
        /// this lookup cannot drift.</para>
        ///
        /// <para><b>A type the enum does not NAME is the request's fault</b> — BAD_REQUEST, as <c>TcTaskSchedule</c>
        /// answers a malformed descriptor (openspec bridge-refusal-review 2.25). It was an InvalidOperationException,
        /// which the push reports as INTERNAL_ERROR, a Volt bug, for a typo in a `.task` file. And the lookup is by NAME
        /// only: <c>Enum.Parse</c> also takes a number, so <c>Type: 99</c> became an undefined <c>KindOfTask</c> written
        /// into the task.</para></summary>
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

        /// <summary>Replace a task's call list with exactly the POUs named, in order.
        ///
        /// <para><b>The list `pous` hands out is a VIEW, and mutating it is not an error — it is a NO-OP.</b>
        /// Measured on live SP21 (`probe-task-calllist.py` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/probe-task-calllist.py`)): `remove(name)` returns happily and the
        /// list is unchanged afterwards, `remove(index)` throws "Cannot remove the specified item because it
        /// was not found in the specified Collection" (it is remove-by-VALUE, not by position), and `add` DOES
        /// take. A rebuild written against that surface drains nothing and appends forever — the probe that
        /// found this hung doing exactly that.</para>
        ///
        /// <para>The mutation therefore goes through <c>PerformWithWriteableCopy</c>, which is the vendor
        /// saying so out loud. Two things about it are not guessable and were measured: it takes an
        /// <c>Action&lt;T&gt;</c> whose T is a vendor type not referenced at compile time (so the callback is
        /// built as an expression tree, the one place reflection alone cannot express the call), and the object
        /// it hands back is the RAW <c>_3S.CoDeSys.TaskObject.PouObjectList</c> — NOT the
        /// <c>ScriptPouObjectList</c> wrapper, so none of that wrapper's `add`/`remove`/`__len__` exists on it.
        /// It is an ordinary <see cref="System.Collections.IList"/> of vendor POU objects, and a new entry is
        /// minted by the task facet's own <c>CreatePouObject(name)</c>.</para>
        ///
        /// <para>Rebuilding rather than diffing is deliberate: an entry carries a per-entry COMMENT the
        /// descriptor does not, so a positional diff would have to preserve something Volt cannot see. The
        /// `Calls:` line means "these POUs, in this order", and that is exactly what gets written.</para></summary>
        private static void WriteCallList(object taskFacet, object pous,
                                          System.Collections.Generic.IReadOnlyList<string> calls)
        {
            // Every refusal of the rebuild (here and in RebuildCallList) is UNSUPPORTED: the IDE did not take the write. They
            // were uncoded InvalidOperationExceptions, INTERNAL_ERROR on the wire (openspec bridge-refusal-review V.1).
            var perform = pous.GetType().GetMethod("PerformWithWriteableCopy", BF)
                ?? throw new Volt.Engine.BridgeException(BridgeErrorCodes.Unsupported,
                    $"CODESYS: no PerformWithWriteableCopy on {pous.GetType().FullName} — a task's call list " +
                    "cannot be rebuilt, and mutating the read-only view would silently do nothing.");

            var actionType = perform.GetParameters()[0].ParameterType;      // Action<TWriteable>
            var param = System.Linq.Expressions.Expression.Parameter(actionType.GetGenericArguments()[0], "list");
            var body = System.Linq.Expressions.Expression.Call(
                typeof(CodesysObjectModel).GetMethod(nameof(RebuildCallList), BindingFlags.NonPublic | BindingFlags.Static)!,
                System.Linq.Expressions.Expression.Convert(param, typeof(object)),
                System.Linq.Expressions.Expression.Constant(taskFacet),
                System.Linq.Expressions.Expression.Constant(calls, typeof(System.Collections.Generic.IReadOnlyList<string>)));
            var callback = System.Linq.Expressions.Expression.Lambda(actionType, body, param).Compile();

            try { perform.Invoke(pous, new object?[] { callback }); }
            catch (TargetInvocationException tie)
            {
                var inner = tie.InnerException ?? tie;
                throw new Volt.Engine.BridgeException(BridgeErrorCodes.Unsupported, $"CODESYS refused a task call-list rebuild: {inner.Message}", inner);
            }
        }

        /// <summary>The mutation itself, against the WRITEABLE copy: clear, then append in call order —
        /// carrying each entry's COMMENT across, which is the one thing a rebuild would otherwise destroy.
        ///
        /// <para><b>The vendor states an entry's whole persisted contract itself</b>, and it is two fields:
        /// <c>PouObject.SerializableValueNames</c> is exactly <c>('Name', 'Comment')</c>, measured identical on
        /// all 21 call entries of five real projects (<c>probe-task-callcomment.py</c> (deleted; <c>git show b2496efb4b:packages/volt-cli/scripts/probe-task-callcomment.py</c>)). Volt's
        /// descriptor carries the name. Clearing and re-minting therefore threw the comment away on every push
        /// that touched a task's call list — invisibly, because the <c>.task</c> file never showed it, so
        /// neither the workspace nor git could reveal the loss.</para>
        ///
        /// <para><b>This method's own doc comment used to justify that</b>: "an entry carries a per-entry
        /// COMMENT the descriptor does not, so a positional diff would have to preserve something Volt cannot
        /// see." The premise is false. <c>PouObject.Comment</c> is an ordinary readable and writable property;
        /// it is only invisible from the SCRIPTING wrapper, which iterates plain name strings. Volt could see
        /// it all along and was not looking. Carrying it needs no format change and no descriptor field — which
        /// is just as well, since the census found all 21 comments EMPTY, so a <c>.task</c> line for it would
        /// be product surface for something no real project uses.</para>
        ///
        /// <para>Matched by NAME, first-come — never by position, which a reorder invalidates, and never by a
        /// dictionary, which would collapse a task that calls the same POU twice.</para></summary>
        private static void RebuildCallList(object writeable, object taskFacet,
                                            System.Collections.Generic.IReadOnlyList<string> calls)
        {
            if (writeable is not System.Collections.IList list)
                throw new Volt.Engine.BridgeException(BridgeErrorCodes.Unsupported,
                    $"CODESYS: the writeable call list is a {writeable.GetType().FullName}, which is not an IList " +
                    $"— it offers: {string.Join(", ", writeable.GetType().GetMethods(BF).Select(m => m.Name).Distinct().OrderBy(n => n))}");

            // Read BEFORE the clear: after it the old entries are gone and there is nothing left to carry.
            var carried = list.Cast<object>()
                .Select(e => (Name: GetMember(e, "Name") as string, Comment: GetMember(e, "Comment") as string))
                .Where(e => !string.IsNullOrEmpty(e.Name) && !string.IsNullOrEmpty(e.Comment))
                .ToList();

            list.Clear();
            foreach (var name in calls)
            {
                var entry = InvokeMethod(taskFacet, "CreatePouObject", name)
                            ?? throw new InvalidOperationException($"CODESYS: CreatePouObject('{name}') returned nothing");

                var i = carried.FindIndex(c => string.Equals(c.Name, name, StringComparison.Ordinal));
                if (i >= 0)
                {
                    SetMember(entry, "Comment", carried[i].Comment);
                    carried.RemoveAt(i);        // one comment per entry, so a repeated call takes the next one
                }

                list.Add(entry);
            }
        }
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
