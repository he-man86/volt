PROGRAM fc_Visualisation_HMI
VAR_INPUT
END_VAR
VAR
	tbool: BOOL;
END_VAR

NETWORK 0 LD TITLE: "NETWORK 5: (P1) Visualisation - emergency stop"
  Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.MIDS_Active AND NOT Mach1_Safety.Status.Emergency_button01), True, Mach1_Alarms.Alm080, Mach1.GenFlags.warning);
END_NETWORK
NETWORK 1 LD TITLE: "NETWORK 5: (P2) Visualisation - emergency stop"
  Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.MIDS_Active AND NOT Mach1_Safety.Status.Emergency_button02), True, Mach1_Alarms.Alm081, Mach1.GenFlags.warning);
END_NETWORK
NETWORK 2 LD TITLE: "NETWORK 5: (P3) Visualisation - emergency stop"
  Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.MIDS_Active AND NOT Mach1_Safety.Status.Emergency_button04), True, Mach1_Alarms.Alm082, Mach1.GenFlags.warning);
END_NETWORK
NETWORK 3 LD TITLE: "DONE NETWORK 5 (p2): Visualisation - doors"
  tbool := (Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch01), True, Mach1_Alarms.Alm083, Mach1.GenFlags.warning) OR Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch02), True, Mach1_Alarms.Alm084, Mach1.GenFlags.warning) OR Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch03), True, Mach1_Alarms.Alm085, Mach1.GenFlags.warning) OR Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch04), True, Mach1_Alarms.Alm086, Mach1.GenFlags.warning) OR Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch05), True, Mach1_Alarms.Alm087, Mach1.GenFlags.warning));
END_NETWORK
NETWORK 4 LD
  tbool := (Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch06), True, Mach1_Alarms.Alm088, Mach1.GenFlags.warning) OR Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch07), True, Mach1_Alarms.Alm089, Mach1.GenFlags.warning) OR Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch08), True, Mach1_Alarms.Alm090, Mach1.GenFlags.warning) OR Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch09), True, Mach1_Alarms.Alm091, Mach1.GenFlags.warning) OR Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch10), True, Mach1_Alarms.Alm092, Mach1.GenFlags.warning));
END_NETWORK
NETWORK 5 LD
  tbool := (Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch14), True, Mach1_Alarms.Alm093, Mach1.GenFlags.warning) OR Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch15), True, Mach1_Alarms.Alm094, Mach1.GenFlags.warning) OR Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch16), True, Mach1_Alarms.Alm095, Mach1.GenFlags.warning) OR Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch11), True, Mach1_Alarms.Alm070, Mach1.GenFlags.warning) OR Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch12), True, Mach1_Alarms.Alm071, Mach1.GenFlags.warning));
END_NETWORK
NETWORK 6 LD
  Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND NOT Mach1_Safety.Status.Door_switch13), True, Mach1_Alarms.Alm072, Mach1.GenFlags.warning);
END_NETWORK
NETWORK 7 LD
  tbool := (Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND LST_InputsOutputs.I100_3_Selector_switch_auto_manual_OP0a), True, Mach1_Alarms.Alm018, Mach1.GenFlags.warning) OR Alarms_V5_1_100(Mach1_Alarms, (Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop AND LST_InputsOutputs.I132_3_SW_Auto_Man), True, Mach1_Alarms.Alm019, Mach1.GenFlags.warning));
END_NETWORK
NETWORK 8 LD TITLE: "Reset of alarmlogging"
  LET en1 := HMI_Var.ResetAlarmLogging;
  IF en1 THEN HMI_Var.ResetAlarmLogging R= Alarms_ResetAlarmLogging(Mach1_Alarms); END_IF
END_NETWORK
NETWORK 9 LD TITLE: "Adding product counters"
  LET en1 := HMI_Var.Mach1.PRDCounterIncr;
  IF en1 THEN HMI_Var.Mach1.PRDTotalCounter := (HMI_Var.Mach1.PRDTotalCounter + 1); END_IF
  LET en2 := en1;
  IF en2 THEN HMI_Var.Mach1.PRDCigDayCounter := (HMI_Var.Mach1.PRDCigDayCounter + 1); END_IF
  LET en3 := en2;
  IF en3 THEN HMI_Var.Mach1.PRDCigCurrentCntr := (HMI_Var.Mach1.PRDCigCurrentCntr + 1); END_IF
  HMI_Var.Mach1.PRDCounterIncr R= en3;
END_NETWORK
NETWORK 10 LD TITLE: "Reset Day Counter"
  LET en1 := HMI_Var.Mach1.PRDDayCounterReset_01;
  IF en1 THEN HMI_Var.Mach1.PRDWrapDayCounter := MOVE(0); END_IF
  LET en2 := en1;
  IF en2 THEN HMI_Var.Mach1.PRDCigDayCounter := MOVE(0); END_IF
  HMI_Var.Mach1.PRDDayCounterReset_01 R= en2;
END_NETWORK
NETWORK 11 LD TITLE: "Reset Current Counter"
  LET en1 := HMI_Var.Mach1.PRDDayCounterReset;
  IF en1 THEN HMI_Var.Mach1.PRDWrapCurrentCntr := MOVE(0); END_IF
  LET en2 := en1;
  IF en2 THEN HMI_Var.Mach1.PRDCigCurrentCntr := MOVE(0); END_IF
  HMI_Var.Mach1.PRDDayCounterReset R= en2;
END_NETWORK
NETWORK 12 LD
  LET en1 := TRUE;
  IF en1 THEN PRG_AlarmsToDWord(); END_IF
END_NETWORK

END_PROGRAM
