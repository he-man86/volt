PROGRAM SideCorrection
VAR_INPUT
END_VAR
VAR
	tCorrectionScale			: DINT;
	tCorrectionScaleReal		: REAL;
	tReal						: REAL;
	tDint						: DINT;
	tInt						: INT;

	tbool: BOOL;
END_VAR

NETWORK 0 LD
  LET i1 := TO_INT(LST_InputsOutputs.IW340_LeafCoverageSensor);
  DB_Kantcorrectie.MeasuredValue := fc_MeanValue(20, True, i1);
END_NETWORK
NETWORK 1 LD
  LET en1 := (TRUE AND DB_Kantcorrectie.CopyMeasuredToDark);
  IF en1 THEN DB_Kantcorrectie.DarkValue := MOVE(DB_Kantcorrectie.MeasuredValue); END_IF
  LET en2 := (TRUE AND DB_Kantcorrectie.CopyMeasuredToLight);
  IF en2 THEN DB_Kantcorrectie.LightValue := MOVE(DB_Kantcorrectie.MeasuredValue); END_IF
  DB_Kantcorrectie.CopyMeasuredToDark := en1 RESET;
  DB_Kantcorrectie.CopyMeasuredToLight := en2 RESET;
END_NETWORK
NETWORK 2 LD
  LET i1 := REAL_TO_INT(tReal);
  LET en1 := TRUE;
  IF en1 THEN tCorrectionScale := MOVE(Mach1_Data.Settings.Ints.SideCorrectionScaleFactor); END_IF
  LET en2 := en1;
  IF en2 THEN LET g1 := SidecorrectionCalculation(DB_Kantcorrectie.MeasuredValue, DB_Kantcorrectie.Setpoint, -1, DB_Kantcorrectie.LightValue, DB_Kantcorrectie.DarkValue, DB_Kantcorrectie.NoWrapperPercentage); END_IF
  LET en3 := en2;
  IF en3 THEN DB_Kantcorrectie.DeviationNoWrapper := MOVE(i1); END_IF
  DB_Kantcorrectie.Percentage10 := g1;
  DB_Kantcorrectie.MeasuredValueReal := g1;
  tReal := g1;
END_NETWORK
NETWORK 3 LD
  LET g1 := fc_CamC_CP_UDT(HMI_Var.Mach1.Position, Mach1.GenFlags.Rotflag);
  LET en1 := ((g1 AND Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Left_OK) AND Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_right_OK);
  IF en1 THEN DB_Kantcorrectie.CopiedValueReal := MOVE(DB_Kantcorrectie.MeasuredValueReal); END_IF
  LET en2 := en1;
  IF en2 THEN DB_Kantcorrectie.CopiedValueInt := MOVE(DB_Kantcorrectie.Percentage10); END_IF
  LET g2 := (g1 AND Mach1_AuxData.MemWrapperDetected_ResetLimitedSpeed);
  LET en3 := g1;
  IF en3 THEN DB_Kantcorrectie.NoWrapperValue := (DB_Kantcorrectie.LightValue - DB_Kantcorrectie.DeviationNoWrapper); END_IF
  LET en4 := en3;
  IF en4 THEN LET g3 := (LST_InputsOutputs.IW340_LeafCoverageSensor > DB_Kantcorrectie.NoWrapperValue); END_IF
  Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper := g2 RESET;
  Mach1_AuxData.MemWrapperDetected_ResetLimitedSpeed := g2 RESET;
  Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper := (g3 AND HMI_Var.Test_Prod) SET;
END_NETWORK
NETWORK 4 LD
  LET en1 := ((True AND NOT Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Left_OK) AND Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Right_OK);
  IF en1 THEN DB_Kantcorrectie.CopiedValueReal := MOVE(-100.0); END_IF
  LET en2 := ((True AND NOT Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Right_OK) AND Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Left_OK);
  IF en2 THEN DB_Kantcorrectie.CopiedValueReal := MOVE(100.0); END_IF
  LET en3 := en2;
  IF en3 THEN tCorrectionScale := MOVE(-1); END_IF
  LET en4 := (((True AND NOT Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Left_OK) AND NOT Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Right_OK) OR (True AND NOT HMI_Var.Test_Prod) OR (True AND Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper));
  IF en4 THEN DB_Kantcorrectie.CopiedValueReal := MOVE(0.0); END_IF
  LET en5 := en4;
  IF en5 THEN tCorrectionScale := MOVE(1); END_IF
END_NETWORK
NETWORK 5 LD
  EXECUTE
tReal:=DB_Kantcorrectie.CopiedValueReal*DINT_TO_REAL(tCorrectionScale);
Mach1_Data.Drives.SideCorrection.CAM.Y_Scale_Recipe:=REAL_TO_INT(tReal/(-1000));
  END_EXECUTE
END_NETWORK
NETWORK 6 LD
  Mach1_Data.Drives.SideCorrection_FreeLimit.Control.Jog_LimitToLeft := ((True AND Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Left_OK) AND HMI_Var.Mach1.DTA_PositioningLeft);
  Mach1_Data.Drives.SideCorrection_FreeLimit.Control.Jog_LimitToRight := ((True AND Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Right_OK) AND HMI_Var.Mach1.DTA_PositioningRight);
END_NETWORK

END_PROGRAM
