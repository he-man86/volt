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
IMPLEMENTATION LD
NETWORK TITLE: "Network 1: Averaging of sensorsignal"
  fc_MeanValue(EN := , iLength := 20, iAcquireNewValue := True, iNewValue := `TO_INT(LST_InputsOutputs.IW340_LeafCoverageSensor)`, ioValues := db_MeanValuesSideCorrectionSensor.MeasurementValues, oMeanValue => DB_Kantcorrectie.MeasuredValue);
END_NETWORK
NETWORK
  VAR_TEMP g62 : BOOL; END_VAR
  g62 := TRUE;
  DB_Kantcorrectie.CopyMeasuredToDark R= MOVE(EN := (g62 AND DB_Kantcorrectie.CopyMeasuredToDark), DB_Kantcorrectie.MeasuredValue, => DB_Kantcorrectie.DarkValue).ENO;
  DB_Kantcorrectie.CopyMeasuredToLight R= MOVE(EN := (g62 AND DB_Kantcorrectie.CopyMeasuredToLight), DB_Kantcorrectie.MeasuredValue, => DB_Kantcorrectie.LightValue).ENO;
END_NETWORK
NETWORK TITLE: "Network 2: Read out inputvalue and calculate correctionvalue"
  MOVE(EN := SidecorrectionCalculation(EN := MOVE(EN := TRUE, Mach1_Data.Settings.Ints.SideCorrectionScaleFactor, => tCorrectionScale).ENO, iAnalogInputValue := DB_Kantcorrectie.MeasuredValue, iSetpoint := DB_Kantcorrectie.Setpoint, iCorrectionScale := `-1`, iLightValue := DB_Kantcorrectie.LightValue, iDarkValue := DB_Kantcorrectie.DarkValue, iNoWrapperOffsetPercentage01Perc := DB_Kantcorrectie.NoWrapperPercentage, oIntPercentage => DB_Kantcorrectie.Percentage10, oCorrectionValue => DB_Kantcorrectie.MeasuredValueReal, oDeviationNoWrapper => tReal).ENO, `REAL_TO_INT(tReal)`, => DB_Kantcorrectie.DeviationNoWrapper);
END_NETWORK
NETWORK TITLE: "Network 3: Determine side-correction value"
  VAR_TEMP g85, g86 : BOOL; END_VAR
  g85 := fc_CamC_CP_UDT(iEN := , iMachinePosition := HMI_Var.Mach1.Position, iResetFlag := Mach1.GenFlags.Rotflag, ioPulse := Mach1_Data.CamControls.MeasurementForSidecorrection_CP);
  MOVE(EN := MOVE(EN := (g85 AND Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Left_OK AND Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_right_OK), DB_Kantcorrectie.MeasuredValueReal, => DB_Kantcorrectie.CopiedValueReal).ENO, DB_Kantcorrectie.Percentage10, => DB_Kantcorrectie.CopiedValueInt);
  g86 := (g85 AND Mach1_AuxData.MemWrapperDetected_ResetLimitedSpeed);
  Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper R= g86;
  Mach1_AuxData.MemWrapperDetected_ResetLimitedSpeed R= g86;
  Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper S= (GT(EN := SUB(EN := g85, DB_Kantcorrectie.LightValue, DB_Kantcorrectie.DeviationNoWrapper, => DB_Kantcorrectie.NoWrapperValue).ENO, LST_InputsOutputs.IW340_LeafCoverageSensor, DB_Kantcorrectie.NoWrapperValue) AND HMI_Var.Test_Prod);
END_NETWORK
NETWORK TITLE: "DONE Network 4: In case a limit switch is reached: overwrite values"
  VAR_TEMP g48 : BOOL; END_VAR
  g48 := True;
  MOVE(EN := (g48 AND NOT Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Left_OK AND Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Right_OK), `-100.0`, => DB_Kantcorrectie.CopiedValueReal);
  MOVE(EN := MOVE(EN := (g48 AND NOT Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Right_OK AND Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Left_OK), 100.0, => DB_Kantcorrectie.CopiedValueReal).ENO, `-1`, => tCorrectionScale);
  MOVE(EN := MOVE(EN := (g48 AND ((NOT Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Left_OK AND NOT Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Right_OK) OR NOT HMI_Var.Test_Prod OR Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper)), 0.0, => DB_Kantcorrectie.CopiedValueReal).ENO, 1, => tCorrectionScale);
END_NETWORK
NETWORK TITLE: "DONE Network 5: Write side-correction values to the servo drive"
  EXECUTE(EN := )
tReal:=DB_Kantcorrectie.CopiedValueReal*DINT_TO_REAL(tCorrectionScale);
Mach1_Data.Drives.SideCorrection.CAM.Y_Scale_Recipe:=REAL_TO_INT(tReal/(-1000));

  END_EXECUTE;
END_NETWORK
NETWORK TITLE: "DONE Network 6 : Manual adjustment of the sidecorrection"
  VAR_TEMP g56 : BOOL; END_VAR
  g56 := True;
  Mach1_Data.Drives.SideCorrection_FreeLimit.Control.Jog_LimitToLeft := (g56 AND Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Left_OK AND HMI_Var.Mach1.DTA_PositioningLeft);
  Mach1_Data.Drives.SideCorrection_FreeLimit.Control.Jog_LimitToRight := (g56 AND Mach1_Data.Drives.SideCorrection_FreeLimit.Status.Limit_Right_OK AND HMI_Var.Mach1.DTA_PositioningRight);
END_NETWORK

END_PROGRAM
