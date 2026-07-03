PROGRAM MachineStateOEE
VAR
END_VAR

NETWORK 0 LD
  LET en1 := ((TRUE AND Mach1.GenFlags.MajorAlarm) OR (TRUE AND Mach1.GenFlags.MinorAlarm));
  IF en1 THEN GVL_OEE_Var.eStatus_States := MOVE(eStates.Aborted); END_IF
  LET g1 := ((TRUE AND NOT Mach1.GenFlags.MajorAlarm) AND NOT Mach1.GenFlags.MinorAlarm);
  LET en2 := ((g1 AND NOT Mach1.GenFlags.RunMan) AND NOT Mach1.GenFlags.RunAuto);
  IF en2 THEN GVL_OEE_Var.eStatus_States := MOVE(eStates.Stopped); END_IF
  LET en3 := ((g1 AND Mach1.GenFlags.RunMan) OR (g1 AND Mach1.GenFlags.RunAuto));
  IF en3 THEN GVL_OEE_Var.eStatus_States := MOVE(eStates.Execute); END_IF
END_NETWORK

END_PROGRAM
