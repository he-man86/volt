namespace VoltBridge.Beckhoff;

public static class ItemTypes
{
    public static string? Map(int typeCode, bool isTopLevelCrud)
    {
        return typeCode switch
        {
            0 => "system_root",
            601 => "folder",
            602 => "program",
            603 => "function",
            604 => "function_block",
            605 => "enumeration",
            606 => "structure",
            608 => "action",
            609 => "method",
            610 => "interface_method",
            611 => "property",
            612 => "interface_property",
            615 => "gvl",
            616 => "transition",
            617 => "library_manager",
            618 => "interface",
            619 => "visualization",
            620 => "visualization_manager",
            621 => "task",
            625 => "global_text_list",
            628 => "image_pool",
            631 => "class_diagram",
            632 => "recipe_manager",
            650 => "task_call_reference",
            652 => "external_types",
            653 => "tmc_file",
            654 => "interface_property_get",
            655 => "interface_property_set",
            657 => "library",
            _ when isTopLevelCrud => null,
            _ => "config",
        };
    }
}
