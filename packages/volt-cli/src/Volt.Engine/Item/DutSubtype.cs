namespace Volt.Engine.Item;

/// <summary>A DUT's subtype AS ITS VENDOR STATES IT — the one fact a DUT's wire name carries beyond its kind
/// (openspec <c>push-without-header-check</c> 5.B). A closed set, so a driver cannot invent an extension: the
/// extension is spelt only in <see cref="ItemKind.SourceKindExtensions"/>, through <see cref="ItemKind.DutExtension"/>.
///
/// <para>It travels on <see cref="ItemContent.DutSubtype"/>, set by the driver's <c>ReadContent</c>. <b>Null there is
/// "the vendor has no answer"</b>, and the item is published as <c>name.dut</c> — the one counted fallback of the
/// change (design.md, step 5.B, "Counted fallbacks"). A CODESYS text-list enumeration
/// (<c>ITextListEnumerationObject</c>) answers <see cref="Enum"/>.</para></summary>
public enum DutSubtype
{
    Struct,
    Enum,
    Union,
    Alias,
}
