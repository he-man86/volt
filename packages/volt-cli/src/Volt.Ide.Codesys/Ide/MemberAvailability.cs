using System;
using System.Collections.Generic;
using System.Linq;

namespace Volt.Ide.Codesys
{
    /// <summary>
    /// WHICH CODESYS HAS WHICH ARCHIVED MEMBER — measured, keyed by the platform version (DIALECT V1), the vendor-fact
    /// record being DIALECT V7 (openspec <c>environment-dependency-audit</c> 2.0).
    ///
    /// <para><b>Two facts, two answers.</b> A member the version's object model does not HAVE is not a member whose read
    /// failed: the library manager's <c>ParameterTable</c> is absent on 3.5.18.30, and refusing it would fail every op
    /// that walks there. Absent on a platform the census measured WITHOUT it, the MEMBER does not exist there — and the reading site states where its
    /// fact lives instead, or that it has none: the stack settings have none on 3.5.18.30; the library parameter values
    /// live on each reference's own archived <c>Params</c> (gate 2a review — read as "none", they would be silently dropped).
    /// Absent anywhere else (a platform the census measured WITH it, or one it never measured, where an
    /// absence may be a rename) is no version fact: that ITEM is unreadable with its reason, never the op.</para>
    ///
    /// <para><b>Filled ONLY from the census</b> (DIALECT V7): every owner type the bridge reads, its full
    /// <c>SerializableValueNames</c> on every instance in four fixture projects and on a fresh instance, on each platform
    /// in <see cref="Measured"/>. A member absent on none of them has no row. Rejected (design 2.0): absent ⇒ empty on
    /// any version (a fallback — a member renamed on a later SP would read as "nothing there"), refusing the version at
    /// start (refuses all of SP18 for a fact about library parameters), inferring it per object at runtime (the table is
    /// the only key a rename cannot fool).</para>
    /// </summary>
    internal static class MemberAvailability
    {
        /// <summary>The platform versions the census measured (DIALECT V7). Exact versions: a patch between two of them
        /// is not measured.</summary>
        public static readonly IReadOnlyList<string> Measured = new[] { "3.5.18.30", "3.5.21.40", "3.5.21.60", "3.5.22.40" };

        /// <summary>One measured row: the archive of <paramref name="Owner"/> (the vendor type's NAME) names
        /// <paramref name="Member"/> from <paramref name="Since"/> on — the first MEASURED platform that has it; every
        /// measured platform below it lacks it.</summary>
        public sealed class Row
        {
            public Row(string owner, string member, string since) { Owner = owner; Member = member; Since = since; }
            public string Owner { get; }
            public string Member { get; }
            public string Since { get; }
        }

        /// <summary>THE TABLE — DIALECT V7's rows, held in step with it by <c>MemberAvailabilityTests</c>.</summary>
        public static readonly IReadOnlyList<Row> Rows = new[]
        {
            new Row("LibManObject", "ParameterTable", "3.5.21.40"),
            new Row("TaskConfigObject", "StackSize", "3.5.21.40"),
            new Row("TaskConfigObject", "UseConfigurableStackSize", "3.5.21.40"),
        };

        /// <summary>Did the census measure <paramref name="platform"/> WITHOUT <paramref name="owner"/>.<paramref name="member"/>?
        /// False for a platform it never measured (or none read) and for a member it found everywhere.</summary>
        public static bool AbsentOn(string? platform, string owner, string member)
        {
            if (platform is null || !Measured.Contains(platform, StringComparer.Ordinal)) return false;
            var row = Rows.FirstOrDefault(r => r.Owner == owner && r.Member == member);
            return row is not null && Version.Parse(platform) < Version.Parse(row.Since);
        }

        /// <summary>Why an absent member is no version fact, for the refusal: the census measured this platform WITH it,
        /// or never measured it.</summary>
        public static string WhyNotAbsent(string? platform) =>
            platform is null ? "the platform version could not be read, so no census measured it"
            : Measured.Contains(platform, StringComparer.Ordinal)
                ? $"the census measured CODESYS {platform} with it (DIALECT V7)"
                : $"no census measured CODESYS {platform} (DIALECT V7: {string.Join(", ", Measured)}), so its absence may be a rename";
    }
}
