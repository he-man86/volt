{attribute 'symbol' := 'none'}
PROGRAM BFU
VAR
	ModuleHandler				: L_IMHP.L_IMHP_IModuleHandler := GlobalVars_BFU.fbModuleManager.ModuleHandler;
END_VAR
VAR_INPUT
	DigIn						: BFU_InputsType;

	{attribute 'symbol' := 'read'}	GateBFU					: GateMagnetFB
	(
		instanceNo		:= 1,
		moduleManager	:= GlobalVars_BFU.fbModuleManager,
		moduleParent	:= ModuleHandler,
	);

	{attribute 'symbol' := 'read'}	GateConveyor			: GateMagnetFB
	(
		instanceNo		:= 2,
		moduleManager	:= GlobalVars_BFU.fbModuleManager,
		moduleParent	:= ModuleHandler,
	);

//	VacuumPumps					: VacuumPumpDualFB;		// See BoxInfeedFB
END_VAR

VAR_OUTPUT
	MainAirValve				: ActuatorFB;
	Stacklight					: StacklightFB;
	ResetSignalOut				: ActuatorFB;
	WorkingLights				: LedFB;			// Illuminate the inside of the machine
	Buzzer						: LedFB;
	warningActive				: BOOL;
	errorActive					: BOOL;
	requestedReaction			: enumErrorReaction;
END_VAR

VAR//VISU
	{attribute 'symbol' := 'read'}	moduleTimeoutMessage		: STRING(255);

END_VAR

VAR
	i							: INT;

	productionUnitMode			: PACK_ML.UnitMode;
	semiAutoUnitMode			: PACK_ML.UnitMode;
	cleaningUnitMode			: PACK_ML.UnitMode;

	OperationModeManager		: PACK_ML.UnitModeManager;	// Unit mode manager to switch between unitmodes
	currentOperationMode		: PACK_ML.IUnitMode;		// Interface to current unit mode
	{attribute 'hide'}
	_operationMode				: SER_OperationModeType;	// Current operation mode (as an enumeration)

	State						: StateMachineHistoryFB(instanceName:= 'BFU');

	{attribute 'init_on_onlchange'}		// Reset this option with every online change.
	semiAutoInContinuousMode	: BOOL;	// Semi-auto mode does not wait for button input. Dry-cycle run active.

	xGatesAreClosed				: BOOL;
	xGatesLockButtonPushed		: BOOL;
	xServoDrivesEnabled			: BOOL;
	airPressureWasDetectedWhileResetting		: BOOL;

	SetError					: ARRAY[4..6] OF SetErrorFB;

	InAutomaticOperationTrigger	: TriggerFB;
END_VAR

Initialize();
PackML();
Cyclic();
Alarms();

END_PROGRAM

// Wait state – A state which represents an error state on the SER which
// will generate an alarm or warning. In this state the unit/machine is not
// producing, until the operator made a transition to the EXECUTING state.
// The state holds the SER operations while material blockage
// are cleared, or safe correction of an equipment fault before the
// production may be resumed.
METHOD PRIVATE Aborted
%FOLDER PackML States
// Wait for user input, e.g. button press

GlobalVars_BFU.EnableMainvalve		:= FALSE;

IF ErrorHandling.requestedReaction <> enumErrorReaction.FastStop THEN
	currentOperationMode.Clear();		// State change to: Clearing		<-- Press F12 here
END_IF
END_METHOD

// Acting State
METHOD PRIVATE Aborting
VAR	// These variables will be reset every PLC cycle.
	allModulesDone	: BOOL := TRUE;
	ui				: UINT;
END_VAR
VAR_INST
	eStopResult		: ARRAY[1..GVL_Constants_BFU.MaxNumberOfModules] OF BOOL;
	EStopTimeout	: BTON;
END_VAR
%FOLDER PackML States
// EStop requested

IF State.Changed THEN
	BfuButtons.StartCycle.Off();
	Stacklight.Green.Off();

	BfuButtons.Stop.Off();
	BfuButtons.EndCycle.Off();

	EStopTimeout.Reset();

	FOR ui := 1 TO GlobalVars_BFU.fbModuleManager.baseModulesCount DO
		eStopResult[ui] := FALSE;
	END_FOR
END_IF

// Kill air pressure (but allow power to the servo's to decelerate the drives)
GlobalVars_BFU.EnableMainvalve	:= FALSE;


// Iterate through all modules
FOR ui := 1 TO GlobalVars_BFU.fbModuleManager.baseModulesCount DO

	// Only execute the EStop method when result bool is false.
	IF NOT eStopResult[ui] THEN
		eStopResult[ui] := GlobalVars_BFU.fbModuleManager.baseModules[ui].EStop();
	END_IF

	// Reset allModulesDone when any stopResult bool in the array is still false
	allModulesDone	R= NOT eStopResult[ui];
END_FOR


// Start a timer of 200ms. This time is set in the Pilz safety relay.
// Drives must be stopped when timer expires.
IF allModulesDone OR EStopTimeout.Set(TRUE, 0.2) THEN
	currentOperationMode.ActingStateCompleted();		// State change to: Aborted		<-- Press F12 here
