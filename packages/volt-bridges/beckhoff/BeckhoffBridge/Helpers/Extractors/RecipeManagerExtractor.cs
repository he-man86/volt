namespace BeckhoffBridge.Helpers.Extractors;

/// <summary>
/// Recipe Manager → text manifest of its configuration.
///
/// ProduceXml shape (typical):
/// <code>
/// &lt;TreeItem&gt;
///   &lt;Name&gt;RecipeManager&lt;/Name&gt;
///   &lt;RecipeManager&gt;
///     &lt;StorageType&gt;Textual&lt;/StorageType&gt;
///     &lt;StoragePath&gt;...&lt;/StoragePath&gt;
///     &lt;RecipeFileExtension&gt;txtrecipe&lt;/RecipeFileExtension&gt;
///     &lt;Separator&gt;:&lt;/Separator&gt;
///     &lt;SaveAtRuntime&gt;TRUE&lt;/SaveAtRuntime&gt;
///     &lt;SortRecipesAtRuntime&gt;FALSE&lt;/SortRecipesAtRuntime&gt;
///     &lt;WithValueCheck&gt;TRUE&lt;/WithValueCheck&gt;
///     &lt;UnicodeRecipeFile&gt;FALSE&lt;/UnicodeRecipeFile&gt;
///     &lt;UpdateValueChange&gt;TRUE&lt;/UpdateValueChange&gt;
///   &lt;/RecipeManager&gt;
/// &lt;/TreeItem&gt;
/// </code>
///
/// The actual recipe definitions live as separate child items (under
/// the Recipes container, ItemType 633) and the walker emits each
/// recipe child separately. This extractor captures just the manager's
/// own settings.
/// </summary>
internal sealed class RecipeManagerExtractor : IConfigExtractor
{
	public string Kind => "recipe_manager";

	public string Extract(object item)
	{
		var doc = ExtractorXml.Parse(item);
		var root = ExtractorXml.KindRoot(doc);

		return new ExtractorPairs()
			.Add("storage-type", ExtractorXml.ChildText(root, "StorageType"))
			.Add("storage-path", ExtractorXml.ChildText(root, "StoragePath"))
			.Add("recipe-file-extension", ExtractorXml.ChildText(root, "RecipeFileExtension"))
			.Add("separator", ExtractorXml.ChildText(root, "Separator"))
			.Add("save-at-runtime", ExtractorXml.ChildBool(root, "SaveAtRuntime"))
			.Add("sort-recipes-at-runtime", ExtractorXml.ChildBool(root, "SortRecipesAtRuntime"))
			.Add("with-value-check", ExtractorXml.ChildBool(root, "WithValueCheck"))
			.Add("unicode-recipe-file", ExtractorXml.ChildBool(root, "UnicodeRecipeFile"))
			.Add("update-value-change", ExtractorXml.ChildBool(root, "UpdateValueChange"))
			.Build();
	}
}
