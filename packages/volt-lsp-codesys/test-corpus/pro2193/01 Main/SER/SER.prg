{attribute 'symbol' := 'none'}
PROGRAM SER
VAR
	ModuleHandler				: L_IMHP.L_IMHP_IModuleHandler := GlobalVars.fbModuleManager.ModuleHandler;
END_VAR
VAR_INPUT
	DigIn						: SER_InputsType;

	{attribute 'symbol' := 'read'}	GateZAxis					: GatePneumaticFB
	(
		instanceNo		:= 1,
		moduleManager	:= GlobalVars.fbModuleManager,
		moduleParent	:= ModuleHandler,
	);
	{attribute 'symbol' := 'read'}	GateSTG						: GateMagnetFB
	(
		instanceNo		:= 2,
		moduleManager	:= GlobalVars.fbModuleManager,
		moduleParent	:= ModuleHandler,
	);
	{attribute 'symbol' := 'read'}	GateMAxis					: GatePneumaticDrawerFB
	(
		instanceNo		:= 3,
		moduleManager	:= GlobalVars.fbModuleManager,
		moduleParent	:= ModuleHandler,
	);
	{attribute 'symbol' := 'read'}	GateDrawerMAxis				: GateMagnetFB
	(
		instanceNo		:= 4,
		moduleManager	:= GlobalVars.fbModuleManager,
		moduleParent	:= ModuleHandler,
	);

	CombinedAcknowledgeMAxis	: PushButtonLedFB;
	CombinedAcknowledgeZAxis	: PushButtonLedFB;

	VacuumPumps					: VacuumPumpDualFB;
END_VAR

VAR_OUTPUT
	EnableFreqInvertersRelay	: ActuatorFB;
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
	onlyInsertLabelsUnitMode	: PACK_ML.UnitMode;
	takeOutOnceUnitMode			: PACK_ML.UnitMode;
	autoTakeoutLabelsUnitMode	: PACK_ML.UnitMode;

	OperationModeManager		: PACK_ML.UnitModeManager;	// Unit mode manager to switch between unitmodes
	currentOperationMode		: PACK_ML.IUnitMode;		// Interface to current unit mode
	{attribute 'hide'}
	_operationMode				: SER_OperationModeType;	// Current operation mode (as an enumeration)

	State						: StateMachineHistoryFB(instanceName:= 'SER');

	FreqInvertersRelayOn		: BTON;
	FreqInvertersRelayOff		: BTON;


	{attribute 'init_on_onlchange'}		// Reset this option with every online change.
	semiAutoInContinuousMode	: BOOL;	// Semi-auto mode does not wait for button input. Dry-cycle run active.

	xGatesAreClosed				: BOOL;
	xGatesLockButtonPushed		: BOOL;
	xServoDrivesEnabled			: BOOL;
	airPressureWasDetectedWhileResetting		: BOOL;

	{attribute 'symbol' := 'readwrite'}	Statistics					: ProductionStatsFB;

	GatesControlIMMCircuit		: GatesControlIMMCircuitFB;
	xRequestForOpening			: BOOL;
	xAcknowledgement			: BOOL;

	SetError					: ARRAY[1..15] OF SetErrorFB;
	SetErrorFuse				: ARRAY[1..maxNumberOfFuses] OF SetErrorFB;

	IMM							: IIMM_Default;
	InAutomaticOperationTrigger	: TriggerFB;

END_VAR
VAR CONSTANT
	maxNumberOfFuses			: USINT := 3;
	autoSwitchFromCompleteToResetting	: BOOL	:= TRUE;	// I think It is nice to reset the machine after completing the automatic cycle. Then the SER is in Idle again. Test this and make this standard.
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

GlobalVars.EnableServoDrives	:= FALSE;
GlobalVars.EnableMainvalve		:= FALSE;

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
	eStopResult		: ARRAY[1..GVL_Constants.MaxNumberOfModules] OF BOOL;
	EStopTimeout	: BTON;
END_VAR
%FOLDER PackML States
// EStop requested

IF State.Changed THEN
	HardwareButtons.StartCycle.Off();
	Stacklight.Green.Off();

	HardwareButtons.Stop.Off();
	HardwareButtons.EndCycle.Off();
	HardwareButtons.Homing.Off();
	HardwareButtons.F1.Off();
	HardwareButtons.F2.Off();

	HMI.FooterName		:= enumFooterNames.None;

	IF OperationMode = SER_OperationModeType.SemiAuto THEN			// if stopping in semi-auto, request that the mode is put back to Production.
		HMI.OperationMode	:= SER_OperationModeType.Production;
	END_IF

	EStopTimeout.Reset();

	FOR ui := 1 TO GlobalVars.fbModuleManager.baseModulesCount DO
		eStopResult[ui] := FALSE;
	END_FOR
END_IF

// Reset the freq. inverters relay
EnableFreqInvertersRelay.Reset();

// Kill air pressure (but allow power to the servo's to decelerate the drives)
GlobalVars.EnableMainvalve	:= FALSE;


// Itterate through all modules
FOR ui := 1 TO GlobalVars.fbModuleManager.baseModulesCount DO

	// Only execute the EStop method when result bool is false.
	IF NOT eStopResult[ui] THEN
		eStopResult[ui] := GlobalVars.fbModuleManager.baseModules[ui].EStop();
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
VAR_INST
	fuseOk			: ARRAY[1..maxNumberOfFuses] OF BOOL;
END_VAR
SetError[1](
	moduleHandler	:= ModuleHandler,
	textRefId		:= SER_Errors,
	errorId			:= 1,		// Fatal- 0000 - Emergency Stop
	alarmCondition	:= GlobalVars.EmergencyStopActive,
	alarmDelay		:= 0.0,
	severity		:= enumErrorSeverity.Fault,
	reaction		:= enumErrorReaction.FastStop,
	active			=> );

SetError[2](
	moduleHandler	:= ModuleHandler,
	textRefId		:= SER_Errors,
	errorId			:= 2,
	alarmCondition	:= NOT DigIn.quickStopOk,
	alarmDelay		:= 0.0,
	severity		:= enumErrorSeverity.Information,
	reaction		:= enumErrorReaction.No_reaction,
	active			=> );

SetError[3](
	moduleHandler	:= ModuleHandler,
	textRefId		:= SER_Errors,
	errorId			:= 15,
	alarmCondition	:= NOT DigIn.quickStopOk_MUnit AND DigIn.quickStopOk,
	alarmDelay		:= 0.0,
	severity		:= enumErrorSeverity.Information,
	reaction		:= enumErrorReaction.No_reaction,
	active			=> );

