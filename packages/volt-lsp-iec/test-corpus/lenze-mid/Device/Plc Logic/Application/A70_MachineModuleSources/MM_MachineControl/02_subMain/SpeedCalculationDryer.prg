PROGRAM SpeedCalculationDryer
VAR_INPUT
END_VAR
VAR
	TempI: INT;
	cor_DenumI: INT:=1;
	cor_NumI: INT:=1;
	cor_DenumDI: DINT:=1;
	cor_NumDI: DINT:=1;
	Speed01rpm: INT;
	tSetHighSpeedCycles : BOOL;
	cor_Const: INT;
	R_TRIG_0: R_TRIG;
	MainDrive_AutoSpeed01rpm: INT;
	Mach_ActSpeed_Rpm01:INT;
	devAngle: INT;
	
	
END_VAR

NETWORK 0 LD TITLE: "NETWORK 1 : Speed control transport system dryer"
  LET g185 := True;
  LET en1 := g185;
  IF en1 THEN TempI := MOVE(0); END_IF
  LET en2 := g185;
  IF en2 THEN MainDrive_AutoSpeed01rpm := (Mach1_Data.AUTOSPEED * 10); END_IF
  LET en3 := g185;
  IF en3 THEN Droger_Data.Cor_denumerator := MOVE(MainDrive_AutoSpeed01rpm); END_IF
  LET g186 := (g185 AND True);
  LET en4 := (Mach1_AuxData.IEC_TIMERS.TON_DelayIdling(IN := (g186 AND NOT Mach1.GenFlags.DriveIsRunning), PT := T#500MS) AND NOT Mach1_Alarms.Alm049);
  IF en4 THEN Mach_ActSpeed_Rpm01 := MOVE(MainDrive_AutoSpeed01rpm); END_IF
  LET en5 := en4;
  IF en5 THEN Droger_Data.Cor_numerator := MOVE(MainDrive_AutoSpeed01rpm); END_IF
  LET en6 := (g186 AND (Mach1.GenFlags.DriveIsRunning OR NOT Mach1_AuxData.IEC_TIMERS.TON_DelayIdling.Q));
  IF en6 THEN Mach_ActSpeed_Rpm01 := MOVE(HMI_Var.Mach1.ActualSpeed*10); END_IF
  LET g187 := (g186 AND True);
  LET g188 := (g187 AND Trayfiller_Data.commInterface.HoldFeedFwd);
  LET en7 := (g188 AND (LST_InputsOutputs.I133_1_PROX_zero_position_transport_ADS OR Mach1_AuxData.ADS_StopOnZeroPulse));
  IF en7 THEN Droger_Data.Cor_numerator := MOVE(750); END_IF
  LET en8 := Mach1_AuxData.Edge.Osr_SetCounter(CLK := (g188 AND Trayfiller_Data.commInterface.Permission));
  IF en8 THEN Mach1_AuxData.CounterHighSpeedATF_ADS := MOVE(5); END_IF
  LET en9 := (g187 AND Trayfiller_Data.commInterface.Permission);
  IF en9 THEN (Mach1_AuxData.CounterHighSpeedATF_ADS <> 0); END_IF
  LET en10 := en9;
  IF en10 THEN Droger_Data.Cor_numerator := (Mach1_Data.AUTOSPEED * 13); END_IF
  LET en11 := g186;
  IF en11 THEN
  EXECUTE
cor_NumDI:=Droger_Data.Cor_numerator;
cor_DenumDI:=Droger_Data.Cor_denumerator;
//cor_NumDI:=1;
//cor_DenumDI:=1;
HMI_Var.Mach1.ActualSpeedDryer:=(Mach_ActSpeed_Rpm01*cor_numDI)/cor_denumdi;
Mach1_Data.Drives.FeedForwardADS.Control.AutoSpeed:=REAL_TO_INT(0.9*dint_to_real(HMI_Var.Mach1.ActualSpeedDryer)*6/10);
  END_EXECUTE
  END_IF
END_NETWORK
NETWORK 1 LD TITLE: "NETWORK 2: Deviation calculation of sync point, transport system trayfiller"
  // Principle: It's better to accelerate the drive then to decelerate, because otherwise cigars could be missed. 
  // So that is why the deceleration should be kept short, by trial and error the optimum point is 60degrees (difference between setpoint and actual point).
  // dev: [0-60]: dec.
  // dev: ]60-360]: acc.
  // 
  // Numerator = (Act_syncpos -/- Gew_syncpos) + Cte
  // Cte=little bit slower then the value for the set speed. (If the mid-s rotates 100rpm (value=1000), then this value should be a little less (e.g 99,8rpm).
  //         This way, the system lags a little bit, and therefor needs to accelerate (which is beter). If the system leads, then it needs to decel. (which is not ideal)
  // 
  // Uit metingen is gebleken dat de optimale synchronisatiepositie op 60 graden 
  // ligt.
  // 
  // correctie  -60     0     60     120    180    240    300
  //             |------|------|------|------|------|------|--
  // encoder     0     60     120    180    240    300    360
  // 
  // Om de ingestelde synchronisatiepositie te verschuiven naar het optimale window 
  // van -60..300 wordt de correctiefactor gecorrigeerd:
  //  - indien correctie < -60 dan 360 erbij optellen
  //  - indien correctie > 300 dan 360 eraf tellen
  LET en1 := Mach1.GenFlags.DriveIsRunning;
  IF en1 THEN devAngle := (Droger_Data.Act_sync_pos - Droger_Data.set_sync_pos); END_IF
  LET en2 := en1;
  IF en2 THEN cor_Const := (MainDrive_AutoSpeed01rpm - 2); END_IF
  LET en3 := en2;
  IF en3 THEN Droger_Data.Cor_numerator := (devAngle + cor_Const); END_IF
  LET g4 := en3;
  LET en4 := g4;
  IF en4 THEN (devAngle < -60); END_IF
  LET en5 := en4;
  IF en5 THEN Droger_Data.Cor_numerator := (Droger_Data.Cor_numerator + 360); END_IF
  LET en6 := g4;
  IF en6 THEN (devAngle > 300); END_IF
  LET en7 := en6;
  IF en7 THEN Droger_Data.Cor_numerator := (Droger_Data.Cor_numerator - 360); END_IF
END_NETWORK
NETWORK 2 LD
  LET g0 := R_TRIG_0(CLK := LST_InputsOutputs.I133_1_PROX_zero_position_transport_ADS);
  LET en1 := g0;
  IF en1 THEN Droger_Data.Act_sync_pos := MOVE(HMI_Var.Mach1.Position); END_IF
  LET en2 := g0;
  IF en2 THEN Droger_Data.set_sync_pos := MOVE(Mach1_Data.CamControls.FeedforwardDryer_CP.Start); END_IF
  LET en3 := g0;
  IF en3 THEN (Mach1_AuxData.CounterHighSpeedATF_ADS > 0); END_IF
  LET en4 := en3;
  IF en4 THEN Mach1_AuxData.CounterHighSpeedATF_ADS := (Mach1_AuxData.CounterHighSpeedATF_ADS - 1); END_IF
END_NETWORK

END_PROGRAM
