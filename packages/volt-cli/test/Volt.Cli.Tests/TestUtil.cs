using System;
using System.IO;
using Volt.Cli.Sync;

namespace Volt.Cli.Tests;

/// <summary>Shared test helpers — a throwaway git repo with a definite identity, and a Windows-safe recursive
/// delete (git marks loose objects read-only, which plain Directory.Delete can't remove).</summary>
internal static class TestUtil
{
    public static string NewRepo()
    {
        Environment.SetEnvironmentVariable("GIT_AUTHOR_NAME", "t");
        Environment.SetEnvironmentVariable("GIT_AUTHOR_EMAIL", "t@t");
        Environment.SetEnvironmentVariable("GIT_COMMITTER_NAME", "t");
        Environment.SetEnvironmentVariable("GIT_COMMITTER_EMAIL", "t@t");
        var dir = Directory.CreateTempSubdirectory("volt-test-").FullName;
        Git.GitInit(dir);
        return dir;
    }

    /// <summary>
    /// <paramref name="call"/> on a THREAD OF ITS OWN, never the thread pool's — for a test that runs a BLOCKING call
    /// (a <see cref="Volt.Wire.PipeClient"/> call, a pipe server) beside its own body. xunit runs test bodies on the pool
    /// and the suite's bodies block on pipes and events, so on a loaded or 2-core machine the pool is saturated and a
    /// <c>Task.Run</c> waits for the pool to inject a thread (about one per half second, behind every other queued
    /// item): the call had not even STARTED when the test's 15 s liveness bound expired. A real client is its own
    /// process and never waits on this one's pool, so the test must not either.
    /// </summary>
    public static Task<T> OnOwnThread<T>(Func<T> call) =>
        Task.Factory.StartNew(call, CancellationToken.None,
            TaskCreationOptions.LongRunning, TaskScheduler.Default);

    /// <inheritdoc cref="OnOwnThread{T}(Func{T})"/>
    public static Task OnOwnThread(Action call) =>
        Task.Factory.StartNew(call, CancellationToken.None,
            TaskCreationOptions.LongRunning, TaskScheduler.Default);

    public static void ForceDelete(string dir)
    {
        if (!Directory.Exists(dir)) return;
        foreach (var f in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories))
            try { File.SetAttributes(f, FileAttributes.Normal); } catch { /* best effort */ }
        try { Directory.Delete(dir, true); } catch { /* best effort */ }
    }
}