SetError[4](
	moduleHandler	:= ModuleHandler,
	textRefId		:= SER_Errors,
	errorId			:= 16,		// Alarm- 0002 - Check air pressure alarm :-)
	alarmCondition	:= GlobalVars.EnableMainvalve AND NOT DigIn.xAirPressureOK AND DigIn.fuseOk[3] AND PNOZMulti2.xEnableAir,
	alarmDelay		:= 30.0,
	severity		:= enumErrorSeverity.Fault,
	// When gate is opened, make a fatal alarm. To make sure that air pressure does not come back when someone is in the machine.
	reaction		:= SEL(xGatesAreClosed, enumErrorReaction.FastStop, enumErrorReaction.No_reaction),
	active			=> );

SetError[5](
	moduleHandler	:= ModuleHandler,
	textRefId		:= SER_Errors,
	errorId			:= 8,		// Resetting not allowed while 'Enable operation with robot' (ZB2) is active
	alarmCondition	:= (ActState = PACK_ML.State.Stopped OR ActState = PACK_ML.State.Complete) AND HardwareButtons.Homing.ButtonPushed AND IMM.AutoOperation,
	alarmDelay		:= 0.0,
	severity		:= enumErrorSeverity.Fault,
	reaction		:= enumErrorReaction.No_reaction,
	active			=> );

SetError[6](
	moduleHandler	:= ModuleHandler,
	textRefId		:= SER_Errors,
	errorId			:= 5,		// Operator key switch is enabled
	alarmCondition	:= PNOZMulti2.xOperatorSwitch,
	alarmDelay		:= 0.0,
	severity		:= enumErrorSeverity.Warning,
	reaction		:= enumErrorReaction.Stop,
	active			=> );

SetError[7](
	moduleHandler	:= ModuleHandler,
	textRefId		:= SER_Errors,
	errorId			:= 6,		// Service key switch is enabled
	alarmCondition	:= PNOZMulti2.xServiceSwitch,
	alarmDelay		:= 0.0,
	severity		:= enumErrorSeverity.Warning,
	reaction		:= enumErrorReaction.Stop,
	active			=> );

SetError[8](
	moduleHandler	:= ModuleHandler,
	textRefId		:= SER_Errors,
	errorId			:= 17,		// Press Acknowlege buttons to confirm gate closed
	alarmCondition	:= xGatesAreClosed AND NOT DigIn.xSafetyGateRelay,
	alarmDelay		:= 5.0,
	severity		:= enumErrorSeverity.Warning,
	reaction		:= enumErrorReaction.No_reaction,
	active			=> );

//SetError[9](
//	moduleHandler	:= ModuleHandler,
//	textRefId		:= SER_Errors,
//	errorId			:= 18,		// Lenze i700 Status: Brake Chopper Active
//	alarmCondition	:= DigIn.i700_BrakeChopperStatus,
//	alarmDelay		:= 1.0,
//	severity		:= enumErrorSeverity.Fault,
//	reaction		:= enumErrorReaction.Stop,
//	active			=> );
//
//SetError[10](
//	moduleHandler	:= ModuleHandler,
//	textRefId		:= SER_Errors,
//	errorId			:= 19,		// Lenze i700 Status: Error Message Active
//	alarmCondition	:= NOT DigIn.i700_StatusMessage,
//	alarmDelay		:= 1.0,
//	severity		:= enumErrorSeverity.Fault,
//	reaction		:= enumErrorReaction.Stop,
//	active			=> );
//
//SetError[11](
//	moduleHandler	:= ModuleHandler,
//	textRefId		:= SER_Errors,
//	errorId			:= 20,		// Brake Resistor Utilisation too High.
//	alarmCondition	:= NOT DigIn.i700_BrakeResistor,
//	alarmDelay		:= 1.0,
//	severity		:= enumErrorSeverity.Fault,
//	reaction		:= enumErrorReaction.Stop,
//	active			=> );

SetError[12](
	moduleHandler	:= ModuleHandler,
	textRefId		:= SER_Errors,
	errorId			:= 21,		// Air pressure dropped while resetting
	alarmCondition	:= ActState = PACK_ML.State.Resetting AND airPressureWasDetectedWhileResetting AND NOT DigIn.xAirPressureOK,
	alarmDelay		:= 1.0,
	severity		:= enumErrorSeverity.Fault,
	reaction		:= enumErrorReaction.Stop,
	active			=> );

SetError[13](
	moduleHandler	:= ModuleHandler,
	textRefId		:= SER_Errors,
	errorId			:= 22,		// SD card trouble: no appication credits available
	alarmCondition	:= TimeSettings.applicationCredits = 0,
	alarmDelay		:= 1.0,
	severity		:= enumErrorSeverity.Fault,
	reaction		:= enumErrorReaction.No_reaction,
	active			=> );

SetError[14](
	moduleHandler	:= ModuleHandler,
	textRefId		:= SER_Errors,
	errorId			:= 23,		// Fault airconditioning main cabinet
	alarmCondition	:= NOT Digin.airconditioningOk,
	alarmDelay		:= 1.0,
	severity		:= enumErrorSeverity.Fault,
	reaction		:= enumErrorReaction.No_reaction,
	active			=> );

SetError[15](
	moduleHandler	:= moduleHandler,
	textRefId		:= SER_Errors,
	alarmCondition	:= NOT DigIn.vacuumPumpThermistor,
	alarmDelay		:= 1.0,
	errorId			:= 24,				// Thermal contact Vacuum pump (Thermistor)
	severity		:= enumErrorSeverity.Fault,
	reaction		:= enumErrorReaction.EndCycle,
	active			=> );

IF SetError[15].active THEN
	VacuumPumps.Reset();
END_IF

///// Fuse alarms
FOR i := 1 TO maxNumberOfFuses DO

	// Some fuses always trip in case of Emergency stop. Filter these here:
	IF GlobalVars.EmergencyStopActive
	AND (i = 6 OR i = 7 OR i = 8)
	THEN
		fuseOk[i]	:= TRUE;
	ELSE
		fuseOk[i]	:= DigIn.fuseOk[i];
	END_IF

	SetErrorFuse[i](
		moduleHandler	:= ModuleHandler,
		textRefId		:= Fuse_Errors,
		alarmCondition	:= NOT fuseOk[i],
		alarmDelay		:= 10.0,
		errorId			:= TO_WORD(i),
		severity		:= enumErrorSeverity.Fault,
		reaction		:= enumErrorReaction.No_reaction,
		active			=> );
END_FOR
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
// SER is done.
// Wait for 'Home' button

IF State.Changed THEN
	HardwareButtons.StartCycle.Off();
	Stacklight.Green.Off();
	HardwareButtons.Stop.Solid();
	HardwareButtons.Homing.Off();
	HardwareButtons.F1.Off();
	HardwareButtons.F2.Off();
END_IF

IF NOT IMM.AutoOperation THEN
	HardwareButtons.EndCycle.Flash();
ELSE
	HardwareButtons.EndCycle.Off();
END_IF

IF HardwareButtons.EndCycle.ButtonPushed THEN
	currentOperationMode.Stop();		// State change to: Stopping
	RETURN;
END_IF