END_IF
END_METHOD

METHOD PRIVATE Alarms
//SetError[1](
//	moduleHandler	:= ModuleHandler,
//	textRefId		:= BFU_Errors,
//	errorId			:= 1,		// Fatal- 0000 - Emergency Stop
//	alarmCondition	:= GlobalVars.EmergencyStopActive,
//	alarmDelay		:= 0.0,
//	severity		:= enumErrorSeverity.Fault,
//	reaction		:= enumErrorReaction.FastStop,
//	active			=> );

//SetError[2](
//	moduleHandler	:= ModuleHandler,
//	textRefId		:= BFU_Errors,
//	errorId			:= 2,
//	alarmCondition	:= NOT DigIn.quickStopOk,
//	alarmDelay		:= 0.0,
//	severity		:= enumErrorSeverity.Information,
//	reaction		:= enumErrorReaction.No_reaction,
//	active			=> );

SetError[4](
	moduleHandler	:= ModuleHandler,
	textRefId		:= BFU_Errors,
	errorId			:= 16,		// Alarm- 0002 - Check air pressure alarm
	alarmCondition	:= GlobalVars_BFU.EnableMainvalve AND NOT DigIn.xAirPressureOK AND SER.DigIn.fuseOk[3] AND PNOZMulti2.xEnableAirBFU,
	alarmDelay		:= 30.0,
	severity		:= enumErrorSeverity.Fault,
	// When gate is opened, make a fatal alarm. To make sure that air pressure does not come back when someone is in the machine.
	reaction		:= SEL(xGatesAreClosed, enumErrorReaction.FastStop, enumErrorReaction.No_reaction),
	active			=> );

SetError[5](
	moduleHandler	:= ModuleHandler,
	textRefId		:= BFU_Errors,
	errorId			:= 17,		// Press Acknowlege buttons to confirm gate closed
	alarmCondition	:= xGatesAreClosed AND NOT DigIn.xSafetyGateRelay,
	alarmDelay		:= 5.0,
	severity		:= enumErrorSeverity.Warning,
	reaction		:= enumErrorReaction.No_reaction,
	active			=> );

SetError[6](
	moduleHandler	:= ModuleHandler,
	textRefId		:= BFU_Errors,
	errorId			:= 21,// Air pressure dropped while resetting
	alarmCondition	:= SER.ActState = PACK_ML.State.Resetting AND airPressureWasDetectedWhileResetting AND NOT DigIn.xAirPressureOK,
	alarmDelay		:= 1.0,
	severity		:= enumErrorSeverity.Fault,
	reaction		:= enumErrorReaction.Stop,
	active			=> );
END_METHOD

// Acting State
METHOD PRIVATE Clearing
%FOLDER PackML States
// No actions needed here

currentOperationMode.ActingStateCompleted();		// State change to: Stopped		<-- Press F12 here
END_METHOD

// Wait State – A stable state, the SER has achieved a defined set of conditions.
METHOD PRIVATE Completed
%FOLDER PackML States
BfuButtons.StartCycle.Off();
Stacklight.Green.Off();
BfuButtons.Stop.Solid();
BfuButtons.EndCycle.Off();

currentOperationMode.Stop();		// State change to: Stopping
END_METHOD

// Acting State
METHOD PRIVATE Completing
VAR	// These variables will be reset every PLC cycle.
	allModulesDone	: BOOL := TRUE;
	ui				: UINT;
END_VAR
VAR_INST
	completeResult	: ARRAY[1..GVL_Constants_BFU.MaxNumberOfStartableModules] OF BOOL;
END_VAR
%FOLDER PackML States
// End cycle is requested
// Wait here for the BFU to finish the last cycle(s)

IF State.Changed THEN
	FOR ui := 1 TO GlobalVars_BFU.fbModuleManager.startableModulesCount DO
		completeResult[ui] := FALSE;
	END_FOR
END_IF

BfuButtons.StartCycle.Flash();
Stacklight.Green.Flash();

moduleTimeoutMessage := 'Modules still completing: ';

FOR ui := 1 TO GlobalVars_BFU.fbModuleManager.StartableModulesCount DO

	// Request a cycle stop on all modules that are startable.
	IF NOT completeResult[ui] THEN
		completeResult[ui]	:= GlobalVars_BFU.fbModuleManager.startableModules[ui].StopCycle();
	END_IF

	IF NOT completeResult[ui] THEN
		allModulesDone	:= FALSE;	// Reset allModulesDone when any completeResult bool in the array is still false
		// Generate string to give info about which module is still completing
		SAFECONCAT3(ADR(moduleTimeoutMessage), GlobalVars_BFU.fbModuleManager.startableModules[ui].InstanceName, ', ', 250);
	END_IF

END_FOR

// All modules are done
IF allModulesDone THEN
	moduleTimeoutMessage := '';
	currentOperationMode.ActingStateCompleted();		// State change to: Completed		<-- Press F12 here
END_IF
END_METHOD

