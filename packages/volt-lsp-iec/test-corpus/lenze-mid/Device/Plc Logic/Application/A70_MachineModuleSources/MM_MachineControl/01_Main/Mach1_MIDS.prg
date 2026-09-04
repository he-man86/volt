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

NETWORK 0 LD TITLE: "DONE Network 1: Activating/deactivating MID-S/Trayfiller"
  LET g0 := TRUE;
  LET g1 := (g0 AND NOT Mach1_Safety.Status.Custom_ATF_Disabled);
  Mach1_AuxData.TrayfillerActive := g1;
  HMI_Var.TrayfillerActive := g1;
  Mach1_AuxData.MIDS_Active := (g0 AND TRUE);
END_NETWORK
NETWORK 1 LD TITLE: "DONE Network 2: Main Block FB100 TODO"
  LET i1 := fc_dinttotime(Mach1_Data.Timers.StartDelayAuxDrives,2);
  LET i2 := fc_dinttotime(Mach1_Data.Timers.StopDelayAuxDrives,2);
  tResetSafetyGuard := FB_Mach1(iStartResetSeparate := LST_General.AlwaysOff, iServiceButtonHasResetFunction := LST_General.AlwaysOff, iFirstCycle := LST_General.FirstCycle, iSignalPulse := LST_General.FF500ms, iAirPressureDoorsSeparate := LST_General.AlwaysOff, iEmergencyUnitOK := ((Mach1_AuxData.MIDS_Active AND Mach1_Safety.Status.EmergencyStopOK) OR NOT Mach1_AuxData.MIDS_Active), iDoorUnitOK := ((Mach1_AuxData.MIDS_Active AND Mach1_Safety.Status.DoorsOK) OR NOT Mach1_AuxData.MIDS_Active), iSTO_Enabled := Mach1_Safety.Status.STO_OK, iAirPressureOK := ((Mach1_AuxData.MIDS_Active AND LST_InputsOutputs.I100_0_AirpressureOK) OR NOT Mach1_AuxData.MIDS_Active), iSwitchService := Mach1_Safety.Status.ServiceMode, iButtonService := Mach1_Safety.Status.Service_ButtonAB, iStart1 := LST_InputsOutputs.I100_1_Pushbutton_start_OP0a, iStop1 := ((Mach1_AuxData.MIDS_Active AND LST_InputsOutputs.I100_2_Pushbutton_stop_OP0a) OR NOT Mach1_AuxData.MIDS_Active), iReset1 := LST_General.AlwaysOff, iAutoManual1 := LST_InputsOutputs.I100_3_Selector_switch_auto_manual_OP0a, iStart2 := (Mach1_AuxData.TrayfillerActive AND LST_InputsOutputs.I132_1_PB_Start_OP2a), iStop2 := (LST_InputsOutputs.I132_2_PB_Stop_OP2a OR NOT Mach1_AuxData.TrayfillerActive), iReset2 := LST_General.AlwaysOff, iAutoManual2 := LST_InputsOutputs.I132_3_SW_Auto_Man, iStart3 := LST_General.AlwaysOff, iStop3 := TRUE, iReset3 := LST_General.AlwaysOff, iAutoManual3 := LST_General.AlwaysOff, iPreDelayAfterEmergStop := T#4S, iPreStartDelayAuxDrives := i1, iPreStopDelayAuxDrives := i2, iPreDelayAfterSTOEnabled := T#2S, GenFlags := Mach1.GenFlags);
END_NETWORK
NETWORK 2 LD
  LET g54 := TRUE;
  Mach1_Safety.Control.ResetSafetyGuard := (g54 AND (mach1.Genflags.StartFlag OR tResetSafetyGuard)) SET;
  Mach1_Safety.Control.ResetSafetyGuard := TMR_ResetSafety(IN := (g54 AND Mach1_Safety.Control.ResetSafetyGuard), PT := T#1S) SET;
END_NETWORK
NETWORK 3 LD TITLE: "DONE Network 3 :Muting zones"
  LET g2 := (TRUE AND Mach1_AuxData.MainDriveHomed AND Mach1_AuxData.RollingDeviceHomed);
  Mach1_Safety.Control.Muting_zone1 := (g2 AND tCrossDoorcircuit1);
  Mach1_Safety.Control.Muting_zone2 := (g2 AND tCrossDoorcircuit1);
END_NETWORK
NETWORK 4 LD TITLE: "DONE NETWORK 4 (p1)Major alarms (start-up conditions)"
  Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.MIDS_Active AND NOT Mach1_Safety.Status.EmergencyStopOK), TRUE, Mach1_Alarms.Alm001, Mach1.GenFlags.MajorAlarm);
END_NETWORK
NETWORK 5 LD TITLE: "DONE NETWORK 4 (p2)Major alarms (start-up conditions)"
  Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.MIDS_Active AND Mach1_Safety.Status.EmergencyStopOK AND (NOT Mach1_Safety.Status.DoorsOK OR (Mach1_Safety.Status.ServiceMode AND NOT Mach1_AuxData.AllDrivesHomed AND NOT Mach1_Safety.Status.AllDoorsActuallyClosed))), TRUE, Mach1_Alarms.Alm002, Mach1.GenFlags.MinorAlarm);
END_NETWORK
NETWORK 6 LD TITLE: "DONE NETWORK 4 (p3)Major alarms (start-up conditions)"
  Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT LST_InputsOutputs.I100_0_AirpressureOK), Mach1.GenFlags.StartFlag, Mach1_Alarms.Alm004, Mach1.GenFlags.MajorAlarm);
