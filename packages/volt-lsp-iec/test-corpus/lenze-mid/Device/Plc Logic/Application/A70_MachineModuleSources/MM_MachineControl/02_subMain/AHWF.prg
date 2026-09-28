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
IMPLEMENTATION LD
NETWORK TITLE: "Network 1: Detection of wrapper (set and reset)"
  VAR_TEMP g10 : BOOL; END_VAR
  g10 := True;
  Mach1_AuxData.MemWrapperPassedUnderTheSensor S= (g10 AND LST_InputsOutputs.I101_0_Wrapper_present);
  Mach1_AuxData.MemWrapperPresentForLeafCarrier S=
  Mach1_AuxData.MemWrapperDetected_ResetLimitedSpeed S= (g10 AND NOT LST_InputsOutputs.I101_0_Wrapper_present AND Mach1_AuxData.MemWrapperPassedUnderTheSensor);
  Mach1_AuxData.MemWrapperPresentForLeafCarrier R=
  Mach1_AuxData.MemWrapperPassedUnderTheSensor R= fc_CamC_CP_UDT(iEN := MOVE(EN := g10, Mach1_Data.CamControls.TakeOverCycle_C.Stop, => Mach1_AuxData.CamControls.TakeOverCycleStopPulse_CP.Start).ENO, iMachinePosition := HMI_Var.Mach1.Position, iResetFlag := Mach1.GenFlags.Rotflag, ioPulse := Mach1_AuxData.CamControls.TakeOverCycleStopPulse_CP);
END_NETWORK
NETWORK
  Mach1_AuxData.MemWrapperPresentForLeafCarrier R=
  Mach1_AuxData.MemWrapperPassedUnderTheSensor R= R_TrigStartPos(CLK := HMI_Var.HMI_AHWF_StartPos);
END_NETWORK
NETWORK TITLE: "Network 2: FB for DTA"
  PneumValveTerminalSMC.Pos1B := (IDB_WSM(EN := , iGenflags := Mach1.GenFlags, iInit := LST_General.FirstCycle, iTest_Prod := HMI_Var.Test_Prod, iCleaning := HMI_Var.Btn_Cleaning, iBunchPresent := Mach1_AuxData.ShiftRegister.SR_bunch_present_position_1_JL, iWrapperPresentForLeafCarrier := (Mach1_AuxData.MemWrapperPresentForLeafCarrier AND NOT HMI_Var.HMI_AHWF_fast_winding), iPhotocellWrapper := (LST_InputsOutputs.I101_0_Wrapper_present AND NOT HMI_Var.HMI_AHWF_fast_winding), iWaterLevelSensor := LST_InputsOutputs.I101_3_Water_level_control, iTakeOverCycle := fc_CamC_CC_UDT(iEnable := True, iMachinePosition := HMI_Var.Mach1.Position, ioCamControl := Mach1_Data.CamControls.TakeOverCycle_C), iTimeOutSupplyWrapper := `fc_dinttotime(Mach1_Data.Timers.TimeOutSupplyWrapper,2)`, iSprayTime := `fc_dinttotime(Mach1_Data.Timers.SprayPulseWidth,2)`, iDelayContSpraying := `fc_dinttotime(Mach1_Data.Timers.DelayContSpraying,2)`, iScreenForOperatorSettingsActivated := Mach1_AuxData.ScreenForOperatorSettingsActivated, iManualSprayCycleReset := HMI_Var.Mach1.SprayReset, iManualSprayCycleStart := HMI_Var.Mach1.SprayStart, iManualSprayCycleStop := HMI_Var.Mach1.SprayStop, iMaxNumberOfSprayPulses := Mach1_Data.Settings.Ints.MaxNumberOfSprayPulses, ioEnableSpraying := HMI_Var.Btn_Spraying, ioManualSprayCycleActualCount := Mach1_Data.Settings.Ints.ActualNumberOfSprayPulses, ioManualStartSupply := HMI_Var.HMI_AHWF_StartPos, oPositionMotor => tSupplyWrapper, oSprayingValve => tSprayingValve, oWaterLevelValve => LST_InputsOutputs.Q101_1_PNV_Waterlevel_control, oFaultWaitingForWrapper => tFaultWaitingForWrapper, oFaultNoWrapper => tFaultNoWrapper, oFaultPhotocellWrapper => tFaultPhotocellWrapper).ENO AND Mach1.GenFlags.EnablePneumPressurised AND Mach1_Safety.Status.AllDoorsActuallyClosed AND tSprayingValve AND NOT Mach1_Alarms.Alm011);
