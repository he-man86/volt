namespace Volt.Contracts;

/// <summary>
/// The command-line FLAGS of the connector → spawned-worker contract, defined once. The connector reaches an
/// external-attach IDE host (the TwinCAT worker exe) by process argv — a contract with no ProjectReference behind
/// it, so before this table a rename on one side compiled, linked and passed every suite while at runtime the child
/// exited non-zero, the pid probe read that as "probe failed", the supervisor left the fleet alone, and a newly
/// opened XAE silently never got a bridge. Both sides now reference these consts, so the rename is a build error.
/// <para>Lives in Transport because it is the only project BOTH the connector (<c>Volt.Cli.Connector</c> /
/// <c>Volt.Cli.Connector.Core</c>) and the IDE host (<c>Volt.Cli.Ide.Twincat</c>) already reference; putting it in
/// Connector.Core would make the worker reference the connector and invert the layering.</para>
/// <para><b>Deliberately flags ONLY.</b> The exit codes stay raw integers at both ends: the moment they get names
/// someone compares against one, and the "bad arguments" exit reads as a SUCCESSFUL empty enumeration — which reaps
/// every healthy worker. The exe NAME is not here either: its authority is MSBuild (<c>AssemblyName</c>), so a C#
/// const would be one more spelling, not one fewer. Neither is the one-pid-per-line stdout format — that needs a
/// shared parser, not a constant.</para>
/// </summary>
public static class WorkerCli
{
    /// <summary>One-shot XAE discovery: print each running XAE window's process id, one per line, and exit.</summary>
    public const string ListXaePids = "--list-xae-pids";

    /// <summary>The ONE XAE window a worker owns, as <c>--xae-pid &lt;pid&gt;</c>. Required to serve.</summary>
    public const string XaePid = "--xae-pid";
}
