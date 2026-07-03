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

NETWORK 0 LD
  LET g1 := ((True AND NOT LST_InputsOutputs.I101_0_Wrapper_present) AND Mach1_AuxData.MemWrapperPassedUnderTheSensor);
  LET en1 := True;
  IF en1 THEN Mach1_AuxData.CamControls.TakeOverCycleStopPulse_CP.Start := MOVE(Mach1_Data.CamControls.TakeOverCycle_C.Stop); END_IF
  LET g2 := fc_CamC_CP_UDT(en1, HMI_Var.Mach1.Position, Mach1.GenFlags.Rotflag);
  Mach1_AuxData.MemWrapperPassedUnderTheSensor := (True AND LST_InputsOutputs.I101_0_Wrapper_present) SET;
  Mach1_AuxData.MemWrapperPresentForLeafCarrier := g1 SET;
  Mach1_AuxData.MemWrapperDetected_ResetLimitedSpeed := g1 SET;
  Mach1_AuxData.MemWrapperPresentForLeafCarrier := g2 RESET;
  Mach1_AuxData.MemWrapperPassedUnderTheSensor := g2 RESET;
END_NETWORK
NETWORK 1 LD
  R_TrigStartPos(CLK := HMI_Var.HMI_AHWF_StartPos);
  Mach1_AuxData.MemWrapperPresentForLeafCarrier := R_TrigStartPos.Q RESET;
  Mach1_AuxData.MemWrapperPassedUnderTheSensor := R_TrigStartPos.Q RESET;
END_NETWORK
NETWORK 2 LD
  LET i1 := fc_dinttotime(Mach1_Data.Timers.TimeOutSupplyWrapper,2);
  LET i2 := fc_dinttotime(Mach1_Data.Timers.SprayPulseWidth,2);
  LET i3 := fc_dinttotime(Mach1_Data.Timers.DelayContSpraying,2);
  IDB_WSM(iGenflags := Mach1.GenFlags, iInit := LST_General.FirstCycle, iTest_Prod := HMI_Var.Test_Prod, iCleaning := HMI_Var.Btn_Cleaning, iBunchPresent := Mach1_AuxData.ShiftRegister.SR_bunch_present_position_1_JL, iWrapperPresentForLeafCarrier := (Mach1_AuxData.MemWrapperPresentForLeafCarrier AND NOT HMI_Var.HMI_AHWF_fast_winding), iPhotocellWrapper := (LST_InputsOutputs.I101_0_Wrapper_present AND NOT HMI_Var.HMI_AHWF_fast_winding), iWaterLevelSensor := LST_InputsOutputs.I101_3_Water_level_control, iTakeOverCycle := fc_CamC_CC_UDT(True, HMI_Var.Mach1.Position), iTimeOutSupplyWrapper := i1, iSprayTime := i2, iDelayContSpraying := i3, iScreenForOperatorSettingsActivated := Mach1_AuxData.ScreenForOperatorSettingsActivated, iManualSprayCycleReset := HMI_Var.Mach1.SprayReset, iManualSprayCycleStart := HMI_Var.Mach1.SprayStart, iManualSprayCycleStop := HMI_Var.Mach1.SprayStop, iMaxNumberOfSprayPulses := Mach1_Data.Settings.Ints.MaxNumberOfSprayPulses);
  PneumValveTerminalSMC.Pos1B := ((((IDB_WSM.ENO AND Mach1.GenFlags.EnablePneumPressurised) AND Mach1_Safety.Status.AllDoorsActuallyClosed) AND tSprayingValve) AND NOT Mach1_Alarms.Alm011);
  tSupplyWrapper := IDB_WSM.oPositionMotor;
  tSprayingValve := IDB_WSM.oSprayingValve;
  LST_InputsOutputs.Q101_1_PNV_Waterlevel_control := IDB_WSM.oWaterLevelValve;
  tFaultWaitingForWrapper := IDB_WSM.oFaultWaitingForWrapper;
  tFaultNoWrapper := IDB_WSM.oFaultNoWrapper;
  tFaultPhotocellWrapper := IDB_WSM.oFaultPhotocellWrapper;
END_NETWORK
NETWORK 3 LD
  Mach1.GenFlags.StopDriveDirect := (Alarms_V5_1_100(((((Mach1.GenFlags.DelayAfterEmergStop AND HMI_Var.Test_Prod) AND NOT HMI_Var.Btn_Cleaning) AND tFaultWaitingForWrapper) AND Mach1_AuxData.AllDrivesHomed), True) OR Alarms_V5_1_100(((((Mach1.GenFlags.DelayAfterEmergStop AND HMI_Var.Test_Prod) AND NOT HMI_Var.Btn_Cleaning) AND tFaultNoWrapper) AND Mach1_AuxData.AllDrivesHomed), Mach1.GenFlags.StartFlag) OR Alarms_V5_1_100((((((Mach1.GenFlags.DelayAfterEmergStop AND HMI_Var.Test_Prod) AND NOT HMI_Var.Btn_Cleaning) AND NOT Mach1_Alarms.Alm045) AND tFaultPhotocellWrapper) AND Mach1_AuxData.AllDrivesHomed), Mach1.GenFlags.StartFlag)) SET;
