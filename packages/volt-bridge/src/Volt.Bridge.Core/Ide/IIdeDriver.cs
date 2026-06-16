namespace Volt.Bridge.Core.Ide;

/// <summary>A complete vendor driver: session + tree + code store. The one type each vendor package
/// implements, and the one Core consumers (the sync services, the HTTP server) depend on. The three
/// facets stay separate so each reads as a focused contract.</summary>
public interface IIdeDriver : IIdeSession, IProjectTree, ICodeStore
{
}
