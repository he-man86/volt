PROGRAM MachineStateOEE
VAR
END_VAR

NETWORK 0 LD TITLE: "DONE NETWORK 49: State of the machine"
  LET g22 := TRUE;
  LET en1 := (g22 AND (Mach1.GenFlags.MajorAlarm OR Mach1.GenFlags.MinorAlarm));
  IF en1 THEN GVL_OEE_Var.eStatus_States := MOVE(eStates.Aborted); END_IF
  LET g23 := (g22 AND NOT Mach1.GenFlags.MajorAlarm AND NOT Mach1.GenFlags.MinorAlarm);
  LET en2 := (g23 AND NOT Mach1.GenFlags.RunMan AND NOT Mach1.GenFlags.RunAuto);
  IF en2 THEN GVL_OEE_Var.eStatus_States := MOVE(eStates.Stopped); END_IF
  LET en3 := (g23 AND (Mach1.GenFlags.RunMan OR Mach1.GenFlags.RunAuto));
  IF en3 THEN GVL_OEE_Var.eStatus_States := MOVE(eStates.Execute); END_IF
END_NETWORK

END_PROGRAM
