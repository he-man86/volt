PROGRAM MACH_HMI_Control
VAR
	
END_VAR

(* Status *)
g_sHMI_Mach_UnitStatus.nActState			:= g_sMACH.MCL.nStepCounter;

IF	g_sMACH.ERH.bError234Active
THEN
	g_sHMI_Mach_UnitStatus.nActState := 10;
END_IF

IF g_sMACH.ERH.bErrorCategory4 THEN
	g_HMI_MachCommand.bTestMode := FALSE;
END_IF

g_sHMI_Mach_UnitStatus.dwCat1_Error					:= g_sMACH.ERR.dwCat1_Error;
g_sHMI_Mach_UnitStatus.dwCat2_Error					:= g_sMACH.ERR.dwCat2_Error;
g_sHMI_Mach_UnitStatus.dwCat3_Error					:= g_sMACH.ERR.dwCat3_Error;
g_sHMI_Mach_UnitStatus.dwCat4_Error_a				:= g_sMACH.ERR.dwCat4_Error_a;
g_sHMI_Mach_UnitStatus.dwCat4_Error_b				:= g_sMACH.ERR.dwCat4_Error_b;
g_sHMI_Mach_UnitStatus.dwCat4_Error_c				:= g_sMACH.ERR.dwCat4_Error_c;
                                                	
g_sHMI_Mach_UnitStatus.bErrorActiv					:= g_sMACH.ERH.bError234Active;
g_sHMI_Mach_UnitStatus.bWarningActiv				:= g_sMACH.ERH.bErrorCategory1 OR g_sHMI_Mach_UnitStatus.bErrorActiv;
g_sHMI_Mach_UnitStatus.bStateAutomatic 				:= g_sMACH.MCL.nStepCounter = StateAutomatic;
g_sHMI_Mach_UnitStatus.bHomingDone					:= g_bHomingDone;
g_sHMI_Mach_UnitStatus.bProcessBusy					:= g_sMACH.aut.bProcessBusy;
g_sHMI_Mach_UnitStatus.bScanModeBusy				:= g_HMI_MachCommand.bScanMode;
g_sHMI_Mach_UnitStatus.bEmergencyStop				:= NOT g_bDI_ES_DirectOK;
													//OR NOT g_bDI_LightCurtainOK;
                                                	
g_sHMI_Mach_UnitStatus.dwAGM1_PowerLoss				:= g_dwAGM1_PowerLoss;
g_sHMI_Mach_UnitStatus.rAGM1_Frequency				:= g_rAGM1_Frequency;

(* Positions *)
g_sHMI_Mach_UnitStatus.dnActualPosDrive_X			:= REAL_TO_DINT(g_uStatus_X_Axis.lrActPosition);
g_sHMI_Mach_UnitStatus.dnActualPosDrive_Y			:= REAL_TO_DINT(g_uStatus_Y_Axis.lrActPosition);
g_sHMI_Mach_UnitStatus.dnActualPosDrive_Front		:= REAL_TO_DINT(g_uStatus_Front_Axis.lrActPosition);
g_sHMI_Mach_UnitStatus.dnActualPosDrive_Rear		:= REAL_TO_DINT(g_uStatus_Rear_Axis.lrActPosition);
g_sHMI_Mach_UnitStatus.dnActualPosDrive_Z			:= REAL_TO_DINT(g_uStatus_Z_Axis.lrActPosition);
g_sHMI_Mach_UnitStatus.dnActualPosDrive_R			:=g_uStatus_R_Axis.lrActPosition;

(* Enable Start button *)
g_sHMI_Mach_UnitStatus.wButtonStatus.0				:=	g_sHMI_Mach_UnitStatus.nActState = StateWaitForInit
													OR	g_sHMI_Mach_UnitStatus.nActState = StateWaitForAutomatic
													OR	(g_sHMI_Mach_UnitStatus.nActState = StateAutomatic AND g_sMACH.MCL.bHoldOnRequest);
(* Enable Pause button *)
g_sHMI_Mach_UnitStatus.wButtonStatus.1				:= (g_sHMI_Mach_UnitStatus.nActState = StateAutomatic AND NOT g_sMACH.MCL.bHoldOnRequest);
(* Enable Stop button *)
g_sHMI_Mach_UnitStatus.wButtonStatus.2				:= (g_sHMI_Mach_UnitStatus.nActState = StateAutomatic AND NOT g_sMACH.MCL.bStopEndOfCycle);
(* g_HMI_dwButtonStatus.3	:= gMachConfig.bPneumaticRaxis used for visible SetRef R-axis button *)
(* Enable Cleaning mode button *)
g_sHMI_Mach_UnitStatus.wButtonStatus.4				:=	g_sHMI_Mach_UnitStatus.nActState = StateWaitForRecipe
													OR	g_sHMI_Mach_UnitStatus.nActState = StateWaitForAutomatic;
(* g_HMI_dwButtonStatus.5	used for visible SetRef X-axis button *)

