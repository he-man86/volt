using System.Globalization;
using System.Threading.Tasks;
using Xunit;

namespace Volt.Tests.Shared
{
    /// <summary>
    /// A LOCALE RUN THAT DID NOT SWITCH THE CULTURE PROVES NOTHING (openspec <c>environment-dependency-audit</c> 1.1): a
    /// <c>VOLT_TEST_CULTURE=tr-TR</c> run whose tests silently ran under the machine's culture would be green over every
    /// Turkish bug. So each test assembly states, under the culture it was asked for, that the test thread, a thread-pool
    /// thread and an <c>await</c> continuation all run under it. Unset, the run keeps the machine's culture and so does
    /// this test.
    /// </summary>
    public class TestCultureTests
    {
        [Fact]
        public async Task A_locale_run_runs_every_thread_under_the_requested_culture()
        {
            var expected = TestCulture.Requested is { } name ? CultureInfo.GetCultureInfo(name).Name : CultureInfo.CurrentCulture.Name;

            Assert.Equal(expected, CultureInfo.CurrentCulture.Name);
            Assert.Equal(expected, await Task.Run(() => CultureInfo.CurrentCulture.Name));
            await Task.Yield();
            Assert.Equal(expected, CultureInfo.CurrentCulture.Name);
        }

        /// <summary>The Turkish trap the runs exist for, stated once so a tr-TR run shows it is armed: under tr-TR the
        /// culture's upper case of <c>i</c> is the dotted capital <c>İ</c>, never <c>I</c>.</summary>
        [Fact]
        public void A_turkish_run_is_armed()
        {
            if (TestCulture.Requested is not { } name || CultureInfo.GetCultureInfo(name).TwoLetterISOLanguageName != "tr") return;
            Assert.Equal("İ", "i".ToUpper(CultureInfo.CurrentCulture));
        }
    }
}
