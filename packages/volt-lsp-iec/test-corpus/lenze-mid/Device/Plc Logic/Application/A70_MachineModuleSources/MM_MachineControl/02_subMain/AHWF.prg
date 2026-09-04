PROGRAM AHWF
VAR
	tFaultWaitingForWrapper : BOOL;
	tFaultNoWrapper: BOOL;
	tFaultPhotocellWrapper: BOOL;
	tStartFastWinding: BOOL;
	tSupplyWrapper: BOOL;
	tSprayingValve: BOOL;
	ttest: BOOL;
	R_TrigStartPos: R_TRIG;
END_VAR

VAR 
	IDB_WSM: WSM;
END_VAR

NETWORK 0 LD TITLE: "Network 1: Detection of wrapper (set and reset)"
  LET g10 := True;
  Mach1_AuxData.MemWrapperPassedUnderTheSensor S= (g10 AND LST_InputsOutputs.I101_0_Wrapper_present);
  LET g1 := (g10 AND NOT LST_InputsOutputs.I101_0_Wrapper_present AND Mach1_AuxData.MemWrapperPassedUnderTheSensor);
  Mach1_AuxData.MemWrapperPresentForLeafCarrier S= g1;
  Mach1_AuxData.MemWrapperDetected_ResetLimitedSpeed S= g1;
  LET g2 := fc_CamC_CP_UDT(MOVE(Mach1_Data.CamControls.TakeOverCycle_C.Stop), HMI_Var.Mach1.Position, Mach1.GenFlags.Rotflag, Mach1_AuxData.CamControls.TakeOverCycleStopPulse_CP);
  Mach1_AuxData.MemWrapperPresentForLeafCarrier R= g2;
  Mach1_AuxData.MemWrapperPassedUnderTheSensor R= g2;
END_NETWORK
NETWORK 1 LD
  LET g1 := R_TrigStartPos(CLK := HMI_Var.HMI_AHWF_StartPos);
  Mach1_AuxData.MemWrapperPresentForLeafCarrier R= g1;
  Mach1_AuxData.MemWrapperPassedUnderTheSensor R= g1;
END_NETWORK
NETWORK 2 LD TITLE: "Network 2: FB for DTA"
  LET i1 := fc_dinttotime(Mach1_Data.Timers.TimeOutSupplyWrapper,2);
  LET i2 := fc_dinttotime(Mach1_Data.Timers.SprayPulseWidth,2);
  LET i3 := fc_dinttotime(Mach1_Data.Timers.DelayContSpraying,2);
  PneumValveTerminalSMC.Pos1B := (IDB_WSM(iGenflags := Mach1.GenFlags, iInit := LST_General.FirstCycle, iTest_Prod := HMI_Var.Test_Prod, iCleaning := HMI_Var.Btn_Cleaning, iBunchPresent := Mach1_AuxData.ShiftRegister.SR_bunch_present_position_1_JL, iWrapperPresentForLeafCarrier := (Mach1_AuxData.MemWrapperPresentForLeafCarrier AND NOT HMI_Var.HMI_AHWF_fast_winding), iPhotocellWrapper := (LST_InputsOutputs.I101_0_Wrapper_present AND NOT HMI_Var.HMI_AHWF_fast_winding), iWaterLevelSensor := LST_InputsOutputs.I101_3_Water_level_control, iTakeOverCycle := fc_CamC_CC_UDT(True, HMI_Var.Mach1.Position, Mach1_Data.CamControls.TakeOverCycle_C), iTimeOutSupplyWrapper := i1, iSprayTime := i2, iDelayContSpraying := i3, iScreenForOperatorSettingsActivated := Mach1_AuxData.ScreenForOperatorSettingsActivated, iManualSprayCycleReset := HMI_Var.Mach1.SprayReset, iManualSprayCycleStart := HMI_Var.Mach1.SprayStart, iManualSprayCycleStop := HMI_Var.Mach1.SprayStop, iMaxNumberOfSprayPulses := Mach1_Data.Settings.Ints.MaxNumberOfSprayPulses, ioEnableSpraying := HMI_Var.Btn_Spraying, ioManualSprayCycleActualCount := Mach1_Data.Settings.Ints.ActualNumberOfSprayPulses, ioManualStartSupply := HMI_Var.HMI_AHWF_StartPos) AND Mach1.GenFlags.EnablePneumPressurised AND Mach1_Safety.Status.AllDoorsActuallyClosed AND tSprayingValve AND NOT Mach1_Alarms.Alm011);
