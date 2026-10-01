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
        // ── reflection helpers ─────────────────────────────────────────────────
        /// <summary>Reads a member, RESOLVING explicit interface implementations
        /// (which both concrete-type reflection and C# <c>dynamic</c> miss — e.g.
        /// <c>IMetaObject.Object</c>).</summary>
        private static object? GetMember(object? o, string name)
        {
            if (o == null) return null;
            var t = o.GetType();
            var p = t.GetProperty(name, BF);
            if (p != null) return p.GetValue(o);
            foreach (var i in t.GetInterfaces())
            {
                var ip = i.GetProperty(name);
                if (ip != null) return ip.GetValue(o);
            }
            var m = t.GetMethod("get_" + name, BF, null, Type.EmptyTypes, null);
            return m?.Invoke(o, null);
        }

        /// <summary>Set a member, UNWRAPPING the reflection wrapper on failure. A vendor setter that rejects a
        /// value throws inside `SetValue`, and reflection re-wraps it as "Exception has been thrown by the
        /// target of an invocation" - which reaches the user as a push refusal saying nothing at all about what
        /// they wrote. `InvokeMethod` has always unwrapped; this did not.</summary>
        private static void SetMember(object o, string name, object? value)
        {
            var t = o.GetType();
            var p = t.GetProperty(name, BF);
            if (p != null && p.CanWrite) { Set(p, o, value, name); return; }
            foreach (var i in t.GetInterfaces())
            {
                var ip = i.GetProperty(name);
                if (ip != null && ip.CanWrite) { Set(ip, o, value, name); return; }
            }
            throw new InvalidOperationException($"no writable '{name}' on {t.FullName}");
        }

        /// <summary>Invoke a CODESYS scripting method by name. A method that ISN'T THERE throws — like
        /// <see cref="InvokeWithOptionals"/> and <see cref="CreateNamed"/>. Returning null instead meant every
        /// mutating call through here could silently do nothing: <c>SetObject(meta, true, null)</c> is how a
        /// source-text write COMMITS, so a missed match made `push` report success while the edit never
        /// reached the project — and the build that followed saw no errors precisely because nothing changed.
        /// Use <see cref="TryInvokeMethod"/> where absence is a legitimate answer.</summary>
        private static void Set(PropertyInfo p, object o, object? value, string name)
        {
            try { p.SetValue(o, value); }
            catch (TargetInvocationException tie)
            {
                var inner = tie.InnerException ?? tie;
                throw new InvalidOperationException(
                    $"CODESYS refused '{name}' = {(value is null ? "null" : $"'{value}'")}: {inner.Message}", inner);
            }
        }

        private static object? InvokeMethod(object? o, string name, params object?[] args)
        {
            if (o == null) return null;
            return TryInvokeMethod(o, name, out var found, args) is var r && found ? r
                : throw new MissingMethodException(
                    $"No '{name}' taking {args.Length} arg(s) on {o.GetType().FullName}");
        }

        /// <summary>Invoke if such a method exists; <paramref name="found"/> reports whether it did. The one
        /// legitimate use is probing ARITY — some CODESYS scripting objects expose `get_name()` and others
        /// `get_name(bool)` — where "no such overload" means "try the other", not "something is wrong".</summary>
        private static object? TryInvokeMethod(object? o, string name, out bool found, params object?[] args)
        {
            found = false;
            if (o == null) return null;
            // The overload the arguments' TYPES pick, never "the first with this many parameters": the object
            // manager has two 2-arg reads, and which came first changed inside one IDE (Reflection.Overload).
            var m = Reflection.Overload(o.GetType().GetMethods(BF), name, args);
            if (m == null) return null;
            found = true;
            try { return m.Invoke(o, args); }
            catch (TargetInvocationException tie) { throw tie.InnerException ?? tie; }
        }

        private static object? TryInvokeMethod(object? o, string name, params object?[] args) =>
            TryInvokeMethod(o, name, out _, args);

        /// <summary>The <c>create_*</c> methods a container actually exposes — so a "cannot create this kind"
        /// refusal names the alternatives instead of leaving the reader to decompile.</summary>
        private static string CreateMethodNames(object? container)
        {
            if (container == null) return "none";
            var names = container.GetType().GetMethods(BF)
                .Select(m => m.Name).Where(n => n.StartsWith("create_", StringComparison.Ordinal))
                .Distinct().OrderBy(n => n, StringComparer.Ordinal).ToList();
            return names.Count == 0 ? "none" : string.Join(", ", names);
        }

        private static object? Unwrap(object? o)
        {
            while (o != null)
            {
                var bp = o.GetType().GetProperty("BaseObject", BF);
                if (bp == null) break;
                var inner = bp.GetValue(o);
                if (inner == null || ReferenceEquals(inner, o)) break;
                o = inner;
            }
            return o;
        }

        /// <summary>A static property or field on a CODESYS type, or null when the type is not loaded.
        /// <para>The AppDomain scan is <see cref="Reflection.FindType"/>'s, not a second copy: this one had a
        /// BARE catch around <c>GetType</c>, so an unexpected reflection failure read as "type not present" and
        /// the caller went on believing the IDE simply lacked it.</para></summary>
        private static object? GetStaticMember(string typeName, string member)
        {
            var t = Reflection.FindType(typeName);
            if (t == null) return null;
            const BindingFlags Static = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static;
            return t.GetProperty(member, Static)?.GetValue(null)
                ?? t.GetField(member, Static)?.GetValue(null);
        }
    }
}
