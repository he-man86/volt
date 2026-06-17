using System;
using System.Reflection;

namespace Volt.Bridge.Codesys
{
    /// <summary>
    /// Marshals work onto the CODESYS primary (UI/scripting) thread. The scripting
    /// objects are thread-affine, so every read/write must run there — but the HTTP
    /// server runs on background ThreadPool threads. This is the CODESYS analogue of
    /// the Beckhoff bridge's STA queue: it wraps the IDE's own
    /// <c>IEngine.InvokeInPrimaryThread(delegate, args, bAsync)</c>.
    ///
    /// Obtained by reflection from the already-loaded <c>SystemInstances.Engine</c>
    /// so this DLL needs no compile-time CODESYS reference (loads in any 3.5.x).
    /// </summary>
    internal sealed class CodesysDispatcher
    {
        private readonly object _engine;
        private readonly MethodInfo _invoke;

        private CodesysDispatcher(object engine, MethodInfo invoke)
        {
            _engine = engine;
            _invoke = invoke;
        }

        public static CodesysDispatcher? TryCreate()
        {
            var siType = Reflection.FindType("_3S.CoDeSys.Core.SystemInstances");
            var engine = siType?.GetProperty("Engine", BindingFlags.Public | BindingFlags.Static)?.GetValue(null);
            if (engine == null) return null;

            var invoke = FindInvoke(engine);
            return invoke == null ? null : new CodesysDispatcher(engine, invoke);
        }

        /// <summary>Run <paramref name="fn"/> on the primary thread, block for its
        /// result, and re-throw any exception on the calling thread.</summary>
        public T Run<T>(Func<T> fn)
        {
            T result = default!;
            Exception? error = null;
            Action action = () =>
            {
                try { result = fn(); }
                catch (Exception ex) { error = ex; }
            };
            // bAsync = false → synchronous: returns once the delegate has run.
            _invoke.Invoke(_engine, new object?[] { action, null, false });
            if (error != null) throw error;
            return result;
        }

        private static MethodInfo? FindInvoke(object engine)
        {
            var sig = new[] { typeof(Delegate), typeof(object[]), typeof(bool) };
            var m = engine.GetType().GetMethod("InvokeInPrimaryThread", sig);
            if (m != null) return m;
            foreach (var itf in engine.GetType().GetInterfaces())
            {
                m = itf.GetMethod("InvokeInPrimaryThread", sig);
                if (m != null) return m;
            }
            return null;
        }
    }
}
