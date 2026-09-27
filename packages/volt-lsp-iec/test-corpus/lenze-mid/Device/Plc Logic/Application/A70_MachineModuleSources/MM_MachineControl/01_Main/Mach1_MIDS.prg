PROGRAM Mach1_MIDS
VAR
	FB_Mach1					: GeneralMachineFlags;
	//Mach1.GenFlags				: UDT_GeneralFlags;
	tStopPositionCleaning	: BOOL;
	
	tDoorUnitOk				: BOOL;
	tCrossDoorcircuit1 		: BOOL;
	tCrossDoorcircuit2 		: BOOL;
	tAlarmlamp				: BOOL;
	tBool					: BOOL;
	tCond					: BOOL;
	
	tStopPositionLeafCarrier: BOOL;
	tReset: BOOL;
	a:INT;
//TODO
	//test5: CTD;
	//HMI_Var_Mach1_MuteNoBunchAlarm: SR;
	RepetitionNoBunch: CTD;
	tCampulseCigarPresent: BOOL;
	RepetitionNoCigar: CTD;
	PhotocellCigarHasBeenOff: SR;
	tTime1: TIME;
	tLowLevel: BOOL;
	tErrorRuntimeGreasingSystem: BOOL;
	tAlarmSL: BOOL;
	tWarningSL: BOOL;
	tStandbySL: BOOL;
	tRunningSL: BOOL;
	tHeater1Word: WORD;
	tHeater2Word: WORD;
	tHeater3Word: WORD;
	test3: BOOL;
	test4: BOOL;
	qw105: WORD;
	DRYER_SCALING_Heater1: LIN_TRAFO;
	
	DRYER_Scaling_Speed: LIN_TRAFO;
	lrDryer_ScaledSpeed: REAL;
	lrHeater1_ScaledPower:REAL; //% of max power of 1500
	
	lrHeater1_Analog: REAL;
	DRYER_SCALING_Heater2: LIN_TRAFO;
	lrHeater2_ScaledPower: REAL;
	DRYER_SCALING_Heater1_Analog: LIN_TRAFO;
	DRYER_SCALING_Heater2_Analog: LIN_TRAFO;
	lrHeater2_Analog: REAL;
	lrHeater3_ScaledPower: REAL;
	DRYER_SCALING_Heater3: LIN_TRAFO;
	lrHeater3_Analog: REAL;
	tspeed: REAL;
	TMR_ResetSafety: TON;
	tResetSafetyGuard: BOOL;
	TMR_StartupFan: TON;
	tElevatorUp: BOOL;
	tElevatorDown:BOOL;
	TMR_DelaySafetyModuleError: TON;
	Comm_OK: BOOL;
	TON_DelayAfterNetworkError: TON;
	REQ_RestartComm: BOOL;
	ReInitAllNodes: L_MC1P_ReinitAllNodes;
END_VAR
VAR 
	Mach1_Drives_DB: Mach1_Drives;
	IDB_Dryer: Dryer;
	IDB_TrayFiller: TrayFiller;
END_VAR
(* @volt-implementation *)
(* @volt-graphical: an assign below the top level *)

END_PROGRAM
