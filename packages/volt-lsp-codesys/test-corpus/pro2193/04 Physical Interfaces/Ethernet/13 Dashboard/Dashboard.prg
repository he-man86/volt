PROGRAM Dashboard
VAR
	monitoringService		: EdgePcLogging.MonitoringService;

	serState				: DWORD;
	bfuState				: DWORD;
	serOperationMode		: INT;
	gatesAreOpen			: BOOL;

	taskInfo				: CmpIecTask.Task_Info2;
	watchdogCounter			: USINT;
END_VAR

__TRY
taskInfo	:= TaskGetInfo();

IF taskInfo.dwCycleTime >= taskInfo.dwWatchdogTime THEN
	LogPlc.Fatal(concat3('Watchdog! Cycletime: ', TO_STRING(taskInfo.dwCycleTime), 'ms.'));
	Increment.AnyInt(watchdogCounter);
END_IF

EdgePcPrg.client.UpdateCurrentTime();

Initialize();

monitoringService(edgePcClient := EdgePcPrg.client);

serState				:= SER.ActState;
serOperationMode		:= SER.OperationMode;
bfuState				:= BFU.ActState;

//gatesAreOpen			:= NOT SER.xGatesAreClosed OR NOT BFU.xGatesAreClosed;

gatesAreOpen			:= SER.GateZAxis.GateState = enumGateStates.Opened
						OR SER.GateSTG.GateState = enumGateStates.Opened
						OR SER.GateMAxis.GateState = enumGateStates.Opened
						OR SER.GateDrawerMAxis.GateState = enumGateStates.Opened
						OR BFU.GateBFU.GateState = enumGateStates.Opened;

__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.DashboardTask])
	GVL_Exceptions.xException := TRUE;
	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;
__ENDTRY

END_PROGRAM

METHOD PRIVATE Initialize
VAR_INST
	{attribute 'init_on_onlchange' }
	initialized	: BOOL;
END_VAR
IF initialized THEN
	RETURN;
END_IF

monitoringService.UnregisterAll();

// Disable warning C0327: Implicit conversion from one enumeration type (PLCDATATYPE) to another (PLCDATATYPE (edgepclogging, x.x (brink automation)))
{warning disable C0327}

