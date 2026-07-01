// Check if the etherCAT network is Ok.
{attribute 'symbol' := 'none'}
PROGRAM EtherCAT_Diag
VAR
	EtherCATDiagFB		: L_ETC_GetMasterDiagnostic;
	ReInitAllNodes		: L_MC1P.L_MC1P_ReinitAllNodes;
	etherCatOk			: BOOL;					// The EtherCAT bus is ok and running.
	EtherCatAlarm		: SetErrorFB;
	GlobalResetTrigger	: TriggerFB;
	StartupTrigger		: RisingTriggerFB;
	StartupTimer		: BTON;
	restartingEtherCAT	: BOOL;
END_VAR

// Do not call EtherCAT_Master() FB!

EtherCATDiagFB(
	xReset		:= ,	// A positive edge (TRUE) resets the error counters and the output xNotAllSlavesOperational in the output structure oDiagnostic. Exception: "Frame Lost Counter"
	xDone		=> ,
	xBusy		=> ,
	xError		=> ,
	eErrorCode	=> ,
	oDiagnostic	=> );

// Use a trigger to give the FB a xReset input when G_xGlobalReset is pushed
IF GlobalResetTrigger.AnyEdge(CLK := GlobalVars.Reset) THEN
	EtherCATDiagFB.xReset	:= GlobalVars.Reset AND EtherCATDiagFB.oDiagnostic.xNotAllSlavesOperational;
END_IF


ReInitAllNodes(
	xExecute	:= ,
	xInitCommunication := ,
	xDone		=> ,
	xBusy		=> ,
	xError		=> ,
	eErrorID	=> );

etherCatOk		:=  EtherCATDiagFB.oDiagnostic.wState = L_ETC_STATE.ETC_STATE_OPERATIONAL
			AND		EtherCATDiagFB.oDiagnostic.xEthernetLinkup
			AND		EtherCATDiagFB.oDiagnostic.xDC_Enabled
			AND		EtherCATDiagFB.oDiagnostic.xDC_InSync
			AND NOT EtherCATDiagFB.oDiagnostic.xBusMismatch
			AND NOT EtherCATDiagFB.oDiagnostic.xNotAllSlavesOperational;

EtherCatAlarm(
	moduleHandler	:= ErrorHandling.ModuleHandler,
	textRefId		:= SER_Errors,
	errorId			:= 7,		// EtherCAT network failure detected
	alarmCondition	:= NOT etherCatOk,
	alarmDelay		:= 5.0,
	severity		:= enumErrorSeverity.Fault,
	reaction		:= enumErrorReaction.Stop,
	active			=> );

// Needed because Keyence controller boots up slower than Lenze PLC. EthetCAT is not yet available on boot up.
IF StartupTrigger.Rising(CLK := StartupTimer.Set(NOT etherCatOk, 60)) THEN
	EtherCAT_Master.xRestart	:= TRUE;
	restartingEtherCAT			:= TRUE;
END_IF

IF restartingEtherCAT AND (EtherCAT_Master.xDone OR EtherCAT_Master.xError) THEN
	EtherCAT_Master.xRestart	:= FALSE;
	restartingEtherCAT			:= FALSE;
	StartupTimer.Reset();
END_IF

END_PROGRAM
