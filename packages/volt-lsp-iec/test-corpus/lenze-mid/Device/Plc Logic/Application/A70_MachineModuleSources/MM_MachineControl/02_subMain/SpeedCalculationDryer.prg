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
  MOVE(g185, 0);
  (g185 * Mach1_Data.AUTOSPEED * 10);
  MOVE(g185, MainDrive_AutoSpeed01rpm);
  LET g186 := (g185 AND True);
  MOVE(MOVE((Mach1_AuxData.IEC_TIMERS.TON_DelayIdling(IN := (g186 AND NOT Mach1.GenFlags.DriveIsRunning), PT := T#500MS) AND NOT Mach1_Alarms.Alm049), MainDrive_AutoSpeed01rpm), MainDrive_AutoSpeed01rpm);
  MOVE((g186 AND (Mach1.GenFlags.DriveIsRunning OR NOT Mach1_AuxData.IEC_TIMERS.TON_DelayIdling.Q)), HMI_Var.Mach1.ActualSpeed*10);
  LET g187 := (g186 AND True);
  LET g188 := (g187 AND Trayfiller_Data.commInterface.HoldFeedFwd);
  MOVE((g188 AND (LST_InputsOutputs.I133_1_PROX_zero_position_transport_ADS OR Mach1_AuxData.ADS_StopOnZeroPulse)), 750);
  MOVE(Mach1_AuxData.Edge.Osr_SetCounter(CLK := (g188 AND Trayfiller_Data.commInterface.Permission)), 5);
  (((g187 AND Trayfiller_Data.commInterface.Permission) <> Mach1_AuxData.CounterHighSpeedATF_ADS <> 0) * Mach1_Data.AUTOSPEED * 13);
  EXECUTE(g186);
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
  LET g4 := (((Mach1.GenFlags.DriveIsRunning - Droger_Data.Act_sync_pos - Droger_Data.set_sync_pos) - MainDrive_AutoSpeed01rpm - 2) + devAngle + cor_Const);
  ((g4 < devAngle < -60) + Droger_Data.Cor_numerator + 360);
  ((g4 > devAngle > 300) - Droger_Data.Cor_numerator - 360);
END_NETWORK
NETWORK 2 LD
  LET g0 := R_TRIG_0(CLK := LST_InputsOutputs.I133_1_PROX_zero_position_transport_ADS);
  MOVE(g0, HMI_Var.Mach1.Position);
  MOVE(g0, Mach1_Data.CamControls.FeedforwardDryer_CP.Start);
  ((g0 > Mach1_AuxData.CounterHighSpeedATF_ADS > 0) - Mach1_AuxData.CounterHighSpeedATF_ADS - 1);
END_NETWORK

END_PROGRAM
