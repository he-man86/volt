using System;

namespace Volt.Wire;

/// <summary>A bridge pipe exists and refused this process — NAMED, not "access to the path is denied" (openspec
/// environment-dependency-audit 2.2). A bridge pipe admits its own user at either elevation (<see cref="PipeAcl"/>), so
/// what is left to refuse is an IDE serving under ANOTHER Windows user, or one elevated and still running a bridge from
/// before that ACL (whose default pipe gives an elevated process's Administrators-owned token full access and everyone
/// else read only).</summary>
public sealed class PipeAccessDeniedException : UnauthorizedAccessException
{
    public string PipeName { get; }

    public PipeAccessDeniedException(string pipeName, Exception inner)
        : base($"the IDE bridge on pipe '{pipeName}' refused this process (access denied): that IDE runs as another Windows "
               + "user, or elevated (\"as administrator\") with a Volt bridge older than this one. Run the IDE and Volt as the same "
               + "user, update Volt in the IDE, or run both elevated.", inner) =>
        PipeName = pipeName;
}
