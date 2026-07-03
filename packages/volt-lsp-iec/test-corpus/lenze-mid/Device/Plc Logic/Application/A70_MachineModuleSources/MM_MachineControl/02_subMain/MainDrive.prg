PROGRAM MainDrive 
VAR_INPUT
END_VAR
VAR
	tInt: INT;
	tMainDriveRun: BOOL;
	tMainDriveJog: BOOL;
END_VAR

VAR_OUTPUT
	oMainDriveRun: BOOL;
	oMainDriveJog: BOOL;
END_VAR

NETWORK 0 LD
  Mach1_AuxData.IEC_TIMERS.TON_DelayAfterDoorsClosed(IN := ((Mach1.GenFlags.DelayAfterEmergStop AND Mach1_Safety.Status.AllDoorsActuallyClosed) AND Mach1_Safety.Status.DoorsOK), PT := T#150MS);
  Mach1_AuxData.DelayAfterDoorsActuallyClosed := Mach1_AuxData.IEC_TIMERS.TON_DelayAfterDoorsClosed.Q;
END_NETWORK
NETWORK 1 LD
  LET en1 := TRUE;
  IF en1 THEN tInt := MOVE(0); END_IF
  LET g1 := ((((TRUE AND Mach1.GenFlags.EnableMainDrive) AND Mach1.GenFlags.ConditionsReadyForOperation) AND NOT Mach1.GenFlags.StopDriveDirect) AND Mach1_AuxData.AllDrivesInLock);
  LET g2 := (g1 AND Mach1.GenFlags.RunAuto);
  LET en2 := (g2 AND Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper);
  IF en2 THEN LET g3 := (Mach1_Data.AUTOSPEED <= 40); END_IF
  LET en3 := (((g2 AND NOT Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper) OR g3) AND NOT HMI_Var.Btn_Cleaning);
  IF en3 THEN tInt := MOVE(Mach1_Data.AUTOSPEED); END_IF
  LET en4 := (g2 AND Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper);
  IF en4 THEN LET g4 := (Mach1_Data.AUTOSPEED > 40); END_IF
  LET en5 := (g4 AND NOT HMI_Var.Btn_Cleaning);
  IF en5 THEN tInt := MOVE(30); END_IF
  LET en6 := (g2 AND HMI_Var.Btn_Cleaning);
  IF en6 THEN tInt := MOVE(6); END_IF
  LET g5 := (g1 AND Mach1.GenFlags.RunMan);
  LET en7 := g5;
  IF en7 THEN tInt := MOVE(Mach1_Data.MANUALSPEED); END_IF
  Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper := (TRUE AND NOT HMI_Var.Test_Prod) RESET;
  tMainDriveRun := g2;
  oMainDriveRun := g2;
  Mach1_Safety.Control.RequestAutoSpeed := g2;
  tMainDriveJog := g5;
  oMainDriveJog := g5;
  Mach1_Safety.Control.RequestManSpeed := g5;
  Mach1_Data.Drives.MainDrive_VM.Control.DriveMasterSpeed := RPM_To_DriveSpeed(TRUE, tInt);
END_NETWORK
NETWORK 2 LD
  Mach1_AuxData.IEC_TIMERS.TON_MainDriveAtProductionSpeed(IN := (TRUE AND tMainDriveRun), PT := T#200MS);
  Mach1_AuxData.IEC_TIMERS.TOFF_MainDriveAtProductionSpeed(IN := Mach1_AuxData.IEC_TIMERS.TON_MainDriveAtProductionSpeed.Q, PT := T#60MS);
  Mach1.GenFlags.StopDriveDirect := TRUE RESET;
  Mach1.GenFlags.DriveIsRunning := ((TRUE AND tMainDriveRun) OR (TRUE AND tMainDriveJog));
  Mach1.GenFlags.DriveAtSpeed := Mach1_AuxData.IEC_TIMERS.TOFF_MainDriveAtProductionSpeed.Q;
END_NETWORK
NETWORK 3 LD
  Mach1_AuxData.IEC_TIMERS.TON_MainDriveBlocked(IN := oMainDriveRun, PT := T#12S);
  LET en1 := Mach1_AuxData.IEC_TIMERS.TON_MainDriveBlocked.Q;
  IF en1 THEN LET g1 := (HMI_Var.Mach1.ActualSpeed < 5); END_IF
  Mach1.GenFlags.StopDriveDirect := (Alarms_V5_1_100(g1, Mach1.GenFlags.StartFlag) AND Mach1_Alarms.Alm040) SET;
END_NETWORK

END_PROGRAM
