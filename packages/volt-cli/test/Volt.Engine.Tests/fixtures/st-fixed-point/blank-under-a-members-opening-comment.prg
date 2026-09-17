PROGRAM ErrorHandling
VAR
	dummy	: BOOL;
END_VAR
(* @volt-implementation *)

END_PROGRAM

METHOD PROTECTED Initialize
// Connect Lenze module handlers to this base module handler
(* @volt-implementation *)

GlobalVars.fbModuleManager.ModuleHandler.SetParent(
	ModuleHandlerParent	:= ModuleHandler);
END_METHOD