(* Visible van Y richting aantal stukken*)
g_sHMI_MACH_UnitStatus.wButtonStatus.6 	:= g_HMI_RCP_Parameters.nProductType <> Prod_Slab_Rectangle_2x1;

(* Enable Clean once button *)
g_sHMI_Mach_UnitStatus.wButtonStatus.7		:=		g_sHMI_Mach_UnitStatus.nActState = StateWaitForInit
												OR	g_sHMI_Mach_UnitStatus.nActState = StateWaitForAutomatic
												OR	(g_sHMI_Mach_UnitStatus.nActState = StateAutomatic AND g_sMACH.MCL.bHoldOnRequest)
												OR NOT gMachConfig.bCleaningUnit;

(*REDCASE BITS*)
(*Prepare machine*)
g_sHMI_Mach_UnitStatus.wButtonStatus.8		:= g_HMI_MachCommand.bScanMode AND g_sHMI_Mach_UnitStatus.nActState <> StateAutomatic  AND NOT  g_sHMI_Mach_UnitStatus.bScanFinished;;
(*Scan busy*)
g_sHMI_Mach_UnitStatus.wButtonStatus.9		:= g_HMI_MachCommand.bScanMode AND g_sHMI_Mach_UnitStatus.nActState = StateAutomatic AND NOT  g_sHMI_Mach_UnitStatus.bScanFinished;
(*Scan ready but uploading*)												
g_sHMI_Mach_UnitStatus.wButtonStatus.10		:= g_HMI_MachCommand.bScanMode AND g_sHMI_Mach_UnitStatus.bScanFinished;
(*Please leave screen*)
g_sHMI_Mach_UnitStatus.wButtonStatus.11		:= NOT g_HMI_MachCommand.bScanMode;

(*Tray product*)
g_sHMI_Mach_UnitStatus.wButtonStatus.12		:= (g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x1
											OR g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x2
											OR g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_2x1
											OR g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x4)
											AND gMachConfig.bCrashDetection;
								
(* IO visualisation *)
g_sHMI_Mach_UnitStatus.wInputs_Modul0_1	:= g_byInputs_Module_00 + 256 * g_byInputs_Module_01;
g_sHMI_Mach_UnitStatus.wInputs_Modul2_3	:= g_byInputs_Module_02 + 256 * g_byInputs_Module_03;
g_sHMI_Mach_UnitStatus.wInputs_Modul4_5	:= g_byInputs_Module_04 + 256 * g_byInputs_Module_05;
g_sHMI_Mach_UnitStatus.wOutputs_Modul0_1:= g_byOutputs_Module_00 + 256 * g_byOutputs_Module_01;

(*Reset productCounters*)
IF g_HMI_MachCommand.CMD.bResetDayCounter THEN
	g_sHMI_CountersDay.dnProductCountTotal 			:= 0;
	g_sHMI_CountersDay.dnProductCountTrayLarge		:= 0;
	g_sHMI_CountersDay.dnProductCountTraySmall		:= 0;
	g_sHMI_CountersDay.dnProductCountSlabSquare		:= 0;
	g_sHMI_CountersDay.dnProductCountSlabDiagonal 	:= 0;
	g_sHMI_CountersDay.dnProductCountSlabTriangle 	:= 0;
	g_sHMI_CountersDay.dnProductCountRound 			:= 0;
	g_sHMI_CountersDay.dnProductCountTrayTriple		:= 0;	(* V03.03 *)
END_IF

(* Status light in HMI*)
IF g_sMACH.MCL.nStepCounter >= StateWaitForRecipe THEN
	g_sHMI_Mach_UnitStatus.byStatusInit := 3;
ELSIF g_sMACH.MCL.nStepCounter = StateInit THEN
	g_sHMI_Mach_UnitStatus.byStatusInit := 2;
ELSE
	g_sHMI_Mach_UnitStatus.byStatusInit := 1;
END_IF

(*Triangle choice*)
IF g_HMI_RCP_Parameters.bUseRectanglesForTriangles THEN
	g_sHMI_Mach_UnitStatus.nTrianglesChoice := 2;
ELSIF g_HMI_RCP_Parameters.bUseRectanglesInEight THEN
	g_sHMI_Mach_UnitStatus.nTrianglesChoice := 1;
ELSE
	g_sHMI_Mach_UnitStatus.nTrianglesChoice := 0;
END_IF

(* functions for new Visu *)
g_HMI_RCP_ShowCleaningsettings	:= gMachConfig.bCleaningUnit;
g_HMI_RCP_ShowCrashDetectionSettings := gMachConfig.bCrashDetection;
VisuCutsHandler();
VisuDashboardNotifications();
RecipeChoiceSelector();

IF g_sHMI_Mach_UnitStatus.bEmergencyStop AND NOT(g_HMI_bCloseOverlay) THEN
	g_HMI_bShowOverlay := TRUE;
ELSE
	g_HMI_bShowOverlay := FALSE;
END_IF
IF NOT(g_sHMI_Mach_UnitStatus.bEmergencyStop) THEN
	g_HMI_bCloseOverlay := FALSE;
END_IF

END_PROGRAM
