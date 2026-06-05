namespace BeckhoffBridge.Helpers.Extractors;

/// <summary>
/// One CODESYS-equivalent typed extractor for a single non-CRUD kind
/// (task / library / project_info / device / visualization / ...).
///
/// Mirrors the CODESYS bridge's TypeExtension pattern (see
/// volt-bridges/codesys/CodesysBridge/handlers/extensions.py). Each
/// implementation parses the item's ProduceXml() output (TwinCAT's
/// generic round-trippable serialization) into a deterministic text
/// manifest the agent writes to disk verbatim.
///
/// Contract — every implementation MUST:
///   1. Produce byte-stable output for unchanged TwinCAT state. Sort
///      collections deterministically (alphabetical, or document
///      order if document-order is semantically meaningful — task POU
///      call lists for example).
///   2. End the output with a trailing newline (LF only — gitattributes
///      handles cross-platform normalization on the agent side).
///   3. Throw on errors instead of returning ""/null. Empty output
///      from a healthy item is fine; silently swallowing a COM
///      failure masks the bridge's `bridge-can-also-be-buggy` failure
///      modes.
///
/// The extractor output flows two ways:
///   - As the workspace file's `sourceText` (engineer reads it raw).
///   - SHA1-hashed into the item's `version` for /refs and /fetch
///     drift detection. The constant-version bug — where `version =
///     configKind` produced the same hash for every task — is fixed
///     because the version is now content-aware.
/// </summary>
internal interface IConfigExtractor
{
	/// <summary>
	/// Vendor-neutral kind string — must match an entry in the agent's
	/// extension-registry.ts (e.g. "task", "library", "project_info").
	/// </summary>
	string Kind { get; }

	/// <summary>
	/// Render the item as a deterministic text manifest. See the
	/// contract on <see cref="IConfigExtractor"/> for the
	/// byte-stability guarantees expected.
	///
	/// Parameter is <c>object</c> (not <c>dynamic</c>) on purpose:
	/// a dynamic parameter would propagate through every method call
	/// inside the implementation, making ExtractorXml.Parse() / KindRoot
	/// / LINQ extension methods (FirstOrDefault) / overload resolution
	/// on ExtractorPairs.Add(...) all late-bound and prone to runtime
	/// binder failures. The COM cast (<c>(dynamic)item</c>) happens
	/// once inside <see cref="ExtractorXml.Parse"/> where it's needed.
	/// </summary>
	string Extract(object item);
}
