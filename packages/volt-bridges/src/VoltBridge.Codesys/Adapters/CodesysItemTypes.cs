namespace VoltBridge.Codesys.Adapters;

/// <summary>
/// Maps CODESYS Scripting Engine item types to vendor-neutral kind strings.
/// CODESYS uses the Scripting API which exposes type information via various
/// properties (PouType, ObjectType, etc.) rather than numeric COM type codes.
/// This mapper normalizes them to the same vocabulary Beckhoff uses.
/// </summary>
public static class CodesysItemTypes
{
    /// <summary>
    /// Map a CODESYS POU type or object type to the vendor-neutral kind string.
    /// Returns null for items that shouldn't be tracked (non-CRUD children, etc.).
    /// </summary>
    public static string? Map(string? pouType, bool isTopLevelCrud)
    {
        if (pouType == null) return isTopLevelCrud ? null : "config";

        return pouType switch
        {
            "program" => "program",
            "function" => "function",
            "functionBlock" => "function_block",
            "interface" => "interface",
            "gvl" => "gvl",
            "struct" => "structure",
            "enum" => "enumeration",
            "union" => "union",
            "alias" => "alias",
            "action" => "action",
            "method" => "method",
            "property" => "property",
            "transition" => "transition",
            "library" => "library",
            "task" => "task",
            "device" => "device",
            "trace" => "trace",
            "imagePool" => "image_pool",
            "textList" => "text_list",
            "recipeManager" => "recipe_manager",
            "visualizationManager" => "visualization_manager",
            "visualization" => "visualization",
            "symbolConfig" => "symbol_config",
            "projectInfo" => "project_info",
            "libraryManager" => "library_manager",
            "classDiagram" => "class_diagram",
            "externalTypes" => "external_types",
            "tmcFile" => "tmc_file",
            "folder" => "folder",
            _ when isTopLevelCrud => null,
            _ => "config",
        };
    }
}