METHOD PRIVATE Cyclic
VAR_INST
	Blink_04sec						: BLINK;
	Blink_12sec						: BLINK;
	ChangingOperationMode			: BTON;
	TriggerStopRequested			: RisingTriggerFB;
	machineIdleTimeout				: BTON;
	workingLightsTimeout			: BTON;

	ReadActualError					: ReadActualErrorFB;
	ForwardSeverity					: L_IE1P.L_IE1P_ForwardSeverity;			// Forward alarms of children to parent
	ResetError						: L_IE1P.L_IE1P_ResetError;

END_VAR
MainAirValve();
Stacklight();
WorkingLights();
ResetSignalOut();
DigIn.workingLightsButton();

// Execute gate function blocks
GateBFU(
	xAcknowledge		:= DigIn.xSafetyGateRelay,
	xGateAllowedOpen	:= ActState = PACK_ML.State.Aborted OR ActState = PACK_ML.State.Stopped,// OR ActState = PACK_ML.State.Idle,	No Idle state for BFU.
	xRequestForOpening	:= ,
	xAcknowledgement	:= ,
	moduleThatBlocks	:= 0
);

GateConveyor(
	xAcknowledge		:= DigIn.xSafetyGateRelay,
	xGateAllowedOpen	:= ActState = PACK_ML.State.Aborted OR ActState = PACK_ML.State.Stopped,// OR ActState = PACK_ML.State.Idle,
	xRequestForOpening	:= ,
	xAcknowledgement	:= ,
	moduleThatBlocks	:= 0
);

// Check if all gates are closed
xGatesAreClosed			:= TRUE;
FOR i := 1 TO TO_INT(GlobalVars_BFU.fbModuleManager.gatesCount) DO
	IF GlobalVars_BFU.fbModuleManager.gates[i].GateState = enumGateStates.Opened THEN
		xGatesAreClosed	:= FALSE;
		EXIT;
	END_IF
END_FOR

// Check if the Lock button is pushed on any gate
xGatesLockButtonPushed	:= FALSE;
FOR i := 1 TO TO_INT(GlobalVars_BFU.fbModuleManager.gatesCount) DO
	IF GlobalVars_BFU.fbModuleManager.gates[i].LockButtonPushed THEN
		xGatesLockButtonPushed	:= TRUE;
		EXIT;
	END_IF
END_FOR

// Set Global Reset variable
ResetSignalOut.SetOrReset(GlobalVars_BFU.Reset);

// Set stack light outputs
IF warningActive THEN
	Stacklight.Amber.Flash();
ELSE
	Stacklight.Amber.Off();
END_IF

IF errorActive THEN
	Stacklight.Red.Flash();
ELSE
	Stacklight.Red.Off();
END_IF

IF errorActive THEN
	Buzzer.Flash();
ELSIF warningActive THEN
	Buzzer.SetOrReset(Blink_12sec.OUT AND Blink_04sec.OUT);
ELSE
	Buzzer.Off();
END_IF

IF BfuButtons.Stop.ButtonPushed
OR TriggerStopRequested.Rising(CLK	:= GlobalVars.manualControlRequested	// Extra maken voor BFU?
									//OR NOT xGatesAreClosed
									OR NOT DigIn.xSafetyGateRelay
									OR ReadActualError.requestedReaction = enumErrorReaction.Stop)
THEN
	currentOperationMode.Stop();		// State change to: Stopping
END_IF

IF ErrorHandling.requestedReaction = enumErrorReaction.FastStop THEN
	currentOperationMode.Abort();	// State change to: Aborting
END_IF

// Switch to emptying mode when button is pushed
IF BfuButtons.EmptyBFU.ButtonPushed
AND InAutomaticOperation
AND NOT SER.InAutomaticOperation
AND OperationMode <> SER_OperationModeType.CleaningMode
THEN
	HMI_BFU.OperationMode := SER_OperationModeType.CleaningMode;
END_IF

// Change the current unit mode
IF OperationMode <> HMI_BFU.OperationMode THEN
	IF OperationModeManager.SwitchUnitMode(TO_STRING(HMI_BFU.OperationMode)) THEN
		OperationMode			:= HMI_BFU.OperationMode;
		IF OperationMode = SER_OperationModeType.SemiAuto THEN
			PersistentVars.usiGlobalSERSpeed	:= LIMIT(1, PersistentVars.usiGlobalSERSpeed, 20);
		END_IF
	END_IF
END_IF
IF ChangingOperationMode.Set(In := OperationMode <> HMI_BFU.OperationMode, Pt := 1) THEN
	HMI_BFU.OperationMode			:= OperationMode;
	ChangingOperationMode.Reset();
END_IF

currentOperationMode		:= OperationModeManager.ActiveUnitMode;

// Handle servo drives
xServoDrivesEnabled			:= TRUE;
FOR i := 1 TO TO_INT(GlobalVars_BFU.fbModuleManager.servoDrivesCount) DO
	IF NOT GlobalVars_BFU.fbModuleManager.servoDrives[i].AxisEnabled THEN
		xServoDrivesEnabled	:= FALSE;
		EXIT;
	END_IF
END_FOR

// Set main air valve output
MainAirValve.SetOrReset(GlobalVars_BFU.EnableMainvalve);