END_NETWORK
NETWORK 7 LD TITLE: "DONE NETWORK 4 (p4)Major alarms (start-up conditions)"
  Mach1_Safety.Control.ExternalRequestResetSafetyModule := (Alarms_V5_1_100(Mach1_Alarms, TMR_DelaySafetyModuleError(IN := (Mach1_AuxData.MIDS_Active AND (Mach1_Safety.Status.ErrorInInputModule OR Mach1_Safety.Status.ErrorInOutputModule)), PT := T#1S), TRUE, Mach1_Alarms.Alm009, Mach1.GenFlags.MinorAlarm) SET AND (FB_Mach1.iStart1 OR FB_Mach1.iStart2 OR FB_Mach1.iStart3));
END_NETWORK
NETWORK 8 LD
  Comm_OK := (Axis_MainDrive.xCommunicationOK AND Axis_SideCorrection.xCommunicationOK AND Axis_FeedFowardWrapper.xCommunicationOK AND Axis_OverrollingDevice.xCommunicationOK AND Axis_Bobbin.xCommunicationOK AND Axis_Fan.xCommunicationOK AND Axis_FeedForwardADS.xCommunicationOK AND Axis_FeedForwardATF.xCommunicationOK AND Axis_Elevator.xCommunicationOK);
END_NETWORK
NETWORK 9 LD TITLE: "DONE NETWORK 4 (p3)Major alarms (start-up conditions)"
  Alarms_V5_1_100(Mach1_Alarms, (LST_General.StartUpDelayPLC AND NOT Comm_OK), (Mach1.GenFlags.StartFlag OR NOT LST_General.StartUpDelayPLC OR Comm_OK), Mach1_Alarms.Alm011, Mach1.GenFlags.Warning);
END_NETWORK
NETWORK 10 LD
  LET g1 := TON_DelayAfterNetworkError(IN := (Mach1_Alarms.Alm011 AND NOT Mach1_Alarms.Alm011), PT := T#10000S) SET;
  EtherCAT_Master.xRestart := g1;
  REQ_RestartComm := g1;
END_NETWORK
NETWORK 11 LD
  ReInitAllNodes(xExecute := REQ_RestartComm, xInitCommunication := TRUE);
END_NETWORK
NETWORK 12 LD
  REQ_RestartComm := (REQ_RestartComm AND Comm_OK) SET;
END_NETWORK
NETWORK 13 LD TITLE: "TODO NETWORK 6"
  HMI_Var.Mach1.HourCounterRunning := (MainDrive(TRUE) AND Mach1.GenFlags.DriveIsRunning) SET;
END_NETWORK
NETWORK 14 LD TITLE: "DONE NETWORK 6: Drives"
  Mach1_Drives_DB(EN := );
END_NETWORK
NETWORK 15 LD TITLE: "DONE NETWORK 7: Positioned stop leaf carrier"
  LET g3 := TRUE;
  Mach1_AuxData.MemStopLeafCarrier := (g3 AND HMI_Var.Btn_StopLeafCarrier AND ((Mach1.GenFlags.RunAuto AND Mach1.GenFlags.DriveIsRunning) OR Mach1_AuxData.MemStopLeafCarrier));
  tStopPositionLeafCarrier := (fc_CamC_CP_UDT(g3, HMI_Var.Mach1.Position, Mach1.GenFlags.Rotflag, Mach1_Data.CamControls.StopPostionLeafCarrier_CP) AND Mach1_Data.CamControls.StopPostionLeafCarrier_CP.Active AND Mach1_AuxData.MemStopLeafCarrier);
END_NETWORK
NETWORK 16 LD TITLE: "DONE NETWORK 8: Alarm Positioned stop leaf carrier"
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100(Mach1_Alarms, tStopPositionLeafCarrier, NOT Mach1_AuxData.MemStopLeafCarrier, Mach1_Alarms.Alm054, Mach1.GenFlags.MinorAlarm) SET;
END_NETWORK
NETWORK 17 LD TITLE: "DONE NETWORK 9: Positioned stop cleaning"
  LET g4 := TRUE;
  Mach1_AuxData.MemStopCleaning := (g4 AND HMI_Var.Btn_Cleaning AND ((Mach1.GenFlags.RunAuto AND Mach1.GenFlags.DriveIsRunning) OR Mach1_AuxData.MemStopCleaning));
  tStopPositionCleaning := (fc_CamC_CP_UDT(g4, HMI_Var.Mach1.Position, Mach1.GenFlags.Rotflag, Mach1_Data.CamControls.StopPostionCleaning_CP) AND Mach1_AuxData.MemStopCleaning);
END_NETWORK
NETWORK 18 LD TITLE: "DONE NETWORK 10: Alarm Positioned stop cleaning"
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100(Mach1_Alarms, tStopPositionCleaning, NOT Mach1_AuxData.MemStopCleaning, Mach1_Alarms.Alm037, Mach1.GenFlags.MinorAlarm) SET;
END_NETWORK
NETWORK 19 LD TITLE: "DONE NETWORK 11 (p1): Level bunch magazine alarms"
  Alarms_V5_1_100(, Mach1_Alarms, Mach1_AuxData.IEC_TIMERS.TON_BunchLevelWarning(IN := (Mach1_AuxData.MIDS_Active AND Mach1.GenFlags.DelayAfterEmergStop AND NOT LST_InputsOutputs.I101_4_Level_bunch_magazine AND HMI_Var.Test_Prod AND NOT HMI_Var.Btn_Cleaning AND HMI_Var.Mach1.MuteNoBunchAlarm AND Mach1_Alarms.Alm036), PT := T#5S), (LST_InputsOutputs.I101_4_Level_bunch_magazine OR HMI_Var.Test_Prod OR HMI_Var.Btn_Cleaning OR HMI_Var.Mach1.MuteNoBunchAlarm OR Mach1_Alarms.Alm036), Mach1_Alarms.Alm073, Mach1.GenFlags.Warning);
END_NETWORK
NETWORK 20 LD TITLE: "DONE NETWORK 11 (p2): Level bunch magazine alarms"
  LET i1 := fc_dinttotime(Mach1_Data.Timers.BunchMagazineEmptyTime,0);
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100(Mach1_Alarms, Mach1_AuxData.IEC_TIMERS.TON_BunchLevelAlarm(IN := (Mach1_AuxData.MIDS_Active AND Mach1.GenFlags.DelayAfterEmergStop AND NOT Mach1_Alarms.Alm036 AND NOT LST_InputsOutputs.I101_4_Level_bunch_magazine AND HMI_Var.Test_Prod AND NOT HMI_Var.Btn_Cleaning AND NOT HMI_Var.Mach1.MuteNoBunchAlarm), PT := i1), Mach1.GenFlags.StartFlag, Mach1_Alarms.Alm036, Mach1.GenFlags.MinorAlarm) SET;
END_NETWORK
NETWORK 21 LD TITLE: "TODO NETWORK 12: SR Bunches (JL / rolling device / outfeed)"
  LET g119 := fc_camc_cp_udt(, HMI_Var.Mach1.Position, Mach1.GenFlags.Rotflag, Mach1_Data.CamControls.BunchDetection_CP);
  Mach1_AuxData.ShiftRegister.SR_bunch_present_position_3_outfeed := (g119 AND Mach1_AuxData.ShiftRegister.SR_bunch_present_position_3_outfeed) SET;
  LET g120 := (g119 AND Mach1_AuxData.ShiftRegister.SR_bunch_present_position_2_wrapping_device);
  Mach1_AuxData.ShiftRegister.SR_bunch_present_position_3_outfeed := g120 SET;
  Mach1_AuxData.ShiftRegister.SR_bunch_present_position_2_wrapping_device := g120 SET;
  LET g121 := (g119 AND Mach1_AuxData.ShiftRegister.SR_bunch_present_position_1_JL);
  Mach1_AuxData.ShiftRegister.SR_bunch_present_position_2_wrapping_device := g121 SET;
  Mach1_AuxData.ShiftRegister.SR_bunch_present_position_1_JL := g121 SET;
  Mach1_AuxData.ShiftRegister.SR_bunch_present_position_1_JL := (g119 AND LST_InputsOutputs.I101_1_FC_Bunch_present) SET;
  tBool := g119;
END_NETWORK
NETWORK 22 LD TITLE: "DONE NETWORK 13: Stop bunch infeed when cleaning is activated"
  HMI_Var.Btn_BunchSupply := Mach1_AuxData.Edge.OSP_Emptying_Cleaning(CLK := HMI_Var.Btn_Cleaning) SET;
END_NETWORK
NETWORK 23 LD TITLE: "DONE NETWORK 14: PNV Block bunch infeed"
  LET g5 := TRUE;
  LET g6 := (g5 AND TRUE);
  LET g7 := (fc_CamC_CP_UDT(g6, HMI_Var.Mach1.Position, LST_General.AlwaysOff, Mach1_Data.CamControls.BlockBunchInfeed_CP) AND TRUE);
  Mach1_AuxData.BlockBunchInfeed := (g7 AND NOT HMI_Var.Btn_BunchSupply) SET;
  Mach1_AuxData.BlockBunchInfeed := (g7 AND HMI_Var.Btn_BunchSupply) SET;
  Mach1_AuxData.BlockBunchInfeed := (g6 AND NOT Mach1.GenFlags.DelayAfterEmergStop) SET;
  PneumValveTerminalSMC.Pos2A := (g5 AND Mach1.GenFlags.EnablePneumEStop AND Mach1_AuxData.BlockBunchInfeed AND NOT Mach1_Alarms.Alm011);
END_NETWORK
NETWORK 24 LD TITLE: "DONE NETWORK 15: Muting of alarm ""No bunch"""
  LET i1 := INT_TO_WORD(Mach1_Data.Counters.BunchesFillBunchFeeder.SetValue);
  Mach1_AuxData.NumberOfMutingCyclesReached := Mach1_AuxData.COUNTERS.RepetitionMuteNuBunch(CD := (ATD_SR(Mach1_Alarms.Alm041, (tBool AND (NOT HMI_Var.Test_Prod OR HMI_Var.Btn_Cleaning OR Mach1_AuxData.ShiftRegister.SR_bunch_present_position_1_JL OR NOT HMI_Var.Btn_BunchSupply OR Mach1_AuxData.NumberOfMutingCyclesReached)), hmi_var.mach1.MuteNoBunchAlarm) AND tBool AND HMI_Var.Test_Prod AND NOT HMI_Var.Btn_Cleaning AND NOT Mach1_AuxData.ShiftRegister.SR_bunch_present_position_1_JL), LOAD := Mach1_Alarms.Alm041, PV := i1);
END_NETWORK
NETWORK 25 LD TITLE: "DONE NETWORK 16 (p1): Alarms Bunch"
  LET i1 := INT_TO_WORD(Mach1_Data.Counters.MaxRepetitionNoBunch.SetValue);
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100(Mach1_Alarms, ((Mach1_AuxData.COUNTERS.RepetitionNoBunch(CD := (tBool AND HMI_Var.Test_Prod AND NOT HMI_Var.Btn_Cleaning AND NOT HMI_Var.Mach1.MuteNoBunchAlarm AND NOT Mach1_AuxData.ShiftRegister.SR_bunch_present_position_1_JL), LOAD := ((tBool AND (NOT HMI_Var.Test_Prod OR HMI_Var.Btn_Cleaning OR Mach1_AuxData.ShiftRegister.SR_bunch_present_position_1_JL OR NOT HMI_Var.Btn_BunchSupply OR hmi_var.mach1.MuteNoBunchAlarm)) OR (Mach1.GenFlags.StartFlag AND Mach1_Alarms.Alm041)), PV := i1) AND Mach1_AuxData.AllDrivesHomed) AND NOT HMI_Var.Mach1.MuteNoBunchAlarm), Mach1.GenFlags.StartFlag, Mach1_Alarms.Alm041, Mach1.GenFlags.MinorAlarm) SET;
END_NETWORK
NETWORK 26 LD TITLE: "DONE NETWORK 16 (p2): Alarms Bunch"
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100(Mach1_Alarms, (tBool AND NOT Mach1_AuxData.PhotocellBunchHasBeenOff AND HMI_Var.Btn_BunchSupply AND Mach1_AuxData.AllDrivesHomed), Mach1.GenFlags.StartFlag, Mach1_Alarms.Alm042, Mach1.GenFlags.MinorAlarm) SET;
END_NETWORK
NETWORK 27 LD TITLE: "DONE NETWORK 16 (p3): Alarms Bunch"
  ATD_SR(NOT LST_InputsOutputs.I101_1_FC_Bunch_present, tBool, Mach1_AuxData.PhotocellBunchHasBeenOff);
END_NETWORK
NETWORK 28 LD
END_NETWORK
NETWORK 29 LD TITLE: "DONE NETWORK 17 (p1): Alarms: Cigar fault"
  LET i1 := INT_TO_WORD(Mach1_Data.Counters.MaxRepetitionNoCigars.SetValue);
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.COUNTERS.RepetitionNoCigar(CD := (fc_CamC_CP_UDT(, HMI_Var.Mach1.Position, Mach1.GenFlags.Rotflag, Mach1_Data.CamControls.CigarDetection_CP) AND HMI_Var.Test_Prod AND NOT HMI_Var.Btn_Cleaning AND Mach1_AuxData.ShiftRegister.SR_bunch_present_position_3_outfeed AND NOT LST_InputsOutputs.I101_2_Cigar_present), LOAD := ((tBool AND (NOT HMI_Var.Test_Prod OR HMI_Var.Btn_Cleaning OR (Mach1_AuxData.ShiftRegister.SR_bunch_present_position_3_outfeed AND LST_InputsOutputs.I101_2_Cigar_present))) OR (Mach1.GenFlags.StartFlag AND Mach1_Alarms.Alm046)), PV := i1) AND Mach1_AuxData.AllDrivesHomed), Mach1.GenFlags.StartFlag, Mach1_Alarms.Alm046, Mach1.GenFlags.MinorAlarm) SET;
END_NETWORK
NETWORK 30 LD TITLE: "DONE NETWORK 17 (p2): Alarms: Cigar fault"
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100(Mach1_Alarms, (tbool AND NOT Mach1_AuxData.PhotocellCigarHasBeenOff AND Mach1_AuxData.AllDrivesHomed), Mach1.GenFlags.StartFlag, Mach1_Alarms.Alm047, Mach1.GenFlags.MinorAlarm) SET;
END_NETWORK
NETWORK 31 LD TITLE: "DONE NETWORK 17 (p3): Alarms: Cigar fault"
  ATD_SR(NOT LST_InputsOutputs.I101_2_Cigar_present, tbool, Mach1_AuxData.PhotocellCigarHasBeenOff);
END_NETWORK
NETWORK 32 LD TITLE: "DONE NETWORK 18: Production counter"
  HMI_Var.Mach1.PRDCounterIncr := (tBool AND Mach1_AuxData.ShiftRegister.SR_bunch_present_position_3_outfeed AND LST_InputsOutputs.I101_2_Cigar_present) SET;
END_NETWORK
NETWORK 33 LD TITLE: "DONE NETWORK 19 (p1): Set cigar present in checkRegister"
  LET g124 := TRUE;
  db_CheckRegister.Positie[1].Infeed.Cigar_present_infeed := (g124 AND tCampulseCigarPresent AND LST_InputsOutputs.I101_2_Cigar_present) SET;
  Mach1_AuxData.MemCigarAtCrossOver := (g124 AND LST_InputsOutputs.I133_2_Cigar_detected_at_cross_over) SET;
  LET g125 := Mach1_AuxData.Edge.OSP_DryerZeroPoint(CLK := (g124 AND LST_InputsOutputs.I133_1_PROX_zero_position_transport_ADS));
  LET g126 := (g125 AND Mach1_AuxData.MemCigarAtCrossOver);
  db_CheckRegister.Positie[CTE.posCigarPresentOutfeed].Outfeed.Cigar_present_outfeed := g126 SET;
  Mach1_AuxData.MemCigarAtCrossOver := g126 SET;
  Mach1_AuxData.PreviousCycleHasOutfeedError := g125 SET;
  Mach1_AuxData.PreviousCycleHasOutfeedError := (g125 AND Mach1_AuxData.CurrentCycleHasOutfeedError) SET;
  fc_CheckRegister(g125);
  Mach1_AuxData.CurrentCycleHasOutfeedError := g125 SET;
  Mach1_AuxData.CurrentCycleHasOutfeedError := (g125 AND db_CheckRegister.CheckRegisterError) SET;
END_NETWORK
NETWORK 34 LD TITLE: "DONE NETWORK 20: Start Fan"
  LET g109 := (Mach1.GenFlags.EnableAuxDrive AND HMI_Var.Test_Prod AND NOT HMI_Var.Btn_Cleaning);
  Mach1_Data.Drives.Fan.Control.StartAuto := g109;
  TMR_StartupFan(IN := g109, PT := T#5S);
END_NETWORK
NETWORK 35 LD
  mach1.Genflags.StopDriveDirect := Alarms_V5_1_100(Mach1_Alarms, (NOT HMI_Var.Btn_Cleaning AND Mach1.GenFlags.EnableAuxDrive AND HMI_Var.Test_Prod AND NOT TMR_StartupFan.Q), TRUE, Mach1_Alarms.Alm034, mach1.Genflags.MinorAlarm) SET;
END_NETWORK
NETWORK 36 LD TITLE: "DONE NETWORK 21: Blocking glue rod"
  LET g12 := (Mach1.GenFlags.EnablePneumEStop AND Mach1_Safety.Status.DoorsOK);
  PneumValveTerminalSMC.Pos3A := (g12 AND (NOT Mach1_AuxData.ShiftRegister.SR_bunch_present_position_2_wrapping_device OR NOT HMI_Var.Test_Prod OR HMI_Var.Btn_Cleaning) AND Mach1_AuxData.AllDrivesHomed AND NOT Mach1_Alarms.Alm011);
  PneumValveTerminalSMC.Pos3B := (g12 AND NOT PneumValveTerminalSMC.Pos3A);
END_NETWORK
NETWORK 37 LD TITLE: "DONE NETWORK 22 (p1): Insert needle"
  PneumValveTerminalSMC.Pos4A := (fc_CamC_LS_UDT((Mach1_Safety.Status.DoorsOK AND Mach1.GenFlags.EnablePneumEStop), HMI_Var.Mach1.ActualSpeed, HMI_Var.Mach1.Position, Mach1.GenFlags.Rotflag, Mach1_Data.CamControls.InserNeedle_CLS) AND Mach1_AuxData.AllDrivesHomed AND NOT Mach1_Alarms.Alm011);
END_NETWORK
NETWORK 38 LD TITLE: "DONE NETWORK 22 (p2): Insert needle"
  PneumValveTerminalSMC.Pos4B := (Mach1_Safety.Status.DoorsOK AND Mach1.GenFlags.EnablePneumEStop AND NOT PneumValveTerminalSMC.Pos4A);
END_NETWORK
NETWORK 39 LD TITLE: "DONE NETWORK 23 (p1): Bunch positioner"
  PneumValveTerminalSMC.Pos5A := (fc_CamC_LS_UDT((Mach1_Safety.Status.DoorsOK AND Mach1.GenFlags.EnablePneumEStop), HMI_Var.Mach1.ActualSpeed, HMI_Var.Mach1.Position, Mach1.GenFlags.Rotflag, Mach1_Data.CamControls.BunchPositioner_CLS) AND Mach1_AuxData.AllDrivesHomed AND NOT Mach1_Alarms.Alm011);
END_NETWORK
NETWORK 40 LD TITLE: "DONE NETWORK 23 (p2): Bunch positioner"
  PneumValveTerminalSMC.Pos5B := (Mach1_Safety.Status.DoorsOK AND Mach1.GenFlags.EnablePneumEStop AND NOT PneumValveTerminalSMC.Pos5A);
END_NETWORK
NETWORK 41 LD TITLE: "DONE NETWORK 24: Manual glue pumping"
  LET g103 := Mach1_AuxData.EnableGlueSprayCalibration;
  LET g104 := (g103 AND TRUE AND (HMI_Var.Mach1.GlueStart OR HMI_Var.Mach1.GlueStop OR HMI_Var.Mach1.GlueReset OR HMI_Var.Mach1.SprayStart OR HMI_Var.Mach1.SprayStop OR HMI_Var.Mach1.SprayReset OR Mach1_AuxData.ScreenForOperatorSettingsActivated));
  Mach1_AuxData.ScreenForOperatorSettingsActivated := g104;
  Mach1.GenFlags.StopDriveDirect := g104 SET;
  MOVE((g103 AND (HMI_Var.Mach1.GlueReset OR NOT LST_InputsOutputs.I100_2_Pushbutton_stop_OP0a)), 0);
  Mach1_AuxData.GlueWeighingCycleStarted := ((g103 AND Mach1.GenFlags.EnablePneumEStop AND (((HMI_Var.Mach1.GlueStart OR LST_InputsOutputs.I100_4_Pushbutton_request_glue_OP0a) AND NOT LST_General.FF500ms) OR Mach1_AuxData.GlueWeighingCycleStarted) AND NOT HMI_Var.Mach1.GlueStop AND NOT HMI_Var.Mach1.GlueReset AND LST_InputsOutputs.I100_2_Pushbutton_stop_OP0a) < Mach1_Data.Settings.Ints.ActualNumberOfGluePulses < Mach1_Data.Settings.Ints.MaxNumberOfGluePulses);
  ((Mach1_AuxData.Edge.OSN_Gluepump(CLK := (g103 AND PneumValveTerminalSMC.Pos6A)) AND Mach1_AuxData.GlueWeighingCycleStarted) + Mach1_Data.Settings.Ints.ActualNumberOfGluePulses + 1);
END_NETWORK
NETWORK 42 LD TITLE: "DONE NETWORK 25: Continuous Glueing"
  LET g15 := TRUE;
  LET g16 := (NOT(Mach1_AuxData.Edge.OSPushbuttonGlue(CLK := (g15 AND (LST_InputsOutputs.I100_4_Pushbutton_request_glue_OP0a OR Mach1_AuxData.IEC_TIMERS.TON_StopContGluePumping.Q)))) AND Mach1.GenFlags.EnablePneumEStop AND NOT Mach1.GenFlags.DriveIsRunning AND NOT Mach1_AuxData.ScreenForOperatorSettingsActivated AND (LST_InputsOutputs.I100_4_Pushbutton_request_glue_OP0a OR Mach1_AuxData.IEC_TIMERS.DelayContiniousGluePumping.Q));
  Mach1_AuxData.MemContinuousGluePumping := g16;
  Mach1_AuxData.IEC_TIMERS.DelayContiniousGluePumping(IN := g16, PT := T#3S);
  Mach1_AuxData.IEC_TIMERS.TON_StopContGluePumping(IN := (g15 AND Mach1_AuxData.MemContinuousGluePumping), PT := T#120S);
END_NETWORK
NETWORK 43 LD TITLE: "DONE NETWORK 26: PNV Glue pump 1+2+3"
  LET g1 := (((fc_CamC_CC_UDT(Mach1.GenFlags.EnablePneumEStop, HMI_Var.Mach1.Position, Mach1_Data.CamControls.GluePump123_C) AND Mach1_AuxData.ShiftRegister.SR_bunch_present_position_1_JL AND HMI_Var.Test_Prod AND NOT HMI_Var.Btn_Cleaning AND NOT Mach1_AuxData.MemContinuousGluePumping AND NOT Mach1_AuxData.ScreenForOperatorSettingsActivated) OR (Mach1.GenFlags.EnablePneumEStop AND ((LST_General.FF500ms AND Mach1_AuxData.MemContinuousGluePumping) OR (LST_General.FF500ms AND Mach1_AuxData.GlueWeighingCycleStarted)))) AND NOT Mach1_Alarms.Alm011);
  PneumValveTerminalSMC.Pos6A := g1;
  LST_InputsOutputs.Q101_2_Enable_GluePump := g1;
END_NETWORK
NETWORK 44 LD TITLE: "DONE NETWORK 27: PNV Glue pump 4"
  PneumValveTerminalSMC.Pos10A := (((fc_CamC_CC_UDT(Mach1.GenFlags.EnablePneumEStop, HMI_Var.Mach1.Position, Mach1_Data.CamControls.GluePump4_C) AND Mach1_AuxData.ShiftRegister.SR_bunch_present_position_1_JL AND HMI_Var.Test_Prod AND NOT HMI_Var.Btn_Cleaning AND NOT Mach1_AuxData.MemContinuousGluePumping AND NOT Mach1_AuxData.ScreenForOperatorSettingsActivated) OR (Mach1.GenFlags.EnablePneumEStop AND ((LST_General.FF500ms AND Mach1_AuxData.MemContinuousGluePumping) OR (LST_General.FF500ms AND Mach1_AuxData.GlueWeighingCycleStarted)))) AND NOT Mach1_Alarms.Alm011);
END_NETWORK
NETWORK 45 LD TITLE: "DONE NETWORK 28: PNV Glue pump 5"
  PneumValveTerminalSMC.Pos11A := (((fc_CamC_CC_UDT(Mach1.GenFlags.EnablePneumEStop, HMI_Var.Mach1.Position, Mach1_Data.CamControls.GluePump5_C) AND Mach1_AuxData.ShiftRegister.SR_bunch_present_position_1_JL AND HMI_Var.Test_Prod AND NOT HMI_Var.Btn_Cleaning AND NOT Mach1_AuxData.MemContinuousGluePumping AND NOT Mach1_AuxData.ScreenForOperatorSettingsActivated) OR (Mach1.GenFlags.EnablePneumEStop AND ((LST_General.FF500ms AND Mach1_AuxData.MemContinuousGluePumping) OR (LST_General.FF500ms AND Mach1_AuxData.GlueWeighingCycleStarted)))) AND NOT Mach1_Alarms.Alm011);
END_NETWORK
NETWORK 46 LD TITLE: "DONE NETWORK 29: PNV Small gripper"
  PneumValveTerminalSMC.Pos7A := (fc_CamC_LS_UDT(Mach1.GenFlags.EnablePneumEStop, HMI_Var.Mach1.ActualSpeed, HMI_Var.Mach1.Position, Mach1.GenFlags.Rotflag, Mach1_Data.CamControls.SmallGripper_CLS) AND Mach1_AuxData.AllDrivesHomed AND NOT Mach1_Alarms.Alm011);
END_NETWORK
NETWORK 47 LD TITLE: "DONE NETWORK 30: Big gripper"
  PneumValveTerminalSMC.Pos8A := (fc_CamC_LS_UDT(Mach1.GenFlags.EnablePneumEStop, HMI_Var.Mach1.ActualSpeed, HMI_Var.Mach1.Position, Mach1.GenFlags.Rotflag, Mach1_Data.CamControls.BigGripper_CLS) AND Mach1_AuxData.AllDrivesHomed AND NOT Mach1_Alarms.Alm011);
END_NETWORK
NETWORK 48 LD TITLE: "TODO NETWORK 31: Blow off wrapper"
  PneumValveTerminalSMC.Pos9A := (fc_CamC_CC_UDT(Mach1.GenFlags.EnablePneumEStop, HMI_Var.Mach1.Position, Mach1_Data.CamControls.BlowOffWrapper_C) AND NOT Mach1_Alarms.Alm011);
END_NETWORK
NETWORK 49 LD TITLE: "DONE NETWORK 32: Blow off bobbin"
  PneumValveTerminalSMC.Pos1A := (fc_CamC_CC_UDT((Mach1.GenFlags.EnablePneumEStop AND Mach1.GenFlags.DriveIsRunning), HMI_Var.Mach1.Position, Mach1_Data.CamControls.BlowOffBobine_C) AND NOT Mach1_Alarms.Alm011);
END_NETWORK
NETWORK 50 LD TITLE: "DONE NETWORK 33:"
  AHWF();
END_NETWORK
NETWORK 51 LD TITLE: "TODO NETWORK 34: OBSOLETE"
END_NETWORK
NETWORK 52 LD TITLE: "DONE NETWORK 35: Main FB:  Dryer-trayfiller"
  LET g105 := IDB_Dryer(iGenFlags := Mach1.GenFlags, iMachineStarted := (Mach1.GenFlags.EnableAuxDrive AND Mach1_Safety.Status.DoorsOK AND NOT Mach1.GenFlags.StopFlag), iSwitchDryer := HMI_Var.Btn_DryerOn, iDryerClosed := LST_InputsOutputs.I133_0_PROX_Dryer_closed, iStartFeedForward := fc_CamC_CP_UDT(, HMI_Var.Mach1.Position, Mach1.GenFlags.Rotflag, Mach1_Data.CamControls.FeedforwardDryer_CP), iStopFeedForward := (((NOT Mach1.GenFlags.EnableAuxDrive OR ( < Mach1_AuxData.COUNTERS.EmptyingCycles.CV < 105) OR NOT Trayfiller_Data.commInterface.Permission OR NOT Mach1_Safety.Status.DoorsOK) AND LST_InputsOutputs.I133_1_PROX_zero_position_transport_ADS) OR Mach1_Alarms.Alm048), iPermissionDownstream := (Trayfiller_Data.commInterface.Permission AND NOT Mach1_Alarms.Alm053), iSetPowerHeater1 := Mach1_Data.Dryer.Heater1.SetHeaterPower, iSetPowerHeater2 := Mach1_Data.Dryer.Heater2.SetHeaterPower, iSetPowerHeater3 := Mach1_Data.Dryer.Heater3.SetHeaterPower, iPowerOrAnalog := TRUE, iSpeedForEmptying := 100);
  LST_InputsOutputs.Q132_2_Enable_power_controllers := (g105 AND HMI_Var.Mach1.HeatersActive);
  MOVE((g105 >= Mach1_Data.Dryer.Heater1.SetHeaterPower >= 350), 350);
  MOVE((g105 >= Mach1_Data.Dryer.Heater2.SetHeaterPower >= 350), 350);
  MOVE((g105 >= Mach1_Data.Dryer.Heater3.SetHeaterPower >= 350), 350);
END_NETWORK
NETWORK 53 LD TITLE: "DONE NETWORK 36: CT Fan dryer"
  LST_InputsOutputs.Q132_4_CT_Fan_dryer := (Mach1_AuxData.TrayfillerActive AND Mach1.GenFlags.EnableAuxDrive AND HMI_Var.Btn_DryerOn);
END_NETWORK
NETWORK 54 LD TITLE: "TODO NETWORK 37:"
  // dryer speed: 100rpm ->1000 0.1rpm
  // max AO-value: 2^14=16384
  LET g40 := TRUE;
  LET i1 := DINT_TO_REAL(HMI_Var.Mach1.ActualSpeedDryer);
  DRYER_Scaling_Speed(EN := g40, IN := i1, IN_MIN := 0, IN_MAX := 1000, OUT_MIN := 0, OUT_MAX := 1);
  LET i2 := REAL_TO_INT(lrHeater1_ScaledPower*lrDryer_ScaledSpeed*1500);
  LET i3 := REAL_TO_WORD(lrHeater1_Analog);
  MOVE(DRYER_SCALING_Heater1_Analog(EN := MOVE(DRYER_SCALING_Heater1(EN := g40, IN := tHeater1Word, IN_MIN := 0, IN_MAX := 1500, OUT_MIN := 0, OUT_MAX := 1), i2), IN := lrDryer_ScaledSpeed*lrHeater1_ScaledPower*1500, IN_MIN := 0, IN_MAX := 1500, OUT_MIN := 0, OUT_MAX := 16384), i3);
  LET i4 := REAL_TO_INT(lrHeater2_ScaledPower*lrDryer_ScaledSpeed*1500);
  LET i5 := REAL_TO_WORD(lrHeater2_Analog);
  MOVE(DRYER_SCALING_Heater2_Analog(EN := MOVE(DRYER_SCALING_Heater2(EN := g40, IN := tHeater2Word, IN_MIN := 0, IN_MAX := 1500, OUT_MIN := 0, OUT_MAX := 1), i4), IN := lrDryer_ScaledSpeed*lrHeater2_ScaledPower*1500, IN_MIN := 0, IN_MAX := 1500, OUT_MIN := 0, OUT_MAX := 16384), i5);
  LET i6 := REAL_TO_INT(lrHeater3_ScaledPower*lrDryer_ScaledSpeed*1500);
  LET i7 := REAL_TO_WORD(lrHeater3_Analog);
  MOVE(DRYER_SCALING_Heater2_Analog(EN := MOVE(DRYER_SCALING_Heater3(EN := g40, IN := tHeater3Word, IN_MIN := 0, IN_MAX := 1500, OUT_MIN := 0, OUT_MAX := 1), i6), IN := lrDryer_ScaledSpeed*lrHeater3_ScaledPower*1500, IN_MIN := 0, IN_MAX := 1500, OUT_MIN := 0, OUT_MAX := 16384), i7);
END_NETWORK
NETWORK 55 LD TITLE: "DONE NETWORK 38 (p1): Alarms dryer"
  Mach1.GenFlags.StopDriveDirect := RuntimeGuard_V5_1_100(Mach1_Alarms, (Mach1_AuxData.TrayfillerActive AND ((IDB_Dryer.oFeedForward AND Mach1.Genflags.DelayAfterSTO) OR mach1.Genflags.DriveIsRunning) AND (Mach1_AuxData.AllDrivesHomed OR NOT Mach1_AuxData.MIDS_Active)), LST_General.AlwaysOff, ((Mach1.GenFlags.EnableAuxDrive AND NOT Mach1_Alarms.Alm048 AND ((Mach1.Genflags.DelayAfterSTO AND IDB_Dryer.oFeedForward) OR mach1.Genflags.DriveIsRunning) AND NOT LST_InputsOutputs.I133_1_PROX_zero_position_transport_ADS) >= Mach1_Data.Drives.FeedForwardADS.Control.AutoSpeed >= 10), T#10S, Mach1.GenFlags.StartFlag, Mach1_Alarms.Alm048, Mach1.GenFlags.MinorAlarm, Mach1_AuxData.IEC_TIMERS.RuntimeGuardFeedforwardDryer) SET;
END_NETWORK
NETWORK 56 LD TITLE: "DONE NETWORK 38 (p2): Alarms dryer"
  Mach1.GenFlags.StopDriveDirect := (Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.TrayfillerActive AND Mach1.GenFlags.DelayAfterEmergStop AND IDB_Dryer.oFaultDryerOpened), TRUE, Mach1_Alarms.Alm049, Mach1.GenFlags.MinorAlarm) AND Mach1_AuxData.AllDrivesHomed) SET;
END_NETWORK
NETWORK 57 LD TITLE: "TODO NETWORK 38 (p3): Alarms dryer"
  LET g123 := Alarms_V5_1_100(Mach1_Alarms, (((mach1.Genflags.DelayAfterEmergStop AND HMI_Var.Test_Prod AND Mach1_AuxData.TrayfillerActive) > Mach1_Data.Counters.MaxRepetitionNoCigarsDryer.SetValue > 0) AND db_CheckRegister.CheckRegisterError AND NOT Mach1_AuxData.PreviousCycleHasOutfeedError), Mach1.GenFlags.StartFlag, Mach1_Alarms.Alm053, Mach1.GenFlags.MinorAlarm);
  Mach1.GenFlags.StopDriveDirect := g123 SET;
  db_CheckRegister.CheckRegisterError := g123 SET;
END_NETWORK
NETWORK 58 LD TITLE: "DONE NETWORK 38 (p4): Alarms dryer"
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100(Mach1_Alarms, Mach1_AuxData.IEC_TIMERS.TON_DryerSwitchedOff(IN := (Mach1_AuxData.TrayfillerActive AND HMI_Var.Test_Prod AND NOT HMI_Var.Btn_DryerOn), PT := T#5S), Mach1.GenFlags.StartFlag, Mach1_Alarms.Alm058, Mach1.GenFlags.MinorAlarm) SET;
END_NETWORK
NETWORK 59 LD TITLE: "TODO NETWORK 39: Analog setpoint feedforward dryer"
  SpeedCalculationDryer();
END_NETWORK
NETWORK 60 LD TITLE: "TODO NETWORK 40: Analog setpoint feedforward trayfiller"
  SpeedCalculationTrayfiller();
END_NETWORK
NETWORK 61 LD TITLE: "DONE NETWORK 41: Empty trayfiller"
  HMI_Var.Btn_Cleaning := Mach1_AuxData.COUNTERS.EmptyingCycles(CD := (HMI_Var.Btn_Cleaning AND LST_InputsOutputs.I133_1_PROX_zero_position_transport_ADS), LOAD := NOT HMI_Var.Btn_Cleaning, PV := 194) SET;
END_NETWORK
NETWORK 62 LD TITLE: "DONE NETWORK 42: Main block Trayfiller"
  IDB_TrayFiller(iGenFlags := Mach1.GenFlags, iMachineStarted := (Mach1.GenFlags.EnableAuxDrive AND NOT Mach1.GenFlags.StopFlag), iButtonChangeTray := LST_General.AlwaysOff, iButtonTrayDown := LST_InputsOutputs.I132_6_Tray_down, iButtonTrayUp := LST_InputsOutputs.I132_7_Tray_up, iCigarAtCrossover := (LST_InputsOutputs.I133_2_Cigar_detected_at_cross_over OR ( < Mach1_AuxData.COUNTERS.EmptyingCycles.CV < 106)), iStartFeedForward := ((LST_InputsOutputs.I133_1_PROX_zero_position_transport_ADS OR ( < Mach1_AuxData.COUNTERS.EmptyingCycles.CV < 106)) AND Mach1_Safety.Status.DoorsOK), iStopFeedForward := LST_InputsOutputs.I133_3_PROX_zero_position_transport_ATF, iCigarAtInpusher := LST_InputsOutputs.I133_4_Cigar_detected_at_inpusher, iRpsInpusher := LST_InputsOutputs.I133_6_PROX_inpusher_retracted, iEpsInpusher := LST_InputsOutputs.I133_7_PROX_inpusher_at_tray, iGuardInpusher := TRUE, iPsElevatorUp := LST_InputsOutputs.I136_0_PROX_Elevator_above, iPsElevatorDown := LST_InputsOutputs.I136_1_PROX_Elevator_below, iPulseCounterElevator := LST_InputsOutputs.I136_2_PROX_pulse_counter_elevator, iFcGuardTrayOnElev := LST_InputsOutputs.I136_3_FC_Position_tray_OK, iRowHeight := Mach1_Data.TrayFiller.RowHeight, iSetNumberOfRows := Mach1_Data.Trayfiller.SetNumberOfRows, iInitialDescentValue := Mach1_Data.Trayfiller.InitialDescentValue, iLightCurtainInpusher := Mach1_Safety.Status.Door_switch17, iLightCurtainElevator := Mach1_Safety.Status.Door_switch18, iPsInfeedConvAtInit := LST_InputsOutputs.I136_4_PROX_Infeed_conveyor_initial_position, iPsInfeedConvAtElev := LST_InputsOutputs.I136_5_PROX_Infeed_conveyor_at_elevator, iFcGuardTrayFromElev := LST_InputsOutputs.I136_6_FC_Guard_tray_from_elevator, iFcOutfeedConvFull := LST_InputsOutputs.I136_7_FC_Outfeed_conveyor_full, iTestProd := TRUE, ioActNumberOfRows := HMI_Var.Mach1.ActNumberOfRows);
END_NETWORK
NETWORK 63 LD
  Mach1_Data.Drives.FeedForwardATF.Control.StartAuto := IDB_TrayFiller.oFeedForwardMotor;
END_NETWORK
NETWORK 64 LD TITLE: "DONE NETWORK 43: Selection of inpusher runtimeguard time"
  LET g20 := IDB_TrayFiller.oValveInpusher;
  MOVE(g20, T#1S);
  MOVE(NOT(g20), T#5S);
END_NETWORK
NETWORK 65 LD TITLE: "DONE NETWORK 44 (p1): Runtimeguard trayfiller"
  Mach1.GenFlags.StopDriveDirect := RuntimeGuard_V5_1_100(Mach1_Alarms, (Mach1_AuxData.TrayfillerActive AND IDB_TrayFiller.oValveInpusher AND Mach1_AuxData.AllDrivesHomed), (Mach1_AuxData.TrayfillerActive AND NOT IDB_TrayFiller.oValveInpusher AND Mach1_AuxData.AllDrivesHomed), (Mach1_AuxData.TrayfillerActive AND Mach1.GenFlags.EnablePneumEStop AND ((IDB_TrayFiller.oValveInpusher AND NOT LST_InputsOutputs.I133_7_PROX_inpusher_at_tray) OR (NOT IDB_TrayFiller.oValveInpusher AND NOT LST_InputsOutputs.I133_6_PROX_inpusher_retracted))), T#3S, Mach1.GenFlags.StartFlag, Mach1_Alarms.Alm050, Mach1.GenFlags.MinorAlarm, Mach1_AuxData.IEC_TIMERS.RuntimeguardInpusher) SET;
END_NETWORK
NETWORK 66 LD TITLE: "DONE NETWORK 44 (p2): Runtimeguard trayfiller"
  Mach1.GenFlags.StopDriveDirect := RuntimeGuard_V5_1_100(Mach1_Alarms, (Mach1_AuxData.TrayfillerActive AND IDB_TrayFiller.oElevatorMotorUp AND Mach1_AuxData.AllDrivesHomed), (Mach1_AuxData.TrayfillerActive AND IDB_TrayFiller.oElevatorMotorDown AND Mach1_AuxData.AllDrivesHomed), TRUE, T#15S, Mach1.GenFlags.StartFlag, Mach1_Alarms.Alm052, Mach1.GenFlags.MinorAlarm, Mach1_AuxData.IEC_TIMERS.RuntimeGuardElevator) SET;
END_NETWORK
NETWORK 67 LD TITLE: "DONE NETWORK 44 (p3): Runtimeguard trayfiller"
  Mach1.GenFlags.StopDriveDirect := RuntimeGuard_V5_1_100(Mach1_Alarms, (Mach1_AuxData.TrayfillerActive AND IDB_TrayFiller.oInfeedMotorFwd AND Mach1_AuxData.AllDrivesHomed), (Mach1_AuxData.TrayfillerActive AND IDB_TrayFiller.oInfeedMotorRev AND Mach1_AuxData.AllDrivesHomed), TRUE, T#4000MS, Mach1.GenFlags.StartFlag, Mach1_Alarms.Alm065, Mach1.GenFlags.MinorAlarm, Mach1_AuxData.IEC_TIMERS.RuntimeGuardInfeedConveyor) SET;
END_NETWORK
NETWORK 68 LD TITLE: "DONE NETWORK 44 (p4): Runtimeguard trayfiller"
  Mach1.GenFlags.StopDriveDirect := RuntimeGuard_V5_1_100(Mach1_Alarms, (Mach1_AuxData.TrayfillerActive AND IDB_TrayFiller.oOutfeedMotorFwd AND Mach1_AuxData.AllDrivesHomed), NOT TRUE, TRUE, T#8500MS, Mach1.GenFlags.StartFlag, Mach1_Alarms.Alm066, Mach1.GenFlags.MinorAlarm, Mach1_AuxData.IEC_TIMERS.RuntimeGuardOutfeedConveyor) SET;
END_NETWORK
NETWORK 69 LD TITLE: "DONE NETWORK 45: Elevator: profinet vs IO"
  LET g21 := (tElevatorUp OR tElevatorDown);
  Mach1_Data.Drives.ElevatorATF.Control.StartAuto := g21;
  MOVE(g21, 30);
  Mach1_Data.Drives.ElevatorATF.Control.Reverse := (g21 AND tElevatorDown);
END_NETWORK
NETWORK 70 LD TITLE: "DONE NETWORK 46 (p1): Alarms trayfiller"
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.TrayfillerActive AND Mach1.GenFlags.DelayAfterEmergStop AND Mach1.GenFlags.DelayAfterSTO AND NOT LST_InputsOutputs.I132_0_Thermal_guards_OK AND (Mach1_AuxData.AllDrivesHomed OR NOT Mach1_AuxData.MIDS_Active)), Mach1.GenFlags.StartFlag, Mach1_Alarms.Alm005, Mach1.GenFlags.MinorAlarm) SET;
END_NETWORK
NETWORK 71 LD TITLE: "DONE NETWORK 46 (p2): Alarms trayfiller"
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.TrayfillerActive AND Trayfiller_Data.Alarms.AlmInpusherBlocked AND (Mach1_AuxData.AllDrivesHomed OR NOT Mach1_AuxData.MIDS_Active)), Mach1.GenFlags.StartFlag, Mach1_Alarms.Alm059, Mach1.GenFlags.MinorAlarm) SET;
END_NETWORK
NETWORK 72 LD TITLE: "DONE NETWORK 46 (p3): Alarms trayfiller"
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.TrayfillerActive AND (Trayfiller_Data.Alarms.AlmTrayPosition OR Trayfiller_Data.Alarms.AlmTrayInfeeding) AND Mach1_AuxData.AllDrivesHomed), TRUE, Mach1_Alarms.Alm060, Mach1.GenFlags.MinorAlarm) SET;
END_NETWORK
NETWORK 73 LD TITLE: "DONE NETWORK 46 (p4): Alarms trayfiller"
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.TrayfillerActive AND Trayfiller_Data.Alarms.AlmLightCurtainInpusher AND (Mach1_AuxData.AllDrivesHomed OR NOT Mach1_AuxData.MIDS_Active)), Mach1.GenFlags.StartFlag, Mach1_Alarms.Alm061, Mach1.GenFlags.MinorAlarm) SET;
END_NETWORK
NETWORK 74 LD TITLE: "DONE NETWORK 46 (p5): Alarms trayfiller"
  Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.TrayfillerActive AND Trayfiller_Data.Alarms.WrnChangeTray AND (Mach1_AuxData.AllDrivesHomed OR NOT Mach1_AuxData.MIDS_Active)), TRUE, Mach1_Alarms.Alm075, Mach1.GenFlags.Warning);
END_NETWORK
NETWORK 75 LD TITLE: "DONE NETWORK 46 (p6): Alarms trayfiller"
  Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.TrayfillerActive AND Trayfiller_Data.Alarms.AlmOutfeedFull AND (Mach1_AuxData.AllDrivesHomed OR NOT Mach1_AuxData.MIDS_Active)), TRUE, Mach1_Alarms.Alm062, Mach1.GenFlags.MinorAlarm);
END_NETWORK
NETWORK 76 LD TITLE: "DONE NETWORK 46 (p7): Alarms trayfiller"
  Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.TrayfillerActive AND Trayfiller_Data.Alarms.AlmOutfeeding AND (Mach1_AuxData.AllDrivesHomed OR NOT Mach1_AuxData.MIDS_Active)), TRUE, Mach1_Alarms.Alm063, Mach1.GenFlags.MinorAlarm);