IF NOT xGatesAreClosed
OR NOT DigIn.xSafetyGateRelay
OR IMM.AutoOperation
OR (PNOZMulti2.xOperatorSwitch AND OperationMode <> SER_OperationModeType.AutoTakeoutLabels)		// Not allowed to leave key switch enabled
OR (PNOZMulti2.xServiceSwitch  AND OperationMode <> SER_OperationModeType.AutoTakeoutLabels)
OR PNOZMulti2.xHoldToRunButton
THEN
	HardwareButtons.Homing.Off();
	RETURN;
END_IF

HardwareButtons.Homing.Flash();

IF HardwareButtons.Homing.ButtonPushed OR autoSwitchFromCompleteToResetting THEN
	currentOperationMode.Reset();		// State change to: Resetting		<-- Press F12 here
END_IF
END_METHOD

// Acting State
METHOD PRIVATE Completing
VAR	// These variables will be reset every PLC cycle.
	allModulesDone	: BOOL := TRUE;
	ui				: UINT;
END_VAR
VAR_INST
	completeResult	: ARRAY[1..GVL_Constants.MaxNumberOfModules] OF BOOL;
	Timer			: BTON;
END_VAR
%FOLDER PackML States
// End cycle is requested
// Wait here for the SER to finish the last cycle(s)

IF State.Changed THEN
	FOR ui := 1 TO GlobalVars.fbModuleManager.baseModulesCount DO
		completeResult[ui] := FALSE;
	END_FOR
	Timer.Reset();
END_IF

HardwareButtons.StartCycle.Flash();
Stacklight.Green.Flash();

// After a second, enable the stop button to stop the cycle. Timer is to prevent accidental double click by operator.
IF Timer.Set(In := TRUE, Pt := 1) THEN
	HardwareButtons.EndCycle.Flash();
	IF HardwareButtons.EndCycle.ButtonPushed
	OR requestedReaction = enumErrorReaction.EndCycle
	THEN
		moduleTimeoutMessage	:= '';
		currentOperationMode.Stop();		// State change to: Stopping
		RETURN;
	END_IF
END_IF


moduleTimeoutMessage := 'Modules still completing: ';

FOR ui := 1 TO GlobalVars.fbModuleManager.StartableModulesCount DO

	// Request a cycle stop on all modules that are startable.
	IF NOT completeResult[ui] THEN
		completeResult[ui]	:= GlobalVars.fbModuleManager.startableModules[ui].StopCycle();
	END_IF

	IF NOT completeResult[ui] THEN
		allModulesDone	:= FALSE;	// Reset allModulesDone when any completeResult bool in the array is still false
		// Generate string to give info about which module is still completing
		SAFECONCAT3(ADR(moduleTimeoutMessage), GlobalVars.fbModuleManager.startableModules[ui].InstanceName, ', ', 250);
	END_IF

END_FOR

// All modules are done
IF allModulesDone THEN
	moduleTimeoutMessage	:= '';
	currentOperationMode.ActingStateCompleted();		// State change to: Completed		<-- Press F12 here
END_IF
END_METHOD

METHOD PRIVATE Cyclic
VAR_INST
	Blink_1sec						: BLINK;
	Blink_04sec						: BLINK;
	Blink_12sec						: BLINK;
	Blink_PulseFast					: BLINK;
	Blink_PulseSlow					: BLINK;
	HornMutedTimeout				: BTON;
	ChangingOperationMode			: BTON;
	TriggerStopRequested			: RisingTriggerFB;
	machineIdleTimeout				: BTON;
	workingLightsTimeout			: BTON;
	usiSavedSERSpeed				: USINT;
	ReadActualError					: ReadActualErrorFB;
	ForwardSeverity					: L_IE1P.L_IE1P_ForwardSeverity;			// Forward alarms of children to parent
END_VAR
EnableFreqInvertersRelay();
MainAirValve			();
Stacklight				();
WorkingLights			();
ResetSignalOut			();
DigIn.workingLightsButton();
Buzzer();

// Execute gate function blocks
GateZAxis(
	xIMMGateClose		:= InjectionMouldingMachine.Unit.DoorsClosed,
	xAcknowledge		:= DigIn.xSafetyGateRelay,
	xGateAllowedOpen	:= ActState = PACK_ML.State.Aborted OR ActState = PACK_ML.State.Stopped OR ActState = PACK_ML.State.Idle,
	xGateAllowedOpenIMM	:= ,
	xRequestForOpening	:= xRequestForOpening,
	xAcknowledgement	:= xAcknowledgement,
	moduleThatBlocks	:= Conveyors.Unit[1]
);
GateSTG(
	xAcknowledge		:= DigIn.xSafetyGateRelay,
	xGateAllowedOpen	:= ActState = PACK_ML.State.Aborted OR ActState = PACK_ML.State.Stopped OR ActState = PACK_ML.State.Idle,
	xRequestForOpening	:= xRequestForOpening,
	xAcknowledgement	:= xAcknowledgement,
	moduleThatBlocks	:= 0
);
GateMAxis(
	xIMMGateClose		:= InjectionMouldingMachine.Unit.DoorsClosed,
	xAcknowledge		:= DigIn.xSafetyGateRelay,
	xGateAllowedOpen	:= ActState = PACK_ML.State.Aborted OR ActState = PACK_ML.State.Stopped OR ActState = PACK_ML.State.Idle,
	xGateAllowedOpenIMM	:= ,
	xRequestForOpening	:= xRequestForOpening,
	xAcknowledgement	:= xAcknowledgement,
	moduleThatBlocks	:= Magazines.Unit[1],
	drawer				:= LabelSuppliers.Unit[1]
);
GateDrawerMAxis(
	xAcknowledge		:= DigIn.xSafetyGateRelay,
	xGateAllowedOpen	:= ActState = PACK_ML.State.Aborted OR ActState = PACK_ML.State.Stopped OR ActState = PACK_ML.State.Idle,
	xRequestForOpening	:= xRequestForOpening,
	xAcknowledgement	:= xAcknowledgement,
	moduleThatBlocks	:= 0
);

CombinedAcknowledgeMAxis(
	buttonInput			:= );
CombinedAcknowledgeZAxis(
	buttonInput			:= );

GateZAxis.ButtonLock.buttonInput		:= CombinedAcknowledgeZAxis.buttonInput;
GateSTG.ButtonLock.buttonInput			:= CombinedAcknowledgeZAxis.buttonInput;

GateMAxis.ButtonLock.buttonInput		:= CombinedAcknowledgeMAxis.buttonInput;
GateDrawerMAxis.ButtonLock.buttonInput	:= CombinedAcknowledgeMAxis.buttonInput;

CombinedAcknowledgeZAxis.SetOrReset(GateZAxis.ButtonLock.Map() OR GateSTG.ButtonLock.Map());
CombinedAcknowledgeMAxis.SetOrReset(GateMAxis.ButtonLock.Map() OR GateDrawerMAxis.ButtonLock.Map());

