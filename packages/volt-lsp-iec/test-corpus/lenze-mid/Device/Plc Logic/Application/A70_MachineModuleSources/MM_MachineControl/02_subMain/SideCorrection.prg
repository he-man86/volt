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

NETWORK 0 LD TITLE: "Network 1: Averaging of sensorsignal"
  LET i1 := TO_INT(LST_InputsOutputs.IW340_LeafCoverageSensor);
  LET en1 := ;
  IF en1 THEN fc_MeanValue(20, True, i1, db_MeanValuesSideCorrectionSensor.MeasurementValues, oMeanValue => DB_Kantcorrectie.MeasuredValue); END_IF
END_NETWORK
NETWORK 1 LD
  LET g62 := TRUE;
  LET en1 := (g62 AND DB_Kantcorrectie.CopyMeasuredToDark);
  IF en1 THEN DB_Kantcorrectie.DarkValue := MOVE(DB_Kantcorrectie.MeasuredValue); END_IF
  DB_Kantcorrectie.CopyMeasuredToDark R= en1;
  LET en2 := (g62 AND DB_Kantcorrectie.CopyMeasuredToLight);
  IF en2 THEN DB_Kantcorrectie.LightValue := MOVE(DB_Kantcorrectie.MeasuredValue); END_IF
  DB_Kantcorrectie.CopyMeasuredToLight R= en2;
END_NETWORK
NETWORK 2 LD TITLE: "Network 2: Read out inputvalue and calculate correctionvalue"
  LET i1 := REAL_TO_INT(tReal);
  LET en1 := SidecorrectionCalculation(DB_Kantcorrectie.MeasuredValue, DB_Kantcorrectie.Setpoint, -1, DB_Kantcorrectie.LightValue, DB_Kantcorrectie.DarkValue, DB_Kantcorrectie.NoWrapperPercentage, oIntPercentage => DB_Kantcorrectie.Percentage10, oCorrectionValue => DB_Kantcorrectie.MeasuredValueReal, oDeviationNoWrapper => tReal);
  IF en1 THEN DB_Kantcorrectie.DeviationNoWrapper := MOVE(i1); END_IF
END_NETWORK
NETWORK 3 LD TITLE: "Network 3: Determine side-correction value"
  LET g85 := fc_CamC_CP_UDT(, HMI_Var.Mach1.Position, Mach1.GenFlags.Rotflag, Mach1_Data.CamControls.MeasurementForSidecorrection_CP);
  LET en1 := MOVE(DB_Kantcorrectie.MeasuredValueReal);
  IF en1 THEN DB_Kantcorrectie.CopiedValueInt := MOVE(DB_Kantcorrectie.Percentage10); END_IF
  LET g86 := (g85 AND Mach1_AuxData.MemWrapperDetected_ResetLimitedSpeed);
  Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper R= g86;
  Mach1_AuxData.MemWrapperDetected_ResetLimitedSpeed R= g86;
  Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper S= ((LST_InputsOutputs.IW340_LeafCoverageSensor > DB_Kantcorrectie.NoWrapperValue) AND HMI_Var.Test_Prod);
END_NETWORK
NETWORK 4 LD TITLE: "DONE Network 4: In case a limit switch is reached: overwrite values"
  LET g48 := True;
  LET en1 := (g48 AND NOT Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Left_OK AND Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Right_OK);
  IF en1 THEN DB_Kantcorrectie.CopiedValueReal := MOVE(-100.0); END_IF
  LET en2 := MOVE(100.0);
  IF en2 THEN tCorrectionScale := MOVE(-1); END_IF
  LET en3 := MOVE(0.0);
  IF en3 THEN tCorrectionScale := MOVE(1); END_IF
END_NETWORK
NETWORK 5 LD TITLE: "DONE Network 5: Write side-correction values to the servo drive"
  LET en1 := ;
  IF en1 THEN EXECUTE(); END_IF
END_NETWORK
NETWORK 6 LD TITLE: "DONE Network 6 : Manual adjustment of the sidecorrection"
  LET g56 := True;
  Mach1_Data.Drives.SideCorrection_FreeLimit.Control.Jog_LimitToLeft := (g56 AND Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Left_OK AND HMI_Var.Mach1.DTA_PositioningLeft);
  Mach1_Data.Drives.SideCorrection_FreeLimit.Control.Jog_LimitToRight := (g56 AND Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Right_OK AND HMI_Var.Mach1.DTA_PositioningRight);
END_NETWORK

END_PROGRAM
