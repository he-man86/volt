# VoltBridge Scripting Engine extension stubs
# Provides type hints for CODESYS ScriptEngine when interacting
# with the VoltBridge HTTP daemon's item types.
#
# The Automation Server Connector uses this same pattern
# (ScriptLib\Stubs\scriptengine\__init__-extension.py) to register
# scripting extensions that the CODESYS IDE's ScriptEngine can
# discover and provide auto-complete for.

# Scripting Engine types surfaced by VoltBridge
# These match the vendor-neutral kind strings in the bridge wire protocol:
#   function_block, function, program, interface, gvl,
#   structure, enumeration, union, alias,
#   library, task, device, trace, image_pool, text_list,
#   recipe_manager, visualization_manager, visualization,
#   symbol_config, project_info, library_manager,
#   class_diagram, external_types, tmc_file, folder

__volt_version__ = "1.0.0"
