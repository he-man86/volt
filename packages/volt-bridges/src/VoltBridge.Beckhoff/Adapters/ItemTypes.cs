namespace VoltBridge.Beckhoff.Adapters;

/// <summary>
/// TwinCAT tree-item type codes → vendor-neutral kind strings.
/// Ported from v2 BeckhoffBridge's BlockTypeMapper with full type coverage.
/// 
/// Codes verified against TwinCAT XAE 15.0:
///   600 = NestedProject root    602 = Program (PRG)
///   601 = Folder                603 = Function (FC)
///   604 = Function Block (FB)   605 = Enumeration (DUT)
///   606 = Struct (DUT)          608 = Action
///   609 = Method                610 = Interface Method
///   611 = Property              612 = Interface Property
///   613 = Property Get          614 = Property Set
///   615 = Global Variable List  616 = Transition (SFC)
///   617 = Library Manager       618 = Interface
///   619 = Visualization         620 = Visualization Manager
///   621 = Task                  625 = GlobalTextList
///   628 = ImagePool             631 = Class Diagram (UML)
///   632 = RecipeManager         633 = Recipes container
///   650 = Task call reference   652 = External Types
///   653 = TMC file              654 = Interface Property Get
///   655 = Interface Property Set 657 = Library
/// </summary>
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
             613 => "property_get",
             614 => "property_set",
             615 => "gvl",
             616 => "transition",
             617 => "library_manager",
             618 => "interface",
             619 => "visualization",
             620 => "visualization_manager",
             621 => "task",
             625 => "text_list",
             628 => "image_pool",
             631 => "class_diagram",
             632 => "recipe_manager",
             633 => "recipe_manager",
             650 => "task_call_reference",
             652 => "external_types",
             653 => "tmc_file",
             654 => "interface_property_get",
             655 => "interface_property_set",
             657 => "library",
             _ when isTopLevelCrud => null,
             _ => null,
         };
    }

    /// <summary>True for source POU kinds (FB, function, program, GVL, DUT, interface).</summary>
    public static bool IsTopLevelCrud(int typeCode) =>
        typeCode is 602 or 603 or 604 or 605 or 606 or 615 or 618;

    /// <summary>True for items that live INSIDE a parent POU (method, action, property, transition).</summary>
    public static bool IsInlinedInPou(int typeCode) =>
        typeCode is 608 or 609 or 610 or 611 or 612 or 613 or 614 or 616 or 650 or 654 or 655;
}