END_NETWORK
NETWORK 3 LD TITLE: "Network 3: Wrapper faults"
  Mach1.GenFlags.StopDriveDirect S= (Alarms_V5_1_100(Mach1_Alarms, (Mach1.GenFlags.DelayAfterEmergStop AND HMI_Var.Test_Prod AND NOT HMI_Var.Btn_Cleaning AND tFaultWaitingForWrapper AND Mach1_AuxData.AllDrivesHomed), True, Mach1_Alarms.Alm076, Mach1.GenFlags.Warning) OR Alarms_V5_1_100(Mach1_Alarms, (Mach1.GenFlags.DelayAfterEmergStop AND HMI_Var.Test_Prod AND NOT HMI_Var.Btn_Cleaning AND tFaultNoWrapper AND Mach1_AuxData.AllDrivesHomed), Mach1.GenFlags.StartFlag, Mach1_Alarms.Alm043, Mach1.GenFlags.MinorAlarm) OR Alarms_V5_1_100(Mach1_Alarms, (Mach1.GenFlags.DelayAfterEmergStop AND HMI_Var.Test_Prod AND NOT HMI_Var.Btn_Cleaning AND NOT Mach1_Alarms.Alm045 AND tFaultPhotocellWrapper AND Mach1_AuxData.AllDrivesHomed), Mach1.GenFlags.StartFlag, Mach1_Alarms.Alm045, Mach1.GenFlags.MinorAlarm));
END_NETWORK
NETWORK 4 LD
END_NETWORK
NETWORK 5 LD TITLE: "TODO Network 4:"
  LET g328 := True;
  LET g329 := (g328 AND True);
  LET en1 := MOVE(750);
  IF en1 THEN MOVE(100); END_IF
  LET g330 := (g329 AND HMI_Var.HMI_AHWF_fast_winding);
  tStartFastWinding := Mach1_AuxData.IEC_TIMERS.TON_StartFastWinding(IN := g330, PT := T#200MS);
  LET en2 := g330;
  IF en2 THEN MOVE(500); END_IF
  LET i1 := DINT_TO_LREAL(Mach1_Data.Settings.Dints.WrapperStopPosition)/10;
  LET en3 := g328;
  IF en3 THEN MOVE(i1); END_IF
  Data_Exchange_Motion.FeedForwardWrapper.Control.StartTouchprobePos := (g328 AND NOT HMI_Var.HMI_AHWF_positioningType AND NOT Mach1_Alarms.Alm056 AND mach1.Genflags.EnableAuxDrive AND (tSupplyWrapper OR tStartFastWinding OR (Data_Exchange_Motion.FeedForwardWrapper.Control.StartTouchprobePos AND NOT Data_Exchange_Motion.FeedForwardWrapper.Status.InPosition)));
  HMI_Var.HMI_AHWF_fast_winding R= Mach1_AuxData.Edge.OSP_StopFlag(CLK := (g328 AND (NOT Mach1_MIDS.FB_Mach1.iStop1 OR NOT Mach1_MIDS.FB_Mach1.iStop2 OR NOT Mach1_MIDS.FB_Mach1.iStop3 OR NOT Mach1_Safety.Status.AllDoorsActuallyClosed OR LST_InputsOutputs.I101_0_Wrapper_present)));
END_NETWORK
NETWORK 6 LD TITLE: "Network 5: Side correction"
  LET en1 := ;
  IF en1 THEN SideCorrection(); END_IF
END_NETWORK
NETWORK 7 LD TITLE: "Network 6: DTA-alarm: side limit reached"
  Mach1.GenFlags.StopDriveDirect S= (Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.Edge.OSP_LimitDTA_Reached(CLK := (Mach1_AuxData.MIDS_Active AND Mach1.GenFlags.DelayAfterEmergStop AND (NOT Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Left_OK OR NOT Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Right_OK))) AND Mach1_AuxData.AllDrivesHomed), Mach1.GenFlags.StartFlag, Mach1_Alarms.Alm057, Mach1.GenFlags.MinorAlarm) OR (LST_General.AlwaysOff AND Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.MIDS_Active AND Mach1.GenFlags.DelayAfterEmergStop AND (NOT Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Left_OK OR NOT Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Right_OK) AND Mach1_AuxData.AllDrivesHomed), Mach1.GenFlags.StartFlag, Mach1_Alarms.Alm074, Mach1.GenFlags.Warning)));
END_NETWORK
NETWORK 8 LD TITLE: "Network 7: Alarm: Water receptacle full"
  Mach1.GenFlags.StopDriveDirect S= Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.IEC_TIMERS.WaterReceptacleFull(IN := (Mach1_AuxData.MIDS_Active AND LST_InputsOutputs.I101_3_Water_level_control AND NOT Mach1_Alarms.Alm055), PT := T#5M) AND HMI_Var.Test_Prod AND HMI_Var.Btn_Spraying AND Mach1_AuxData.AllDrivesHomed), Mach1.GenFlags.StartFlag, Mach1_Alarms.Alm055, Mach1.GenFlags.MinorAlarm);
END_NETWORK

END_PROGRAM
