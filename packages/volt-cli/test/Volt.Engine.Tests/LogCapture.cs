using System;
using System.IO;
using System.Linq;
using Volt.Contracts;

namespace Volt.Engine.Tests;

/// <summary>VoltLog into a private directory for one test (the assembly runs serially, TestParallelism.cs). The level
/// is the one the test asserts under: a line a test reads at <c>Info</c> is one a default bridge log keeps.</summary>
internal sealed class LogCapture : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "volt-log-test-" + Guid.NewGuid().ToString("N"));

    public LogCapture(VoltLogLevel level = VoltLogLevel.Debug)
    {
        VoltLog.Init("codesys", _dir);
        VoltLog.Level = level;
    }

    public string Read() =>
        Directory.Exists(_dir) ? string.Concat(Directory.GetFiles(_dir, "codesys-*.log").Select(File.ReadAllText)) : "";

    public void Dispose()
    {
        VoltLog.Level = VoltLogLevel.Info;
        try { Directory.Delete(_dir, true); } catch { }
    }
}
