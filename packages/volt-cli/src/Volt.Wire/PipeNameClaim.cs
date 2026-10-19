using System;
using System.IO;
using System.Threading;

namespace Volt.Wire;

/// <summary>This process's claim on a pipe name (<see cref="PipeServer.TakeName"/>), held until disposed. Dispose it on
/// the thread that took it: the mutex under it is thread-affine.</summary>
public sealed class PipeNameClaim : IDisposable
{
    private Mutex? _mutex;

    internal PipeNameClaim(string pipeName, Mutex mutex)
    {
        PipeName = pipeName;
        _mutex = mutex;
    }

    public string PipeName { get; }

    /// <summary>Give the name back. Idempotent; a release from a thread that does not own the mutex is swallowed (the
    /// OS drops it with the process, and the next claim takes it over as abandoned).</summary>
    public void Dispose()
    {
        var held = Interlocked.Exchange(ref _mutex, null);
        if (held is null) return;
        lock (PipeServer.Served) { PipeServer.Served.Remove(PipeName); }
        try { held.ReleaseMutex(); }
        catch (ApplicationException) { /* not the owning thread */ }
        held.Dispose();
    }
}

/// <summary>A pipe name another server holds (<see cref="PipeServer.TakeName"/>).</summary>
public sealed class PipeNameTakenException : IOException
{
    public PipeNameTakenException(string pipeName)
        : this(pipeName, $"pipe '{pipeName}' is already served by another Volt bridge.") { }

    public PipeNameTakenException(string pipeName, string message) : base(message) => PipeName = pipeName;

    public string PipeName { get; }
}
