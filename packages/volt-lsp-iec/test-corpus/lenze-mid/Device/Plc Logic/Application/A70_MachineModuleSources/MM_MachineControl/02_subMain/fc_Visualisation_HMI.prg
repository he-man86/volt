PROGRAM fc_Visualisation_HMI
VAR_INPUT
END_VAR
VAR
	tbool: BOOL;
END_VAR
(* @volt-implementation LD *)
NETWORK TITLE: "NETWORK 5: (P1) Visualisation - emergency stop"
  Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := (Mach1_AuxData.MIDS_Active AND NOT Mach1_Safety.Status.Emergency_button01), iReset := True, iAlm := Mach1_Alarms.Alm080, ioAction := Mach1.GenFlags.warning);
END_NETWORK
NETWORK TITLE: "NETWORK 5: (P2) Visualisation - emergency stop"
  Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := (Mach1_AuxData.MIDS_Active AND NOT Mach1_Safety.Status.Emergency_button02), iReset := True, iAlm := Mach1_Alarms.Alm081, ioAction := Mach1.GenFlags.warning);
END_NETWORK
NETWORK TITLE: "NETWORK 5: (P3) Visualisation - emergency stop"
  Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := (Mach1_AuxData.MIDS_Active AND NOT Mach1_Safety.Status.Emergency_button04), iReset := True, iAlm := Mach1_Alarms.Alm082, ioAction := Mach1.GenFlags.warning);
END_NETWORK
NETWORK TITLE: "DONE NETWORK 5 (p2): Visualisation - doors"
  tbool := (Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch01), iReset := True, iAlm := Mach1_Alarms.Alm083, ioAction := Mach1.GenFlags.warning) OR Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch02), iReset := True, iAlm := Mach1_Alarms.Alm084, ioAction := Mach1.GenFlags.warning) OR Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch03), iReset := True, iAlm := Mach1_Alarms.Alm085, ioAction := Mach1.GenFlags.warning) OR Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch04), iReset := True, iAlm := Mach1_Alarms.Alm086, ioAction := Mach1.GenFlags.warning) OR Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch05), iReset := True, iAlm := Mach1_Alarms.Alm087, ioAction := Mach1.GenFlags.warning));
END_NETWORK
NETWORK
  tbool := (Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch06), iReset := True, iAlm := Mach1_Alarms.Alm088, ioAction := Mach1.GenFlags.warning) OR Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch07), iReset := True, iAlm := Mach1_Alarms.Alm089, ioAction := Mach1.GenFlags.warning) OR Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch08), iReset := True, iAlm := Mach1_Alarms.Alm090, ioAction := Mach1.GenFlags.warning) OR Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch09), iReset := True, iAlm := Mach1_Alarms.Alm091, ioAction := Mach1.GenFlags.warning) OR Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch10), iReset := True, iAlm := Mach1_Alarms.Alm092, ioAction := Mach1.GenFlags.warning));
END_NETWORK
NETWORK
  tbool := (Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch14), iReset := True, iAlm := Mach1_Alarms.Alm093, ioAction := Mach1.GenFlags.warning) OR Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch15), iReset := True, iAlm := Mach1_Alarms.Alm094, ioAction := Mach1.GenFlags.warning) OR Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch16), iReset := True, iAlm := Mach1_Alarms.Alm095, ioAction := Mach1.GenFlags.warning) OR Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch11), iReset := True, iAlm := Mach1_Alarms.Alm070, ioAction := Mach1.GenFlags.warning) OR Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch12), iReset := True, iAlm := Mach1_Alarms.Alm071, ioAction := Mach1.GenFlags.warning));
END_NETWORK
NETWORK
  Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch13), iReset := True, iAlm := Mach1_Alarms.Alm072, ioAction := Mach1.GenFlags.warning);
END_NETWORK
NETWORK
  tbool := (Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND LST_InputsOutputs.I100_3_Selector_switch_auto_manual_OP0a), iReset := True, iAlm := Mach1_Alarms.Alm018, ioAction := Mach1.GenFlags.warning) OR Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND LST_InputsOutputs.I132_3_SW_Auto_Man), iReset := True, iAlm := Mach1_Alarms.Alm019, ioAction := Mach1.GenFlags.warning));
END_NETWORK
NETWORK TITLE: "Reset of alarmlogging"
  HMI_Var.ResetAlarmLogging R= Alarms_ResetAlarmLogging(EN := HMI_Var.ResetAlarmLogging, AlarmDB := Mach1_Alarms).ENO;
END_NETWORK
NETWORK TITLE: "Adding product counters"
  HMI_Var.Mach1.PRDCounterIncr R= ADD(EN := ADD(EN := ADD(EN := HMI_Var.Mach1.PRDCounterIncr, HMI_Var.Mach1.PRDTotalCounter, 1, => HMI_Var.Mach1.PRDTotalCounter).ENO, HMI_Var.Mach1.PRDCigDayCounter, 1, => HMI_Var.Mach1.PRDCigDayCounter).ENO, HMI_Var.Mach1.PRDCigCurrentCntr, 1, => HMI_Var.Mach1.PRDCigCurrentCntr).ENO;
END_NETWORK
NETWORK TITLE: "Reset Day Counter"
  HMI_Var.Mach1.PRDDayCounterReset_01 R= MOVE(EN := MOVE(EN := HMI_Var.Mach1.PRDDayCounterReset_01, 0, => HMI_Var.Mach1.PRDWrapDayCounter).ENO, 0, => HMI_Var.Mach1.PRDCigDayCounter).ENO;
END_NETWORK
NETWORK TITLE: "Reset Current Counter"
  HMI_Var.Mach1.PRDDayCounterReset R= MOVE(EN := MOVE(EN := HMI_Var.Mach1.PRDDayCounterReset, 0, => HMI_Var.Mach1.PRDWrapCurrentCntr).ENO, 0, => HMI_Var.Mach1.PRDCigCurrentCntr).ENO;
END_NETWORK
NETWORK
  PRG_AlarmsToDWord(EN := TRUE);
END_NETWORK

END_PROGRAM
