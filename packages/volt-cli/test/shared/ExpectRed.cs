using System;

namespace Volt.Tests.Shared;

/// <summary>
/// A RED TEST THAT CANNOT GO STALE (openspec <c>bridge-one-to-one</c> §2: oracles, red first). The body states what the
/// product MUST do once the named task lands; today it does not, so the body fails — and that failure is the expected
/// outcome. The moment the body PASSES, this helper fails the test: "finding N holds now — remove the mark". So the
/// suites stay green while the debt is visible, and a fix cannot leave a stale mark behind (the C# twin of bun's
/// <c>test.failing</c>).
///
/// <para>The red is an ASSERTION that does not hold yet (<c>Xunit.Sdk.XunitException</c>: every <c>Assert.*</c> failure,
/// <c>Assert.Throws</c> included), or the one product exception a mark names FOR THE REASON it names
/// (<see cref="Until{TRed}"/>: a parse the format does not take yet, its message holding <c>because</c>). ANY other
/// exception — the named type thrown for another reason included — — a slip in the test, an index past the end, a NullReference — is NOT
/// the red: it propagates and fails the test, so a mark cannot stay "red" for a reason its finding does not name once
/// the product changes under it. The reason is kept on the <see cref="LastRed"/> slot for a test that wants to say WHY
/// it is red; <c>VOLT_EXPECT_RED_TRACE=&lt;file&gt;</c> writes every red body's reason, one line each.</para>
/// </summary>
public static class ExpectRed
{
    /// <summary>The exception the last red body raised (per thread), for diagnostics.</summary>
    [ThreadStatic] public static Exception? LastRed;

    private static readonly object TraceLock = new();

    /// <summary>Run <paramref name="body"/>; an assertion in it must FAIL until <paramref name="task"/> lands. Throws when
    /// it passes, naming the task and the finding; any exception but an assertion's propagates.</summary>
    public static void Until(string task, string finding, Action body) => Run(task, finding, body, null);

    /// <summary>As <see cref="Until(string, string, Action)"/>, and <typeparamref name="TRed"/> — the product's refusal
    /// the finding names — is the red too, when its message holds <paramref name="because"/> (the refusal's own words
    /// for what the finding names: <c>'Core' is not a task field</c>). The same type thrown for another reason is not
    /// the red: it propagates.</summary>
    public static void Until<TRed>(string task, string finding, string because, Action body) where TRed : Exception
    {
        if (string.IsNullOrEmpty(because))
            throw new ArgumentException("a mark naming a product exception names the reason it is red", nameof(because));
        Run(task, finding, body, ex => ex is TRed && ex.Message.IndexOf(because, StringComparison.Ordinal) >= 0);
    }

    private static void Run(string task, string finding, Action body, Func<Exception, bool>? red)
    {
        try { body(); }
        catch (Exception ex) when (ex is Xunit.Sdk.XunitException || (red is not null && red(ex)))
        {
            LastRed = ex;
            if (Environment.GetEnvironmentVariable("VOLT_EXPECT_RED_TRACE") is { Length: > 0 } trace)
                lock (TraceLock)
                    System.IO.File.AppendAllText(trace,
                        $"{finding}\n    {ex.GetType().Name}: {ex.Message.Replace("\r", "").Replace("\n", "\n    ")}\n");
            return;
        }
        throw new StaleRedMarkException(
            $"ExpectRed: '{finding}' holds now — task {task} closed it. Remove the ExpectRed mark (the test is green).");
    }
}

/// <summary>A red mark whose body passes: the finding it named is fixed and the mark must go.</summary>
public sealed class StaleRedMarkException : Exception
{
    public StaleRedMarkException(string message) : base(message) { }
}
