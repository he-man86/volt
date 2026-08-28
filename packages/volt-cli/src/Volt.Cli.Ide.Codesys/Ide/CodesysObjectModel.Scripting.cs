using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Volt.Contracts;
using Volt.Engine.Library;
using Volt.Engine.Format.Body;

namespace Volt.Cli.Ide.Codesys
{
    internal sealed partial class CodesysObjectModel
    {
        // ── the CODESYS SCRIPTING API ─────────────────────────────────────────────
        //
        // Structure, not content: creating objects, resolving containers, binding enum members. These live
        // together because they all reflect over the scripting API's factory surface, whose parameters sit
        // behind optionals and must be bound BY NAME.
        //
        // This file was `CodesysObjectModel.PlcOpen.cs` and also held the PLCopen transport itself —
        // `ExportXmlString`, `ExportXmlWithChildren`, `ImportXmlString` and the `IExtendedObject` re-wrapping
        // they needed. That is gone: a body now travels as typed NWL objects and a declaration through its
        // aspect, so nothing serializes. The helpers below stayed because they were never about PLCopen.
        private object? _scriptEngine;   // cached APEnvironment.ScriptEngine

        /// <summary>Wrap a fully-unwrapped tree node back into the <c>IExtendedObject&lt;IScriptObject&gt;</c> the
        /// scripting API takes, via the engine's own <c>CreateExtendedObject</c> factory — the same call the
        /// scripting tree itself uses. Used by <c>Move</c> and the library reads. It outlived the PLCopen export it was
        /// written beside, because it is about the SCRIPTING API rather than about any document format.</summary>
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
