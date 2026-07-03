PROGRAM fc_Visualisation_HMI
VAR_INPUT
END_VAR
VAR
	tbool: BOOL;
END_VAR

NETWORK 0 LD
END_NETWORK
NETWORK 1 LD
END_NETWORK
NETWORK 2 LD
END_NETWORK
NETWORK 3 LD
  tbool := (Alarms_V5_1_100(((Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop) AND NOT Mach1_Safety.Status.Door_switch01), True, Mach1_Alarms.Alm083) OR Alarms_V5_1_100(((Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop) AND NOT Mach1_Safety.Status.Door_switch02), True, Mach1_Alarms.Alm084) OR Alarms_V5_1_100(((Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop) AND NOT Mach1_Safety.Status.Door_switch03), True, Mach1_Alarms.Alm085) OR Alarms_V5_1_100(((Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop) AND NOT Mach1_Safety.Status.Door_switch04), True, Mach1_Alarms.Alm086) OR Alarms_V5_1_100(((Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop) AND NOT Mach1_Safety.Status.Door_switch05), True, Mach1_Alarms.Alm087));
END_NETWORK
NETWORK 4 LD
  tbool := (Alarms_V5_1_100(((Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop) AND NOT Mach1_Safety.Status.Door_switch06), True, Mach1_Alarms.Alm088) OR Alarms_V5_1_100(((Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop) AND NOT Mach1_Safety.Status.Door_switch07), True, Mach1_Alarms.Alm089) OR Alarms_V5_1_100(((Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop) AND NOT Mach1_Safety.Status.Door_switch08), True, Mach1_Alarms.Alm090) OR Alarms_V5_1_100(((Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop) AND NOT Mach1_Safety.Status.Door_switch09), True, Mach1_Alarms.Alm091) OR Alarms_V5_1_100(((Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop) AND NOT Mach1_Safety.Status.Door_switch10), True, Mach1_Alarms.Alm092));
END_NETWORK
NETWORK 5 LD
  tbool := (Alarms_V5_1_100(((Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop) AND NOT Mach1_Safety.Status.Door_switch14), True, Mach1_Alarms.Alm093) OR Alarms_V5_1_100(((Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop) AND NOT Mach1_Safety.Status.Door_switch15), True, Mach1_Alarms.Alm094) OR Alarms_V5_1_100(((Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop) AND NOT Mach1_Safety.Status.Door_switch16), True, Mach1_Alarms.Alm095) OR Alarms_V5_1_100(((Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop) AND NOT Mach1_Safety.Status.Door_switch11), True, Mach1_Alarms.Alm070) OR Alarms_V5_1_100(((Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop) AND NOT Mach1_Safety.Status.Door_switch12), True, Mach1_Alarms.Alm071));
END_NETWORK
NETWORK 6 LD
END_NETWORK
NETWORK 7 LD
  tbool := (Alarms_V5_1_100(((Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop) AND LST_InputsOutputs.I100_3_Selector_switch_auto_manual_OP0a), True, Mach1_Alarms.Alm018) OR Alarms_V5_1_100(((Mach1_AuxData.MIDS_Active AND Mach1.Genflags.DelayAfterEmergStop) AND LST_InputsOutputs.I132_3_SW_Auto_Man), True, Mach1_Alarms.Alm019));
END_NETWORK
NETWORK 8 LD
  LET en1 := HMI_Var.ResetAlarmLogging;
  IF en1 THEN LET g1 := Alarms_ResetAlarmLogging(); END_IF
  HMI_Var.ResetAlarmLogging := en1 RESET;
END_NETWORK
NETWORK 9 LD
  LET en1 := HMI_Var.Mach1.PRDCounterIncr;
  IF en1 THEN HMI_Var.Mach1.PRDTotalCounter := (HMI_Var.Mach1.PRDTotalCounter + 1); END_IF
  LET en2 := en1;
  IF en2 THEN HMI_Var.Mach1.PRDCigDayCounter := (HMI_Var.Mach1.PRDCigDayCounter + 1); END_IF
  LET en3 := en2;
  IF en3 THEN HMI_Var.Mach1.PRDCigCurrentCntr := (HMI_Var.Mach1.PRDCigCurrentCntr + 1); END_IF
  HMI_Var.Mach1.PRDCounterIncr := en3 RESET;
END_NETWORK
NETWORK 10 LD
  LET en1 := HMI_Var.Mach1.PRDDayCounterReset_01;
  IF en1 THEN HMI_Var.Mach1.PRDWrapDayCounter := MOVE(0); END_IF
  LET en2 := en1;
  IF en2 THEN HMI_Var.Mach1.PRDCigDayCounter := MOVE(0); END_IF
  HMI_Var.Mach1.PRDDayCounterReset_01 := en2 RESET;
END_NETWORK
NETWORK 11 LD
  LET en1 := HMI_Var.Mach1.PRDDayCounterReset;
  IF en1 THEN HMI_Var.Mach1.PRDWrapCurrentCntr := MOVE(0); END_IF
  LET en2 := en1;
  IF en2 THEN HMI_Var.Mach1.PRDCigCurrentCntr := MOVE(0); END_IF
  HMI_Var.Mach1.PRDDayCounterReset := en2 RESET;
END_NETWORK
NETWORK 12 LD
  LET en1 := TRUE;
  IF en1 THEN LET g1 := PRG_AlarmsToDWord(); END_IF
END_NETWORK

END_PROGRAM
