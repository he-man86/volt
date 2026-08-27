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
        // ── PLCopenXML import / export (the graphical write/read transport) ──────
        private object? _scriptEngine;   // cached APEnvironment.ScriptEngine

        /// <summary>Serialize an object to a PLCopenXML <b>string</b>, fully IN-MEMORY — NO temp file.
        /// From the decompiled <c>ScriptProject.export_xml(IEnumerable&lt;IExtendedObject&lt;IScriptObject&gt;&gt;,
        /// filePath, …)</c>: passing an EMPTY file path makes it serialize to a MemoryStream and return
        /// the XML string. Our tree stores fully-unwrapped <c>IScriptObject</c> nodes, so re-wrap the
        /// node into the required <c>IExtendedObject&lt;IScriptObject&gt;</c> via the script engine's
        /// <c>CreateExtendedObject</c> factory (the same call the scripting tree itself uses).</summary>
        public string ExportXmlString(object node)
        {
            var proj = PrimaryProject ?? throw new InvalidOperationException("CODESYS: no primary project to export");
            return ExportNodes(proj, new[] { Unwrap(node)! });
        }

        /// <summary>Export the parent POU + its children in ONE call so the returned PLCopen XML contains
        /// child <c>&lt;pou&gt;</c> elements. The Materializer parses everything from this single document,
        /// replacing the per-child COM reads.
        /// <para>Asks the IDE to recurse instead of walking the tree here. The previous version collected every
        /// descendant itself (flattening folders) and exported them as an explicit node list; that was verified
        /// BYTE-IDENTICAL to this, on 8 POUs including the one whose subtree contains folders — the case the
        /// manual flattening existed for — and 4.6× faster on it (0.129s → 0.028s, 24 collected nodes), because
        /// the walk cost one `Unwrap` + `get_children` + `is_folder` + `CreateExtendedObject` per node before
        /// the export even ran.</para>
        /// <para>EVERY kind comes through here, interfaces included — there is no second exporter. Recursion is
        /// load-bearing for them too: the same INTERFACE exported non-recursively carries 0 methods and 0
        /// properties. An interface-specific export existed twice over and neither was needed. The first was a
        /// hand-built <c>StringBuilder</c> document, justified by "CODESYS <c>export_xml</c> rejects
        /// <c>IInterfaceObject</c> — it only accepts <c>IPOUObject</c>", which is FALSE: verified on 3.5.21.40,
        /// all 31 interfaces in the corpus export through this call and re-import with their children intact,
        /// and the real export carries interface PROPERTIES with their <c>&lt;GetAccessor&gt;</c>/
        /// <c>&lt;SetAccessor&gt;</c>, which the synthesized one dropped. The second was a wrapper making this
        /// exact call under another name. See <c>CodesysInterfaceExportTests</c> for the captured ground truth.</para>
        /// <para>NB an interface document has NO <c>&lt;pou&gt;</c> element: CODESYS writes one as
        /// <c>&lt;addData&gt;/&lt;Interface&gt;</c> with <c>&lt;Methods&gt;</c>/<c>&lt;Properties&gt;</c>, exactly
        /// like TwinCAT (DIALECT.md A8). <see cref="Volt.Engine.Source.PouReader"/> already reads that shape.</para></summary>
        public string ExportXmlWithChildren(object parentNode) =>
            ExportNodes(
                PrimaryProject ?? throw new InvalidOperationException("CODESYS: no primary project to export"),
                new[] { Unwrap(parentNode)! }, recursive: true);

        /// <summary>Wrap a fully-unwrapped tree node back into the <c>IExtendedObject&lt;IScriptObject&gt;</c> the
        /// scripting API takes, via the engine's own <c>CreateExtendedObject</c> factory — the same call the
        /// scripting tree itself uses. Shared by <see cref="ExportNodes"/> and <see cref="Move"/>: both take that
        /// wrapper, and hand-rolling it twice is how the two would drift.</summary>
        private object AsExtended(object node, Type baseType)
        {
            var apEnv = Reflection.FindType("_3S.CoDeSys.ScriptDriverProjects.APEnvironment")
                ?? throw new InvalidOperationException("CODESYS APEnvironment type not found — object-model version mismatch");
            var se = _scriptEngine ??= apEnv.GetProperty("ScriptEngine", BF | BindingFlags.Static)?.GetValue(null)
                ?? throw new InvalidOperationException("CODESYS APEnvironment.ScriptEngine not available");
            var createExt = se.GetType().GetMethods(BF).FirstOrDefault(x => x.Name == "CreateExtendedObject"
                && x.IsGenericMethodDefinition && x.GetParameters().Length == 1)
                ?? throw new InvalidOperationException("CODESYS ScriptEngine.CreateExtendedObject not found — object-model version mismatch");
            return createExt.MakeGenericMethod(baseType).Invoke(se, new[] { node })!;
        }

        private string ExportNodes(object proj, ICollection<object> nodes, bool recursive = false)
        {
            var export = proj.GetType().GetMethods(BF).FirstOrDefault(x => x.Name == "export_xml" && x.GetParameters().Length == 5
                && typeof(IEnumerable).IsAssignableFrom(x.GetParameters()[0].ParameterType)
                && x.GetParameters()[1].ParameterType == typeof(string))
                ?? throw new InvalidOperationException("CODESYS export_xml(IEnumerable, string, …) overload not found — object-model version mismatch");
            var elemType = export.GetParameters()[0].ParameterType.GetGenericArguments()[0];   // IExtendedObject<IScriptObject>
            var baseType = elemType.GetGenericArguments()[0];                                    // IScriptObject

            var objects = Array.CreateInstance(elemType, nodes.Count);
            int i = 0;
            foreach (var n in nodes)
                objects.SetValue(AsExtended(n, baseType), i++);

            var xml = (string)export.Invoke(proj, new object?[] { objects, "", recursive, false, true })!;
            return xml.TrimStart('\uFEFF');
        }

        /// <summary>Import a PLCopenXML <b>string</b> <paramref name="data"/> (NOT a file path) IN-MEMORY,
        /// replacing an existing object of the same name when the IDE offers a conflict resolution.
        /// <para>Imports INTO <paramref name="into"/>, which is REQUIRED and has NO project-root default.
        /// PLCopenXML carries no folder membership, so a project-level import of a single POU lands it at the
        /// ROOT and relocates it out of the engineer's folder — the measured regression behind "a graphical push
        /// no longer relocates a POU". The optional parameter meant the one input known to cause that was also
        /// the one the compiler could not stop; an unresolvable target is now a hard failure instead of a quiet
        /// fall-back. import_xml is available on object/folder nodes too.</para></summary>
        public void ImportXmlString(string data, object into)
        {
            var target = Unwrap(into)
                ?? throw new InvalidOperationException(
                    "CODESYS: the import target node unwrapped to null — refusing a project-root import, which " +
                    "would relocate the object out of its folder");
            var t = target.GetType();
            // The 3-arg import with an explicit conflict-resolution enum, and NOTHING ELSE. The caller no longer
            // deletes the existing object first, so the mode is what makes the import a MERGE — measured on
            // 3.5.21.40, only `Replace` lands the body; `Copy` and `Skip` silently land nothing while the push
            // still reports success. The old fall-through to the 2-arg overload (default mode) was safe only
            // BECAUSE of that delete; keeping it now would turn a renamed enum member into silent data loss.
            var m3 = t.GetMethods(BF).FirstOrDefault(x => x.Name == "import_xml" && x.GetParameters().Length == 3
                && x.GetParameters()[0].ParameterType.IsEnum && x.GetParameters()[1].ParameterType == typeof(string))
                ?? throw new InvalidOperationException(
                    "CODESYS import_xml(ConflictResolve, string, bool) overload not found — object-model version mismatch");
            var et = m3.GetParameters()[0].ParameterType;
            // EXACT member name, no substring probe and no second guess. The enum is ConflictResolve and its
            // members are MEASURED, not inferred: on 3.5.21.40 only `Replace` lands the body — `Copy` and `Skip`
            // import nothing while the push still reports success. "Overwrite" was a guess at an enum nobody had
            // seen, and a substring probe would also match a hypothetical `ReplaceNothing`/`NeverOverwrite`, i.e.
            // it could silently select the very modes measured to lose the write.
            var pick = Enum.GetNames(et).FirstOrDefault(n => string.Equals(n, "Replace", StringComparison.Ordinal))
                    ?? throw new InvalidOperationException(
                        $"CODESYS {et.Name} has no 'Replace' member ({string.Join(", ", Enum.GetNames(et))}) — " +
                        "cannot merge without it, and the other modes measurably import nothing");
            InvokeWith(target, m3, Enum.Parse(et, pick), data, false);
        }

        private static object? InvokeWith(object target, System.Reflection.MethodInfo m, params object?[] args)
        {
            try { return m.Invoke(target, args); }
            catch (TargetInvocationException tie) { throw tie.InnerException ?? tie; }
        }


        private static object Create(object container, string method, params object?[] leadingArgs) =>
            Unwrap(InvokeWithOptionals(container, method, leadingArgs))!;

        /// <summary>Invoke a scripting factory binding the given arguments to parameters BY NAME
        /// (case-insensitive); every other (optional) parameter is left at its default. Use this when a
        /// param that matters sits behind optional ones — e.g. <c>create_pou</c>'s <c>return_type</c> is
        /// 4th, behind an optional <c>language</c>. By-name is robust to a CODESYS version reordering the
        /// optionals and is self-documenting, unlike positional <see cref="Type.Missing"/> padding.</summary>
        private static object CreateNamed(object container, string method, params (string Name, object? Value)[] args)
        {
            foreach (var m in container.GetType().GetMethods(BF))
            {
                if (m.Name != method) continue;
                var ps = m.GetParameters();
                if (!Array.TrueForAll(args, a => Array.Exists(ps, p => string.Equals(p.Name, a.Name, StringComparison.OrdinalIgnoreCase))))
                    continue;   // this overload doesn't expose every named arg → try the next
                var values = new object?[ps.Length];
                for (int i = 0; i < ps.Length; i++)
                {
                    var hit = Array.FindIndex(args, a => string.Equals(a.Name, ps[i].Name, StringComparison.OrdinalIgnoreCase));
                    values[i] = hit >= 0 ? args[hit].Value : Type.Missing;
                }
                try { return Unwrap(m.Invoke(container, BindingFlags.OptionalParamBinding, null, values, null))!; }
                catch (TargetInvocationException tie) { throw tie.InnerException ?? tie; }
            }
            throw new MissingMethodException($"No '{method}' overload exposing [{string.Join(", ", Array.ConvertAll(args, a => a.Name))}] on {container.GetType().FullName}");
        }

        /// <summary>Container for top-level objects (POU/DUT/GVL/interface) under the
        /// parent.</summary>
        private object IecContainer(object parent) => Container(parent, "ScriptIecLanguageObjectContainerObject");

        /// <summary>Container for inline POU members (method/action/property/transition)
        /// under the parent POU — distinct from <see cref="IecContainer"/>; this is the
        /// type that actually exposes create_method/create_action/create_property.</summary>
        private object MemberContainer(object parent) => Container(parent, "ScriptIecLanguageMemberContainer");

        /// <summary>Construct one of CODESYS's own IEC language containers over the
        /// parent's ScriptObject. Their <c>create_*</c> methods are real .NET members
        /// (unlike the IronPython-only extension surface), so they're callable from C#.</summary>
        private object Container(object parent, string simpleTypeName)
        {
            var baseObj = Unwrap(parent)!;
            var t = Reflection.FindType("_3S.CoDeSys.ScriptDriverProjects." + simpleTypeName)
                    ?? throw new InvalidOperationException(simpleTypeName + " type not found");
            return Activator.CreateInstance(t,
                BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public,
                null, new object[] { baseObj }, null)!;
        }

        /// <summary>Invoke a scripting factory method supplying only the leading
        /// arguments; trailing optional parameters get <see cref="Type.Missing"/>.</summary>
        private static object InvokeWithOptionals(object target, string method, object?[] leadingArgs)
        {
            foreach (var m in target.GetType().GetMethods(BF))
            {
                if (m.Name != method) continue;
                var ps = m.GetParameters();
                if (ps.Length < leadingArgs.Length) continue;
                if (ps.Length > leadingArgs.Length && !ps[leadingArgs.Length].IsOptional) continue;
                var args = new object?[ps.Length];
                for (int i = 0; i < ps.Length; i++) args[i] = i < leadingArgs.Length ? leadingArgs[i] : Type.Missing;
                try
                {
                    return Unwrap(m.Invoke(target, BindingFlags.OptionalParamBinding, null, args, null))!;
                }
                catch (TargetInvocationException tie) { throw tie.InnerException ?? tie; }
            }
            throw new MissingMethodException($"No '{method}' overload taking {leadingArgs.Length}+ args on {target.GetType().FullName}");
        }

        private static object EnumValue(string enumSimpleName, string member) =>
            Enum.Parse(Reflection.FindEnum(enumSimpleName)
                ?? throw new InvalidOperationException($"CODESYS enum {enumSimpleName} not found"), member);
    }
}
