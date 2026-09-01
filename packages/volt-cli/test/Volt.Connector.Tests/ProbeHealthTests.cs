using Xunit;
using Volt.Connector;

namespace Volt.Connector.Tests;

/// <summary>
/// THE PROBE'S VOICE — it speaks on a transition and stays quiet otherwise.
///
/// <para>A failing XAE probe suspends the whole TwinCAT fleet: <c>Tick</c> returns without spawning,
/// respawning or reaping anything. That is the right call — a persistently failing probe must not reap every
/// healthy worker — but it used to happen in complete silence, so a worker that died in that window stayed dead
/// with nothing anywhere saying why.</para>
///
/// <para>The two failure modes of a naive fix are why this is a state machine and not a log line. Logging every
/// failure buries the log (the probe runs forever, every third tick); logging only the first never tells you it
/// came back. An engineer needs both edges: when supervision stopped, and when it resumed.</para>
/// </summary>
public class ProbeHealthTests
{
    /// <summary>A HEALTHY PROBE SAYS NOTHING — the overwhelmingly common case, and the one that must not
    /// produce a single line.</summary>
    [Fact]
    public void A_probe_that_works_is_silent()
    {
        var health = new ProbeHealth();

        Assert.Null(health.Observe(true));
        Assert.Null(health.Observe(true));
        Assert.Null(health.Observe(true));
    }

    /// <summary>THE FIRST FAILURE SPEAKS, and it names what stopped rather than just what broke — "the probe
    /// failed" sends someone to the probe; "worker supervision is suspended" tells them why their bridge went
    /// away.</summary>
    [Fact]
    public void The_first_failure_reports_that_supervision_stopped()
    {
        var health = new ProbeHealth();

        var msg = health.Observe(false);

        Assert.NotNull(msg);
        Assert.Contains("SUSPENDED", msg);
    }

    /// <summary>AND IT SAYS IT ONCE. The probe fires every third tick forever, so a message per failure would
    /// bury every other line in the log within minutes of a stale XAE being left open.</summary>
    [Fact]
    public void A_continuing_failure_does_not_repeat_itself()
    {
        var health = new ProbeHealth();
        Assert.NotNull(health.Observe(false));

        Assert.Null(health.Observe(false));
        Assert.Null(health.Observe(false));
        Assert.Null(health.Observe(false));
    }

    /// <summary>RECOVERY IS REPORTED TOO — the half a once-only warning would never give you. Without it the
    /// log says supervision stopped and never says it came back, so the last thing an engineer reads is always
    /// the bad news.</summary>
    [Fact]
    public void Recovery_is_reported()
    {
        var health = new ProbeHealth();
        health.Observe(false);

        var msg = health.Observe(true);

        Assert.NotNull(msg);
        Assert.Contains("recovered", msg);
    }

    /// <summary>AND THE CYCLE REPEATS CLEANLY. A machine that latched after one episode would go quiet for the
    /// rest of the session — the failure mode is the same silence, just delayed.</summary>
    [Fact]
    public void A_second_episode_speaks_again()
    {
        var health = new ProbeHealth();

        Assert.NotNull(health.Observe(false));   // episode 1 starts
        Assert.NotNull(health.Observe(true));    // ...and ends
        Assert.NotNull(health.Observe(false));   // episode 2 starts
        Assert.NotNull(health.Observe(true));    // ...and ends
    }

    /// <summary>A PROBE THAT STARTS BROKEN reports on its very first observation. The connector launches before
    /// the IDEs are up, so "failing from the start" is an ordinary state, not an edge case — and it is exactly
    /// the state where an engineer is most likely to be wondering where their bridge is.</summary>
    [Fact]
    public void A_probe_broken_from_the_first_observation_still_reports()
        => Assert.NotNull(new ProbeHealth().Observe(false));
}
