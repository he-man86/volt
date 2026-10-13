using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>
    /// THE MEMBER-AVAILABILITY TABLE AND ITS DIALECT ROW SAY THE SAME THING (openspec <c>environment-dependency-audit</c>
    /// 2.0). <c>MemberAvailability</c> decides whether an absent archive member is a version fact; DIALECT V7 is the
    /// vendor-fact record of the census that filled it. A row added to one and not the other is a measurement nobody can
    /// trace, so the two are read and compared: every <c>`Owner.Member` since &lt;version&gt;</c> in V7 is a table row and
    /// back, and V7's measured platforms are the table's.
    /// </summary>
    public class MemberAvailabilityTests
    {
        private static string Dialect([System.Runtime.CompilerServices.CallerFilePath] string here = "") =>
            Path.GetFullPath(Path.Combine(Path.GetDirectoryName(here)!, "..", "..", "src", "Volt.Engine", "Ide", "DIALECT.md"));

        private static string V7()
        {
            var row = File.ReadAllLines(Dialect()).SingleOrDefault(l => l.StartsWith("| **V7**"));
            Assert.True(row != null, "DIALECT.md has no V7 row — the record of the member-availability census.");
            return row!;
        }

        [Fact]
        public void The_table_rows_are_the_DIALECT_V7_rows()
        {
            var dialect = Regex.Matches(V7(), @"`(\w+)\.(\w+)` since (\d+\.\d+\.\d+\.\d+)").Cast<Match>()
                .Select(m => $"{m.Groups[1].Value}.{m.Groups[2].Value} since {m.Groups[3].Value}").OrderBy(s => s).ToList();
            var table = MemberAvailability.Rows.Select(r => $"{r.Owner}.{r.Member} since {r.Since}").OrderBy(s => s).ToList();

            Assert.NotEmpty(table);
            Assert.Equal(table, dialect);
        }

        [Fact]
        public void The_measured_platforms_are_the_DIALECT_V7_ones()
        {
            var m = Regex.Match(V7(), @"measured platforms: ((?:\d+\.\d+\.\d+\.\d+(?:, )?)+)");
            Assert.True(m.Success, "V7 names no 'measured platforms: …' list.");
            var dialect = Regex.Matches(m.Groups[1].Value, @"\d+\.\d+\.\d+\.\d+").Cast<Match>().Select(x => x.Value).OrderBy(s => s);

            Assert.Equal(MemberAvailability.Measured.OrderBy(s => s), dialect);
        }

        /// <summary>A row's version is a measured one, and every measured platform below it is one the census saw without
        /// the member — the lookup answers exactly that.</summary>
        [Theory]
        [InlineData("3.5.18.30", "LibManObject", "ParameterTable", true)]
        [InlineData("3.5.21.40", "LibManObject", "ParameterTable", false)]
        [InlineData("3.5.17.20", "LibManObject", "ParameterTable", false)]   // never measured: no version fact
        [InlineData(null, "LibManObject", "ParameterTable", false)]
        [InlineData("3.5.18.30", "LibManObject", "Items", false)]            // no row: present on every measured platform
        public void Absent_only_where_the_census_measured_it_absent(string? platform, string owner, string member, bool absent)
        {
            Assert.All(MemberAvailability.Rows, r => Assert.Contains(r.Since, MemberAvailability.Measured));
            Assert.Equal(absent, MemberAvailability.AbsentOn(platform, owner, member));
        }
    }
}
