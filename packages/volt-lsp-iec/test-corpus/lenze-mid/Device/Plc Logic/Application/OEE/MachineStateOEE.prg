PROGRAM MachineStateOEE
VAR
END_VAR

NETWORK 0 LD "DONE NETWORK 49: State of the machine"
  LET g22 := TRUE;
  MOVE((g22 AND (Mach1.GenFlags.MajorAlarm OR Mach1.GenFlags.MinorAlarm)), eStates.Aborted);
  LET g23 := (g22 AND NOT Mach1.GenFlags.MajorAlarm AND NOT Mach1.GenFlags.MinorAlarm);
  MOVE((g23 AND NOT Mach1.GenFlags.RunMan AND NOT Mach1.GenFlags.RunAuto), eStates.Stopped);
  MOVE((g23 AND (Mach1.GenFlags.RunMan OR Mach1.GenFlags.RunAuto)), eStates.Execute);
END_NETWORK

END_PROGRAM