END_NETWORK
NETWORK TITLE: "Network 3: Wrapper faults"
  Mach1.GenFlags.StopDriveDirect S= (Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := (Mach1.GenFlags.DelayAfterEmergStop AND HMI_Var.Test_Prod AND NOT HMI_Var.Btn_Cleaning AND tFaultWaitingForWrapper AND Mach1_AuxData.AllDrivesHomed), iReset := True, iAlm := Mach1_Alarms.Alm076, ioAction := Mach1.GenFlags.Warning) OR Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := (Mach1.GenFlags.DelayAfterEmergStop AND HMI_Var.Test_Prod AND NOT HMI_Var.Btn_Cleaning AND tFaultNoWrapper AND Mach1_AuxData.AllDrivesHomed), iReset := Mach1.GenFlags.StartFlag, iAlm := Mach1_Alarms.Alm043, ioAction := Mach1.GenFlags.MinorAlarm) OR Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := (Mach1.GenFlags.DelayAfterEmergStop AND HMI_Var.Test_Prod AND NOT HMI_Var.Btn_Cleaning AND NOT Mach1_Alarms.Alm045 AND tFaultPhotocellWrapper AND Mach1_AuxData.AllDrivesHomed), iReset := Mach1.GenFlags.StartFlag, iAlm := Mach1_Alarms.Alm045, ioAction := Mach1.GenFlags.MinorAlarm));
END_NETWORK
NETWORK
END_NETWORK
NETWORK TITLE: "TODO Network 4:"
  VAR_TEMP g328, g329, g330 : BOOL; END_VAR
  g328 := True;
  g329 := (g328 AND True);
  MOVE(EN := MOVE(EN := MOVE(EN := MOVE(EN := (g329 AND TRUE), 175, => Data_Exchange_Motion.FeedForwardWrapper.Control.VelUnit).ENO, 2000, => Data_Exchange_Motion.FeedForwardWrapper.Control.DecUnit).ENO, 750, => Data_Exchange_Motion.FeedForwardWrapper.Control.AccUnit).ENO, 100, => Data_Exchange_Motion.FeedForwardWrapper.Control.TorqueLimit);
  g330 := (g329 AND HMI_Var.HMI_AHWF_fast_winding);
  tStartFastWinding := Mach1_AuxData.IEC_TIMERS.TON_StartFastWinding(IN := g330, PT := T#200MS);
  MOVE(EN := g330, 500, => Data_Exchange_Motion.FeedForwardWrapper.Control.VelUnit);
  MOVE(EN := g328, `DINT_TO_LREAL(Mach1_Data.Settings.Dints.WrapperStopPosition)/10`, => Data_Exchange_Motion.FeedForwardWrapper.Control.PosUnit);
  Data_Exchange_Motion.FeedForwardWrapper.Control.StartTouchprobePos := (g328 AND NOT HMI_Var.HMI_AHWF_positioningType AND NOT Mach1_Alarms.Alm056 AND mach1.Genflags.EnableAuxDrive AND (tSupplyWrapper OR tStartFastWinding OR (Data_Exchange_Motion.FeedForwardWrapper.Control.StartTouchprobePos AND NOT Data_Exchange_Motion.FeedForwardWrapper.Status.InPosition)));
  HMI_Var.HMI_AHWF_fast_winding R= Mach1_AuxData.Edge.OSP_StopFlag(CLK := (g328 AND (NOT Mach1_MIDS.FB_Mach1.iStop1 OR NOT Mach1_MIDS.FB_Mach1.iStop2 OR NOT Mach1_MIDS.FB_Mach1.iStop3 OR NOT Mach1_Safety.Status.AllDoorsActuallyClosed OR LST_InputsOutputs.I101_0_Wrapper_present)));
END_NETWORK
NETWORK TITLE: "Network 5: Side correction"
  SideCorrection(EN := , => ???);
END_NETWORK
NETWORK TITLE: "Network 6: DTA-alarm: side limit reached"
  Mach1.GenFlags.StopDriveDirect S= (Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := (Mach1_AuxData.Edge.OSP_LimitDTA_Reached(CLK := (Mach1_AuxData.MIDS_Active AND Mach1.GenFlags.DelayAfterEmergStop AND (NOT Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Left_OK OR NOT Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Right_OK))) AND Mach1_AuxData.AllDrivesHomed), iReset := Mach1.GenFlags.StartFlag, iAlm := Mach1_Alarms.Alm057, ioAction := Mach1.GenFlags.MinorAlarm) OR (LST_General.AlwaysOff AND Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := (Mach1_AuxData.MIDS_Active AND Mach1.GenFlags.DelayAfterEmergStop AND (NOT Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Left_OK OR NOT Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Right_OK) AND Mach1_AuxData.AllDrivesHomed), iReset := Mach1.GenFlags.StartFlag, iAlm := Mach1_Alarms.Alm074, ioAction := Mach1.GenFlags.Warning)));
END_NETWORK
NETWORK TITLE: "Network 7: Alarm: Water receptacle full"
  Mach1.GenFlags.StopDriveDirect S= Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := (Mach1_AuxData.IEC_TIMERS.WaterReceptacleFull(IN := (Mach1_AuxData.MIDS_Active AND LST_InputsOutputs.I101_3_Water_level_control AND NOT Mach1_Alarms.Alm055), PT := T#5M) AND HMI_Var.Test_Prod AND HMI_Var.Btn_Spraying AND Mach1_AuxData.AllDrivesHomed), iReset := Mach1.GenFlags.StartFlag, iAlm := Mach1_Alarms.Alm055, ioAction := Mach1.GenFlags.MinorAlarm);
END_NETWORK

END_PROGRAM
