namespace Volt.Engine.Ide;

/// <summary>A complete vendor driver: session + tree + code store. The one type each vendor package
/// implements, and the one Core consumers (the <c>Sync/</c> services and <c>Wire/BridgePipeHost</c>) depend on. The three
/// facets stay separate so each reads as a focused contract.</summary>
public interface IIdeDriver : IIdeSession, IProjectTree, ICodeStore
{
}
