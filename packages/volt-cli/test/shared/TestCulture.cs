using System;
using System.Globalization;
using System.Threading;

#if NETFRAMEWORK
namespace System.Runtime.CompilerServices
{
    /// <summary>The C# 9 module initializer's marker, which .NET Framework does not ship: the compiler only looks the type
    /// up by name, and the CLR runs the module constructor it emits on every framework.</summary>
    [AttributeUsage(AttributeTargets.Method, Inherited = false)]
    internal sealed class ModuleInitializerAttribute : Attribute { }
}
#endif

namespace Volt.Tests.Shared
{
    /// <summary>
    /// THE CULTURE A TEST RUN RUNS UNDER (openspec <c>environment-dependency-audit</c> 1.1). <c>VOLT_TEST_CULTURE=tr-TR</c>
    /// (or ru-RU, de-DE, …) makes every thread of the test assembly — the test's own, xunit's, the thread pool's — run under
    /// that culture, as on a customer's Turkish or Russian Windows; unset, the run keeps the machine's. Compiled into every
    /// test project (<c>test/Directory.Build.targets</c>) and applied when the test assembly loads, before any test.
    ///
    /// <para>The switch is in the process because .NET takes its culture from the Windows user locale, never from an
    /// environment variable (<c>LANG</c> is ignored on Windows), and a CI runner's locale cannot be changed per job. A name
    /// that is not a culture the runtime knows is refused (it throws, and every test of the assembly fails) instead of
    /// running the suite under a culture nobody asked for.</para>
    ///
    /// <para><c>Thread.CurrentThread</c> is set as well as the defaults because a thread that already exists when the
    /// assembly loads keeps an explicitly set culture; the sentinel (<c>TestCultureTests</c>) checks the test thread, a
    /// pool thread and an await continuation on both frameworks.</para>
    /// </summary>
    internal static class TestCulture
    {
        public const string Variable = "VOLT_TEST_CULTURE";

        /// <summary>The culture the run was asked for, or null when the variable is unset.</summary>
        public static string? Requested => Environment.GetEnvironmentVariable(Variable) is { Length: > 0 } name ? name : null;

        [System.Runtime.CompilerServices.ModuleInitializer]
        internal static void Apply()
        {
            if (Requested is not { } name) return;
            var culture = Known(name);
            CultureInfo.DefaultThreadCurrentCulture = culture;
            CultureInfo.DefaultThreadCurrentUICulture = culture;
            Thread.CurrentThread.CurrentCulture = culture;
            Thread.CurrentThread.CurrentUICulture = culture;
        }

        /// <summary>Only a culture the runtime lists: on Windows 10+ both .NET Framework and ICU hand out a made-up culture
        /// for any well-formed name (measured: <c>qq-QQ</c> loads on net48), which would run the suite under no real
        /// locale at all.</summary>
        private static CultureInfo Known(string name)
        {
            foreach (var c in CultureInfo.GetCultures(CultureTypes.SpecificCultures | CultureTypes.NeutralCultures))
                if (string.Equals(c.Name, name, StringComparison.OrdinalIgnoreCase)) return CultureInfo.GetCultureInfo(c.Name);
            throw new CultureNotFoundException(Variable, name, $"{Variable}={name} is not a culture this runtime knows");
        }
    }
}