END_NETWORK
NETWORK 4 LD
END_NETWORK
NETWORK 5 LD
  LET i1 := DINT_TO_LREAL(Mach1_Data.Settings.Dints.WrapperStopPosition)/10;
  LET g1 := (True AND True);
  LET en1 := (g1 AND TRUE);
  IF en1 THEN Data_Exchange_Motion.FeedForwardWrapper.Control.VelUnit := MOVE(175); END_IF
  LET en2 := en1;
  IF en2 THEN Data_Exchange_Motion.FeedForwardWrapper.Control.DecUnit := MOVE(2000); END_IF
  LET en3 := en2;
  IF en3 THEN Data_Exchange_Motion.FeedForwardWrapper.Control.AccUnit := MOVE(750); END_IF
  LET en4 := en3;
  IF en4 THEN Data_Exchange_Motion.FeedForwardWrapper.Control.TorqueLimit := MOVE(100); END_IF
  LET g2 := (g1 AND HMI_Var.HMI_AHWF_fast_winding);
  Mach1_AuxData.IEC_TIMERS.TON_StartFastWinding(IN := g2, PT := T#200MS);
  LET en5 := g2;
  IF en5 THEN Data_Exchange_Motion.FeedForwardWrapper.Control.VelUnit := MOVE(500); END_IF
  LET en6 := True;
  IF en6 THEN Data_Exchange_Motion.FeedForwardWrapper.Control.PosUnit := MOVE(i1); END_IF
  LET g3 := (((True AND NOT HMI_Var.HMI_AHWF_positioningType) AND NOT Mach1_Alarms.Alm056) AND mach1.Genflags.EnableAuxDrive);
  Mach1_AuxData.Edge.OSP_StopFlag(CLK := ((True AND NOT Mach1_MIDS.FB_Mach1.iStop1) OR (True AND NOT Mach1_MIDS.FB_Mach1.iStop2) OR (True AND NOT Mach1_MIDS.FB_Mach1.iStop3) OR (True AND NOT Mach1_Safety.Status.AllDoorsActuallyClosed) OR (True AND LST_InputsOutputs.I101_0_Wrapper_present)));
  tStartFastWinding := Mach1_AuxData.IEC_TIMERS.TON_StartFastWinding.Q;
  Data_Exchange_Motion.FeedForwardWrapper.Control.StartTouchprobePos := ((g3 AND tSupplyWrapper) OR (g3 AND tStartFastWinding) OR ((g3 AND Data_Exchange_Motion.FeedForwardWrapper.Control.StartTouchprobePos) AND NOT Data_Exchange_Motion.FeedForwardWrapper.Status.InPosition));
  HMI_Var.HMI_AHWF_fast_winding := Mach1_AuxData.Edge.OSP_StopFlag.Q RESET;
END_NETWORK
NETWORK 6 LD
  ??? := SideCorrection();
END_NETWORK
NETWORK 7 LD
  LET g1 := (Mach1_AuxData.MIDS_Active AND Mach1.GenFlags.DelayAfterEmergStop);
  Mach1_AuxData.Edge.OSP_LimitDTA_Reached(CLK := ((g1 AND NOT Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Left_OK) OR (g1 AND NOT Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Right_OK)));
  LET g2 := (Mach1_AuxData.MIDS_Active AND Mach1.GenFlags.DelayAfterEmergStop);
  Mach1.GenFlags.StopDriveDirect := (Alarms_V5_1_100((Mach1_AuxData.Edge.OSP_LimitDTA_Reached.Q AND Mach1_AuxData.AllDrivesHomed), Mach1.GenFlags.StartFlag) OR (LST_General.AlwaysOff AND Alarms_V5_1_100((((g2 AND NOT Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Left_OK) OR (g2 AND NOT Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Right_OK)) AND Mach1_AuxData.AllDrivesHomed), Mach1.GenFlags.StartFlag))) SET;
END_NETWORK
NETWORK 8 LD
  Mach1_AuxData.IEC_TIMERS.WaterReceptacleFull(IN := ((Mach1_AuxData.MIDS_Active AND LST_InputsOutputs.I101_3_Water_level_control) AND NOT Mach1_Alarms.Alm055), PT := T#5M);
  Mach1.GenFlags.StopDriveDirect := Alarms_V5_1_100((((Mach1_AuxData.IEC_TIMERS.WaterReceptacleFull.Q AND HMI_Var.Test_Prod) AND HMI_Var.Btn_Spraying) AND Mach1_AuxData.AllDrivesHomed), Mach1.GenFlags.StartFlag) SET;
END_NETWORK

END_PROGRAM
