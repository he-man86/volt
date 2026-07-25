using Volt.Cli.Transport;
using Volt.Engine.Ide;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>The served-row health VERDICT is now a pure function of the live link signals (busy / degraded /
/// staleness), derived at /health time rather than frozen into a cached snapshot — so it can be unit-tested with no
/// live IDE, and can never report a stale "healthy" over a channel that dropped after the last snapshot.</summary>
public class HonestHealthTests
{
    // StaleMs in DriverBase is 12_000; these straddle it well clear of the boundary.
    private const long Fresh = 3_000;
    private const long Stale = 20_000;

    [Theory]
    // An op holding the IDE thread IS a live link — busy, never a false drop — so it wins over everything, incl. a
    // long op that has outrun the staleness window and a lingering degraded flag from a prior transient.
    [InlineData(false, true, Fresh, HealthStatus.Healthy)]
    [InlineData(true, true, Stale, HealthStatus.Healthy)]
    // A recent transient (an op hit 0x800706BA) shows degraded — the fix for "health lied healthy while ops failed".
    [InlineData(true, false, Fresh, HealthStatus.Degraded)]
    // A confirmed-recent, un-degraded link is healthy.
    [InlineData(false, false, Fresh, HealthStatus.Healthy)]
    // No IDE response within the staleness window (a silent drop — IDE closed, probe can't refresh) is NOT healthy.
    [InlineData(false, false, Stale, HealthStatus.Degraded)]
    // Never confirmed at all (age = long.MaxValue) is likewise not healthy.
    [InlineData(false, false, long.MaxValue, HealthStatus.Degraded)]
    public void DeriveServedStatus_reflects_the_live_link(bool degraded, bool opInFlight, long ageMs, string expected)
    {
        Assert.Equal(expected, DriverBase.DeriveServedStatus(degraded, opInFlight, ageMs));
    }
}