// Bool is high when SER is running in automatic operation
InAutomaticOperationTrigger.Call(  ActState = PACK_ML.State.Starting
								OR ActState = PACK_ML.State.Execute
								OR ActState = PACK_ML.State.Holding
								OR ActState = PACK_ML.State.Held
								OR ActState = PACK_ML.State.UnHolding
								OR ActState = PACK_ML.State.Suspending
								OR ActState = PACK_ML.State.Suspended
								OR ActState = PACK_ML.State.UnSuspending
								OR ActState = PACK_ML.State.Completing);

// Limit the speed from 1 to 100% (because VisiWinNet does not support subrange types)
PersistentVars.usiGlobalBFUSpeed := LIMIT(1, PersistentVars.usiGlobalBFUSpeed, 100);

// Turn off vacuum pumps and main air valve after timeout
IF machineIdleTimeout.Set(	In := (ActState = PACK_ML.State.Idle OR ActState = PACK_ML.State.Stopped OR ActState = PACK_ML.State.Complete)
							  AND GlobalVars_BFU.EnableMainvalve
							  AND NOT PNOZMulti2.xOperatorSwitch,
							Pt := TO_REAL(PersistentVars.BrinkRecipeVars.machineIdleShutoffTime.value * 60))
THEN
	GlobalVars_BFU.EnableMainvalve	:= FALSE;
END_IF

// Working lights control
IF workingLightsTimeout.Set(In := WorkingLights.Map(), Pt := PersistentVars.BrinkRecipeVars.workingLightsTime.value * 60) THEN
	WorkingLights.Off();
END_IF

IF State.Changed
OR DigIn.workingLightsButton.ButtonPushed
OR BfuButtons.StartCycle.ButtonPushed
OR BfuButtons.EndCycle.ButtonPushed
OR BfuButtons.Reset.ButtonPushed
OR GateBFU.ButtonUnLock.ButtonPushed
THEN
	workingLightsTimeout.Reset();
	WorkingLights.Solid();
END_IF

// Read alarm severity of BFU (sub)modules
ReadActualError(
	moduleHandler				:= ModuleHandler,
	warningActive				=> warningActive,
	errorActive					=> errorActive,
	requestedReaction			=> requestedReaction);

// Also enable alarms when safety controller has an alarm
warningActive					S= PNOZMulti2.warningActive;
errorActive						S= PNOZMulti2.errorActive;

ForwardSeverity(
	xEnable						:= TRUE,
	ModuleHandler				:= ModuleHandler,
	xForwardFromChildModules	:= TRUE,
	xDisableForwardToParent		:= ,
	xBusy						=> ,
	xError						=> ,
	eErrorID					=> );

ResetError(
	ModuleHandler				:= ModuleHandler,
	ErrorHandler				:= ,
	xResetError					:= GlobalVars_BFU.Reset,
	xError						=> ,
	eErrorID					=> ,
	xErrorResetActive			=> ,
	xResetActive				=> );
END_METHOD

// Acting State - The unit/machine is in a stable acting state - unit/machine is producing.
METHOD PRIVATE Execute
%FOLDER PackML States
IF OperationMode = SER_OperationModeType.SemiAuto
THEN
	BfuButtons.Step.SetFlashingFrequency(TRUE);
	BfuButtons.Step.Flash();
END_IF

// Finish the cycle and stop the machine
IF BfuButtons.EndCycle.ButtonPushed
OR requestedReaction = enumErrorReaction.EndCycle
OR (	BFU.OperationMode = SER_OperationModeType.CleaningMode
	AND NOT Conveyors.Unit[1].HasStacks
	AND BoxCenterUnits.Unit[1].BoxCanBeFilled
	AND BoxCenterUnits.Unit[1].LayerIndex = 0
	)
THEN
	// Try to switch to Completing, if that state is not supported by this operation mode then switch to Stop instead.
	IF NOT currentOperationMode.ActingStateCompleted() THEN		// State change to: Completing		<-- Press F12 here
		currentOperationMode.Stop();		// State change to: Stopping
	END_IF
	RETURN;
END_IF
END_METHOD

// Wait state – A state which represents an error state on the BFU which
// will generate an alarm or warning. In this state the unit/machine is not
// producing, until the operator made a transition to the EXECUTING state.
// The state holds the BFU operations while material blockage
// are cleared, or safe correction of an equipment fault before the
// production may be resumed.
METHOD PRIVATE Held
%FOLDER PackML States
// Wait for reset button ????

IF TRUE THEN
	currentOperationMode.Unhold();		// State change to: UnHolding		<-- Press F12 here
END_IF
END_METHOD

// Acting State
METHOD PRIVATE Holding
%FOLDER PackML States
// An error has occured, or a pause is requested
// Halt the BFU cycle

currentOperationMode.ActingStateCompleted();		// State change to: Held		<-- Press F12 here
END_METHOD

// Wait State – A stable state, the BFU has achieved a defined set of conditions.
METHOD PRIVATE Idle
%FOLDER PackML States
currentOperationMode.Start();		// State change to: Starting		<-- Press F12 here
END_METHOD

METHOD PRIVATE Initialize
VAR_INST
	{attribute 'init_on_onlchange'}
	xInitialized	: BOOL;
