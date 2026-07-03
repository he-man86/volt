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

NETWORK 0 LD
  LET g1 := (TRUE AND NOT Mach1_Safety.Status.Custom_ATF_Disabled);
  Mach1_AuxData.TrayfillerActive := g1;
  HMI_Var.TrayfillerActive := g1;
  Mach1_AuxData.MIDS_Active := (TRUE AND TRUE);
END_NETWORK
NETWORK 1 LD
  LET i1 := fc_dinttotime(Mach1_Data.Timers.StartDelayAuxDrives,2);
  LET i2 := fc_dinttotime(Mach1_Data.Timers.StopDelayAuxDrives,2);
  FB_Mach1(iStartResetSeparate := LST_General.AlwaysOff, iServiceButtonHasResetFunction := LST_General.AlwaysOff, iFirstCycle := LST_General.FirstCycle, iSignalPulse := LST_General.FF500ms, iAirPressureDoorsSeparate := LST_General.AlwaysOff, iEmergencyUnitOK := ((Mach1_AuxData.MIDS_Active AND Mach1_Safety.Status.EmergencyStopOK) OR NOT Mach1_AuxData.MIDS_Active), iDoorUnitOK := ((Mach1_AuxData.MIDS_Active AND Mach1_Safety.Status.DoorsOK) OR NOT Mach1_AuxData.MIDS_Active), iSTO_Enabled := Mach1_Safety.Status.STO_OK, iAirPressureOK := ((Mach1_AuxData.MIDS_Active AND LST_InputsOutputs.I100_0_AirpressureOK) OR NOT Mach1_AuxData.MIDS_Active), iSwitchService := Mach1_Safety.Status.ServiceMode, iButtonService := Mach1_Safety.Status.Service_ButtonAB, iStart1 := LST_InputsOutputs.I100_1_Pushbutton_start_OP0a, iStop1 := ((Mach1_AuxData.MIDS_Active AND LST_InputsOutputs.I100_2_Pushbutton_stop_OP0a) OR NOT Mach1_AuxData.MIDS_Active), iReset1 := LST_General.AlwaysOff, iAutoManual1 := LST_InputsOutputs.I100_3_Selector_switch_auto_manual_OP0a, iStart2 := (Mach1_AuxData.TrayfillerActive AND LST_InputsOutputs.I132_1_PB_Start_OP2a), iStop2 := (LST_InputsOutputs.I132_2_PB_Stop_OP2a OR NOT Mach1_AuxData.TrayfillerActive), iReset2 := LST_General.AlwaysOff, iAutoManual2 := LST_InputsOutputs.I132_3_SW_Auto_Man, iStart3 := LST_General.AlwaysOff, iStop3 := TRUE, iReset3 := LST_General.AlwaysOff, iAutoManual3 := LST_General.AlwaysOff, iPreDelayAfterEmergStop := T#4S, iPreStartDelayAuxDrives := i1, iPreStopDelayAuxDrives := i2, iPreDelayAfterSTOEnabled := T#2S);
  tResetSafetyGuard := FB_Mach1.oResetEmergencyUnit;
  LST_InputsOutputs.Q100_5_Signal_lamp_Start := FB_Mach1.oStart1;
  LST_InputsOutputs.Q100_6_Signal_lamp_Stop := FB_Mach1.oStop1;
  tCrossDoorcircuit1 := FB_Mach1.oCrossingDoorCircuit1;
  LST_InputsOutputs.Q132_0_SL_Start_OP2a := FB_Mach1.oStart2;
  LST_InputsOutputs.Q132_1_SL_Stop_OP2a := FB_Mach1.oStop2;
  tCrossDoorcircuit2 := FB_Mach1.oCrossingDoorCircuit2;
  tAlarmlamp := FB_Mach1.oAlarm;
END_NETWORK
NETWORK 2 LD
  TMR_ResetSafety(IN := (TRUE AND Mach1_Safety.Control.ResetSafetyGuard), PT := T#1S);
  Mach1_Safety.Control.ResetSafetyGuard := ((TRUE AND mach1.Genflags.StartFlag) OR (TRUE AND tResetSafetyGuard)) SET;
  Mach1_Safety.Control.ResetSafetyGuard := TMR_ResetSafety.Q RESET;
END_NETWORK
NETWORK 3 LD
  LET g1 := ((TRUE AND Mach1_AuxData.MainDriveHomed) AND Mach1_AuxData.RollingDeviceHomed);
  Mach1_Safety.Control.Muting_zone1 := (g1 AND tCrossDoorcircuit1);
  Mach1_Safety.Control.Muting_zone2 := (g1 AND tCrossDoorcircuit1);
END_NETWORK
NETWORK 4 LD
END_NETWORK
NETWORK 5 LD
  LET g1 := (Mach1_AuxData.MIDS_Active AND Mach1_Safety.Status.EmergencyStopOK);
END_NETWORK
NETWORK 6 LD
END_NETWORK
NETWORK 7 LD
  TMR_DelaySafetyModuleError(IN := ((Mach1_AuxData.MIDS_Active AND Mach1_Safety.Status.ErrorInInputModule) OR (Mach1_AuxData.MIDS_Active AND Mach1_Safety.Status.ErrorInOutputModule)), PT := T#1S);
  LET g1 := Alarms_V5_1_100(TMR_DelaySafetyModuleError.Q, TRUE);
  Mach1.Genflags.StopDriveDirect := g1 SET;
  Mach1_Safety.Control.ExternalRequestResetSafetyModule := ((g1 AND FB_Mach1.iStart1) OR (g1 AND FB_Mach1.iStart2) OR (g1 AND FB_Mach1.iStart3));
END_NETWORK
NETWORK 8 LD
  Comm_OK := ((((((((Axis_MainDrive.xCommunicationOK AND Axis_SideCorrection.xCommunicationOK) AND Axis_FeedFowardWrapper.xCommunicationOK) AND Axis_OverrollingDevice.xCommunicationOK) AND Axis_Bobbin.xCommunicationOK) AND Axis_Fan.xCommunicationOK) AND Axis_FeedForwardADS.xCommunicationOK) AND Axis_FeedForwardATF.xCommunicationOK) AND Axis_Elevator.xCommunicationOK);
END_NETWORK
NETWORK 9 LD
END_NETWORK
NETWORK 10 LD
  TON_DelayAfterNetworkError(IN := (Mach1_Alarms.Alm011 AND NOT Mach1_Alarms.Alm011), PT := T#10000S);
  EtherCAT_Master.xRestart := TON_DelayAfterNetworkError.Q;
  REQ_RestartComm := TON_DelayAfterNetworkError.Q SET;
END_NETWORK
NETWORK 11 LD
  ReInitAllNodes(xExecute := REQ_RestartComm, xInitCommunication := TRUE);
END_NETWORK
NETWORK 12 LD
  REQ_RestartComm := (REQ_RestartComm AND Comm_OK) RESET;
END_NETWORK
NETWORK 13 LD
  LET en1 := TRUE;
  IF en1 THEN LET g1 := MainDrive(); END_IF
  HMI_Var.Mach1.HourCounterRunning := (en1 AND Mach1.GenFlags.DriveIsRunning) SET;
END_NETWORK
NETWORK 14 LD
  Mach1_Drives_DB();
END_NETWORK
NETWORK 15 LD
  LET g1 := (TRUE AND HMI_Var.Btn_StopLeafCarrier);
  Mach1_AuxData.MemStopLeafCarrier := (((g1 AND Mach1.GenFlags.RunAuto) AND Mach1.GenFlags.DriveIsRunning) OR (g1 AND Mach1_AuxData.MemStopLeafCarrier));
  tStopPositionLeafCarrier := ((fc_CamC_CP_UDT(TRUE, HMI_Var.Mach1.Position, Mach1.GenFlags.Rotflag) AND Mach1_Data.CamControls.StopPostionLeafCarrier_CP.Active) AND Mach1_AuxData.MemStopLeafCarrier);
END_NETWORK
NETWORK 16 LD
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100(tStopPositionLeafCarrier, NOT Mach1_AuxData.MemStopLeafCarrier, Mach1_Alarms.Alm054) SET;
END_NETWORK
NETWORK 17 LD
  LET g1 := (TRUE AND HMI_Var.Btn_Cleaning);
  Mach1_AuxData.MemStopCleaning := (((g1 AND Mach1.GenFlags.RunAuto) AND Mach1.GenFlags.DriveIsRunning) OR (g1 AND Mach1_AuxData.MemStopCleaning));
  tStopPositionCleaning := (fc_CamC_CP_UDT(TRUE, HMI_Var.Mach1.Position, Mach1.GenFlags.Rotflag) AND Mach1_AuxData.MemStopCleaning);
END_NETWORK
NETWORK 18 LD
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100(tStopPositionCleaning, NOT Mach1_AuxData.MemStopCleaning, Mach1_Alarms.Alm037) SET;
END_NETWORK
NETWORK 19 LD
  Mach1_AuxData.IEC_TIMERS.TON_BunchLevelWarning(IN := ((((((Mach1_AuxData.MIDS_Active AND Mach1.GenFlags.DelayAfterEmergStop) AND NOT LST_InputsOutputs.I101_4_Level_bunch_magazine) AND HMI_Var.Test_Prod) AND NOT HMI_Var.Btn_Cleaning) AND HMI_Var.Mach1.MuteNoBunchAlarm) AND Mach1_Alarms.Alm036), PT := T#5S);
  ??? := Alarms_V5_1_100(Mach1_AuxData.IEC_TIMERS.TON_BunchLevelWarning.Q, (LST_InputsOutputs.I101_4_Level_bunch_magazine OR HMI_Var.Test_Prod OR HMI_Var.Btn_Cleaning OR HMI_Var.Mach1.MuteNoBunchAlarm OR Mach1_Alarms.Alm036), Mach1_Alarms.Alm073);
END_NETWORK
NETWORK 20 LD
  LET i1 := fc_dinttotime(Mach1_Data.Timers.BunchMagazineEmptyTime,0);
  Mach1_AuxData.IEC_TIMERS.TON_BunchLevelAlarm(IN := ((((((Mach1_AuxData.MIDS_Active AND Mach1.GenFlags.DelayAfterEmergStop) AND NOT Mach1_Alarms.Alm036) AND NOT LST_InputsOutputs.I101_4_Level_bunch_magazine) AND HMI_Var.Test_Prod) AND NOT HMI_Var.Btn_Cleaning) AND NOT HMI_Var.Mach1.MuteNoBunchAlarm), PT := i1);
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100(Mach1_AuxData.IEC_TIMERS.TON_BunchLevelAlarm.Q, Mach1.GenFlags.StartFlag) SET;
END_NETWORK
NETWORK 21 LD
  LET g1 := fc_camc_cp_udt(HMI_Var.Mach1.Position, Mach1.GenFlags.Rotflag);
  LET g2 := (g1 AND Mach1_AuxData.ShiftRegister.SR_bunch_present_position_2_wrapping_device);
  LET g3 := (g1 AND Mach1_AuxData.ShiftRegister.SR_bunch_present_position_1_JL);
  Mach1_AuxData.ShiftRegister.SR_bunch_present_position_3_outfeed := (g1 AND Mach1_AuxData.ShiftRegister.SR_bunch_present_position_3_outfeed) RESET;
  Mach1_AuxData.ShiftRegister.SR_bunch_present_position_3_outfeed := g2 SET;
  Mach1_AuxData.ShiftRegister.SR_bunch_present_position_2_wrapping_device := g2 RESET;
  Mach1_AuxData.ShiftRegister.SR_bunch_present_position_2_wrapping_device := g3 SET;
  Mach1_AuxData.ShiftRegister.SR_bunch_present_position_1_JL := g3 RESET;
  Mach1_AuxData.ShiftRegister.SR_bunch_present_position_1_JL := (g1 AND LST_InputsOutputs.I101_1_FC_Bunch_present) SET;
  tBool := g1;
END_NETWORK
NETWORK 22 LD
  Mach1_AuxData.Edge.OSP_Emptying_Cleaning(CLK := HMI_Var.Btn_Cleaning);
  HMI_Var.Btn_BunchSupply := Mach1_AuxData.Edge.OSP_Emptying_Cleaning.Q RESET;
END_NETWORK
NETWORK 23 LD
  LET g1 := (TRUE AND TRUE);
  LET g2 := (fc_CamC_CP_UDT(g1, HMI_Var.Mach1.Position, LST_General.AlwaysOff) AND TRUE);
  Mach1_AuxData.BlockBunchInfeed := (g2 AND NOT HMI_Var.Btn_BunchSupply) SET;
  Mach1_AuxData.BlockBunchInfeed := (g2 AND HMI_Var.Btn_BunchSupply) RESET;
  Mach1_AuxData.BlockBunchInfeed := (g1 AND NOT Mach1.GenFlags.DelayAfterEmergStop) SET;
  PneumValveTerminalSMC.Pos2A := (((TRUE AND Mach1.GenFlags.EnablePneumEStop) AND Mach1_AuxData.BlockBunchInfeed) AND NOT Mach1_Alarms.Alm011);
END_NETWORK
NETWORK 24 LD
  LET i1 := INT_TO_WORD(Mach1_Data.Counters.BunchesFillBunchFeeder.SetValue);
  Mach1_AuxData.COUNTERS.RepetitionMuteNuBunch(CD := ((((ATD_SR(Mach1_Alarms.Alm041, ((tBool AND NOT HMI_Var.Test_Prod) OR (tBool AND HMI_Var.Btn_Cleaning) OR (tBool AND Mach1_AuxData.ShiftRegister.SR_bunch_present_position_1_JL) OR (tBool AND NOT HMI_Var.Btn_BunchSupply) OR (tBool AND Mach1_AuxData.NumberOfMutingCyclesReached))) AND tBool) AND HMI_Var.Test_Prod) AND NOT HMI_Var.Btn_Cleaning) AND NOT Mach1_AuxData.ShiftRegister.SR_bunch_present_position_1_JL), LOAD := Mach1_Alarms.Alm041, PV := i1);
  Mach1_AuxData.NumberOfMutingCyclesReached := Mach1_AuxData.COUNTERS.RepetitionMuteNuBunch.Q;
END_NETWORK
NETWORK 25 LD
  LET i1 := INT_TO_WORD(Mach1_Data.Counters.MaxRepetitionNoBunch.SetValue);
  Mach1_AuxData.COUNTERS.RepetitionNoBunch(CD := ((((tBool AND HMI_Var.Test_Prod) AND NOT HMI_Var.Btn_Cleaning) AND NOT HMI_Var.Mach1.MuteNoBunchAlarm) AND NOT Mach1_AuxData.ShiftRegister.SR_bunch_present_position_1_JL), LOAD := ((tBool AND NOT HMI_Var.Test_Prod) OR (tBool AND HMI_Var.Btn_Cleaning) OR (tBool AND Mach1_AuxData.ShiftRegister.SR_bunch_present_position_1_JL) OR (tBool AND NOT HMI_Var.Btn_BunchSupply) OR (tBool AND hmi_var.mach1.MuteNoBunchAlarm) OR (Mach1.GenFlags.StartFlag AND Mach1_Alarms.Alm041)), PV := i1);
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100(((Mach1_AuxData.COUNTERS.RepetitionNoBunch.Q AND Mach1_AuxData.AllDrivesHomed) AND NOT HMI_Var.Mach1.MuteNoBunchAlarm), Mach1.GenFlags.StartFlag) SET;
END_NETWORK
NETWORK 26 LD
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100((((tBool AND NOT Mach1_AuxData.PhotocellBunchHasBeenOff) AND HMI_Var.Btn_BunchSupply) AND Mach1_AuxData.AllDrivesHomed), Mach1.GenFlags.StartFlag, Mach1_Alarms.Alm042) SET;
END_NETWORK
NETWORK 27 LD
END_NETWORK
NETWORK 28 LD
END_NETWORK
NETWORK 29 LD
  LET i1 := INT_TO_WORD(Mach1_Data.Counters.MaxRepetitionNoCigars.SetValue);
  LET g1 := fc_CamC_CP_UDT(HMI_Var.Mach1.Position, Mach1.GenFlags.Rotflag);
  Mach1_AuxData.COUNTERS.RepetitionNoCigar(CD := ((((g1 AND HMI_Var.Test_Prod) AND NOT HMI_Var.Btn_Cleaning) AND Mach1_AuxData.ShiftRegister.SR_bunch_present_position_3_outfeed) AND NOT LST_InputsOutputs.I101_2_Cigar_present), LOAD := ((tBool AND NOT HMI_Var.Test_Prod) OR (tBool AND HMI_Var.Btn_Cleaning) OR ((tBool AND Mach1_AuxData.ShiftRegister.SR_bunch_present_position_3_outfeed) AND LST_InputsOutputs.I101_2_Cigar_present) OR (Mach1.GenFlags.StartFlag AND Mach1_Alarms.Alm046)), PV := i1);
  tBool := g1;
  tCampulseCigarPresent := g1;
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100((Mach1_AuxData.COUNTERS.RepetitionNoCigar.Q AND Mach1_AuxData.AllDrivesHomed), Mach1.GenFlags.StartFlag) SET;
END_NETWORK
NETWORK 30 LD
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100(((tbool AND NOT Mach1_AuxData.PhotocellCigarHasBeenOff) AND Mach1_AuxData.AllDrivesHomed), Mach1.GenFlags.StartFlag, Mach1_Alarms.Alm047) SET;
END_NETWORK
NETWORK 31 LD
END_NETWORK
NETWORK 32 LD
  HMI_Var.Mach1.PRDCounterIncr := ((tBool AND Mach1_AuxData.ShiftRegister.SR_bunch_present_position_3_outfeed) AND LST_InputsOutputs.I101_2_Cigar_present) SET;
END_NETWORK
NETWORK 33 LD
  Mach1_AuxData.Edge.OSP_DryerZeroPoint(CLK := (TRUE AND LST_InputsOutputs.I133_1_PROX_zero_position_transport_ADS));
  LET g1 := (Mach1_AuxData.Edge.OSP_DryerZeroPoint.Q AND Mach1_AuxData.MemCigarAtCrossOver);
  LET en1 := Mach1_AuxData.Edge.OSP_DryerZeroPoint.Q;
  IF en1 THEN LET g2 := fc_CheckRegister(); END_IF
  db_CheckRegister.Positie[1].Infeed.Cigar_present_infeed := ((TRUE AND tCampulseCigarPresent) AND LST_InputsOutputs.I101_2_Cigar_present) SET;
  Mach1_AuxData.MemCigarAtCrossOver := (TRUE AND LST_InputsOutputs.I133_2_Cigar_detected_at_cross_over) SET;
  db_CheckRegister.Positie[CTE.posCigarPresentOutfeed].Outfeed.Cigar_present_outfeed := g1 SET;
  Mach1_AuxData.MemCigarAtCrossOver := g1 RESET;
  Mach1_AuxData.PreviousCycleHasOutfeedError := Mach1_AuxData.Edge.OSP_DryerZeroPoint.Mach1_AuxData.PreviousCycleHasOutfeedError RESET;
  Mach1_AuxData.PreviousCycleHasOutfeedError := (Mach1_AuxData.Edge.OSP_DryerZeroPoint.Q AND Mach1_AuxData.CurrentCycleHasOutfeedError) SET;
  Mach1_AuxData.CurrentCycleHasOutfeedError := Mach1_AuxData.Edge.OSP_DryerZeroPoint.Mach1_AuxData.CurrentCycleHasOutfeedError RESET;
  Mach1_AuxData.CurrentCycleHasOutfeedError := (Mach1_AuxData.Edge.OSP_DryerZeroPoint.Q AND db_CheckRegister.CheckRegisterError) SET;
END_NETWORK
NETWORK 34 LD
  LET g1 := ((Mach1.GenFlags.EnableAuxDrive AND HMI_Var.Test_Prod) AND NOT HMI_Var.Btn_Cleaning);
  TMR_StartupFan(IN := g1, PT := T#5S);
  Mach1_Data.Drives.Fan.Control.StartAuto := g1;
END_NETWORK
NETWORK 35 LD
  mach1.Genflags.StopDriveDirect := Alarms_V5_1_100((((NOT HMI_Var.Btn_Cleaning AND Mach1.GenFlags.EnableAuxDrive) AND HMI_Var.Test_Prod) AND NOT TMR_StartupFan.Q), TRUE) SET;
END_NETWORK
NETWORK 36 LD
  LET g1 := (Mach1.GenFlags.EnablePneumEStop AND Mach1_Safety.Status.DoorsOK);
  PneumValveTerminalSMC.Pos3A := ((((g1 AND NOT Mach1_AuxData.ShiftRegister.SR_bunch_present_position_2_wrapping_device) OR (g1 AND NOT HMI_Var.Test_Prod) OR (g1 AND HMI_Var.Btn_Cleaning)) AND Mach1_AuxData.AllDrivesHomed) AND NOT Mach1_Alarms.Alm011);
  PneumValveTerminalSMC.Pos3B := (g1 AND NOT PneumValveTerminalSMC.Pos3A);
END_NETWORK
NETWORK 37 LD
  PneumValveTerminalSMC.Pos4A := ((fc_CamC_LS_UDT((Mach1_Safety.Status.DoorsOK AND Mach1.GenFlags.EnablePneumEStop), HMI_Var.Mach1.ActualSpeed, HMI_Var.Mach1.Position, Mach1.GenFlags.Rotflag) AND Mach1_AuxData.AllDrivesHomed) AND NOT Mach1_Alarms.Alm011);
END_NETWORK
NETWORK 38 LD
  PneumValveTerminalSMC.Pos4B := ((Mach1_Safety.Status.DoorsOK AND Mach1.GenFlags.EnablePneumEStop) AND NOT PneumValveTerminalSMC.Pos4A);
END_NETWORK
NETWORK 39 LD
  PneumValveTerminalSMC.Pos5A := ((fc_CamC_LS_UDT((Mach1_Safety.Status.DoorsOK AND Mach1.GenFlags.EnablePneumEStop), HMI_Var.Mach1.ActualSpeed, HMI_Var.Mach1.Position, Mach1.GenFlags.Rotflag) AND Mach1_AuxData.AllDrivesHomed) AND NOT Mach1_Alarms.Alm011);
END_NETWORK
NETWORK 40 LD
  PneumValveTerminalSMC.Pos5B := ((Mach1_Safety.Status.DoorsOK AND Mach1.GenFlags.EnablePneumEStop) AND NOT PneumValveTerminalSMC.Pos5A);
END_NETWORK
NETWORK 41 LD
  LET g1 := (Mach1_AuxData.EnableGlueSprayCalibration AND TRUE);
  LET g2 := (g1 AND HMI_Var.Mach1.GlueStart);
  LET g3 := (g1 AND HMI_Var.Mach1.GlueStop);
  LET g4 := (g1 AND HMI_Var.Mach1.GlueReset);
  LET g5 := (g1 AND HMI_Var.Mach1.SprayStart);
  LET g6 := (g1 AND HMI_Var.Mach1.SprayStop);
  LET g7 := (g1 AND HMI_Var.Mach1.SprayReset);
  LET g8 := (g1 AND Mach1_AuxData.ScreenForOperatorSettingsActivated);
  LET en1 := ((Mach1_AuxData.EnableGlueSprayCalibration AND HMI_Var.Mach1.GlueReset) OR (Mach1_AuxData.EnableGlueSprayCalibration AND NOT LST_InputsOutputs.I100_2_Pushbutton_stop_OP0a));
  IF en1 THEN Mach1_Data.Settings.Ints.ActualNumberOfGluePulses := MOVE(0); END_IF
  LET en2 := ((((((HMI_Var.Mach1.GlueStart OR LST_InputsOutputs.I100_4_Pushbutton_request_glue_OP0a) AND NOT LST_General.FF500ms) OR Mach1_AuxData.GlueWeighingCycleStarted) AND NOT HMI_Var.Mach1.GlueStop) AND NOT HMI_Var.Mach1.GlueReset) AND LST_InputsOutputs.I100_2_Pushbutton_stop_OP0a);
  IF en2 THEN Mach1_AuxData.GlueWeighingCycleStarted := (Mach1_Data.Settings.Ints.ActualNumberOfGluePulses < Mach1_Data.Settings.Ints.MaxNumberOfGluePulses); END_IF
  Mach1_AuxData.Edge.OSN_Gluepump(CLK := (Mach1_AuxData.EnableGlueSprayCalibration AND PneumValveTerminalSMC.Pos6A));
  LET en3 := (Mach1_AuxData.Edge.OSN_Gluepump.Q AND Mach1_AuxData.GlueWeighingCycleStarted);
  IF en3 THEN Mach1_Data.Settings.Ints.ActualNumberOfGluePulses := (Mach1_Data.Settings.Ints.ActualNumberOfGluePulses + 1); END_IF
  Mach1_AuxData.ScreenForOperatorSettingsActivated := (g2 OR g3 OR g4 OR g5 OR g6 OR g7 OR g8);
  Mach1.GenFlags.StopDriveDirect := (g2 OR g3 OR g4 OR g5 OR g6 OR g7 OR g8) SET;
END_NETWORK
NETWORK 42 LD
  Mach1_AuxData.Edge.OSPushbuttonGlue(CLK := ((TRUE AND LST_InputsOutputs.I100_4_Pushbutton_request_glue_OP0a) OR (TRUE AND Mach1_AuxData.IEC_TIMERS.TON_StopContGluePumping.Q)));
  LET g1 := (((NOT(Mach1_AuxData.Edge.OSPushbuttonGlue.Q) AND Mach1.GenFlags.EnablePneumEStop) AND NOT Mach1.GenFlags.DriveIsRunning) AND NOT Mach1_AuxData.ScreenForOperatorSettingsActivated);
  LET g2 := (g1 AND LST_InputsOutputs.I100_4_Pushbutton_request_glue_OP0a);
  LET g3 := (g1 AND Mach1_AuxData.IEC_TIMERS.DelayContiniousGluePumping.Q);
  Mach1_AuxData.IEC_TIMERS.DelayContiniousGluePumping(IN := (g2 OR g3), PT := T#3S);
  Mach1_AuxData.IEC_TIMERS.TON_StopContGluePumping(IN := (TRUE AND Mach1_AuxData.MemContinuousGluePumping), PT := T#120S);
  Mach1_AuxData.MemContinuousGluePumping := (g2 OR g3);
END_NETWORK
NETWORK 43 LD
  LET g1 := (((((((fc_CamC_CC_UDT(Mach1.GenFlags.EnablePneumEStop, HMI_Var.Mach1.Position) AND Mach1_AuxData.ShiftRegister.SR_bunch_present_position_1_JL) AND HMI_Var.Test_Prod) AND NOT HMI_Var.Btn_Cleaning) AND NOT Mach1_AuxData.MemContinuousGluePumping) AND NOT Mach1_AuxData.ScreenForOperatorSettingsActivated) OR ((Mach1.GenFlags.EnablePneumEStop AND LST_General.FF500ms) AND Mach1_AuxData.MemContinuousGluePumping) OR ((Mach1.GenFlags.EnablePneumEStop AND LST_General.FF500ms) AND Mach1_AuxData.GlueWeighingCycleStarted)) AND NOT Mach1_Alarms.Alm011);
  PneumValveTerminalSMC.Pos6A := g1;
  LST_InputsOutputs.Q101_2_Enable_GluePump := g1;
END_NETWORK
NETWORK 44 LD
  PneumValveTerminalSMC.Pos10A := (((((((fc_CamC_CC_UDT(Mach1.GenFlags.EnablePneumEStop, HMI_Var.Mach1.Position) AND Mach1_AuxData.ShiftRegister.SR_bunch_present_position_1_JL) AND HMI_Var.Test_Prod) AND NOT HMI_Var.Btn_Cleaning) AND NOT Mach1_AuxData.MemContinuousGluePumping) AND NOT Mach1_AuxData.ScreenForOperatorSettingsActivated) OR ((Mach1.GenFlags.EnablePneumEStop AND LST_General.FF500ms) AND Mach1_AuxData.MemContinuousGluePumping) OR ((Mach1.GenFlags.EnablePneumEStop AND LST_General.FF500ms) AND Mach1_AuxData.GlueWeighingCycleStarted)) AND NOT Mach1_Alarms.Alm011);
END_NETWORK
NETWORK 45 LD
  PneumValveTerminalSMC.Pos11A := (((((((fc_CamC_CC_UDT(Mach1.GenFlags.EnablePneumEStop, HMI_Var.Mach1.Position) AND Mach1_AuxData.ShiftRegister.SR_bunch_present_position_1_JL) AND HMI_Var.Test_Prod) AND NOT HMI_Var.Btn_Cleaning) AND NOT Mach1_AuxData.MemContinuousGluePumping) AND NOT Mach1_AuxData.ScreenForOperatorSettingsActivated) OR ((Mach1.GenFlags.EnablePneumEStop AND LST_General.FF500ms) AND Mach1_AuxData.MemContinuousGluePumping) OR ((Mach1.GenFlags.EnablePneumEStop AND LST_General.FF500ms) AND Mach1_AuxData.GlueWeighingCycleStarted)) AND NOT Mach1_Alarms.Alm011);
END_NETWORK
NETWORK 46 LD
  PneumValveTerminalSMC.Pos7A := ((fc_CamC_LS_UDT(Mach1.GenFlags.EnablePneumEStop, HMI_Var.Mach1.ActualSpeed, HMI_Var.Mach1.Position, Mach1.GenFlags.Rotflag) AND Mach1_AuxData.AllDrivesHomed) AND NOT Mach1_Alarms.Alm011);
END_NETWORK
NETWORK 47 LD
  PneumValveTerminalSMC.Pos8A := ((fc_CamC_LS_UDT(Mach1.GenFlags.EnablePneumEStop, HMI_Var.Mach1.ActualSpeed, HMI_Var.Mach1.Position, Mach1.GenFlags.Rotflag) AND Mach1_AuxData.AllDrivesHomed) AND NOT Mach1_Alarms.Alm011);
END_NETWORK
NETWORK 48 LD
  PneumValveTerminalSMC.Pos9A := (fc_CamC_CC_UDT(Mach1.GenFlags.EnablePneumEStop, HMI_Var.Mach1.Position) AND NOT Mach1_Alarms.Alm011);
END_NETWORK
NETWORK 49 LD
  PneumValveTerminalSMC.Pos1A := (fc_CamC_CC_UDT((Mach1.GenFlags.EnablePneumEStop AND Mach1.GenFlags.DriveIsRunning), HMI_Var.Mach1.Position) AND NOT Mach1_Alarms.Alm011);
END_NETWORK
NETWORK 50 LD
END_NETWORK
NETWORK 51 LD
END_NETWORK
NETWORK 52 LD
  LET g1 := fc_CamC_CP_UDT(HMI_Var.Mach1.Position, Mach1.GenFlags.Rotflag);
  IDB_Dryer(iGenFlags := Mach1.GenFlags, iMachineStarted := ((Mach1.GenFlags.EnableAuxDrive AND Mach1_Safety.Status.DoorsOK) AND NOT Mach1.GenFlags.StopFlag), iSwitchDryer := HMI_Var.Btn_DryerOn, iDryerClosed := LST_InputsOutputs.I133_0_PROX_Dryer_closed, iStartFeedForward := g1, iStopFeedForward := (((NOT Mach1.GenFlags.EnableAuxDrive OR (Mach1_AuxData.COUNTERS.EmptyingCycles.CV < 105) OR NOT Trayfiller_Data.commInterface.Permission OR NOT Mach1_Safety.Status.DoorsOK) AND LST_InputsOutputs.I133_1_PROX_zero_position_transport_ADS) OR Mach1_Alarms.Alm048), iPermissionDownstream := (Trayfiller_Data.commInterface.Permission AND NOT Mach1_Alarms.Alm053), iSetPowerHeater1 := Mach1_Data.Dryer.Heater1.SetHeaterPower, iSetPowerHeater2 := Mach1_Data.Dryer.Heater2.SetHeaterPower, iSetPowerHeater3 := Mach1_Data.Dryer.Heater3.SetHeaterPower, iPowerOrAnalog := TRUE, iSpeedForEmptying := 100);
  LET en1 := IDB_Dryer.ENO;
  IF en1 THEN LET g2 := (Mach1_Data.Dryer.Heater1.SetHeaterPower >= 350); END_IF
  LET en2 := g2;
  IF en2 THEN Mach1_Data.Dryer.Heater1.SetHeaterPower := MOVE(350); END_IF
  LET en3 := IDB_Dryer.ENO;
  IF en3 THEN LET g3 := (Mach1_Data.Dryer.Heater2.SetHeaterPower >= 350); END_IF
  LET en4 := g3;
  IF en4 THEN Mach1_Data.Dryer.Heater2.SetHeaterPower := MOVE(350); END_IF
  LET en5 := IDB_Dryer.ENO;
  IF en5 THEN LET g4 := (Mach1_Data.Dryer.Heater3.SetHeaterPower >= 350); END_IF
  LET en6 := g4;
  IF en6 THEN Mach1_Data.Dryer.Heater3.SetHeaterPower := MOVE(350); END_IF
  Mach1_AuxData.StartpulseDryer := g1;
  LST_InputsOutputs.Q132_2_Enable_power_controllers := (IDB_Dryer.ENO AND HMI_Var.Mach1.HeatersActive);
  HMI_Var.Mach1.HeatersActive := IDB_Dryer.oEnableHeaters;
  tHeater1Word := IDB_Dryer.oPowerHeater1;
  tHeater2Word := IDB_Dryer.oPowerHeater2;
  tHeater3Word := IDB_Dryer.oPowerHeater3;
END_NETWORK
NETWORK 53 LD
  LST_InputsOutputs.Q132_4_CT_Fan_dryer := ((Mach1_AuxData.TrayfillerActive AND Mach1.GenFlags.EnableAuxDrive) AND HMI_Var.Btn_DryerOn);
END_NETWORK
NETWORK 54 LD
  // dryer speed: 100rpm ->1000 0.1rpm
  // max AO-value: 2^14=16384
  LET i1 := DINT_TO_REAL(HMI_Var.Mach1.ActualSpeedDryer);
  LET i2 := REAL_TO_INT(lrHeater1_ScaledPower*lrDryer_ScaledSpeed*1500);
  LET i3 := REAL_TO_WORD(lrHeater1_Analog);
  LET i4 := REAL_TO_INT(lrHeater2_ScaledPower*lrDryer_ScaledSpeed*1500);
  LET i5 := REAL_TO_WORD(lrHeater2_Analog);
  LET i6 := REAL_TO_INT(lrHeater3_ScaledPower*lrDryer_ScaledSpeed*1500);
  LET i7 := REAL_TO_WORD(lrHeater3_Analog);
  LET en1 := TRUE;
  IF en1 THEN DRYER_Scaling_Speed(IN := i1, IN_MIN := 0, IN_MAX := 1000, OUT_MIN := 0, OUT_MAX := 1); END_IF
  LET en2 := TRUE;
  IF en2 THEN DRYER_SCALING_Heater1(IN := tHeater1Word, IN_MIN := 0, IN_MAX := 1500, OUT_MIN := 0, OUT_MAX := 1); END_IF
  LET en3 := en2;
  IF en3 THEN HMI_Var.Mach1.ActHeater1 := MOVE(i2); END_IF
  LET en4 := en3;
  IF en4 THEN DRYER_SCALING_Heater1_Analog(IN := lrDryer_ScaledSpeed*lrHeater1_ScaledPower*1500, IN_MIN := 0, IN_MAX := 1500, OUT_MIN := 0, OUT_MAX := 16384); END_IF
  LET en5 := en4;
  IF en5 THEN %QW105 := MOVE(i3); END_IF
  LET en6 := TRUE;
  IF en6 THEN DRYER_SCALING_Heater2(IN := tHeater2Word, IN_MIN := 0, IN_MAX := 1500, OUT_MIN := 0, OUT_MAX := 1); END_IF
  LET en7 := en6;
  IF en7 THEN HMI_Var.Mach1.ActHeater2 := MOVE(i4); END_IF
  LET en8 := en7;
  IF en8 THEN DRYER_SCALING_Heater2_Analog(IN := lrDryer_ScaledSpeed*lrHeater2_ScaledPower*1500, IN_MIN := 0, IN_MAX := 1500, OUT_MIN := 0, OUT_MAX := 16384); END_IF
  LET en9 := en8;
  IF en9 THEN %QW106 := MOVE(i5); END_IF
  LET en10 := TRUE;
  IF en10 THEN DRYER_SCALING_Heater3(IN := tHeater3Word, IN_MIN := 0, IN_MAX := 1500, OUT_MIN := 0, OUT_MAX := 1); END_IF
  LET en11 := en10;
  IF en11 THEN HMI_Var.Mach1.ActHeater3 := MOVE(i6); END_IF
  LET en12 := en11;
  IF en12 THEN DRYER_SCALING_Heater2_Analog(IN := lrDryer_ScaledSpeed*lrHeater3_ScaledPower*1500, IN_MIN := 0, IN_MAX := 1500, OUT_MIN := 0, OUT_MAX := 16384); END_IF
  LET en13 := en12;
  IF en13 THEN %QW107 := MOVE(i7); END_IF
  lrDryer_ScaledSpeed := DRYER_Scaling_Speed.OUT;
  lrHeater1_ScaledPower := DRYER_SCALING_Heater1.OUT;
  lrHeater1_Analog := DRYER_SCALING_Heater1_Analog.OUT;
  lrHeater2_ScaledPower := DRYER_SCALING_Heater2.OUT;
  lrHeater2_Analog := DRYER_SCALING_Heater2_Analog.OUT;
  lrHeater3_ScaledPower := DRYER_SCALING_Heater3.OUT;
  lrHeater3_Analog := DRYER_SCALING_Heater2_Analog.OUT;
END_NETWORK
NETWORK 55 LD
  LET g1 := ((Mach1_AuxData.TrayfillerActive AND IDB_Dryer.oFeedForward) AND Mach1.Genflags.DelayAfterSTO);
  LET g2 := (Mach1_AuxData.TrayfillerActive AND mach1.Genflags.DriveIsRunning);
  LET g3 := (Mach1.GenFlags.EnableAuxDrive AND NOT Mach1_Alarms.Alm048);
  LET en1 := ((((g3 AND Mach1.Genflags.DelayAfterSTO) AND IDB_Dryer.oFeedForward) OR (g3 AND mach1.Genflags.DriveIsRunning)) AND NOT LST_InputsOutputs.I133_1_PROX_zero_position_transport_ADS);
  IF en1 THEN LET g4 := (Mach1_Data.Drives.FeedForwardADS.Control.AutoSpeed >= 10); END_IF
  LET g5 := RuntimeGuard_V5_1_100((((g1 OR g2) AND Mach1_AuxData.AllDrivesHomed) OR ((g1 OR g2) AND NOT Mach1_AuxData.MIDS_Active)), LST_General.AlwaysOff, g4, T#10S, Mach1.GenFlags.StartFlag);
  Mach1.GenFlags.StopDriveDirect := g5 SET;
  tBool := g5;
  Mach1_Data.Drives.FeedForwardADS.Control.StartAuto := g5;
  tBool := g5;
  tBool := g5;
END_NETWORK
NETWORK 56 LD
  Mach1.GenFlags.StopDriveDirect := (Alarms_V5_1_100(((Mach1_AuxData.TrayfillerActive AND Mach1.GenFlags.DelayAfterEmergStop) AND IDB_Dryer.oFaultDryerOpened), TRUE) AND Mach1_AuxData.AllDrivesHomed) SET;
END_NETWORK
NETWORK 57 LD
  LET en1 := ((mach1.Genflags.DelayAfterEmergStop AND HMI_Var.Test_Prod) AND Mach1_AuxData.TrayfillerActive);
  IF en1 THEN LET g1 := (Mach1_Data.Counters.MaxRepetitionNoCigarsDryer.SetValue > 0); END_IF
  LET g2 := Alarms_V5_1_100(((g1 AND db_CheckRegister.CheckRegisterError) AND NOT Mach1_AuxData.PreviousCycleHasOutfeedError), Mach1.GenFlags.StartFlag);
  Mach1.GenFlags.StopDriveDirect := g2 SET;
  db_CheckRegister.CheckRegisterError := g2 RESET;
END_NETWORK
NETWORK 58 LD
  Mach1_AuxData.IEC_TIMERS.TON_DryerSwitchedOff(IN := ((Mach1_AuxData.TrayfillerActive AND HMI_Var.Test_Prod) AND NOT HMI_Var.Btn_DryerOn), PT := T#5S);
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100(Mach1_AuxData.IEC_TIMERS.TON_DryerSwitchedOff.Q, Mach1.GenFlags.StartFlag) SET;
END_NETWORK
NETWORK 59 LD
  ??? := SpeedCalculationDryer();
END_NETWORK
NETWORK 60 LD
  ??? := SpeedCalculationTrayfiller();
END_NETWORK
NETWORK 61 LD
  Mach1_AuxData.COUNTERS.EmptyingCycles(CD := (HMI_Var.Btn_Cleaning AND LST_InputsOutputs.I133_1_PROX_zero_position_transport_ADS), LOAD := NOT HMI_Var.Btn_Cleaning, PV := 194);
  HMI_Var.Btn_Cleaning := Mach1_AuxData.COUNTERS.EmptyingCycles.Q RESET;
END_NETWORK
NETWORK 62 LD
  IDB_TrayFiller(iGenFlags := Mach1.GenFlags, iMachineStarted := (Mach1.GenFlags.EnableAuxDrive AND NOT Mach1.GenFlags.StopFlag), iButtonChangeTray := LST_General.AlwaysOff, iButtonTrayDown := LST_InputsOutputs.I132_6_Tray_down, iButtonTrayUp := LST_InputsOutputs.I132_7_Tray_up, iCigarAtCrossover := (LST_InputsOutputs.I133_2_Cigar_detected_at_cross_over OR (Mach1_AuxData.COUNTERS.EmptyingCycles.CV < 106)), iStartFeedForward := ((LST_InputsOutputs.I133_1_PROX_zero_position_transport_ADS OR (Mach1_AuxData.COUNTERS.EmptyingCycles.CV < 106)) AND Mach1_Safety.Status.DoorsOK), iStopFeedForward := LST_InputsOutputs.I133_3_PROX_zero_position_transport_ATF, iCigarAtInpusher := LST_InputsOutputs.I133_4_Cigar_detected_at_inpusher, iRpsInpusher := LST_InputsOutputs.I133_6_PROX_inpusher_retracted, iEpsInpusher := LST_InputsOutputs.I133_7_PROX_inpusher_at_tray, iGuardInpusher := TRUE, iPsElevatorUp := LST_InputsOutputs.I136_0_PROX_Elevator_above, iPsElevatorDown := LST_InputsOutputs.I136_1_PROX_Elevator_below, iPulseCounterElevator := LST_InputsOutputs.I136_2_PROX_pulse_counter_elevator, iFcGuardTrayOnElev := LST_InputsOutputs.I136_3_FC_Position_tray_OK, iRowHeight := Mach1_Data.TrayFiller.RowHeight, iSetNumberOfRows := Mach1_Data.Trayfiller.SetNumberOfRows, iInitialDescentValue := Mach1_Data.Trayfiller.InitialDescentValue, iLightCurtainInpusher := Mach1_Safety.Status.Door_switch17, iLightCurtainElevator := Mach1_Safety.Status.Door_switch18, iPsInfeedConvAtInit := LST_InputsOutputs.I136_4_PROX_Infeed_conveyor_initial_position, iPsInfeedConvAtElev := LST_InputsOutputs.I136_5_PROX_Infeed_conveyor_at_elevator, iFcGuardTrayFromElev := LST_InputsOutputs.I136_6_FC_Guard_tray_from_elevator, iFcOutfeedConvFull := LST_InputsOutputs.I136_7_FC_Outfeed_conveyor_full, iTestProd := TRUE);
  LST_InputsOutputs.Q132_7_PNV_tilting_inpusher := IDB_TrayFiller.oValveTiltInpusher;
END_NETWORK
NETWORK 63 LD
  Mach1_Data.Drives.FeedForwardATF.Control.StartAuto := IDB_TrayFiller.oFeedForwardMotor;
END_NETWORK
NETWORK 64 LD
  LET en1 := IDB_TrayFiller.oValveInpusher;
  IF en1 THEN tTime1 := MOVE(T#1S); END_IF
  LET en2 := NOT(IDB_TrayFiller.oValveInpusher);
  IF en2 THEN tTime1 := MOVE(T#5S); END_IF
END_NETWORK
NETWORK 65 LD
  LET g1 := (Mach1_AuxData.TrayfillerActive AND Mach1.GenFlags.EnablePneumEStop);
  LET g2 := RuntimeGuard_V5_1_100(((Mach1_AuxData.TrayfillerActive AND IDB_TrayFiller.oValveInpusher) AND Mach1_AuxData.AllDrivesHomed), ((Mach1_AuxData.TrayfillerActive AND NOT IDB_TrayFiller.oValveInpusher) AND Mach1_AuxData.AllDrivesHomed), (((g1 AND IDB_TrayFiller.oValveInpusher) AND NOT LST_InputsOutputs.I133_7_PROX_inpusher_at_tray) OR ((g1 AND NOT IDB_TrayFiller.oValveInpusher) AND NOT LST_InputsOutputs.I133_6_PROX_inpusher_retracted)), T#3S, Mach1.GenFlags.StartFlag);
  Mach1.GenFlags.StopDriveDirect := g2 SET;
  LST_InputsOutputs.Q132_6_PNV_Inpusher := g2;
  tBool := g2;
  tBool := g2;
END_NETWORK
NETWORK 66 LD
  LET g1 := RuntimeGuard_V5_1_100(((Mach1_AuxData.TrayfillerActive AND IDB_TrayFiller.oElevatorMotorUp) AND Mach1_AuxData.AllDrivesHomed), ((Mach1_AuxData.TrayfillerActive AND IDB_TrayFiller.oElevatorMotorDown) AND Mach1_AuxData.AllDrivesHomed), TRUE, T#15S, Mach1.GenFlags.StartFlag);
  Mach1.GenFlags.StopDriveDirect := g1 SET;
  tElevatorUp := g1;
  tElevatorDown := g1;
END_NETWORK
NETWORK 67 LD
  LET g1 := RuntimeGuard_V5_1_100(((Mach1_AuxData.TrayfillerActive AND IDB_TrayFiller.oInfeedMotorFwd) AND Mach1_AuxData.AllDrivesHomed), ((Mach1_AuxData.TrayfillerActive AND IDB_TrayFiller.oInfeedMotorRev) AND Mach1_AuxData.AllDrivesHomed), TRUE, T#4000MS, Mach1.GenFlags.StartFlag);
  Mach1.GenFlags.StopDriveDirect := g1 SET;
  LST_InputsOutputs.Q133_5_InfeedConv_Fwd := g1;
  LST_InputsOutputs.Q133_6_InfeedConv_Rev := g1;
END_NETWORK
NETWORK 68 LD
  LET g1 := RuntimeGuard_V5_1_100(((Mach1_AuxData.TrayfillerActive AND IDB_TrayFiller.oOutfeedMotorFwd) AND Mach1_AuxData.AllDrivesHomed), NOT TRUE, TRUE, T#8500MS, Mach1.GenFlags.StartFlag);
  Mach1.GenFlags.StopDriveDirect := g1 SET;
  tBool := g1;
  LST_InputsOutputs.Q133_7_OutfeedConv_Fwd := g1;
  tBool := g1;
  tBool := g1;
END_NETWORK
NETWORK 69 LD
  LET en1 := (tElevatorUp OR tElevatorDown);
  IF en1 THEN Mach1_Data.Drives.ElevatorATF.Control.AutoSpeed := MOVE(30); END_IF
  Mach1_Data.Drives.ElevatorATF.Control.StartAuto := (tElevatorUp OR tElevatorDown);
  Mach1_Data.Drives.ElevatorATF.Control.Reverse := ((tElevatorUp OR tElevatorDown) AND tElevatorDown);
END_NETWORK
NETWORK 70 LD
  LET g1 := (((Mach1_AuxData.TrayfillerActive AND Mach1.GenFlags.DelayAfterEmergStop) AND Mach1.GenFlags.DelayAfterSTO) AND NOT LST_InputsOutputs.I132_0_Thermal_guards_OK);
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100(((g1 AND Mach1_AuxData.AllDrivesHomed) OR (g1 AND NOT Mach1_AuxData.MIDS_Active)), Mach1.GenFlags.StartFlag) SET;
END_NETWORK
NETWORK 71 LD
  LET g1 := (Mach1_AuxData.TrayfillerActive AND Trayfiller_Data.Alarms.AlmInpusherBlocked);
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100(((g1 AND Mach1_AuxData.AllDrivesHomed) OR (g1 AND NOT Mach1_AuxData.MIDS_Active)), Mach1.GenFlags.StartFlag) SET;
END_NETWORK
NETWORK 72 LD
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100((((Mach1_AuxData.TrayfillerActive AND Trayfiller_Data.Alarms.AlmTrayPosition) OR (Mach1_AuxData.TrayfillerActive AND Trayfiller_Data.Alarms.AlmTrayInfeeding)) AND Mach1_AuxData.AllDrivesHomed), TRUE) SET;
END_NETWORK
NETWORK 73 LD
  LET g1 := (Mach1_AuxData.TrayfillerActive AND Trayfiller_Data.Alarms.AlmLightCurtainInpusher);
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100(((g1 AND Mach1_AuxData.AllDrivesHomed) OR (g1 AND NOT Mach1_AuxData.MIDS_Active)), Mach1.GenFlags.StartFlag) SET;
END_NETWORK
NETWORK 74 LD
  LET g1 := (Mach1_AuxData.TrayfillerActive AND Trayfiller_Data.Alarms.WrnChangeTray);
END_NETWORK
NETWORK 75 LD
  LET g1 := (Mach1_AuxData.TrayfillerActive AND Trayfiller_Data.Alarms.AlmOutfeedFull);
END_NETWORK
NETWORK 76 LD
  LET g1 := (Mach1_AuxData.TrayfillerActive AND Trayfiller_Data.Alarms.AlmOutfeeding);
END_NETWORK
NETWORK 77 LD
  LET g1 := (Mach1_AuxData.TrayfillerActive AND Trayfiller_Data.Alarms.AlmLightCurtainElevator);
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100(((g1 AND Mach1_AuxData.AllDrivesHomed) OR (g1 AND NOT Mach1_AuxData.MIDS_Active)), TRUE) SET;
END_NETWORK
NETWORK 78 LD
  Mach1.GenFlags.StopDriveDirect := ((Mach1_AuxData.AllDrivesHomed AND Mach1_AuxData.TrayfillerActive) AND NOT Trayfiller_Data.commInterface.Permission) SET;
END_NETWORK
NETWORK 79 LD
END_NETWORK
NETWORK 80 LD
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100((Mach1.GenFlags.DelayAfterEmergStop AND tLowLevel), TRUE) SET;
END_NETWORK
NETWORK 81 LD
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100((Mach1.GenFlags.DelayAfterEmergStop AND tErrorRuntimeGreasingSystem), Mach1.GenFlags.StartFlag) SET;
END_NETWORK
NETWORK 82 LD
  LET en1 := ((TRUE AND Mach1.GenFlags.MajorAlarm) OR (TRUE AND Mach1.GenFlags.MinorAlarm));
  IF en1 THEN HMI_Var.Mach1.Status := MOVE(0); END_IF
  LET g1 := ((TRUE AND NOT Mach1.GenFlags.MajorAlarm) AND NOT Mach1.GenFlags.MinorAlarm);
  LET en2 := (g1 AND Mach1.GenFlags.Warning);
  IF en2 THEN HMI_Var.Mach1.Status := MOVE(1); END_IF
  LET g2 := (g1 AND NOT Mach1.GenFlags.Warning);
  LET en3 := ((g2 AND NOT Mach1.GenFlags.RunMan) AND NOT Mach1.GenFlags.RunAuto);
  IF en3 THEN HMI_Var.Mach1.Status := MOVE(2); END_IF
  LET en4 := ((g2 AND Mach1.GenFlags.RunMan) OR (g2 AND Mach1.GenFlags.RunAuto));
  IF en4 THEN HMI_Var.Mach1.Status := MOVE(3); END_IF
  tAlarmSL := en1;
  tWarningSL := en2;
  tStandbySL := en3;
  tRunningSL := en4;
END_NETWORK
NETWORK 83 LD
  LST_InputsOutputs.Q100_2_Pilot_light_Alarm_red_ := ((TRUE AND tAlarmlamp) AND tAlarmSL);
  LST_InputsOutputs.Q100_1_Pilot_light_Alarm_orange_ := ((TRUE AND tAlarmlamp) AND tWarningSL);
  LST_InputsOutputs.Q100_0_Pilot_light_Alarm_green_ := (((TRUE AND tAlarmlamp) AND tStandbySL) OR (TRUE AND tRunningSL));
END_NETWORK
NETWORK 84 LD
END_NETWORK

END_PROGRAM
