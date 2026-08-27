using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Volt.Contracts;
using Volt.Engine.Library;
using Volt.Engine.Source.Body;
using Volt.Engine.Source.Body.St;

namespace Volt.Cli.Ide.Codesys
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
        public string TaskDescriptor(object node)
        {
            var f = Facet(node, "ScriptTaskObject");
            var d = new Descriptor(11)
                .Add("Type", System.Convert.ToString(GetMember(f, "kind_of_task")))
                .Add("Interval", Unitize(GetMember(f, "interval"), GetMember(f, "interval_unit")))
                .Add("Priority", System.Convert.ToString(GetMember(f, "priority")));

            // Event-triggered tasks carry the triggering (external) event variable; empty for cyclic/freewheeling.
            var ev = System.Convert.ToString(GetMember(f, "event"));
            if (string.IsNullOrWhiteSpace(ev)) ev = System.Convert.ToString(GetMember(f, "external_event"));
            d.Add("Event", ev);

            var wd = GetMember(f, "watchdog");
            d.Add("Watchdog", wd != null && GetMember(wd, "enabled") is bool on && on
                ? $"{Unitize(GetMember(wd, "time"), GetMember(wd, "time_unit"))} (sensitivity {System.Convert.ToString(GetMember(wd, "sensitivity"))?.Trim()})"
                : "off");

            // The POUs this task calls each cycle (ScriptPouObjectList yields the POU names, in call order).
            if (GetMember(f, "pous") is IEnumerable pous)
            {
                var names = new List<string>();
                foreach (var p in pous) { var n = System.Convert.ToString(p)?.Trim(); if (!string.IsNullOrEmpty(n)) names.Add(n!); }
                if (names.Count > 0) d.Add("Calls", string.Join(", ", names));
            }
            return d.ToString();
        }

        // The rule is Engine's (Text/Descriptor.Unitize, where it has tests); this only turns the facet's
        // boxed values into strings first.
        private static string Unitize(object? value, object? unit) =>
            Descriptor.Unitize(System.Convert.ToString(value), System.Convert.ToString(unit));

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