END_VAR
IF xInitialized THEN
	RETURN;
END_IF

// Set up the different unit modes that a SER supports

productionUnitMode(			sName						:= TO_STRING(SER_OperationModeType.Production),
							dwSupportedStates			:= PACK_ML.State.All	- PACK_ML.State.Holding - PACK_ML.State.Held - PACK_ML.State.UnHolding
																				- PACK_ML.State.UnSuspending - PACK_ML.State.Suspended - PACK_ML.State.Suspending
																				- PACK_ML.State.Completing - PACK_ML.State.Complete,
							// Allowed to leave from this unit mode if the state is one of the following
							dwAllowsLeavingFromStates	:= PACK_ML.State.Stopped OR PACK_ML.State.Aborted OR PACK_ML.Execute,
							// Allowed to enter this unit mode if the state is one of the following
							dwAllowsEnteringIntoStates	:= productionUnitMode.dwAllowsLeavingFromStates,
							eInitialState				:= PACK_ML.State.Stopped,
							xActive						:= TRUE);

semiAutoUnitMode(			sName						:= TO_STRING(SER_OperationModeType.SemiAuto),
							dwSupportedStates			:= productionUnitMode.dwSupportedStates,
							dwAllowsLeavingFromStates	:= productionUnitMode.dwAllowsLeavingFromStates,
							dwAllowsEnteringIntoStates	:= productionUnitMode.dwAllowsEnteringIntoStates,
							eInitialState				:= PACK_ML.State.Stopped,
							xActive						:= FALSE);

cleaningUnitMode(			sName						:= TO_STRING(SER_OperationModeType.CleaningMode),
							dwSupportedStates			:= productionUnitMode.dwSupportedStates,
							dwAllowsLeavingFromStates	:= productionUnitMode.dwAllowsLeavingFromStates,
							dwAllowsEnteringIntoStates	:= productionUnitMode.dwAllowsEnteringIntoStates,
							eInitialState				:= PACK_ML.State.Stopped,
							xActive						:= FALSE);


// Register the unit modes with the manager
OperationModeManager.Register(productionUnitMode);
OperationModeManager.Register(semiAutoUnitMode);
OperationModeManager.Register(cleaningUnitMode);

// Sync current unit mode enumeration from HMI
OperationMode		:= HMI_BFU.OperationMode;

currentOperationMode		:= OperationModeManager.ActiveUnitMode;

xInitialized := TRUE;
END_METHOD

METHOD PRIVATE PackML
State(actState := TO_DINT(ActState));

CASE ActState OF
	PACK_ML.State.Stopped:		Stopped();
	PACK_ML.State.Resetting:	Resetting();
	PACK_ML.State.Idle:			Idle();
	PACK_ML.State.Starting:		Starting();
	PACK_ML.State.Execute:		Execute();
	PACK_ML.State.Holding:		Holding();
	PACK_ML.State.Held:			Held();
	PACK_ML.State.UnHolding:	UnHolding();
	PACK_ML.State.Suspending:	Suspending();
	PACK_ML.State.Suspended:	Suspended();
	PACK_ML.State.UnSuspending:	UnSuspending();
	PACK_ML.State.Completing:	Completing();
	PACK_ML.State.Complete:		Completed();
	PACK_ML.State.Stopping:		Stopping();
	PACK_ML.State.Aborting:		Aborting();
	PACK_ML.State.Aborted:		Aborted();
	PACK_ML.State.Clearing:		Clearing();

	PACK_ML.State.No,
	PACK_ML.State.All,
	PACK_ML.State.Invalid:		;
	ELSE						;
END_CASE
END_METHOD

// Acting State
METHOD PRIVATE Resetting
VAR	// These variables will be reset every PLC cycle.
	allModulesDone	: BOOL := TRUE;
	ui				: UINT;
	uj				: UINT;
END_VAR
VAR_INST
	startCondition	: ARRAY[1..GVL_Constants.MaxNumberOfResettableModules, 1..2] OF BOOL;
	resetResult		: ARRAY[1..GVL_Constants.MaxNumberOfResettableModules] OF BOOL;
END_VAR
%FOLDER PackML States
// Homing button was pushed
// All axes find the zero positions

IF State.Changed THEN
	BfuButtons.StartCycle.Solid();
	Stacklight.Green.Solid();
	BfuButtons.Stop.Off();
	BfuButtons.EndCycle.Off();

//	GlobalVars_BFU.manualControlRequested := FALSE;

	semiAutoInContinuousMode	:= FALSE;		// For safety, disable this option every time we reset the machine
	airPressureWasDetectedWhileResetting	:= FALSE;

	FOR ui := 1 TO GlobalVars_BFU.fbModuleManager.resettableModulesCount DO
		startCondition[ui,1]	:= FALSE;
		startCondition[ui,2]	:= FALSE;
		resetResult[ui]			:= FALSE;
	END_FOR
END_IF

IF BfuButtons.EndCycle.ButtonPushed THEN
	currentOperationMode.Stop();		// State change to: Stopping
	RETURN;
END_IF

