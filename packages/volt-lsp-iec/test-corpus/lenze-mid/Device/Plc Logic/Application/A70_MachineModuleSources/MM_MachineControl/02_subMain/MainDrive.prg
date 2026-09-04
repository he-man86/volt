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

NETWORK 0 LD TITLE: "DONE NETWORK 1: Delay after doors closed"
  Mach1_AuxData.DelayAfterDoorsActuallyClosed := Mach1_AuxData.IEC_TIMERS.TON_DelayAfterDoorsClosed(IN := (Mach1.GenFlags.DelayAfterEmergStop AND Mach1_Safety.Status.AllDoorsActuallyClosed AND Mach1_Safety.Status.DoorsOK), PT := T#150MS);
END_NETWORK
NETWORK 1 LD TITLE: "DONE NETWORK 2: Activating main drive"
  LET g174 := TRUE;
  LET en1 := g174;
  IF en1 THEN tInt := MOVE(0); END_IF
  Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper R= (g174 AND NOT HMI_Var.Test_Prod);
  LET g175 := (g174 AND Mach1.GenFlags.EnableMainDrive AND Mach1.GenFlags.ConditionsReadyForOperation AND NOT Mach1.GenFlags.StopDriveDirect AND Mach1_AuxData.AllDrivesInLock);
  LET g176 := (g175 AND Mach1.GenFlags.RunAuto);
  LET g1 := g176;
  tMainDriveRun := g1;
  oMainDriveRun := g1;
  Mach1_Safety.Control.RequestAutoSpeed := g1;
  LET en2 := Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper;
  IF en2 THEN (Mach1_Data.AUTOSPEED <= 40); END_IF
  LET en3 := ((g176 AND (NOT Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper OR en2)) AND NOT HMI_Var.Btn_Cleaning);
  IF en3 THEN tInt := MOVE(Mach1_Data.AUTOSPEED); END_IF
  LET en4 := (g176 AND Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper);
  IF en4 THEN (Mach1_Data.AUTOSPEED > 40); END_IF
  LET en5 := (en4 AND NOT HMI_Var.Btn_Cleaning);
  IF en5 THEN tInt := MOVE(30); END_IF
  LET en6 := (g176 AND HMI_Var.Btn_Cleaning);
  IF en6 THEN tInt := MOVE(6); END_IF
  LET g177 := (g175 AND Mach1.GenFlags.RunMan);
  LET g2 := g177;
  tMainDriveJog := g2;
  oMainDriveJog := g2;
  Mach1_Safety.Control.RequestManSpeed := g2;
  LET en7 := g177;
  IF en7 THEN tInt := MOVE(Mach1_Data.MANUALSPEED); END_IF
  RPM_To_DriveSpeed(g174, tInt, oDriveSpeed => Mach1_Data.Drives.MainDrive_VM.Control.DriveMasterSpeed);
END_NETWORK
NETWORK 2 LD TITLE: "DONE NETWORK 3 : DriveIsRunning flag"
  LET g96 := TRUE;
  Mach1.GenFlags.StopDriveDirect R= g96;
  Mach1.GenFlags.DriveIsRunning := (g96 AND (tMainDriveRun OR tMainDriveJog));
  Mach1.GenFlags.DriveAtSpeed := Mach1_AuxData.IEC_TIMERS.TOFF_MainDriveAtProductionSpeed(IN := Mach1_AuxData.IEC_TIMERS.TON_MainDriveAtProductionSpeed(IN := (g96 AND tMainDriveRun), PT := T#200MS), PT := T#60MS);
END_NETWORK
NETWORK 3 LD TITLE: "DONE NETWORK 4: Alarm: Main drive blocked"
  LET en1 := Mach1_AuxData.IEC_TIMERS.TON_MainDriveBlocked(IN := oMainDriveRun, PT := T#12S);
  IF en1 THEN (HMI_Var.Mach1.ActualSpeed < 5); END_IF
  Mach1.GenFlags.StopDriveDirect S= (Alarms_V5_1_100(Mach1_Alarms, en1, Mach1.GenFlags.StartFlag, Mach1_Alarms.Alm040, Mach1.GenFlags.MinorAlarm) AND Mach1_Alarms.Alm040);
END_NETWORK
NETWORK 4 LD TITLE: "DONE NETWORK 5: Manual brakerelease" DISABLED
  LET g180 := TRUE;
  LST_InputsOutputs.Q101_0_REL_release_brake := (g180 AND Mach1_Alarms.Alm001 AND HMI_Var.ReleaseBrake);
  HMI_Var.ReleaseBrake R= (g180 AND (NOT Mach1_Alarms.Alm001 OR (Mach1_Alarms.Alm001 AND NOT Mach1.GenFlags.StartFlag)));
END_NETWORK

END_PROGRAM