// Global options
monitoringService.RegisterBool(	PlcDataType.Main_EnableIML,						PersistentVars.RecipeVars.EnableIML,		TRUE, T#30M);
monitoringService.RegisterBool(	PlcDataType.Main_EnableHMU,						PersistentVars.RecipeVars.EnableHMU,		TRUE, T#30M);
monitoringService.RegisterBool(	PlcDataType.Main_EnableVision,					PersistentVars.RecipeVars.EnableVision,		TRUE, T#30M);

// Vacuum pumps
monitoringService.RegisterBool(	PlcDataType.Main_Relays_HighVacuumPumpRunning,	SER.VacuumPumps.HighVacuumPump.VacuumPump.output);
monitoringService.RegisterBool(	PlcDataType.Main_Relays_LowVacuumPumpRunning,	SER.VacuumPumps.LowVacuumPump.VacuumPump.output);
monitoringService.RegisterBool(	PlcDataType.Main_HighVacuumTankFull,			SER.VacuumPumps.xHighVacuumtankFull,	TRUE,	T#30M);
monitoringService.RegisterBool(	PlcDataType.Main_LowVacuumTankFull,				SER.VacuumPumps.xLowVacuumtankFull,		TRUE,	T#30M);
monitoringService.RegisterBool(	PlcDataType.Main_AirPressureOk,					SER.DigIn.xAirPressureOK,				TRUE,	T#30M);

// IMM
monitoringService.RegisterBool(	PlcDataType.IMM_I_Euromap_RejectMoulding,		InjectionMouldingMachine.Unit.xRejectMoulding);
monitoringService.RegisterBool(	PlcDataType.IMM_I_Euromap_MouldClosed,			InjectionMouldingMachine.Unit.xMouldClosed);
monitoringService.RegisterBool(	PlcDataType.IMM_I_Euromap_IntermediateOpen,		InjectionMouldingMachine.Unit.xIntermediateOpen);
monitoringService.RegisterBool(	PlcDataType.IMM_I_Euromap_AutoOperation,		InjectionMouldingMachine.Unit.xAutoOperation);
monitoringService.RegisterBool(	PlcDataType.IMM_I_Euromap_EjectorBack,			InjectionMouldingMachine.Unit.Ejectors.inputIsBack);
monitoringService.RegisterBool(	PlcDataType.IMM_I_Euromap_EjectorForward,		InjectionMouldingMachine.Unit.Ejectors.inputIsForward);
monitoringService.RegisterBool(	PlcDataType.IMM_I_Euromap_CorePos1Back,			InjectionMouldingMachine.Unit.CorePullers.inputIsBack);
monitoringService.RegisterBool(	PlcDataType.IMM_I_Euromap_CorePos2Forward,		InjectionMouldingMachine.Unit.CorePullers.inputIsForward);
monitoringService.RegisterBool(	PlcDataType.IMM_I_Euromap_DoorClosed,			InjectionMouldingMachine.Unit.xDoorsClosed);

monitoringService.RegisterBool(	PlcDataType.Relays_MouldAreaFree,				InjectionMouldingMachine.Unit.MouldAreaFree.output);
monitoringService.RegisterBool(	PlcDataType.Relays_EnableMouldClosure,			InjectionMouldingMachine.Unit.EnableMouldClosure.output);
monitoringService.RegisterBool(	PlcDataType.Relays_EnableFullMouldOpening,		InjectionMouldingMachine.Unit.EnableFullMouldOpening.output);
monitoringService.RegisterBool(	PlcDataType.Relays_OperationWithRobot,			InjectionMouldingMachine.Unit.OperationWithRobot.output);
monitoringService.RegisterBool(	PlcDataType.Relays_EnableEjectorBack,			InjectionMouldingMachine.Unit.Ejectors.EnableBackOutput.output);
monitoringService.RegisterBool(	PlcDataType.Relays_EnableEjectorForward,		InjectionMouldingMachine.Unit.Ejectors.EnableForwardOutput.output);
monitoringService.RegisterBool(	PlcDataType.Relays_EnableCorePos1Back,			InjectionMouldingMachine.Unit.CorePullers.EnableBackOutput.output);
monitoringService.RegisterBool(	PlcDataType.Relays_EnableCorePos2Forward,		InjectionMouldingMachine.Unit.CorePullers.EnableForwardOutput.output);

// Relay outputs
monitoringService.RegisterBool(	PlcDataType.Relays_GlobalReset,					SER.ResetSignalOut.output);
monitoringService.RegisterBool(	PlcDataType.Relays_MainAirValve,				SER.MainAirValve.output);
monitoringService.RegisterBool(	PlcDataType.Relays_YUnit_MotorCooling,			YUnits.Unit[1].MotorCooling.Output.output);
monitoringService.RegisterBool(	PlcDataType.Relays_EnableFrequencyController,	SER.EnableFreqInvertersRelay.output);
monitoringService.RegisterBool(	PlcDataType.Relays_SafetyGate,					SER.DigIn.xSafetyGateRelay);

// Main status
monitoringService.RegisterInt(	PlcDataType.Main_SER_State,						serState,											1, T#10S, TRUE, T#5M);
monitoringService.RegisterInt(	PlcDataType.Main_SER_OperationMode,				serOperationMode,									1, T#10S, TRUE, T#15M);
monitoringService.RegisterBool(	PlcDataType.Main_GeneralAlarmActive,			ErrorHandling.errorActive,							TRUE,	T#30M);
monitoringService.RegisterBool(	PlcDataType.Main_GeneralWarningActive,			ErrorHandling.warningActive,						TRUE,	T#30M);
monitoringService.RegisterBool(	PlcDataType.Main_DoorStatusOpen,				gatesAreOpen,										TRUE,	T#5M);

monitoringService.RegisterInt(	PlcDataType.BFU_RobotStatus,					bfuState,											1, T#10S, TRUE, T#5M);


monitoringService.RegisterInt(	PlcDataType.Main_SafetyPLCStatus1,				PNOZMulti2.dwSafetyPLCStatus[1],					1, T#10S, TRUE, T#30M, TRUE);
monitoringService.RegisterInt(	PlcDataType.Main_SafetyPLCStatus2,				PNOZMulti2.dwSafetyPLCStatus[2],					1, T#10S, TRUE, T#30M, TRUE);
monitoringService.RegisterInt(	PlcDataType.Main_SafetyPLCStatus3,				PNOZMulti2.dwSafetyPLCStatus[3],					1, T#10S, TRUE, T#30M, TRUE);
monitoringService.RegisterInt(	PlcDataType.CycleTimes_TimeAutomatic,			PersistentVars.Statistics[3].TimeAutomatic,			60, T#1M);
monitoringService.RegisterInt(	PlcDataType.CycleTimes_TimeIdle,				PersistentVars.Statistics[3].TimeIdle,				60, T#1M);
monitoringService.RegisterInt(	PlcDataType.CycleTimes_TimeResetting,			PersistentVars.Statistics[3].TimeResetting,			60, T#1M);
monitoringService.RegisterInt(	PlcDataType.CycleTimes_TimeStopped,				PersistentVars.Statistics[3].TimeStopped,			60, T#1M);
monitoringService.RegisterInt(	PlcDataType.CycleTimes_AutomaticCycleStarts,	PersistentVars.Statistics[3].AutomaticCycleStarts,	0);
monitoringService.RegisterInt(	PlcDataType.Magazine_ActiveDrawer,				LabelSuppliers.Unit[1].activeDrawerForMonitoring,	0, T#10S, TRUE, T#10M);
monitoringService.RegisterReal(	PlcDataType.CycleTimes_TargetCycleTime,			PersistentVars.RecipeVars.targetCycleTime);
monitoringService.RegisterReal(	PlcDataType.Main_ProductWeight,					PersistentVars.RecipeVars.productWeight);

YUnits.Unit[1].Drive.SetMonitoring(
	itfAddLog			:= EdgePcPrg.client,
	powerSectionUtil	:= PlcDataType.YUnit_DriveUtilisation,
	motorUtil			:= PlcDataType.YUnit_MotorUtilisation,
	coveredDistance		:= PlcDataType.YUnit_CoveredDistance,
	errorId				:= PlcDataType.YUnit_ErrorId,
	axisErrorId			:= PlcDataType.YUnit_AxisErrorId,
	driveErrorId		:= PlcDataType.YUnit_DriveErrorId);
XiUnits.Unit[1].Drive.SetMonitoring(
	itfAddLog			:= EdgePcPrg.client,
	powerSectionUtil	:= PlcDataType.XiUnit_DriveUtilisation,
	motorUtil			:= PlcDataType.XiUnit_MotorUtilisation,
	coveredDistance		:= PlcDataType.XiUnit_CoveredDistance,
	errorId				:= PlcDataType.XiUnit_ErrorId,
	axisErrorId			:= PlcDataType.XiUnit_AxisErrorId,
	driveErrorId		:= PlcDataType.XiUnit_DriveErrorId);
XuUnits.Unit[1].Drive.SetMonitoring(
	itfAddLog			:= EdgePcPrg.client,
	powerSectionUtil	:= PlcDataType.XuUnit_DriveUtilisation,
	motorUtil			:= PlcDataType.XuUnit_MotorUtilisation,
	coveredDistance		:= PlcDataType.XuUnit_CoveredDistance,
	errorId				:= PlcDataType.XuUnit_ErrorId,
	axisErrorId			:= PlcDataType.XuUnit_AxisErrorId,
	driveErrorId		:= PlcDataType.XuUnit_DriveErrorId);
ZUnits.Unit[1].Drive.SetMonitoring(
	itfAddLog			:= EdgePcPrg.client,
	powerSectionUtil	:= PlcDataType.ZUnit_DriveUtilisation,
	motorUtil			:= PlcDataType.ZUnit_MotorUtilisation,
	coveredDistance		:= PlcDataType.ZUnit_CoveredDistance,
	errorId				:= PlcDataType.ZUnit_ErrorId,
	axisErrorId			:= PlcDataType.ZUnit_AxisErrorId,
	driveErrorId		:= PlcDataType.ZUnit_DriveErrorId);
Chains.Unit[1].Drive.SetMonitoring(
	itfAddLog			:= EdgePcPrg.client,
	powerSectionUtil	:= PlcDataType.Chain_DriveUtilisation,
	motorUtil			:= PlcDataType.Chain_MotorUtilisation,
	coveredDistance		:= PlcDataType.Chain_CoveredDistance,
	errorId				:= PlcDataType.Chain_ErrorId,
	axisErrorId			:= PlcDataType.Chain_AxisErrorId,
	driveErrorId		:= PlcDataType.Chain_DriveErrorId);
ZRUnits.Unit[1].Drive.SetMonitoring(
	itfAddLog			:= EdgePcPrg.client,
	powerSectionUtil	:= PlcDataType.ZrUnit_Zr1_DriveUtilisation,
	motorUtil			:= PlcDataType.ZrUnit_Zr1_MotorUtilisation,
	coveredDistance		:= PlcDataType.ZrUnit_Zr1_CoveredDistance,
	errorId				:= PlcDataType.ZrUnit_Zr1_ErrorId,
	axisErrorId			:= PlcDataType.ZrUnit_Zr1_AxisErrorId,
	driveErrorId		:= PlcDataType.ZrUnit_Zr1_DriveErrorId);
Conveyors.Unit[1].Drive.SetMonitoring(
	itfAddLog			:= EdgePcPrg.client,
	powerSectionUtil	:= PlcDataType.Conveyors_DriveUtilisation,
	motorUtil			:= PlcDataType.Conveyors_MotorUtilisation,
	coveredDistance		:= PlcDataType.Conveyors_CoveredDistance,
	errorId				:= PlcDataType.Conveyors_ErrorId,
	axisErrorId			:= PlcDataType.Conveyors_AxisErrorId,
	driveErrorId		:= PlcDataType.Conveyors_DriveErrorId);

monitoringService.RegisterInt(	PlcDataType.Magazine_M1_1_CoveredDistance,		Magazines.coveredDistance[1][PickPlaceAxesNames.A1],					10, T#1H);
monitoringService.RegisterInt(	PlcDataType.Magazine_M1_2_CoveredDistance,		Magazines.coveredDistance[1][PickPlaceAxesNames.A2],					10, T#1H);
monitoringService.RegisterReal(	PlcDataType.Magazine_M1_1_DriveUtilisation,		Magazines.UnitMotors[1].powerSectionUtilisation[PickPlaceAxesNames.A1],	5);
monitoringService.RegisterReal(	PlcDataType.Magazine_M1_2_DriveUtilisation,		Magazines.UnitMotors[1].powerSectionUtilisation[PickPlaceAxesNames.A2],	5);
monitoringService.RegisterReal(	PlcDataType.Magazine_M1_1_MotorUtilisation,		Magazines.UnitMotors[1].motorUtilisation[PickPlaceAxesNames.A1],		5);
monitoringService.RegisterReal(	PlcDataType.Magazine_M1_2_MotorUtilisation,		Magazines.UnitMotors[1].motorUtilisation[PickPlaceAxesNames.A2],		5);


InjectionMouldingMachine.Unit.cycleTimeTakeoutFB.SetMonitoring(EdgePcPrg.client,	PlcDataType.IMM_CycleTimeTakeout);
InjectionMouldingMachine.Unit.cycleTimeTotalFB.SetMonitoring(EdgePcPrg.client,		PlcDataType.IMM_CycleTimeTotal);

// Cylinder / vacuum times
XuUnits.Unit[1].Vacuum[1].SetMonitoring(EdgePcPrg.client,					PlcDataType.XuUnit_SensorTimes_Vacuum_1);
XuUnits.Unit[1].Vacuum[2].SetMonitoring(EdgePcPrg.client,					PlcDataType.XuUnit_SensorTimes_Vacuum_2);
XuUnits.Unit[1].Vacuum[3].SetMonitoring(EdgePcPrg.client,					PlcDataType.XuUnit_SensorTimes_Vacuum_3);

Magazines.Unit[1].Vacuum[1].SetMonitoring(EdgePcPrg.client,					PlcDataType.Magazine_SensorTimes_Vacuum_1);
Magazines.Unit[1].Vacuum[2].SetMonitoring(EdgePcPrg.client,					PlcDataType.Magazine_SensorTimes_Vacuum_2);
Magazines.Unit[1].Vacuum[3].SetMonitoring(EdgePcPrg.client,					PlcDataType.Magazine_SensorTimes_Vacuum_3);
Magazines.Unit[1].Vacuum[4].SetMonitoring(EdgePcPrg.client,					PlcDataType.Magazine_SensorTimes_Vacuum_4);
Magazines.Unit[1].Vacuum[5].SetMonitoring(EdgePcPrg.client,					PlcDataType.Magazine_SensorTimes_Vacuum_5);
Magazines.Unit[1].Vacuum[6].SetMonitoring(EdgePcPrg.client,					PlcDataType.Magazine_SensorTimes_Vacuum_6);

Magazines.Unit[1].FlipLabel.SetMonitoring(EdgePcPrg.client,					PlcDataType.Magazine_SensorTimes_FlipLabel1In,
																			PlcDataType.Magazine_SensorTimes_FlipLabel1Out);

LabelSuppliers.Unit[1].DrawerChangeCylinder.SetMonitoring(EdgePcPrg.client,	PlcDataType.Magazine_SensorTimes_ChangeDrawerIn,
																			PlcDataType.Magazine_SensorTimes_ChangeDrawerOut);

LabelSuppliers.Unit[1].LockPins.SetMonitoring(EdgePcPrg.client,				PlcDataType.Magazine_SensorTimes_LockDrawerIn,
																			PlcDataType.Magazine_SensorTimes_LockDrawerOut);

ZUnits.Unit[1].Vacuum[1,1].SetMonitoring(EdgePcPrg.client,					PlcDataType.ZUnit_SensorTimes_Vacuum_1);
ZUnits.Unit[1].Vacuum[1,2].SetMonitoring(EdgePcPrg.client,					PlcDataType.ZUnit_SensorTimes_Vacuum_2);
ZUnits.Unit[1].Vacuum[1,3].SetMonitoring(EdgePcPrg.client,					PlcDataType.ZUnit_SensorTimes_Vacuum_3);
ZUnits.Unit[1].Vacuum[1,4].SetMonitoring(EdgePcPrg.client,					PlcDataType.ZUnit_SensorTimes_Vacuum_4);
ZUnits.Unit[1].Vacuum[1,5].SetMonitoring(EdgePcPrg.client,					PlcDataType.ZUnit_SensorTimes_Vacuum_5);
ZUnits.Unit[1].Vacuum[1,6].SetMonitoring(EdgePcPrg.client,					PlcDataType.ZUnit_SensorTimes_Vacuum_6);
ZUnits.Unit[1].Vacuum[2,1].SetMonitoring(EdgePcPrg.client,					PlcDataType.ZUnit_SensorTimes_Vacuum_7);
ZUnits.Unit[1].Vacuum[2,2].SetMonitoring(EdgePcPrg.client,					PlcDataType.ZUnit_SensorTimes_Vacuum_8);
ZUnits.Unit[1].Vacuum[2,3].SetMonitoring(EdgePcPrg.client,					PlcDataType.ZUnit_SensorTimes_Vacuum_9);
ZUnits.Unit[1].Vacuum[2,4].SetMonitoring(EdgePcPrg.client,					PlcDataType.ZUnit_SensorTimes_Vacuum_10);
ZUnits.Unit[1].Vacuum[2,5].SetMonitoring(EdgePcPrg.client,					PlcDataType.ZUnit_SensorTimes_Vacuum_11);
ZUnits.Unit[1].Vacuum[2,6].SetMonitoring(EdgePcPrg.client,					PlcDataType.ZUnit_SensorTimes_Vacuum_12);

ZUnits.Unit[1].Shift.SetMonitoring(EdgePcPrg.client,						PlcDataType.ZUnit_SensorTimes_Shift1In,
																			PlcDataType.ZUnit_SensorTimes_Shift1Out);

BoxCenterUnits.Unit[1].OpenBoxLongSide.SetMonitoring(EdgePcPrg.client,		PlcDataType.BoxConveyor_SensorTimes_OpenBoxLongSideIn,
																			PlcDataType.BoxConveyor_SensorTimes_OpenBoxLongSideOut);
BoxCenterUnits.Unit[1].OpenBoxShortSide.SetMonitoring(EdgePcPrg.client,		PlcDataType.BoxConveyor_SensorTimes_OpenBoxShortSideIn,
																			PlcDataType.BoxConveyor_SensorTimes_OpenBoxShortSideOut);
BoxCenterUnits.Unit[1].Lift.SetMonitoring(EdgePcPrg.client,					PlcDataType.BoxConveyor_SensorTimes_LiftIn,
																			PlcDataType.BoxConveyor_SensorTimes_LiftOut);

BoxPushers.Unit[1].Pusher.SetMonitoring(EdgePcPrg.client,					PlcDataType.BoxInfeed_SensorTimes_PusherIn,
																			PlcDataType.BoxInfeed_SensorTimes_PusherOut);

monitoringService.RegisterBool(	PlcDataType.PTZ_AirPressureOk,				BFU.DigIn.xAirPressureOK,				TRUE,	T#30M);


// Example how to set up monitoring of program states:
//ProcessModules.ChainControl[1].State.SetMonitoring(EdgePcPrg.client,				PlcDataType.state1);
//ProcessModules.ConveyorControl[1].State.SetMonitoringEdgePcPrg.client,			PlcDataType.state2);
// Note: No PlcDataType available yet for program states

// Strings
monitoringService.registerString(	PlcDataType.MetaData_RejectReason_1_Description,	refInput := ADR(PersistentVars.rejectReasonDescriptions[1]),		FALSE,	T#2H);
monitoringService.registerString(	PlcDataType.MetaData_RejectReason_2_Description,	refInput := ADR(PersistentVars.rejectReasonDescriptions[2]),		FALSE,	T#2H);
monitoringService.registerString(	PlcDataType.MetaData_RejectReason_3_Description,	refInput := ADR(PersistentVars.rejectReasonDescriptions[3]),		FALSE,	T#2H);
monitoringService.registerString(	PlcDataType.MetaData_RejectReason_4_Description,	refInput := ADR(PersistentVars.rejectReasonDescriptions[4]),		FALSE,	T#2H);
monitoringService.registerString(	PlcDataType.MetaData_RejectReason_5_Description,	refInput := ADR(PersistentVars.rejectReasonDescriptions[5]),		FALSE,	T#2H);
monitoringService.registerString(	PlcDataType.MetaData_RejectReason_6_Description,	refInput := ADR(PersistentVars.rejectReasonDescriptions[6]),		FALSE,	T#2H);
monitoringService.registerString(	PlcDataType.MetaData_RejectReason_7_Description,	refInput := ADR(PersistentVars.rejectReasonDescriptions[7]),		FALSE,	T#2H);
monitoringService.registerString(	PlcDataType.MetaData_RejectReason_8_Description,	refInput := ADR(PersistentVars.rejectReasonDescriptions[8]),		FALSE,	T#2H);
monitoringService.registerString(	PlcDataType.Main_RecipeName_Brink,					refInput := ADR(RecipeControl.activeRecipe[1]),						TRUE,	T#3H);
monitoringService.registerString(	PlcDataType.Main_RecipeName,						refInput := ADR(RecipeControl.activeRecipe[2]),						TRUE,	T#3H);
monitoringService.registerString(	PlcDataType.Main_RecipeName_Cassette,				refInput := ADR(RecipeControl.activeRecipe[3]),						TRUE,	T#3H);
monitoringService.registerString(	PlcDataType.Main_ParameterChanged,					refInput := ADR(HMI.logMessageParameterChange),						FALSE,	T#0MS);


{warning restore C0327}

initialized := TRUE;


(*
// Time Idle
monitoringService.RegisterReal(	PlcDataType.YUnit_Time_Idle,						YAxis.Axis[1].T_Active[2].rStoredTimeMax,		0);
monitoringService.RegisterReal(	PlcDataType.XrUnit_Time_Idle,						XrAxis.Axis[1].T_Active[2].rStoredTimeMax,		0);
monitoringService.RegisterReal(	PlcDataType.XiUnit_Time_Idle,						XiAxis.Axis[1].T_Active[2].rStoredTimeMax,		0);
monitoringService.RegisterReal(	PlcDataType.XuUnit_Time_Idle,						XuAxis.Axis[1].T_Active[2].rStoredTimeMax,		0);
monitoringService.RegisterReal(	PlcDataType.Chain_Time_Idle,						Chain.T_Active[2].rStoredTimeMax,				0);
monitoringService.RegisterReal(	PlcDataType.Magazine_M1_1_Time_Idle,				MAxis.Axis[1].T_Active[2].rStoredTimeMax,		0);
monitoringService.RegisterReal(	PlcDataType.Magazine_M1_2_Time_Idle,				MAxis.Axis[1].T_Active[4].rStoredTimeMax,		0);
monitoringService.RegisterReal(	PlcDataType.ZUnit_Time_Idle,						ZAxis.T_Active[2].rStoredTimeMax,				0);
monitoringService.RegisterReal(	PlcDataType.Camera_Time_Idle,						Camera.T_Active[2].rStoredTimeMax,				0);
monitoringService.RegisterReal(	PlcDataType.RejectStation_Time_Idle,				RejectStation.T_Active[2].rStoredTimeMax,		0);
monitoringService.RegisterReal(	PlcDataType.Conveyors_Time_Idle,					Conveyor.T_Active[2].rStoredTimeMax,			0);

// Time Active
monitoringService.RegisterReal(	PlcDataType.YUnit_Time_Active,						YAxis.Axis[1].T_Active[1].rStoredTimeMax,		0);
monitoringService.RegisterReal(	PlcDataType.XrUnit_Time_Active,						XrAxis.Axis[1].T_Active[1].rStoredTimeMax,		0);
monitoringService.RegisterReal(	PlcDataType.XiUnit_Time_Active,						XiAxis.Axis[1].T_Active[1].rStoredTimeMax,		0);
monitoringService.RegisterReal(	PlcDataType.XuUnit_Time_Active,						XuAxis.Axis[1].T_Active[1].rStoredTimeMax,		0);
monitoringService.RegisterReal(	PlcDataType.Chain_Time_Active,						Chain.T_Active[1].rStoredTimeMax,				0);
monitoringService.RegisterReal(	PlcDataType.Magazine_M1_1_Time_Active,				MAxis.Axis[1].T_Active[1].rStoredTimeMax,		0);
monitoringService.RegisterReal(	PlcDataType.Magazine_M1_2_Time_Active,				MAxis.Axis[1].T_Active[3].rStoredTimeMax,		0);
monitoringService.RegisterReal(	PlcDataType.ZUnit_Time_Active,						ZAxis.T_Active[1].rStoredTimeMax,				0);
monitoringService.RegisterReal(	PlcDataType.Camera_Time_Active,						Camera.T_Active[1].rStoredTimeMax,				0);
monitoringService.RegisterReal(	PlcDataType.RejectStation_Time_Active,				RejectStation.T_Active[1].rStoredTimeMax,		0);
monitoringService.RegisterReal(	PlcDataType.Conveyors_Time_Active,					Conveyor.T_Active[1].rStoredTimeMax,			0);
*)
END_METHOD
