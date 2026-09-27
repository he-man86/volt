PROGRAM MachineStateOEE
VAR
END_VAR
(* @volt-implementation LD *)
NETWORK TITLE: "DONE NETWORK 49: State of the machine"
  VAR_TEMP g22, g23 : BOOL; END_VAR
  g22 := TRUE;
  MOVE(EN := (g22 AND (Mach1.GenFlags.MajorAlarm OR Mach1.GenFlags.MinorAlarm)), eStates.Aborted, => GVL_OEE_Var.eStatus_States);
  g23 := (g22 AND NOT Mach1.GenFlags.MajorAlarm AND NOT Mach1.GenFlags.MinorAlarm);
  MOVE(EN := (g23 AND NOT Mach1.GenFlags.RunMan AND NOT Mach1.GenFlags.RunAuto), eStates.Stopped, => GVL_OEE_Var.eStatus_States);
  MOVE(EN := (g23 AND (Mach1.GenFlags.RunMan OR Mach1.GenFlags.RunAuto)), eStates.Execute, => GVL_OEE_Var.eStatus_States);
END_NETWORK

END_PROGRAM