GatesControlIMMCircuit(
	xGateAllowedOpen			:= ActState = PACK_ML.State.Aborted OR ActState = PACK_ML.State.Stopped OR ActState = PACK_ML.State.Idle,
	xSafetyGateRelay			:= DigIn.xSafetyGateRelay,
	xPnozMulti2Acknowledgement	=> PNOZMulti2.xButtonAcknSafetyGates,
	xRequestForOpening			:= xRequestForOpening,
	xAcknowledgement			:= xAcknowledgement);

VacuumPumps(
	moduleHandler				:= ModuleHandler,
	textRefId					:= SER_Errors,
	alarmEnable					:= TRUE,
	alarmDelay					:= 10,
	severity					:= enumErrorSeverity.Fault,
	reaction					:= enumErrorReaction.No_reaction,
	xMachineRunning				:= InAutomaticOperation OR ActState = PACK_ML.State.Resetting,
	xMainAirValve				:= MainAirValve.Map(),
	xManualOnOffSwitch			:= HMI.ButtonEnableVacuumPumps.ButtonPushed,
	xThermalInputHighVacuum		:= ,
	xThermalInputLowVacuum		:= ,
	xPhaseCheck					:= ,
	xLowVacuumtankFull			:= ,
	xHighVacuumtankFull			:= ,
	xOptionDisableWithAirButton	:= PersistentVars.DisableVacuumWithAirButton,
	xOptionDisableVacuumPumps	:= OperationMode = SER_OperationModeType.SemiAuto AND HMI.SemiAutoMode = enumSemiAutoModeType.WithoutVacuums AND (NOT PersistentVars.RecipeVars.EnableIML OR semiAutoInContinuousMode),
	xOptionDisableVacuumPump2	:= TRUE,
//	xOptionDisableVacuumPump2	:= PersistentVars.DisableVacuumPump2 AND NOT PersistentVars.RecipeVars.EnableIML AND XiUnits.Unit[1].HasPayload = enumPayload.None,
	errorId_PhaseCheck			:= 10,
	errorId_Thermal				:= 11,
	errorId_TooMuchRequested	:= 12,
	errorId_HighTankDoesNotFill	:= 13,
	errorId_Maintenance			:= 14,
	TotalRunningTime			:= PersistentVars.vacuumPumpRunningTime,
	TotalNumberOfStarts			:= PersistentVars.vacuumPumpNumberOfStarts,
	xVacuumpumpRunning			=> );

// Set correct number of cavities according to the selected exchange set.
(*
CASE PersistentVars.RecipeVars.ActiveExchangeSet OF
	enumExchangeSets.SingleCavSingleTakeover:
		GlobalVars.ActProductsInX	:= 1;
		GlobalVars.ActProductsInY	:= 1;
	enumExchangeSets.SingleCavDualTakeover:
		GlobalVars.ActProductsInX	:= 1;
		GlobalVars.ActProductsInY	:= 1;
	enumExchangeSets.FourCavDualTakeover:
		GlobalVars.ActProductsInX	:= 2;
		GlobalVars.ActProductsInY	:= 2;
	enumExchangeSets.TwoCavSingleTakeover:
		GlobalVars.ActProductsInX	:= 2;
		GlobalVars.ActProductsInY	:= 1;
	ELSE
		GlobalVars.ActProductsInX	:= 2;
		GlobalVars.ActProductsInY	:= 2;
END_CASE
*)

GlobalVars.ActProductsInX			:= GVL_Constants.MaxProductsInX;
GlobalVars.ActProductsInY			:= GVL_Constants.MaxProductsInY;

// Set Emergency stop active
GlobalVars.EmergencyStopActive			:= NOT DigIn.emergencyStopOk;

// Check if all gates are closed
xGatesAreClosed			:= TRUE;
FOR i := 1 TO TO_INT(GlobalVars.fbModuleManager.gatesCount) DO
	IF GlobalVars.fbModuleManager.gates[i].GateState = enumGateStates.Opened THEN
		xGatesAreClosed	:= FALSE;
		EXIT;
	END_IF
END_FOR
//xGatesAreClosed			R= NOT DigIn.xSafetyGateRelay; Do not reset the xGatesAreClosed bit here. Is better when creating alarm messages.

// Check if the Lock button is pushed on any gate
xGatesLockButtonPushed	:= FALSE;
FOR i := 1 TO TO_INT(GlobalVars.fbModuleManager.gatesCount) DO
	IF GlobalVars.fbModuleManager.gates[i].LockButtonPushed THEN
		xGatesLockButtonPushed	:= TRUE;
		EXIT;
	END_IF
END_FOR

// Set Global Reset variable
ResetSignalOut.SetOrReset(GlobalVars.Reset);