// Wait until all servo drives have power
GlobalVars_BFU.EnableServoDrives := TRUE;
IF NOT xServoDrivesEnabled THEN
	RETURN;
END_IF

// Wait until the machine has air pressure
GlobalVars_BFU.EnableMainvalve S= PNOZMulti2.xEnableAirBFU;
IF NOT GlobalVars_BFU.EnableMainvalve
OR NOT DigIn.xAirPressureOK				// Do not continue when air pressure is missing
THEN
	IF NOT airPressureWasDetectedWhileResetting THEN
		RETURN;
	END_IF
END_IF

airPressureWasDetectedWhileResetting	:= TRUE;


moduleTimeoutMessage	:= 'Resetting active for modules: ';

// Iterate through all resettable modules
FOR ui := 1 TO GlobalVars_BFU.fbModuleManager.resettableModulesCount DO

	IF NOT startCondition[ui,1] THEN
		IF GlobalVars_BFU.fbModuleManager.resettableModules[ui].ResetCondition1 = 0 THEN
			startCondition[ui,1] := TRUE;						// Condition is not in use, so this condition is true.
		ELSE
			FOR uj := 1 TO GlobalVars_BFU.fbModuleManager.resettableModulesCount DO		// Find other module that needs to be done first
				IF GlobalVars_BFU.fbModuleManager.resettableModules[ui].ResetCondition1 = GlobalVars_BFU.fbModuleManager.resettableModules[uj] THEN
					startCondition[ui,1] := resetResult[uj];		// Copy result of other module
					EXIT;
				END_IF
			END_FOR
		END_IF
	END_IF

	IF NOT startCondition[ui,2] THEN
		IF GlobalVars_BFU.fbModuleManager.resettableModules[ui].ResetCondition2 = 0 THEN		// Do the same for second reset condition
			startCondition[ui,2] := TRUE;
		ELSE
			FOR uj := 1 TO GlobalVars_BFU.fbModuleManager.resettableModulesCount DO
				IF GlobalVars_BFU.fbModuleManager.resettableModules[ui].ResetCondition2 = GlobalVars_BFU.fbModuleManager.resettableModules[uj] THEN
					startCondition[ui,2] := resetResult[uj];
					EXIT;
				END_IF
			END_FOR
		END_IF
	END_IF

	IF startCondition[ui,1] AND startCondition[ui,2] THEN		// Both start conditions are true, so start resetting module

		IF NOT resetResult[ui] THEN
			resetResult[ui] := GlobalVars_BFU.fbModuleManager.resettableModules[ui].Reset();	// Give Reset command
		END_IF

		IF NOT resetResult[ui] THEN
			allModulesDone	:= FALSE;	// Reset allModulesDone when any resetResult bool in the array is still false
			SAFECONCAT3(ADR(moduleTimeoutMessage), GlobalVars_BFU.fbModuleManager.resettableModules[ui].InstanceName, ', ', 250);
		END_IF

	END_IF

END_FOR

IF allModulesDone THEN	// Homing all modules is done.
	moduleTimeoutMessage := '';
	currentOperationMode.ActingStateCompleted();		// State change to: Idle		<-- Press F12 here
END_IF
END_METHOD

// Acting State
METHOD PRIVATE Starting
VAR	// These variables will be reset every PLC cycle.
	allModulesDone	: BOOL := TRUE;
	ui				: UINT;
END_VAR
VAR_INST
	startCondition	: ARRAY[1..GVL_Constants.MaxNumberOfStartableModules] OF BOOL;
	startResult		: ARRAY[1..GVL_Constants.MaxNumberOfStartableModules] OF BOOL;
END_VAR
%FOLDER PackML States
IF State.Changed THEN
	BfuButtons.StartCycle.Solid();
	Stacklight.Green.Solid();

	moduleTimeoutMessage := '';

	FOR ui := 1 TO GlobalVars_BFU.fbModuleManager.startableModulesCount DO
		startResult[ui]			:= FALSE;

		// Check if a certain module needs to start up in this operation mode. Only do this once.
		startCondition[ui]		:= GlobalVars_BFU.fbModuleManager.startableModules[ui].ShouldStart(OperationMode);
	END_FOR
END_IF

IF OperationMode = SER_OperationModeType.SemiAuto
THEN
	BfuButtons.Step.SetFlashingFrequency(TRUE);
	BfuButtons.Step.Flash();
END_IF

BfuButtons.StartCycle.Solid();

IF BfuButtons.EndCycle.ButtonPushed THEN
	currentOperationMode.Stop();		// State change to: Stopping
	RETURN;
END_IF

moduleTimeoutMessage := 'Modules still busy starting: ';


FOR ui := 1 TO GlobalVars_BFU.fbModuleManager.startableModulesCount DO

	IF NOT startCondition[ui] THEN	// This module should not start.
		startResult[ui]	:= TRUE;
		CONTINUE;					// Continue with the next module
	END_IF

	// Start automatic cycle on all starting modules that should start in this operation mode
	// Only execute the StartCycle method when result bool is false.
	IF NOT startResult[ui] THEN
		startResult[ui]	:= GlobalVars_BFU.fbModuleManager.startableModules[ui].StartCycle();
	END_IF

	IF NOT startResult[ui] THEN
		allModulesDone	:= FALSE;	// Reset allModulesDone when any startResult bool in the array is still false
		// Generate string to give info about which module is still starting
		SAFECONCAT3(ADR(moduleTimeoutMessage), GlobalVars_BFU.fbModuleManager.startableModules[ui].InstanceName, ', ', 250);
	END_IF