END_NETWORK
NETWORK 77 LD TITLE: "DONE NETWORK 46 (p8): Alarms trayfiller"
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.TrayfillerActive AND Trayfiller_Data.Alarms.AlmLightCurtainElevator AND (Mach1_AuxData.AllDrivesHomed OR NOT Mach1_AuxData.MIDS_Active)), TRUE, Mach1_Alarms.Alm064, Mach1.GenFlags.MinorAlarm) SET;
END_NETWORK
NETWORK 78 LD TITLE: "DONE NETWORK 46 (p9): Alarms trayfiller"
  Mach1.GenFlags.StopDriveDirect := (Mach1_AuxData.AllDrivesHomed AND Mach1_AuxData.TrayfillerActive AND NOT Trayfiller_Data.commInterface.Permission) SET;
END_NETWORK
NETWORK 79 LD TITLE: "TODO NETWORK 47 (p1):Greasing system"
END_NETWORK
NETWORK 80 LD TITLE: "DONE NETWORK 47 (p2): Greasing system"
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100(Mach1_Alarms, (Mach1.GenFlags.DelayAfterEmergStop AND tLowLevel), TRUE, Mach1_Alarms.Alm078, Mach1.GenFlags.Warning) SET;
END_NETWORK
NETWORK 81 LD TITLE: "DONE NETWORK 48: Alarm: Greasing system"
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100(Mach1_Alarms, (Mach1.GenFlags.DelayAfterEmergStop AND tErrorRuntimeGreasingSystem), Mach1.GenFlags.StartFlag, Mach1_Alarms.Alm067, Mach1.GenFlags.MinorAlarm) SET;
END_NETWORK
NETWORK 82 LD TITLE: "DONE NETWORK 49: State of the machine"
  LET g22 := TRUE;
  tAlarmSL := MOVE((g22 AND (Mach1.GenFlags.MajorAlarm OR Mach1.GenFlags.MinorAlarm)), 0);
  LET g23 := (g22 AND NOT Mach1.GenFlags.MajorAlarm AND NOT Mach1.GenFlags.MinorAlarm);
  tWarningSL := MOVE((g23 AND Mach1.GenFlags.Warning), 1);
  LET g24 := (g23 AND NOT Mach1.GenFlags.Warning);
  tStandbySL := MOVE((g24 AND NOT Mach1.GenFlags.RunMan AND NOT Mach1.GenFlags.RunAuto), 2);
  tRunningSL := MOVE((g24 AND (Mach1.GenFlags.RunMan OR Mach1.GenFlags.RunAuto)), 3);
END_NETWORK
NETWORK 83 LD TITLE: "TODO NETWORK 50: SL Alarmlamp"
  LET g25 := TRUE;
  LST_InputsOutputs.Q100_2_Pilot_light_Alarm_red_ := (g25 AND tAlarmlamp AND tAlarmSL);
  LST_InputsOutputs.Q100_1_Pilot_light_Alarm_orange_ := (g25 AND tAlarmlamp AND tWarningSL);
  LST_InputsOutputs.Q100_0_Pilot_light_Alarm_green_ := (g25 AND ((tAlarmlamp AND tStandbySL) OR tRunningSL));
END_NETWORK
NETWORK 84 LD TITLE: "TODO NETWORK 51: SL Alarmlamp Buzzer"
END_NETWORK

END_PROGRAM
