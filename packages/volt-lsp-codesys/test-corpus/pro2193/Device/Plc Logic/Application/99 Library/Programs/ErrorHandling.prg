{attribute 'symbol' := 'none'}
PROGRAM ErrorHandling
VAR_OUTPUT
	warningActive		: BOOL;
	errorActive			: BOOL;
	requestedReaction	: enumErrorReaction;
END_VAR
VAR
	{attribute 'hide'}
	{attribute 'init_on_onlchange'}
	_initialized				: BOOL	:= FALSE;	// Is high when init is done

	ModuleHandler				: L_IMHP.L_IMHP_ModuleHandler;	// Lenze module handler (No need to call this FB)

	TriggeredReset				: BTON;
	ResetErrorGlobal			: L_IE1P.L_IE1P_ResetErrorGlobal;

	ReadActualError				: ReadActualErrorFB;
END_VAR

IF NOT _initialized THEN
	Initialize();
	_initialized := TRUE;
END_IF

ResetErrorGlobal(
//	xResetError				:= TriggeredReset.Set(In := GlobalVars.Reset, Pt := 0.1),		// Give a rising edge every 50MS
	xResetError				:= GlobalVars.Reset,
	xError					=> ,
	eErrorID				=> ,
	xErrorResetActive		=> );

IF TriggeredReset.Q THEN
	TriggeredReset.Reset();
END_IF

ReadActualError(
	moduleHandler		:= ModuleHandler,
	warningActive		=> warningActive,
	errorActive			=> errorActive,
	requestedReaction	=> requestedReaction);

END_PROGRAM

METHOD PROTECTED Initialize
// Connect Lenze module handlers to this base module handler

GlobalVars.fbModuleManager.ModuleHandler.SetParent(
	ModuleHandlerParent	:= ModuleHandler,
	RelationShip		:= L_IMHP.L_IMHP_RelationshipID.ApplicationView);

GlobalVars_BFU.fbModuleManager.ModuleHandler.SetParent(
	ModuleHandlerParent	:= ModuleHandler,
	RelationShip		:= L_IMHP.L_IMHP_RelationshipID.ApplicationView);

PNOZMulti2.ModuleHandler.SetParent(
	ModuleHandlerParent	:= ModuleHandler,
	RelationShip		:= L_IMHP.L_IMHP_RelationshipID.ApplicationView);
END_METHOD