END_FOR

IF allModulesDone THEN	// Starting all modules is done.
	moduleTimeoutMessage := '';
	currentOperationMode.ActingStateCompleted();		// State change to: Execute		<-- Press F12 here
END_IF
END_METHOD

// Wait State – A stable state, the SER has achieved a defined set of conditions.
METHOD PRIVATE Stopped
%FOLDER PackML States
// SER is just started up, or moved in manual mode.
// Wait for 'Home' button

IF State.Changed THEN
	BfuButtons.StartCycle.Off();
	Stacklight.Green.Off();
	BfuButtons.Stop.Off();
	BfuButtons.EndCycle.Off();

	airPressureWasDetectedWhileResetting	:= FALSE;
END_IF

IF HMI_BFU.ButtonEnableDrives.ButtonPushed THEN
	GlobalVars_BFU.EnableServoDrives := NOT GlobalVars_BFU.EnableServoDrives;
END_IF

IF (NOT xGatesAreClosed OR NOT DigIn.xSafetyGateRelay) AND NOT PNOZMulti2.xOperatorSwitch THEN
	GlobalVars_BFU.EnableServoDrives := FALSE;
END_IF

IF HMI_BFU.ButtonEnableMainvalve.ButtonPushed THEN
	GlobalVars_BFU.EnableMainvalve := NOT GlobalVars_BFU.EnableMainvalve;
END_IF

// Activate main air valve when button is pushed while all gates are closed.
GlobalVars_BFU.EnableMainvalve		S= xGatesAreClosed AND xGatesLockButtonPushed;
// Reset main air valve when Pilz does not enable air.
GlobalVars_BFU.EnableMainvalve		R= NOT PNOZMulti2.xEnableAirBFU;

IF NOT xGatesAreClosed
OR NOT DigIn.xSafetyGateRelay
OR PNOZMulti2.xOperatorSwitch
OR PNOZMulti2.xServiceSwitch
OR PNOZMulti2.xHoldToRunButton
// OR errorActive		Niet handig bij een BFU? Moeten we testen.. Sommige errors worden opgelost tijdens Resetten
THEN
	BfuButtons.StartCycle.Off();
	Stacklight.Green.Off();
	RETURN;
END_IF

BfuButtons.StartCycle.Flash();
Stacklight.Green.Flash();

IF BfuButtons.StartCycle.ButtonPushed THEN
	currentOperationMode.Reset();		// State change to: Resetting		<-- Press F12 here
END_IF
END_METHOD

// Acting State
METHOD PRIVATE Stopping
VAR	// These variables will be reset every PLC cycle.
	allModulesDone	: BOOL := TRUE;
	ui				: UINT;
END_VAR
VAR_INST
	stopResult		: ARRAY[1..GVL_Constants.MaxNumberOfModules] OF BOOL;
END_VAR
%FOLDER PackML States
// Stop requested
// Wait for standstill

IF State.Changed THEN
	BfuButtons.StartCycle.Off();
	Stacklight.Green.Off();

	BfuButtons.Stop.Flash();
	BfuButtons.EndCycle.Off();

	moduleTimeoutMessage := '';

	IF OperationMode = SER_OperationModeType.CleaningMode THEN			// if stopping in semi-auto, request that the mode is put back to Production.
		HMI_BFU.OperationMode := SER_OperationModeType.Production;
	END_IF

	FOR ui := 1 TO GlobalVars_BFU.fbModuleManager.baseModulesCount DO
		stopResult[ui] := FALSE;
	END_FOR
END_IF

// Allow operator to switch off power to the servo motors while Stopping. This way when a drive does not Stop correctly the state can change to Stopped that way.
GlobalVars_BFU.EnableServoDrives	R= HMI_BFU.ButtonEnableDrives.ButtonPushed;
GlobalVars_BFU.EnableMainvalve		R= HMI_BFU.ButtonEnableMainvalve.ButtonPushed;

moduleTimeoutMessage := 'Modules still stopping: ';

// Itterate through all modules
FOR ui := 1 TO GlobalVars_BFU.fbModuleManager.baseModulesCount DO

	// Only execute the Stop method when result bool is false.
	IF NOT stopResult[ui] THEN
		stopResult[ui]	:= GlobalVars_BFU.fbModuleManager.baseModules[ui].Stop();
	END_IF

	IF NOT stopResult[ui] THEN
		allModulesDone	:= FALSE;	// Reset allModulesDone when any stopResult bool in the array is still false
		SAFECONCAT3(ADR(moduleTimeoutMessage), GlobalVars_BFU.fbModuleManager.baseModules[ui].InstanceName, ', ', 250);
	END_IF
END_FOR

// All modules are done
IF allModulesDone THEN
	moduleTimeoutMessage := '';
	currentOperationMode.ActingStateCompleted();		// State change to: Stopped
