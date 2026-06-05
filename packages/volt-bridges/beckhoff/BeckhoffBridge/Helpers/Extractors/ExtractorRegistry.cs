using System.Collections.Generic;

namespace BeckhoffBridge.Helpers.Extractors;

/// <summary>
/// Closed registry of per-kind <see cref="IConfigExtractor"/>s. Mirrors
/// the CODESYS bridge's EXTENSIONS list (one entry per tracked
/// vendor-neutral kind).
///
/// Lookup is by the kind string the agent expects — same vocabulary
/// pinned by the agent's `extension-registry.ts` + the
/// `bridge-agent-vocabulary.test.ts` contract test.
///
/// Adding a new kind: write a new <see cref="IConfigExtractor"/>
/// implementation under <c>Helpers/Extractors/</c>, then register one
/// entry below. The Beckhoff side then matches the CODESYS side.
/// </summary>
internal static class ExtractorRegistry
{
	private static readonly Dictionary<string, IConfigExtractor> ByKind = BuildByKind();

	private static Dictionary<string, IConfigExtractor> BuildByKind()
	{
		var list = new IConfigExtractor[]
		{
			new TaskExtractor(),
			new LibraryExtractor(),
			new LibraryManagerExtractor(),
			new SymbolConfigExtractor(),
			new ProjectInfoExtractor(),
			new RecipeManagerExtractor(),
			new ImagePoolExtractor(),
			new TextListExtractor(),
			new VisualizationManagerExtractor(),
			new VisualizationExtractor(),
			new ClassDiagramExtractor(),
			new ExternalTypesExtractor(),
			new TmcFileExtractor(),
			new DeviceExtractor(),
			new TraceExtractor(),
		};
		var map = new Dictionary<string, IConfigExtractor>(list.Length);
		foreach (var ext in list)
		{
			if (map.ContainsKey(ext.Kind))
				throw new System.InvalidOperationException(
					$"ExtractorRegistry: duplicate kind '{ext.Kind}' — two extractors claim the same kind");
			map[ext.Kind] = ext;
		}
		return map;
	}

	/// <summary>Look up an extractor by vendor-neutral kind string.
	/// Returns null when no extractor is registered for that kind —
	/// caller is responsible for deciding whether to fall back to
	/// opaque XML (only for kinds the agent registers but we
	/// deliberately don't have a typed extractor for).</summary>
	public static IConfigExtractor? Get(string kind)
	{
		return ByKind.TryGetValue(kind, out var ext) ? ext : null;
	}

	/// <summary>True iff the registry has a typed extractor for the
	/// kind. Used by handlers to detect unregistered kinds (which get
	/// SKIPPED with a warning — no opaque-XML fallback, per the
	/// no-fallbacks rule). The closed kind set declared in
	/// <see cref="BuildByKind"/> must stay in sync with the agent's
	/// extension-registry.ts.</summary>
	public static bool HasExtractor(string kind) => ByKind.ContainsKey(kind);
}
