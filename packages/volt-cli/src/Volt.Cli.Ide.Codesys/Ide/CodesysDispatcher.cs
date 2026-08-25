using System;
using System.Reflection;
using System.Runtime.ExceptionServices;
using Volt.Contracts;
using Volt.Engine.Ide;

namespace Volt.Cli.Ide.Codesys
{
    /// <summary>
    /// Marshals work onto the CODESYS primary (UI/scripting) thread. The scripting
    /// objects are thread-affine, so every read/write must run there — but
    /// BridgePipeHost serves each pipe connection on a background ThreadPool thread.
    /// This is the CODESYS analogue of the Beckhoff bridge's STA queue: it wraps the IDE's own
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
            if (siType == null) return Unavailable("_3S.CoDeSys.Core.SystemInstances is not loaded in this AppDomain");

            var engine = siType.GetProperty("Engine", BindingFlags.Public | BindingFlags.Static)?.GetValue(null);
            if (engine == null) return Unavailable("SystemInstances.Engine (public static) is absent or null");

            var invoke = FindInvoke(engine);
            if (invoke == null)
                return Unavailable($"InvokeInPrimaryThread(Delegate, object[], bool) not found on {engine.GetType().FullName} or its interfaces");

            return new CodesysDispatcher(engine, invoke);
        }

        /// <summary>A null dispatcher leaves the driver permanently unable to reach the IDE thread, which the
        /// client only ever sees as PLC_DISCONNECTED — so say WHY, through <c>BridgeLog</c> (both sinks).</summary>
        private static CodesysDispatcher? Unavailable(string reason)
        {
            Volt.Engine.Ide.BridgeLog.Warn($"CODESYS primary-thread dispatcher unavailable: {reason}");
            return null;
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
            // Capture().Throw() rather than `throw error;` — a bare rethrow resets the stack trace to this line,
            // so every failure inside the IDE work item would look like the marshal threw it.
            if (error != null) ExceptionDispatchInfo.Capture(error).Throw();
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