// Set global blinker booleans
Blink_1sec(			ENABLE := TRUE,	TIMELOW := T#500MS,		TIMEHIGH := T#500MS,	OUT => GlobalVars.BlinkerNormal);
Blink_04sec(		ENABLE := TRUE,	TIMELOW := T#200MS,		TIMEHIGH := T#200MS,	OUT => GlobalVars.BlinkerFast);
Blink_12sec(		ENABLE := TRUE,	TIMELOW := T#10S,		TIMEHIGH := T#2S);
Blink_PulseSlow(	ENABLE := TRUE,	TIMELOW := T#850MS,		TIMEHIGH := T#150MS,	OUT => GlobalVars.BlinkerPulseSlow);
Blink_PulseFast(	ENABLE := TRUE,	TIMELOW := T#1400MS,	TIMEHIGH := T#100MS,	OUT => GlobalVars.BlinkerPulseFast);

// Temporary mute the horn for 60 seconds. After timeout the horn starts beeping again.
hornMutedTimeout.Set(	In := HMI.xMuteHorn,	Pt := 60);
HMI.xMuteHorn R= hornMutedTimeout.Q;

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

IF HMI.xMuteHorn OR PersistentVars.disableBuzzer THEN
	Buzzer.Off();
ELSIF errorActive THEN
	Buzzer.Flash();
ELSIF warningActive THEN
	Buzzer.SetOrReset(Blink_12sec.OUT AND Blink_04sec.OUT);
ELSE
	Buzzer.Off();
END_IF

IF HardwareButtons.Stop.ButtonPushed
OR TriggerStopRequested.Rising(CLK	:= GlobalVars.manualControlRequested
									//OR NOT xGatesAreClosed
									OR NOT DigIn.xSafetyGateRelay
									OR ReadActualError.requestedReaction = enumErrorReaction.Stop)
THEN
	currentOperationMode.Stop();		// State change to: Stopping
END_IF

IF ErrorHandling.requestedReaction = enumErrorReaction.FastStop THEN
	currentOperationMode.Abort();	// State change to: Aborting
END_IF

// Change the current unit mode
IF OperationMode <> HMI.OperationMode THEN
	IF OperationModeManager.SwitchUnitMode(TO_STRING(HMI.OperationMode)) THEN

		IF OperationMode = SER_OperationModeType.SemiAuto AND usiSavedSERSpeed <> 0 THEN	// Check if switching from semi-auto. If so, set global speed back to previous value
			PersistentVars.usiGlobalSERSpeed	:= usiSavedSERSpeed;
			usiSavedSERSpeed					:= 0;
		END_IF

		OperationMode							:= HMI.OperationMode;

		IF OperationMode = SER_OperationModeType.SemiAuto THEN
			usiSavedSERSpeed					:= PersistentVars.usiGlobalSERSpeed;		// Save global speed
			PersistentVars.usiGlobalSERSpeed	:= LIMIT(1, PersistentVars.usiGlobalSERSpeed, 20);
			HMI.FooterName						:= enumFooterNames.SemiAutomatic;
		ELSE
			HMI.FooterName						:= enumFooterNames.None;
		END_IF
	END_IF
END_IF
IF ChangingOperationMode.Set(In := OperationMode <> HMI.OperationMode, Pt := 1) THEN
	HMI.OperationMode			:= OperationMode;
	ChangingOperationMode.Reset();
END_IF

currentOperationMode		:= OperationModeManager.ActiveUnitMode;

// Set a timer for 1 second when enabling the relay. Homing continues after this timer.
FreqInvertersRelayOn.Set(EnableFreqInvertersRelay.Map(), 1);
// Start a timer when relay is switched off. Relay needs to stay off for at least this time to prevent an error.
FreqInvertersRelayOff.Set(NOT EnableFreqInvertersRelay.Map(), 10);

// Call Statistics FB to keep track of all statistics of the machine
Statistics(
	serState					:= ActState,
	StatisticsData				:= PersistentVars.Statistics);

// Handle servo drives
xServoDrivesEnabled			:= TRUE;
FOR i := 1 TO TO_INT(GlobalVars.fbModuleManager.servoDrivesCount) DO
	IF NOT GlobalVars.fbModuleManager.servoDrives[i].AxisEnabled THEN
		xServoDrivesEnabled	:= FALSE;
		EXIT;
	END_IF
END_FOR

// Set main air valve output
MainAirValve.SetOrReset(GlobalVars.EnableMainvalve);

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

// Set limits for the positions, and guard the limits
PersistentVars.BrinkRecipeVars.maximumAllowedCycleTime.value	:= LIMIT(	PersistentVars.BrinkRecipeVars.maximumAllowedCycleTime.lowerLimit,
																			PersistentVars.BrinkRecipeVars.maximumAllowedCycleTime.value,
																			PersistentVars.BrinkRecipeVars.maximumAllowedCycleTime.upperLimit);

PersistentVars.BrinkRecipeVars.machineIdleShutoffTime.value		:= LIMIT(	PersistentVars.BrinkRecipeVars.machineIdleShutoffTime.lowerLimit,
																			PersistentVars.BrinkRecipeVars.machineIdleShutoffTime.value,
																			PersistentVars.BrinkRecipeVars.machineIdleShutoffTime.upperLimit);

PersistentVars.BrinkRecipeVars.workingLightsTime.value			:= LIMIT(	PersistentVars.BrinkRecipeVars.workingLightsTime.lowerLimit,
																			PersistentVars.BrinkRecipeVars.workingLightsTime.value,
																			PersistentVars.BrinkRecipeVars.workingLightsTime.upperLimit);

// Limit the speed from 1 to 100% (because VisiWinNet does not support subrange types)
PersistentVars.usiGlobalSERSpeed := LIMIT(1, PersistentVars.usiGlobalSERSpeed, 100);

// Turn off vacuum pumps and main air valve after timeout
IF machineIdleTimeout.Set(	In := (ActState = PACK_ML.State.Idle OR ActState = PACK_ML.State.Stopped OR ActState = PACK_ML.State.Complete)
							  AND GlobalVars.EnableMainvalve
							  AND NOT IMM.AutoOperation
							  AND NOT PNOZMulti2.xOperatorSwitch,
							Pt := TO_REAL(PersistentVars.BrinkRecipeVars.machineIdleShutoffTime.value * 60))
THEN
	GlobalVars.EnableMainvalve	:= FALSE;
	VacuumPumps.Reset();
END_IF

// Working lights control
IF workingLightsTimeout.Set(In := WorkingLights.Map(), Pt := PersistentVars.BrinkRecipeVars.workingLightsTime.value * 60) THEN
	WorkingLights.Off();
END_IF

IF State.Changed
OR DigIn.workingLightsButton.ButtonPushed
OR HardwareButtons.StartCycle.ButtonPushed
OR HardwareButtons.EndCycle.ButtonPushed
OR HardwareButtons.Homing.ButtonPushed
OR HardwareButtons.Reset.ButtonPushed
//OR GatePortal.ButtonUnLock.ButtonPushed
OR GateZAxis.ButtonUnLock.ButtonPushed
OR GateMAxis.ButtonUnLock.ButtonPushed
THEN
	workingLightsTimeout.Reset();
	WorkingLights.Solid();
END_IF

// Read alarm severity of SER (sub)modules
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
END_METHOD

// Acting State - The unit/machine is in a stable acting state - unit/machine is producing.
METHOD PRIVATE Execute
%FOLDER PackML States
IF OperationMode = SER_OperationModeType.SemiAuto
OR OperationMode = SER_OperationModeType.AutoTakeoutLabels
THEN
	HardwareButtons.F1.SetFlashingFrequency(TRUE);
	HardwareButtons.F1.Flash();
END_IF

// Finish the cycle and stop the machine
IF HardwareButtons.EndCycle.ButtonPushed
OR requestedReaction = enumErrorReaction.EndCycle
THEN
	// Try to switch to Completing, if that state is not supported by this operation mode then switch to Stop instead.
	IF NOT currentOperationMode.ActingStateCompleted() THEN		// State change to: Completing		<-- Press F12 here
		currentOperationMode.Stop();		// State change to: Stopping
	END_IF
	RETURN;
END_IF


// Holding / Held / Unholding steps are not in use
IF FALSE THEN
	currentOperationMode.Hold();		// State change to: Holding		<-- Press F12 here
	RETURN;
END_IF

// Go into Suspended state when IMM is not in automatic mode
IF NOT IMM.AutoOperation THEN
	// This method will return false when Suspend is not supported by this operation mode
	IF currentOperationMode.Suspend() THEN		// State change to: Suspending		<-- Press F12 here
		RETURN;
	END_IF
END_IF
END_METHOD

// Wait state – A state which represents an error state on the SER which
// will generate an alarm or warning. In this state the unit/machine is not
// producing, until the operator made a transition to the EXECUTING state.
// The state holds the SER operations while material blockage
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
// Halt the SER cycle
// State is finished when the SER is at the parking position in front of the mould

currentOperationMode.ActingStateCompleted();		// State change to: Held		<-- Press F12 here
END_METHOD

// Wait State – A stable state, the SER has achieved a defined set of conditions.
METHOD PRIVATE Idle
%FOLDER PackML States
// SER is homed and ready to start
// Wait for 'Start' button

IF State.Changed THEN
	HardwareButtons.StartCycle.Off();
	Stacklight.Green.Off();
	HardwareButtons.Stop.Off();
	HardwareButtons.EndCycle.Off();
	HardwareButtons.Homing.Off();
END_IF

IF HardwareButtons.EndCycle.ButtonPushed THEN
	currentOperationMode.Stop();		// State change to: Stopping
	RETURN;
END_IF

// Button pressed on HMI to disable drives
IF HMI.ButtonEnableDrives.ButtonPushed THEN
	GlobalVars.EnableServoDrives	:= FALSE;
	currentOperationMode.Stop();		// State change to: Stopping
	RETURN;
END_IF

// Button pressed on HMI to disable air pressure
IF HMI.ButtonEnableMainvalve.ButtonPushed
OR NOT PNOZMulti2.xEnableAir
THEN
	GlobalVars.EnableMainvalve	:= FALSE;
	currentOperationMode.Stop();		// State change to: Stopping
	RETURN;
END_IF

// In case air or servo drives are turned off by some other part of the program
IF NOT GlobalVars.EnableServoDrives
OR NOT GlobalVars.EnableMainvalve
OR (PNOZMulti2.xOperatorSwitch AND OperationMode <> SER_OperationModeType.AutoTakeoutLabels)		// Not allowed to leave key switch enabled
OR (PNOZMulti2.xServiceSwitch AND OperationMode <> SER_OperationModeType.AutoTakeoutLabels)
THEN
	currentOperationMode.Stop();		// State change to: Stopping
	RETURN;
END_IF

IF errorActive THEN	// No not start auto operation when an error is active
	HardwareButtons.StartCycle.Off();
	Stacklight.Green.Off();
	RETURN;
END_IF

HardwareButtons.StartCycle.Flash();
Stacklight.Green.Flash();

IF HardwareButtons.StartCycle.ButtonPushed THEN
	currentOperationMode.Start();		// State change to: Starting		<-- Press F12 here
END_IF
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
							dwSupportedStates			:= PACK_ML.State.All,
							// Allowed to leave from this unit mode if the state is one of the following
							dwAllowsLeavingFromStates	:= PACK_ML.State.Stopped OR PACK_ML.State.Aborted OR PACK_ML.State.Idle OR PACK_ML.State.Complete OR PACK_ML.State.Resetting,
							// Allowed to enter this unit mode if the state is one of the following
							dwAllowsEnteringIntoStates	:= productionUnitMode.dwAllowsLeavingFromStates,
							eInitialState				:= PACK_ML.State.Stopped,
							xActive						:= TRUE);

semiAutoUnitMode(			sName						:= TO_STRING(SER_OperationModeType.SemiAuto),
							dwSupportedStates			:= PACK_ML.State.All - PACK_ML.State.Completing - PACK_ML.State.Complete - PACK_ML.State.Holding - PACK_ML.State.Held - PACK_ML.State.UnHolding - PACK_ML.State.UnSuspending - PACK_ML.State.Suspended - PACK_ML.State.Suspending,
							dwAllowsLeavingFromStates	:= productionUnitMode.dwAllowsLeavingFromStates,
							dwAllowsEnteringIntoStates	:= productionUnitMode.dwAllowsLeavingFromStates,
							eInitialState				:= PACK_ML.State.Stopped,
							xActive						:= FALSE);

cleaningUnitMode(			sName						:= TO_STRING(SER_OperationModeType.CleaningMode),
							dwSupportedStates			:= PACK_ML.State.All - PACK_ML.State.Completing - PACK_ML.State.Complete - PACK_ML.State.Holding - PACK_ML.State.Held - PACK_ML.State.UnHolding - PACK_ML.State.UnSuspending - PACK_ML.State.Suspended - PACK_ML.State.Suspending,
							dwAllowsLeavingFromStates	:= productionUnitMode.dwAllowsLeavingFromStates,
							dwAllowsEnteringIntoStates	:= productionUnitMode.dwAllowsLeavingFromStates,
							eInitialState				:= PACK_ML.State.Stopped,
							xActive						:= FALSE);

onlyInsertLabelsUnitMode(	sName						:= TO_STRING(SER_OperationModeType.OnlyInsertLabels),
							dwSupportedStates			:= PACK_ML.State.All - PACK_ML.State.Completing - PACK_ML.State.Complete - PACK_ML.State.Holding - PACK_ML.State.Held - PACK_ML.State.UnHolding - PACK_ML.State.UnSuspending - PACK_ML.State.Suspended - PACK_ML.State.Suspending,
							dwAllowsLeavingFromStates	:= PACK_ML.State.Stopped OR PACK_ML.State.Aborted OR PACK_ML.State.Idle OR PACK_ML.State.Complete OR PACK_ML.State.Resetting,
							dwAllowsEnteringIntoStates	:= productionUnitMode.dwAllowsLeavingFromStates,
							eInitialState				:= PACK_ML.State.Stopped,
							xActive						:= FALSE);

takeOutOnceUnitMode(		sName						:= TO_STRING(SER_OperationModeType.TakeOutOnce),
							dwSupportedStates			:= PACK_ML.State.All - PACK_ML.State.Completing - PACK_ML.State.Complete - PACK_ML.State.Holding - PACK_ML.State.Held - PACK_ML.State.UnHolding - PACK_ML.State.UnSuspending - PACK_ML.State.Suspended - PACK_ML.State.Suspending,
							dwAllowsLeavingFromStates	:= productionUnitMode.dwAllowsLeavingFromStates,
							dwAllowsEnteringIntoStates	:= productionUnitMode.dwAllowsLeavingFromStates OR PACK_ML.State.Starting OR PACK_ML.State.Execute,
							eInitialState				:= PACK_ML.State.Stopped,
							xActive						:= FALSE);

autoTakeoutLabelsUnitMode(	sName						:= TO_STRING(SER_OperationModeType.AutoTakeoutLabels),
							dwSupportedStates			:= PACK_ML.State.All - PACK_ML.State.Completing - PACK_ML.State.Complete - PACK_ML.State.Holding - PACK_ML.State.Held - PACK_ML.State.UnHolding - PACK_ML.State.UnSuspending - PACK_ML.State.Suspended - PACK_ML.State.Suspending,
							dwAllowsLeavingFromStates	:= productionUnitMode.dwAllowsLeavingFromStates,
							dwAllowsEnteringIntoStates	:= productionUnitMode.dwAllowsLeavingFromStates,
							eInitialState				:= PACK_ML.State.Stopped,
							xActive						:= FALSE);

// Register the unit modes with the manager
OperationModeManager.Register(productionUnitMode);
OperationModeManager.Register(semiAutoUnitMode);
OperationModeManager.Register(cleaningUnitMode);
OperationModeManager.Register(onlyInsertLabelsUnitMode);
OperationModeManager.Register(takeOutOnceUnitMode);
OperationModeManager.Register(autoTakeoutLabelsUnitMode);

// Sync current unit mode enumeration from HMI
OperationMode		:= HMI.OperationMode;

currentOperationMode		:= OperationModeManager.ActiveUnitMode;

IMM := InjectionMouldingMachine.Unit;

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
	HardwareButtons.StartCycle.Off();
	Stacklight.Green.Off();
	HardwareButtons.Stop.Off();
	HardwareButtons.EndCycle.Off();
	HardwareButtons.Homing.Solid();


	GlobalVars.manualControlRequested := FALSE;


	semiAutoInContinuousMode	:= FALSE;		// For safety, disable this option every time we reset the machine
	airPressureWasDetectedWhileResetting	:= FALSE;

	FOR ui := 1 TO GlobalVars.fbModuleManager.resettableModulesCount DO
		startCondition[ui,1]	:= FALSE;
		startCondition[ui,2]	:= FALSE;
		resetResult[ui]			:= FALSE;
	END_FOR
END_IF

IF HardwareButtons.EndCycle.ButtonPushed THEN
	currentOperationMode.Stop();		// State change to: Stopping
	RETURN;
END_IF

// Check the state of the freq. inverters relay
IF NOT freqInvertersRelayOn.Q THEN		// Relay is not switched on for 2 seconds.
	IF freqInvertersRelayOff.Q THEN		// Check if relay is switched off long enough.
		EnableFreqInvertersRelay.Set();
	END_IF
END_IF

IF NOT EnableFreqInvertersRelay.Map() THEN
	RETURN;
END_IF

// Wait until all servo drives have power
GlobalVars.EnableServoDrives := TRUE;
IF NOT xServoDrivesEnabled THEN
	RETURN;
END_IF

// Wait until the machine has air pressure
GlobalVars.EnableMainvalve S= PNOZMulti2.xEnableAir;
IF NOT GlobalVars.EnableMainvalve
OR NOT DigIn.xAirPressureOK				// Do not continue when air pressure is missing
THEN
	IF NOT airPressureWasDetectedWhileResetting THEN
		RETURN;
	END_IF
END_IF

airPressureWasDetectedWhileResetting	:= TRUE;


moduleTimeoutMessage	:= 'Resetting active for modules: ';

// Itterate through all resettable modules
FOR ui := 1 TO GlobalVars.fbModuleManager.resettableModulesCount DO

	IF NOT startCondition[ui,1] THEN
		IF GlobalVars.fbModuleManager.resettableModules[ui].ResetCondition1 = 0 THEN
			startCondition[ui,1] := TRUE;						// Condition is not in use, so this condition is true.
		ELSE
			FOR uj := 1 TO GlobalVars.fbModuleManager.resettableModulesCount DO		// Find other module that needs to be done first
				IF GlobalVars.fbModuleManager.resettableModules[ui].ResetCondition1 = GlobalVars.fbModuleManager.resettableModules[uj] THEN
					startCondition[ui,1] := resetResult[uj];		// Copy result of other module
					EXIT;
				END_IF
			END_FOR
		END_IF
	END_IF

	IF NOT startCondition[ui,2] THEN
		IF GlobalVars.fbModuleManager.resettableModules[ui].ResetCondition2 = 0 THEN		// Do the same for second reset condition
			startCondition[ui,2] := TRUE;
		ELSE
			FOR uj := 1 TO GlobalVars.fbModuleManager.resettableModulesCount DO
				IF GlobalVars.fbModuleManager.resettableModules[ui].ResetCondition2 = GlobalVars.fbModuleManager.resettableModules[uj] THEN
					startCondition[ui,2] := resetResult[uj];
					EXIT;
				END_IF
			END_FOR
		END_IF
	END_IF

	IF  startCondition[ui,1]
	AND startCondition[ui,2]		// Both start conditions are true, so start resetting module
	AND NOT resetResult[ui]
	THEN
		resetResult[ui] := GlobalVars.fbModuleManager.resettableModules[ui].Reset();	// Give Reset command
		SAFECONCAT3(ADR(moduleTimeoutMessage), GlobalVars.fbModuleManager.resettableModules[ui].InstanceName, ', ', 250);
	END_IF

	allModulesDone	R= NOT resetResult[ui];	// Reset allModulesDone when any resetResult bool in the array is still false
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
// Wait here for the SER to get the first labels ready for the first cycle.
// State is finished when the SER is at the parking position in front of the mould

IF State.Changed THEN
	LogPlc.Info(CONCAT('Automatic cycle started in mode: ', TO_STRING(_operationMode)));
	HardwareButtons.StartCycle.Solid();
	Stacklight.Green.Solid();

	moduleTimeoutMessage := '';

	FOR ui := 1 TO GlobalVars.fbModuleManager.startableModulesCount DO
		startResult[ui]			:= FALSE;

		// Check if a certain module needs to start up in this operation mode. Only do this once.
		startCondition[ui]		:= GlobalVars.fbModuleManager.startableModules[ui].ShouldStart(OperationMode);
	END_FOR
END_IF

IF OperationMode = SER_OperationModeType.SemiAuto
OR OperationMode = SER_OperationModeType.AutoTakeoutLabels
THEN
	HardwareButtons.F1.SetFlashingFrequency(TRUE);
	HardwareButtons.F1.Flash();
END_IF

HardwareButtons.StartCycle.Solid();

IF HardwareButtons.EndCycle.ButtonPushed THEN
	currentOperationMode.Stop();		// State change to: Stopping
	RETURN;
END_IF

moduleTimeoutMessage := 'Modules still busy starting: ';


FOR ui := 1 TO GlobalVars.fbModuleManager.startableModulesCount DO

	IF NOT startCondition[ui] THEN	// This module should not start.
		startResult[ui]	:= TRUE;
		CONTINUE;					// Continue with the next module
	END_IF

	// Start automatic cycle on all starting modules that should start in this operation mode
	// Only execute the StartCycle method when result bool is false.
	IF NOT startResult[ui] THEN
		startResult[ui]	:= GlobalVars.fbModuleManager.startableModules[ui].StartCycle();
	END_IF

	IF NOT startResult[ui] THEN
		allModulesDone	:= FALSE;	// Reset allModulesDone when any startResult bool in the array is still false
		// Generate string to give info about which module is still starting
		SAFECONCAT3(ADR(moduleTimeoutMessage), GlobalVars.fbModuleManager.startableModules[ui].InstanceName, ', ', 250);
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
	HardwareButtons.StartCycle.Off();
	Stacklight.Green.Off();
	HardwareButtons.Stop.Off();
	HardwareButtons.EndCycle.Off();
	HardwareButtons.Homing.Off();

	airPressureWasDetectedWhileResetting	:= FALSE;
END_IF

IF HMI.ButtonEnableDrives.ButtonPushed THEN
	GlobalVars.EnableServoDrives := NOT GlobalVars.EnableServoDrives;
END_IF

IF (NOT xGatesAreClosed OR NOT DigIn.xSafetyGateRelay) AND NOT PNOZMulti2.xOperatorSwitch THEN
	GlobalVars.EnableServoDrives := FALSE;
END_IF

IF HMI.ButtonEnableMainvalve.ButtonPushed THEN
	GlobalVars.EnableMainvalve := NOT GlobalVars.EnableMainvalve;
END_IF

// Activate main air valve when button is pushed while all gates are closed.
GlobalVars.EnableMainvalve		S= xGatesAreClosed AND xGatesLockButtonPushed;
// Reset main air valve when Pilz does not enable air.
GlobalVars.EnableMainvalve		R= NOT PNOZMulti2.xEnableAir;

IF GlobalVars.Reset THEN					// Enable freq. inverters relay when reset button is pushed
	IF NOT freqInvertersRelayOn.Q THEN		// Relay is not switched on for 2 seconds.
		IF freqInvertersRelayOff.Q THEN		// Check if relay is switched off long enough.
			EnableFreqInvertersRelay.Set();
		END_IF
	END_IF
END_IF

IF NOT xGatesAreClosed
OR NOT DigIn.xSafetyGateRelay
OR NOT DigIn.quickStopOk
OR IMM.AutoOperation
OR (PNOZMulti2.xOperatorSwitch AND OperationMode <> SER_OperationModeType.AutoTakeoutLabels)		// Not allowed to leave key switch enabled
OR (PNOZMulti2.xServiceSwitch AND OperationMode <> SER_OperationModeType.AutoTakeoutLabels)
OR PNOZMulti2.xHoldToRunButton
THEN
	HardwareButtons.Homing.Off();
	RETURN;
END_IF

HardwareButtons.Homing.Flash();

IF HardwareButtons.Homing.ButtonPushed
AND NOT HardwareButtons.Stop.buttonInput	// Stop button looks like a black e-stop. Make sure it is depressed.
THEN
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
	HardwareButtons.StartCycle.Off();
	Stacklight.Green.Off();

	HardwareButtons.Stop.Flash();
	HardwareButtons.EndCycle.Off();
	HardwareButtons.Homing.Off();
	HardwareButtons.F1.Off();
	HardwareButtons.F2.Off();

	moduleTimeoutMessage := '';

	HMI.FooterName		:= enumFooterNames.None;

	IF OperationMode = SER_OperationModeType.SemiAuto THEN			// if stopping in semi-auto, request that the mode is put back to Production.
		HMI.OperationMode	:= SER_OperationModeType.Production;
	END_IF

	FOR ui := 1 TO GlobalVars.fbModuleManager.baseModulesCount DO
		stopResult[ui] := FALSE;
	END_FOR
END_IF

// Allow operator to switch off power to the servo motors while Stopping. This way when a drive does not Stop correctly the state can change to Stopped that way.
GlobalVars.EnableServoDrives	R= HMI.ButtonEnableDrives.ButtonPushed;
GlobalVars.EnableMainvalve		R= HMI.ButtonEnableMainvalve.ButtonPushed;

moduleTimeoutMessage := 'Modules still stopping: ';

// Itterate through all modules
FOR ui := 1 TO GlobalVars.fbModuleManager.baseModulesCount DO

	// Only execute the Stop method when result bool is false.
	IF NOT stopResult[ui] THEN
		stopResult[ui]	:= GlobalVars.fbModuleManager.baseModules[ui].Stop();
	END_IF

	IF NOT stopResult[ui] THEN
		allModulesDone	:= FALSE;	// Reset allModulesDone when any stopResult bool in the array is still false
		SAFECONCAT3(ADR(moduleTimeoutMessage), GlobalVars.fbModuleManager.baseModules[ui].InstanceName, ', ', 250);
	END_IF
END_FOR

// All modules are done
IF allModulesDone AND NOT IMM.AutoOperation THEN
	moduleTimeoutMessage := '';
	currentOperationMode.ActingStateCompleted();		// State change to: Stopped
END_IF
END_METHOD

// Wait State – In this state the SER is not producing any
// products. It will either stop running or continue to cycle without
// producing until external process conditions return to normal, at which
// time the SUSPENDED state will transition to the UNSUSPENDING state,
// typically without ANY operator intervention.
// The SER switches to this state when the IMM is not in Automatic Operation
METHOD PRIVATE Suspended
VAR_INST
	Timer:BTON;
END_VAR
%FOLDER PackML States
IF NOT IMM.AutoOperation THEN
	HardwareButtons.EndCycle.Flash();
ELSE
	HardwareButtons.EndCycle.Off();
END_IF

IF HardwareButtons.EndCycle.ButtonPushed THEN
	currentOperationMode.Stop();		// State change to: Stopping
	RETURN;
END_IF


// Wait for the IMM to turn back on
IF (HardwareButtons.StartCycle.ButtonPushed AND Timer.Set(IMM.AutoOperation, 0.2))
OR HardwareButtons.EndCycle.ButtonPushed
OR requestedReaction = enumErrorReaction.EndCycle
THEN
	Timer.Reset();
	currentOperationMode.UnSuspend();		// State change to: UnSuspending		<-- Press F12 here
END_IF
END_METHOD

// Acting State
METHOD PRIVATE Suspending
%FOLDER PackML States
// The IMM is not in Automatic operation
// Halt the SER cycle
// State is finished when the SER is at the parking position in front of the mould

Stacklight.Green.Flash();
HardwareButtons.StartCycle.Flash();

currentOperationMode.ActingStateCompleted();		// State change to: Suspended		<-- Press F12 here
END_METHOD

// Acting State
METHOD PRIVATE UnHolding
%FOLDER PackML States
// Resume the SER cycle.
// No actions needed here

currentOperationMode.ActingStateCompleted();		// State change to: Execute		<-- Press F12 here
END_METHOD

// Acting State
METHOD PRIVATE UnSuspending
%FOLDER PackML States
// Resume the SER cycle.
// No actions needed here

HardwareButtons.StartCycle.Solid();
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
OR OperationMode = SER_OperationModeType.AutoTakeoutLabels
THEN

	IF  OperationMode = SER_OperationModeType.AutoTakeoutLabels
	AND PNOZMulti2.xHoldToRunButton
	AND PNOZMulti2.xServiceSwitch
	THEN
		SemiAutoNextStep := HardwareButtons.F1.ButtonPushed OR HardwareButtons.StartCycle.ButtonPushed;
	ELSIF NOT xGatesAreClosed OR NOT DigIn.xSafetyGateRelay OR NOT IMM.DoorsClosed THEN
		SemiAutoNextStep := FALSE;
	ELSIF semiAutoInContinuousMode THEN
		SemiAutoNextStep := TRUE;
	ELSE
		SemiAutoNextStep := HardwareButtons.F1.ButtonPushed OR HardwareButtons.StartCycle.ButtonPushed;
	END_IF

ELSE
	SemiAutoNextStep := TRUE;
END_IF
END_GET
END_PROPERTY