END_IF
END_METHOD

// Wait State – In this state the BFU is not handling any
// products. It will either stop running or continue to cycle without
// producing until external process conditions return to normal, at which
// time the SUSPENDED state will transition to the UNSUSPENDING state,
// typically without ANY operator intervention.
// The BFU switches to this state when the SER is not in Automatic Operation
METHOD PRIVATE Suspended
VAR_INST
	Timer:BTON;
END_VAR
%FOLDER PackML States
IF NOT SER.InAutomaticOperation THEN
	BfuButtons.EndCycle.Flash();
ELSE
	BfuButtons.EndCycle.Off();
END_IF

IF BfuButtons.EndCycle.ButtonPushed THEN
	currentOperationMode.Stop();		// State change to: Stopping
	RETURN;
END_IF


// Wait for the IMM to turn back on
IF (BfuButtons.StartCycle.ButtonPushed AND Timer.Set(SER.InAutomaticOperation, 1))
OR BfuButtons.EndCycle.ButtonPushed
OR requestedReaction = enumErrorReaction.EndCycle
THEN
	Timer.Reset();
	currentOperationMode.UnSuspend();		// State change to: UnSuspending		<-- Press F12 here
END_IF
END_METHOD

// Acting State
METHOD PRIVATE Suspending
%FOLDER PackML States
// The SER is not in Automatic operation
// Halt the BFU cycle

Stacklight.Green.Flash();
BfuButtons.StartCycle.Flash();

currentOperationMode.ActingStateCompleted();		// State change to: Suspended		<-- Press F12 here
END_METHOD

// Acting State
METHOD PRIVATE UnHolding
%FOLDER PackML States
// Resume the BFU cycle.
// No actions needed here

currentOperationMode.ActingStateCompleted();		// State change to: Execute		<-- Press F12 here
END_METHOD

// Acting State
METHOD PRIVATE UnSuspending
%FOLDER PackML States
// Resume the BFU cycle.
// No actions needed here

BfuButtons.StartCycle.Solid();
Stacklight.Green.Solid();

currentOperationMode.ActingStateCompleted();		// State change to: Execute		<-- Press F12 here
END_METHOD

{attribute 'monitoring':='call'}
PROPERTY ActState : PACK_ML.State
%FOLDER Properties
GET
IF currentOperationMode <> 0 THEN
	ActState := currentOperationMode.CurrentState;
ELSE
	ActState := PACK_ML.State.Invalid;
END_IF
END_GET
END_PROPERTY

// SER is in automatic operation
{attribute 'monitoring':='call'}
PROPERTY PUBLIC InAutomaticOperation : BOOL
%FOLDER Properties
GET
InAutomaticOperation := InAutomaticOperationTrigger.xEdge;
END_GET
END_PROPERTY

// Trigger when SER just stopped in auto. operation
PROPERTY PUBLIC InAutomaticOperation_Falling : BOOL
%FOLDER Properties
GET
InAutomaticOperation_Falling := InAutomaticOperationTrigger.Q_Falling;
END_GET
END_PROPERTY

// Trigger when SER just started in auto. operation
PROPERTY PUBLIC InAutomaticOperation_Rising : BOOL
%FOLDER Properties
GET
InAutomaticOperation_Rising := InAutomaticOperationTrigger.Q_Rising;
END_GET
END_PROPERTY

// General condition when manual control is enabled for the whole SER machine
{attribute 'monitoring':='call'}
PROPERTY PUBLIC ManualControlEnabled : BOOL
%FOLDER Properties
GET
ManualControlEnabled	:= NOT GlobalVars.EmergencyStopActive
						AND ActState = PACK_ML.State.Stopped OR ActState = PACK_ML.State.Idle
						AND xGatesAreClosed
						AND DigIn.xSafetyGateRelay
						AND DigIn.xAirPressureOK;
END_GET
END_PROPERTY

{attribute 'monitoring':='call'}
PROPERTY PUBLIC OperationMode : SER_OperationModeType
%FOLDER Properties
GET
OperationMode := _operationMode;
END_GET
SET
_operationMode := OperationMode;
END_SET
END_PROPERTY

{attribute 'monitoring':='call'}
PROPERTY PUBLIC SemiAutoNextStep : BOOL
%FOLDER Properties
GET
IF OperationMode = SER_OperationModeType.SemiAuto
THEN

	IF  PNOZMulti2.xHoldToRunButton
	AND PNOZMulti2.xServiceSwitch
	THEN
		SemiAutoNextStep := BfuButtons.Step.ButtonPushed OR BfuButtons.StartCycle.ButtonPushed;
	ELSIF NOT xGatesAreClosed OR NOT DigIn.xSafetyGateRelay THEN
		SemiAutoNextStep := FALSE;
	ELSIF semiAutoInContinuousMode THEN
		SemiAutoNextStep := TRUE;
	ELSE
		SemiAutoNextStep := BfuButtons.Step.ButtonPushed OR BfuButtons.StartCycle.ButtonPushed;
	END_IF
ELSE
	SemiAutoNextStep := TRUE;
END_IF
END_GET
END_PROPERTY
