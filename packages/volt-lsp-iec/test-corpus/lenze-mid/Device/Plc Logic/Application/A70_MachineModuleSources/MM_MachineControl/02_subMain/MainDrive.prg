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
(* @volt-implementation LD *)
NETWORK TITLE: "DONE NETWORK 1: Delay after doors closed"
  Mach1_AuxData.DelayAfterDoorsActuallyClosed := Mach1_AuxData.IEC_TIMERS.TON_DelayAfterDoorsClosed(IN := (Mach1.GenFlags.DelayAfterEmergStop AND Mach1_Safety.Status.AllDoorsActuallyClosed AND Mach1_Safety.Status.DoorsOK), PT := T#150MS);
END_NETWORK
NETWORK TITLE: "DONE NETWORK 2: Activating main drive"
  VAR_TEMP g174, g175, g176, g177 : BOOL; END_VAR
  g174 := TRUE;
  MOVE(EN := g174, 0, => tInt);
  Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper R= (g174 AND NOT HMI_Var.Test_Prod);
  g175 := (g174 AND Mach1.GenFlags.EnableMainDrive AND Mach1.GenFlags.ConditionsReadyForOperation AND NOT Mach1.GenFlags.StopDriveDirect AND Mach1_AuxData.AllDrivesInLock);
  g176 := (g175 AND Mach1.GenFlags.RunAuto);
  tMainDriveRun :=
  oMainDriveRun :=
  Mach1_Safety.Control.RequestAutoSpeed := g176;
  MOVE(EN := (PARALLEL(MODE := Sequential, IN := g176, NOT Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper, LE(EN := Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper, Mach1_Data.AUTOSPEED, 40)) AND NOT HMI_Var.Btn_Cleaning), Mach1_Data.AUTOSPEED, => tInt);
  MOVE(EN := (GT(EN := (g176 AND Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper), Mach1_Data.AUTOSPEED, 40) AND NOT HMI_Var.Btn_Cleaning), 30, => tInt);
  MOVE(EN := (g176 AND HMI_Var.Btn_Cleaning), 6, => tInt);
  g177 := (g175 AND Mach1.GenFlags.RunMan);
  tMainDriveJog :=
  oMainDriveJog :=
  Mach1_Safety.Control.RequestManSpeed := g177;
  MOVE(EN := g177, Mach1_Data.MANUALSPEED, => tInt);
  RPM_To_DriveSpeed(iEN := g174, iRPM := tInt, oDriveSpeed => Mach1_Data.Drives.MainDrive_VM.Control.DriveMasterSpeed);
END_NETWORK
NETWORK TITLE: "DONE NETWORK 3 : DriveIsRunning flag"
  VAR_TEMP g96 : BOOL; END_VAR
  g96 := TRUE;
  Mach1.GenFlags.StopDriveDirect R= g96;
  Mach1.GenFlags.DriveIsRunning := (g96 AND (tMainDriveRun OR tMainDriveJog));
  Mach1.GenFlags.DriveAtSpeed := Mach1_AuxData.IEC_TIMERS.TOFF_MainDriveAtProductionSpeed(IN := Mach1_AuxData.IEC_TIMERS.TON_MainDriveAtProductionSpeed(IN := (g96 AND tMainDriveRun), PT := T#200MS), PT := T#60MS);
END_NETWORK
NETWORK TITLE: "DONE NETWORK 4: Alarm: Main drive blocked"
  Mach1.GenFlags.StopDriveDirect S= (Alarms_V5_1_100(AlarmDB := Mach1_Alarms, iCond := LT(EN := Mach1_AuxData.IEC_TIMERS.TON_MainDriveBlocked(IN := oMainDriveRun, PT := T#12S), HMI_Var.Mach1.ActualSpeed, 5), iReset := Mach1.GenFlags.StartFlag, iAlm := Mach1_Alarms.Alm040, ioAction := Mach1.GenFlags.MinorAlarm) AND Mach1_Alarms.Alm040);
END_NETWORK
NETWORK TITLE: "DONE NETWORK 5: Manual brakerelease" DISABLED
  VAR_TEMP g180 : BOOL; END_VAR
  g180 := TRUE;
  LST_InputsOutputs.Q101_0_REL_release_brake := (g180 AND Mach1_Alarms.Alm001 AND HMI_Var.ReleaseBrake);
  HMI_Var.ReleaseBrake R= (g180 AND (NOT Mach1_Alarms.Alm001 OR (Mach1_Alarms.Alm001 AND NOT Mach1.GenFlags.StartFlag)));
END_NETWORK

END_PROGRAM
