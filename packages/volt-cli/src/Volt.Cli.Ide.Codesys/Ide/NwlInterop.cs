using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

namespace Volt.Cli.Ide.Codesys
{
    /// <summary>
    /// The ONLY place that names a member of the 3S NWL object model.
    ///
    /// <para><b>Why a chokepoint.</b> <c>NWLObject</c> is an internal 3S assembly with no compatibility
    /// commitment — <c>4.6.0.0</c> here, with the concrete types in <c>NWLObject.plugin</c> — and it is shared
    /// with TwinCAT, which ships its own version. Volt does not own it and cannot pin it. So every access goes
    /// through here and every miss FAILS LOUD, naming the member and the observed assembly version, rather than
    /// returning null and letting a body materialize half-read. A silently empty body is the worst outcome
    /// available: it looks like an engineer deleted their logic.</para>
    ///
    /// <para>The concrete types live in a DIFFERENT assembly from the interfaces (<c>NWLObject</c> holds only
    /// interfaces), so types are resolved from a LIVE object's assembly rather than by name — which also means
    /// the adapter cannot accidentally bind a stale copy.</para>
    /// </summary>
    internal static class NwlInterop
    {
        private const BindingFlags BF =
            BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.FlattenHierarchy;

        // ── reading ───────────────────────────────────────────────────────────────────────────────

        /// <summary>A property, looked up on the concrete type and then on every interface it implements —
        /// the NWL types implement much of their surface explicitly. Returns null when the member is absent.</summary>
        public static object? Get(object? o, string member)
        {
            if (o == null) return null;
            var t = o.GetType();
            var p = t.GetProperty(member, BF);
            if (p != null) return p.GetValue(o, null);
            foreach (var i in t.GetInterfaces())
            {
                var ip = i.GetProperty(member);
                if (ip != null) return ip.GetValue(o, null);
            }
            return null;
        }

        /// <summary>A property that MUST be there. The version is in the message because "member missing" on an
        /// unpinned vendor assembly is a version story, and the first question is always which one is loaded.</summary>
        public static object Require(object o, string member) =>
            Get(o, member) ?? throw Missing(o, member);

        public static string? Text(object? o, string member) => Get(o, member) as string;

        public static bool Flag(object? o, string member) => Get(o, member) is bool b && b;

        public static int Int(object? o, string member) => Get(o, member) is int i ? i : 0;

        /// <summary>Invoke a method by name and arity, on the type or on any interface.</summary>
        public static object? Call(object o, string method, params object?[] args)
        {
            var t = o.GetType();
            foreach (var src in new[] { t }.Concat(t.GetInterfaces()))
            {
                var m = src.GetMethods(BF).FirstOrDefault(
                    x => x.Name == method && x.GetParameters().Length == args.Length);
                if (m == null) continue;
                try { return m.Invoke(o, args); }
                catch (TargetInvocationException tie) { throw tie.InnerException ?? tie; }
            }
            throw Missing(o, method + "(" + args.Length + " args)");
        }

        /// <summary>Invoke a method that may legitimately run off the end of a collection, returning null
        /// instead of throwing.
        /// <para><c>INetwork</c> exposes <c>GetSplitPoint(i)</c> with NO count to bound the loop, and the vendor
        /// THROWS past the end rather than returning null — which surfaced as a bare "Index was out of range"
        /// on the first live graphical push, from a read the caller believed was a probe.</para></summary>
        public static object? TryCall(object o, string method, params object?[] args)
        {
            try { return Call(o, method, args); }
            catch (ArgumentOutOfRangeException) { return null; }
            catch (IndexOutOfRangeException) { return null; }
        }

        /// <summary>A vendor collection as a list. The NWL collections are NOT <c>IList</c>: an
        /// <c>OutputItemList</c> exposes <c>AppendOutputItem</c>/<c>InsertOutputItem</c>/<c>RemoveOutputItem</c>
        /// and enumerates through a <c>List</c> property, with no <c>Add</c>, no <c>Count</c> and no indexer.</summary>
        public static IReadOnlyList<object> Items(object? collection, string listMember = "List")
        {
            if (collection == null) return Array.Empty<object>();
            if (Get(collection, listMember) is IEnumerable seq)
                return seq.Cast<object>().Where(x => x != null).ToList();
            if (collection is IEnumerable direct)
                return direct.Cast<object>().Where(x => x != null).ToList();
            return Array.Empty<object>();
        }

        /// <summary>The runtime type name — how the adapter dispatches, mirroring the vendor's own
        /// <c>IBoxTreeVisitor</c> arms.</summary>
        public static string TypeName(object o) => o.GetType().Name;

        // ── constructing ──────────────────────────────────────────────────────────────────────────

        /// <summary>Construct a concrete NWL type, resolved from the assembly of a LIVE object. The types are
        /// public with real constructors, so nothing here needs a private-reflection trick.</summary>
        public static object New(object sample, string typeName, params object?[] args)
        {
            var asm = sample.GetType().Assembly;
            var t = asm.GetTypes().FirstOrDefault(x => x.Name == typeName && x.IsClass && !x.IsAbstract)
                ?? throw new InvalidOperationException(
                    $"CODESYS: the NWL type '{typeName}' is not in {Describe(asm)} — the object model does not " +
                    "match what this adapter was written against, and a graphical write would land nothing.");
            try { return Activator.CreateInstance(t, args)!; }
            catch (TargetInvocationException tie) { throw tie.InnerException ?? tie; }
        }

        /// <summary>Set a property that must be writable.</summary>
        public static void Set(object o, string member, object? value)
        {
            var t = o.GetType();
            foreach (var p in new[] { t.GetProperty(member, BF) }
                         .Concat(t.GetInterfaces().Select(i => i.GetProperty(member)))
                         .Where(p => p != null && p.CanWrite))
            {
                p!.SetValue(o, value, null);
                return;
            }
            throw Missing(o, member + " (writable)");
        }

        // ── diagnostics ───────────────────────────────────────────────────────────────────────────

        private static InvalidOperationException Missing(object o, string member) =>
            new InvalidOperationException(
                $"CODESYS: '{o.GetType().Name}' has no '{member}'. Volt's graphical transport is written " +
                $"against the 3S NWL object model in {Describe(o.GetType().Assembly)}; this build exposes a " +
                "different shape. Refusing rather than reading a partial body — a body that comes back " +
                "half-read is indistinguishable from one the engineer emptied.");

        private static string Describe(Assembly a)
        {
            var n = a.GetName();
            return $"{n.Name} {n.Version}";
        }
    }
}
