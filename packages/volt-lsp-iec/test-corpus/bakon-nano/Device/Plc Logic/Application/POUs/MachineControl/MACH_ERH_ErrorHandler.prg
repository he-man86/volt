PROGRAM MACH_ERH_ErrorHandler
VAR
	bSkipFirstTrigger		: BOOL	:= TRUE;
	tBuzzerTimerErr1		:TON;
	tBuzzerTimerErr234	:TON;
	Blinker					:BLINK;
	TON_Pressure		:TON;
	rSizeOfKnife			: REAL;
	rCenterPointKnifeInverted: REAL;
	rLengthOfLineHor: REAL;
	rLengthOfLineVer: REAL;
	bPosXaxisOK		: BOOL;
	bPosYaxisOK		: BOOL;	
	bscandatapending : BOOL;
	
	tonTimeoutHomingDown: TON;
END_VAR

(*************************************************************************
 *
 * Application name			: Snijmachine
 * Module name				: MACH_ERH_ErrorHandler
 * Version number module	: 0.00
 *
 *
 *						Copyright (c) Bakon 2009
 *						Goes, The Netherlands
 *
 *
 * All rights are reserved. Reproduction in whole or in part is prohibited
 * without the written consent of the copyright owner.
 *
 *************************************************************************)

(*************************************************************************
 * HISTORY																					 
 *************************************************************************
 * Update  :																				  
 * Author  :																				  
 * Changes :																				  
 *************************************************************************)

(* initialise signals on g_bFirstCycle *)
IF			g_bFirstCycle
THEN
			g_sMACH.ERH.bErrorCategory1		 := FALSE;
			g_sMACH.ERH.bErrorCategory2		 := FALSE;
			g_sMACH.ERH.bErrorCategory3		 := FALSE;
			g_sMACH.ERH.bErrorCategory4		 := FALSE;
			g_sMACH.ERH.bError234Active		:= FALSE;
			g_sMACH.ERH.bSoundSignalOn	:= FALSE;
END_IF

(* Reset the NOT-self resetting errors *)
IF		g_HMI_MachCommand.CMD.bResetErrorPulse
	OR	g_bFirstCycle
THEN
	g_sMACH.ERR.bEmergencyCircuitNotOK					:= FALSE;
	g_sMACH.ERR.ModusRV_AccDeccZ						:= FALSE;
	g_sMACH.ERR.ModusRV_SpeedZToHigh					:= FALSE;
	g_sMACH.ERR.ModusRV_TargetPosInSWLimits				:= FALSE;
	g_sMACH.ERR.bPressure								:= FALSE;
	g_sMACH.ERR.bErrorComIOStation						:= FALSE;
	g_sMACH.ERR.bTrayTooSmall							:= FALSE;
	g_sMACH.ERR.bR_AxisPositionError					:= FALSE;
	g_sMACH.ERR.bUltrasonic1							:= FALSE;
	g_sMACH.ERR.bAGM1_CommFailure						:= FALSE;
	g_sMACH.ERR.bPieceTooLarge							:= FALSE;
	g_sMACH.ERR.bAxisFrontNotSet						:= FALSE;
	g_sMACH.ERR.bAxisRearNotSet							:= FALSE;
	g_sMACH.ERR.bAxisRNotSet							:= FALSE;
	g_sMACH.ERR.bWrongTable								:= FALSE;
	g_sMACH.ERR.bSlabTooSmall							:= FALSE;
	g_sMACH.ERR.bXYNotEnabled							:= FALSE;
	g_sMACH.ERR.bZNotEnabled							:= FALSE;
	g_sMACH.ERR.bRNotEnabled							:= FALSE;
	g_sMACH.ERR.bServoPowerNOK							:= FALSE;
	g_sMACH.ERR.bTableMovementNotAllowed				:= FALSE;
	g_sMACH.ERR.bRAxisMovementNotAllowed				:= FALSE;
	g_sMACH.ERR.bZAxisMovementNotAllowed				:= FALSE;
	g_smach.ERR.bZHomeSensorTimeout						:= FALSE;
	g_sMACH.ERR.bCrashDetectFault						:= FALSE;
	g_sMACH.ERR.bStackIsFull							:= FALSE;
	g_sMACH.ERR.bStackIsEmpty							:= FALSE;
	g_sMACH.ERR.bMarginsInOvershootCorrectionInvalid	:= FALSE;
	g_sMACH.ERR.bKnifeSettingsIncorrect					:= FALSE;
	g_sMACH.ERR.bIntersectionNotFound					:= FALSE;
	g_sMACH.ERR.bOvershootCorrectionImpossible			:= FALSE;
	g_sMACH.ERR.bOldOvershootCorrectionDiffers			:= FALSE;
	g_sMACH.ERR.bIndexOutOfBoundsWhileCopyingCuts		:= FALSE;
	g_sMACH.ERR.bRoundProductsOverlap					:= FALSE;
	g_sMACH.ERR.bCalcVerError							:= FALSE;
	g_sMACH.ERR.bCalcHorError							:= FALSE;
	g_sMACH.ERR.bCalcDia1Error							:= FALSE;
	g_sMACH.ERR.bCalcDia2Error							:= FALSE;
	g_sMACH.ERR.bXYA_K_WasNotZero						:= FALSE;
	
	bscandatapending 								:= g_bFirstCycle;
END_IF

bscandatapending := bscandatapending AND g_bScanDataPending;
(* NOT-self resetting errors *)
(* Set_your_not_self_resetting_errors_here *)
IF	 NOT g_bDI_ES_DirectOK
THEN
		g_sMACH.ERR.bEmergencyCircuitNotOK := TRUE;
END_IF
IF	ModusRondVierkant.Q_bErrorAccDeccZ
THEN
	g_sMACH.ERR.ModusRV_AccDeccZ	 := TRUE;
END_IF
IF ModusRondVierkant.Q_bErrorSpeedZToHigh
THEN
	g_sMACH.ERR.ModusRV_SpeedZToHigh := TRUE;
END_IF
IF ModusRondVierkant.Q_bErrorTargetPosInSWLimits
THEN
	g_sMACH.ERR.ModusRV_TargetPosInSWLimits := TRUE;
END_IF
TON_Pressure(IN:= (NOT g_bDI_PressureSwitchOK AND g_bDQ_MainValve AND g_bDI_ES_DirectOK), pt:=REAL_TO_TIME(g_HMI_MCH_Parameters.rTimeOutAirvalve * 1000));
IF  TON_Pressure.Q THEN
	g_sMACH.ERR.bPressure := TRUE;
END_IF;

IF NOT g_bDI_Servo_Power_OK THEN
	g_sMACH.ERR.bServoPowerNOK := TRUE;
END_IF

tonTimeoutHomingDown(IN:=g_uStatus_Z_Axis.bHomingBusy AND g_uStatus_Z_Axis.bLimitNeg, PT:=T#3S);
IF tonTimeoutHomingDown.Q THEN
	g_sMACH.ERR.bZHomeSensorTimeout := TRUE;
END_IF
(*TODO: Via ethercat bepalen*)
(*IF g_aCanNodeState[C_NodeRemoteIO].xPdoTimeOut OR g_aCanNodeState[C_NodeRemoteIO].iState <> CanSlave_Operational THEN
IF EPM_S130.
	g_sMACH.ERR.bErrorComIOStation:=TRUE;
END_IF*)

(* Cleaning error *)
bPosXaxisOK := 	(g_uStatus_X_Axis.eStateAxis = L_MC1P_AXIS_STATE.StandStill)
			OR 	(g_uStatus_X_Axis.eStateAxis = L_MC1P_AXIS_STATE.Stopping)
			OR 	(g_uStatus_X_Axis.eStateAxis = L_MC1P_AXIS_STATE.Disabled)
			OR	(g_uStatus_X_Axis.lrActPosition <= C_rXAxis_SafeCleaningPos AND (NOT g_bDI_CleaningContainerDown OR NOT gMachConfig.bCleaningUnit))
			OR	(g_uStatus_X_Axis.lrActPosition <= g_HMI_MCH_Parameters.rCleanXPosStart + 1 AND (g_bDI_CleaningContainerDown OR NOT gMachConfig.bCleaningUnit));
bPosYaxisOK := 	(g_uStatus_Y_Axis.eStateAxis = L_MC1P_AXIS_STATE.StandStill)
			OR	(g_uStatus_Y_Axis.eStateAxis = L_MC1P_AXIS_STATE.Stopping)
			OR	(g_uStatus_Y_Axis.eStateAxis = L_MC1P_AXIS_STATE.Disabled)
			OR	(g_uStatus_X_Axis.lrActPosition < C_rXAxis_SafeCleaningPos AND (NOT g_bDI_CleaningContainerDown OR NOT gMachConfig.bCleaningUnit))		// X-as positie moet altijd OK zijn, ook bij de Y beweging
			OR	(g_uStatus_X_Axis.lrActPosition < g_HMI_MCH_Parameters.rCleanXPosStart + 1 AND (g_bDI_CleaningContainerDown OR NOT gMachConfig.bCleaningUnit));	// X-as positie moet altijd OK zijn, ook bij de Y beweging

IF		//NOT	g_sMACH.MCL.bActInitialise	
			(NOT bPosXaxisOK OR NOT bPosYaxisOK)
	AND		((g_uStatus_Z_Axis.lrActPosition > g_sCalculated.rBottomZPos) OR (NOT g_bDI_CleaningContainerDown AND gMachConfig.bCleaningUnit))
THEN
	g_sMACH.ERR.bTableMovementNotAllowed	:= TRUE;
END_IF

IF		(g_uStatus_Z_Axis.lrActPosition > g_sCalculated.rBottomZPos)
	AND (g_uStatus_R_Axis.eStateAxis <> L_MC1P_AXIS_STATE.StandStill)
	AND (g_uStatus_R_Axis.eStateAxis <> L_MC1P_AXIS_STATE.Disabled)
	AND (g_uStatus_R_Axis.eStateAxis <> L_MC1P_AXIS_STATE.Stopping)
THEN
	g_sMACH.ERR.bRAxisMovementNotAllowed	:= TRUE;
END_IF

IF		(g_uStatus_Z_Axis.lrActPosition > g_sCalculated.rBottomZPos + 1)
	AND	g_uStatus_Z_Axis.bHomePositionAvailable
	AND (g_uStatus_Z_Axis.eStateAxis <> L_MC1P_AXIS_STATE.StandStill)
	AND (g_uStatus_Z_Axis.eStateAxis <> L_MC1P_AXIS_STATE.Disabled)
	AND (g_uStatus_Z_Axis.eStateAxis <> L_MC1P_AXIS_STATE.Stopping)
	AND	NOT g_uControl_Z_Axis.bManualJogNeg 
	AND (g_uControl_Z_Axis.lrPosition <> 0 OR NOT g_uControl_Z_Axis.bPosABSPosition)
	AND ((g_uStatus_R_Axis.lrActPosition > 91.0) OR (g_uStatus_R_Axis.lrActPosition < 89.0) OR (g_uStatus_X_Axis.lrActPosition > g_HMI_MCH_Parameters.rCleanXPosStart + 1))
THEN
	g_sMACH.ERR.bZAxisMovementNotAllowed	:= TRUE;
END_IF

rSizeOfKnife				:= g_HMI_MCH_Parameters.rSizeOfKnife;
rCenterPointKnifeInverted	:= rSizeOfKnife/2;

(* Self resetting errors *)
(* Assign_your_self_resetting_errors_here (error := problem) *)
(* Check if machine parameters are not corrupted *)
g_sMACH.ERR.bZStrokeKnifeToBottomRound		:= (g_HMI_MCH_Parameters.rBottomZPosRound > C_LimitKnifeStrokeMax OR g_HMI_MCH_Parameters.rBottomZPosRound < C_LimitKnifeStrokeMin) 
											AND (gProductOption.Prod_Round OR gProductOption.Prod_RoundQuatro);
g_sMACH.ERR.bZStrokeKnifeToBottomSlab		:= (g_HMI_MCH_Parameters.rBottomZPosSlab > C_LimitKnifeStrokeMax OR g_HMI_MCH_Parameters.rBottomZPosSlab < C_LimitKnifeStrokeMin)
											AND	(gProductOption.Prod_SlabDiagonal OR gProductOption.Prod_SlabDouble OR gProductOption.Prod_SlabSquare OR gProductOption.Prod_SlabSquareClamp OR gProductOption.Prod_SlabTriangle);
g_sMACH.ERR.bZStrokeKnifeToBottomTraySmall	:= (g_HMI_MCH_Parameters.rBottomZPosTraySmall > C_LimitKnifeStrokeMax OR g_HMI_MCH_Parameters.rBottomZPosTraySmall < C_LimitKnifeStrokeMin)
											AND (gProductOption.Prod_TraySquareSmall);
g_sMACH.ERR.bZStrokeKnifeToBottomTrayLarge	:= (g_HMI_MCH_Parameters.rBottomZPosTrayLarge > C_LimitKnifeStrokeMax OR g_HMI_MCH_Parameters.rBottomZPosTrayLarge < C_LimitKnifeStrokeMin)
											AND (gProductOption.Prod_TraySquareLarge);
g_sMACH.ERR.bZStrokeKnifeToBottomTrayDouble	:= (g_HMI_MCH_Parameters.rBottomZPosTrayDouble > C_LimitKnifeStrokeMax OR g_HMI_MCH_Parameters.rBottomZPosTrayDouble < C_LimitKnifeStrokeMin)		(* V07.01 *)
											AND (gProductOption.Prod_TraySquareDouble);
g_sMACH.ERR.bRoundCakeTooLarge				:=		g_HMI_RCP_Parameters.rDiameterRound  >= (g_HMI_MCH_Parameters.rMidPosRoundCake1_X - g_HMI_MCH_Parameters.rMidPosRoundCake2_X)
												AND g_HMI_RCP_Parameters.nProductType = Prod_Round_POC_2x1
												AND (g_HMI_RCP_Parameters.nPartsRound <> 0) AND (g_HMI_RCP_Parameters.nPartsRoundRight <> 0);		(* If only one cake is cut, then no error is created *)
g_sMACH.ERR.bRoundCakeTooLarge				:=	g_sMACH.ERR.bRoundCakeTooLarge OR
													g_HMI_RCP_Parameters.rDiameterRound  >= (g_HMI_MCH_Parameters.rMidPosRoundCake13_X - g_HMI_MCH_Parameters.rMidPosRoundCake24_X)
												OR g_HMI_RCP_Parameters.rDiameterRound  >= (g_HMI_MCH_Parameters.rMidPosRoundCake34_Y - g_HMI_MCH_Parameters.rMidPosRoundCake12_Y)
												AND	g_HMI_RCP_Parameters.nProductType = Prod_Round_POC_2x2;

rLengthOfLineHor := g_HMI_RCP_Parameters.rProdLength_InX - g_HMI_RCP_Parameters.rSizeTrimRight - g_HMI_RCP_Parameters.rSizeTrimLeft + (g_HMI_RCP_Parameters.nPartsX * g_HMI_RCP_Parameters.rShiftCompensation);
rLengthOfLineVer := g_HMI_RCP_Parameters.rProdLength_InY - g_HMI_RCP_Parameters.rSizeTrimFront - g_HMI_RCP_Parameters.rSizeTrimRear + (g_HMI_RCP_Parameters.nPartsY * g_HMI_RCP_Parameters.rShiftCompensation);
g_sMACH.ERR.bLengthExceededWithShiftComp	:=		(g_HMI_RCP_Parameters.nProductType = Prod_Slab_Rectangle_1x1)
														AND	(
																(rLengthOfLineHor > (SEL(gMachConfig.bXL,C_rMaxOvershootX,(C_rMaxOvershootX_XL) - g_HMI_MCH_Parameters.rStartPointSlab_X - g_HMI_RCP_Parameters.rSizeTrimRight)))
															OR	(rLengthOfLineVer > (SEL(gMachConfig.bXL,C_rMaxOvershootY,(C_rMaxOvershootY_XL) - g_HMI_MCH_Parameters.rStartPointSlab_Y - g_HMI_RCP_Parameters.rSizeTrimRear))));
g_sMACH.ERR.Z_AxisLimitNeg := g_uStatus_Z_Axis.bLimitNeg;		(* Standard V08.01*)
(* --------------------------------------------------------------------------
 * Assign errors of category 1 (Warnings)
 * -------------------------------------------------------------------------- *)
g_sMACH.ERR.dwCat1_Error.0 := g_sMACH.uINI.bAlmError;
g_sMACH.ERR.dwCat1_Error.1 := EtherCAT_Master.wState <> L_ETC.ETC_STATE_OPERATIONAL;//(g_aCanMasterState[0] <> CanMaster_Operational);
g_sMACH.ERR.dwCat1_Error.2 := g_sMACH.AUT.bAlmError;
g_sMACH.ERR.dwCat1_Error.3 := g_sMACH.MAN.bAlmError;
g_sMACH.ERR.dwCat1_Error.4 := g_sMACH.CLN.bAlmError;
g_sMACH.ERR.dwCat1_Error.5 := FALSE;
g_sMACH.ERR.dwCat1_Error.6 := g_sMACH.ERR.bErrorSetRef_Front_Axis;
g_sMACH.ERR.dwCat1_Error.7 := g_sMACH.ERR.bErrorSetRef_Rear_Axis;
g_sMACH.ERR.dwCat1_Error.8 := g_sMACH.ERR.bErrorSetRef_R_Axis;
g_sMACH.ERR.dwCat1_Error.9 := g_sMACH.ERR.bMaintenanceNecessary;
g_sMACH.ERR.dwCat1_Error.10 := g_sMACH.ERR.bAGM1_CommFailure;
g_sMACH.ERR.dwCat1_Error.11 := g_sMACH.ERR.bPressStartToInit;
g_sMACH.ERR.dwCat1_Error.12 := g_sMACH.ERR.bPressStartToCut AND NOT g_HMI_MachCommand.bScanMode;
g_sMACH.ERR.dwCat1_Error.13 := g_sMACH.ERR.bPressStartForManual;
g_sMACH.ERR.dwCat1_Error.14 := g_sMACH.ERR.bLengthExceededWithShiftComp;
g_sMACH.ERR.dwCat1_Error.15 := g_sMACH.ERR.Z_AxisLimitNeg;
g_sMACH.ERR.dwCat1_Error.16 := g_sMACH.ERR.bOvershootCorrectionImpossible AND g_HMI_MCH_Parameters.bSkipImpossiblePositions; //g_sMACH.ERR.bMessagePosNotPossible;
g_sMACH.ERR.dwCat1_Error.17 := g_sMACH.ERR.bPressStartToCleanInit;
g_sMACH.ERR.dwCat1_Error.18 := bscandatapending;
g_sMACH.ERR.dwCat1_Error.19 := g_sMACH.ERR.bCrashDetected;

(* --------------------------------------------------------------------------
 * Assign errors of category 2 (Stop at end of cycle)
 * -------------------------------------------------------------------------- *)
g_sMACH.ERR.dwCat2_Error.0 := FALSE;
g_sMACH.ERR.dwCat2_Error.1 := FALSE;
g_sMACH.ERR.dwCat2_Error.2 := FALSE;
g_sMACH.ERR.dwCat2_Error.3 := FALSE;
g_sMACH.ERR.dwCat2_Error.4 := FALSE;
g_sMACH.ERR.dwCat2_Error.5 := FALSE;
g_sMACH.ERR.dwCat2_Error.6 := FALSE;
g_sMACH.ERR.dwCat2_Error.7 := FALSE;
g_sMACH.ERR.dwCat2_Error.8 := FALSE;
g_sMACH.ERR.dwCat2_Error.9 := FALSE;
g_sMACH.ERR.dwCat2_Error.10 := FALSE;
g_sMACH.ERR.dwCat2_Error.11 := FALSE;
g_sMACH.ERR.dwCat2_Error.12 := FALSE;
g_sMACH.ERR.dwCat2_Error.13 := FALSE;
g_sMACH.ERR.dwCat2_Error.14 := FALSE;
g_sMACH.ERR.dwCat2_Error.15 := FALSE;

(* --------------------------------------------------------------------------
 * Assign errors of category 3 (Hold automatic)
 * -------------------------------------------------------------------------- *)
g_sMACH.ERR.dwCat3_Error.0 := FALSE;
g_sMACH.ERR.dwCat3_Error.1 := FALSE;
g_sMACH.ERR.dwCat3_Error.2 := FALSE;
g_sMACH.ERR.dwCat3_Error.3 := FALSE;
g_sMACH.ERR.dwCat3_Error.4 := FALSE;
g_sMACH.ERR.dwCat3_Error.5 := FALSE;
g_sMACH.ERR.dwCat3_Error.6 := FALSE;
g_sMACH.ERR.dwCat3_Error.7 := FALSE;
g_sMACH.ERR.dwCat3_Error.8 := FALSE;
g_sMACH.ERR.dwCat3_Error.9 := FALSE;
g_sMACH.ERR.dwCat3_Error.10 := FALSE;
g_sMACH.ERR.dwCat3_Error.11 := FALSE;
g_sMACH.ERR.dwCat3_Error.12 := FALSE;
g_sMACH.ERR.dwCat3_Error.13 := FALSE;
g_sMACH.ERR.dwCat3_Error.14 := FALSE;
g_sMACH.ERR.dwCat3_Error.15 := FALSE;

(* --------------------------------------------------------------------------
 * Assign errors of category 4 (Kill automatic sequence)
 * -------------------------------------------------------------------------- *)
g_sMACH.ERR.dwCat4_Error_a.0	:= NOT g_bDI_ES_DirectOK;
g_sMACH.ERR.dwCat4_Error_a.1	:= g_sMACH.ERR.bPressure;
g_sMACH.ERR.dwCat4_Error_a.2	:= FALSE;
g_sMACH.ERR.dwCat4_Error_a.3	:= FALSE;	//g_sMACH.ERR.bErrorArrayTooSmallDia1
									//	OR	g_sMACH.ERR.bErrorArrayTooSmallDia2
									//	OR	g_sMACH.ERR.bErrorArrayTooSmallHor
									//	OR	g_sMACH.ERR.bErrorArrayTooSmallVer;
g_sMACH.ERR.dwCat4_Error_a.4	:= FALSE;	//g_sMACH.ERR.bErrorPosDia1
									//	OR	g_sMACH.ERR.bErrorPosDia2
									//	OR	g_sMACH.ERR.bErrorPosHor
									//	OR	g_sMACH.ERR.bErrorPosVer;
g_sMACH.ERR.dwCat4_Error_a.5	:= g_sMACH.ERR.bUltrasonic1;
g_sMACH.ERR.dwCat4_Error_a.6	:= NOT g_bDI_CircuitBreaker_i700;
g_sMACH.ERR.dwCat4_Error_a.7	:= NOT g_bDI_CircuitBreaker_Ultrasonic;
g_sMACH.ERR.dwCat4_Error_a.8 := g_sMACH.ERR.bServoPowerNOK;
g_sMACH.ERR.dwCat4_Error_a.9 := (g_uStatus_X_Axis.xDriveError OR g_uStatus_X_Axis.xAxisError OR g_uStatus_X_Axis.bLuMessage) AND g_bDI_CircuitBreaker_i700;
g_sMACH.ERR.dwCat4_Error_a.10 := (g_uStatus_Y_Axis.xDriveError OR g_uStatus_Y_Axis.xAxisError OR g_uStatus_Y_Axis.bLuMessage) AND g_bDI_CircuitBreaker_i700;
g_sMACH.ERR.dwCat4_Error_a.11 := (g_uStatus_Z_Axis.xDriveError OR g_uStatus_Z_Axis.xAxisError OR g_uStatus_Z_Axis.bLuMessage) AND g_bDI_CircuitBreaker_i700;
g_sMACH.ERR.dwCat4_Error_a.12 := (g_uStatus_R_Axis.xDriveError OR g_uStatus_R_Axis.xAxisError OR g_uStatus_R_Axis.bLuMessage) AND g_bDI_CircuitBreaker_i700;
g_sMACH.ERR.dwCat4_Error_a.13 := (g_uStatus_Front_Axis.xDriveError OR g_uStatus_Front_Axis.xAxisError OR g_uStatus_Front_Axis.bLuMessage) AND g_bDI_CircuitBreaker_i700;
g_sMACH.ERR.dwCat4_Error_a.14 := (g_uStatus_Rear_Axis.xDriveError OR g_uStatus_Rear_Axis.xAxisError OR g_uStatus_Rear_Axis.bLuMessage) AND g_bDI_CircuitBreaker_i700;
g_sMACH.ERR.dwCat4_Error_a.15 := g_sMACH.ERR.ModusRV_AccDeccZ;
g_sMACH.ERR.dwCat4_Error_a.16 := g_sMACH.ERR.ModusRV_SpeedZToHigh;
g_sMACH.ERR.dwCat4_Error_a.17 := g_sMACH.ERR.ModusRV_TargetPosInSWLimits;
g_sMACH.ERR.dwCat4_Error_a.18 := NOT Front_Axis.xCommunicationOK;
g_sMACH.ERR.dwCat4_Error_a.19 := NOT Rear_Axis.xCommunicationOK;
g_sMACH.ERR.dwCat4_Error_a.20 := NOT Z_Axis.xCommunicationOK;
g_sMACH.ERR.dwCat4_Error_a.21 := NOT R_Axis.xCommunicationOK;
g_sMACH.ERR.dwCat4_Error_a.22 :=g_sMACH.ERR.bErrorComIOStation;
g_sMACH.ERR.dwCat4_Error_a.23 := g_sMACH.ERR.bPieceTooLarge;
g_sMACH.ERR.dwCat4_Error_a.24 := g_sMACH.ERR.bLanguageValueInvalid;
g_sMACH.ERR.dwCat4_Error_a.25 := FALSE;//g_sMACH.sAxisR.bDetectionError;
g_sMACH.ERR.dwCat4_Error_a.26 := FALSE;//g_sMACH.sAxisR.bFollowingError;
g_sMACH.ERR.dwCat4_Error_a.27 := g_sMACH.ERR.bTrayTooSmall;
g_sMACH.ERR.dwCat4_Error_a.28 := g_sMACH.ERR.bR_AxisPositionError;
g_sMACH.ERR.dwCat4_Error_a.29 := g_sMACH.ERR.bAxisFrontNotSet;
g_sMACH.ERR.dwCat4_Error_a.30 := g_sMACH.ERR.bAxisRearNotSet;
g_sMACH.ERR.dwCat4_Error_a.31 := g_sMACH.ERR.bAxisRNotSet;

g_sMACH.ERR.dwCat4_Error_b.00 := g_sMACH.ERR.bWrongTable;
g_sMACH.ERR.dwCat4_Error_b.01 := 	g_sMACH.ERR.bZStrokeKnifeToBottomRound
								OR	g_sMACH.ERR.bZStrokeKnifeToBottomSlab
								OR	g_sMACH.ERR.bZStrokeKnifeToBottomTraySmall
								OR	g_sMACH.ERR.bZStrokeKnifeToBottomTrayLarge
								OR	g_sMACH.ERR.bZStrokeKnifeToBottomTrayDouble;
g_sMACH.ERR.dwCat4_Error_b.02 := 	g_sMACH.ERR.bRoundCakeTooLarge;
g_sMACH.ERR.dwCat4_Error_b.03 := 	g_sMACH.ERR.bSlabTooSmall;
g_sMACH.ERR.dwCat4_Error_b.04 := 	g_sMACH.ERR.bXYNotEnabled;
g_sMACH.ERR.dwCat4_Error_b.05 := 	g_sMACH.ERR.bZNotEnabled;
g_sMACH.ERR.dwCat4_Error_b.06 := 	g_sMACH.ERR.bRNotEnabled;
g_sMACH.ERR.dwCat4_Error_b.07 := 	g_sMACH.ERR.bCleaningContainerZeroPos;
g_sMACH.ERR.dwCat4_Error_b.08 := 	g_sMACH.ERR.bCleaningContainerEndPos;
g_sMACH.ERR.dwCat4_Error_b.09 := 	g_sMACH.ERR.bCleaningContainerEndZero;
g_sMACH.ERR.dwCat4_Error_b.10 := 	g_sMACH.ERR.bCleaningContainerNotSafeToMove;
g_sMACH.ERR.dwCat4_Error_b.11 := 	g_sMACH.ERR.bTableMovementNotAllowed;
g_sMACH.ERR.dwCat4_Error_b.12 := 	g_sMACH.ERR.bRAxisMovementNotAllowed;
g_sMACH.ERR.dwCat4_Error_b.13 := 	g_sMACH.ERR.bZAxisMovementNotAllowed;
g_sMACH.ERR.dwCat4_Error_b.14 := 	g_sMACH.ERR.bZHomeSensorTimeout;
g_sMACH.ERR.dwCat4_Error_b.15 := 	g_sMACH.ERR.bCrashDetectFault;
g_sMACH.ERR.dwCat4_Error_b.16 :=	g_sMACH.ERR.bStackIsFull;							//Tried to push item to stack but stack was full                                              
g_sMACH.ERR.dwCat4_Error_b.17 :=	g_sMACH.ERR.bStackIsEmpty;                          //Tried to pop item from stack but stack was empty                                             
g_sMACH.ERR.dwCat4_Error_b.18 :=	g_sMACH.ERR.bMarginsInOvershootCorrectionInvalid;   //Occurs when marginMax is smaller than marginMin                                              
g_sMACH.ERR.dwCat4_Error_b.19 :=	g_sMACH.ERR.bKnifeSettingsIncorrect;                //Occurs when the knifecenter is bigger than the knife length                                  
g_sMACH.ERR.dwCat4_Error_b.20 :=	g_sMACH.ERR.bIntersectionNotFound;                  //Overshoot detected a collision, but the intersection coulnt be determained                   
g_sMACH.ERR.dwCat4_Error_b.21 :=	g_sMACH.ERR.bOvershootCorrectionImpossible AND NOT g_HMI_MCH_Parameters.bSkipImpossiblePositions;         //Overshoot coulnt be corrected.                                                               
g_sMACH.ERR.dwCat4_Error_b.22 :=	g_sMACH.ERR.bOldOvershootCorrectionDiffers;         //The old overshoot correction still changed the target after the new correction was executed. 
g_sMACH.ERR.dwCat4_Error_b.23 :=	g_sMACH.ERR.bIndexOutOfBoundsWhileCopyingCuts;      //Index out of boundaries of array while copying cuts                                          
g_sMACH.ERR.dwCat4_Error_b.24 :=	g_sMACH.ERR.bRoundProductsOverlap;                  //Occurs when round products are to close to eachother, space between them is negative.        
g_sMACH.ERR.dwCat4_Error_b.25 :=	g_sMACH.ERR.bCalcVerError;                          //Calc_Ver returned an error.                                                                  
g_sMACH.ERR.dwCat4_Error_b.26 :=	g_sMACH.ERR.bCalcHorError;                          //Calc_Hor returned an error.                                                                  
g_sMACH.ERR.dwCat4_Error_b.27 :=	g_sMACH.ERR.bCalcDia1Error;                         //Calc_Dia1 returned an error.                                                                 
g_sMACH.ERR.dwCat4_Error_b.28 :=	g_sMACH.ERR.bCalcDia2Error;                         //Calc_Dia2 returned an error.       
g_sMACH.ERR.dwCat4_Error_b.29 :=	g_sMACH.ERR.bXYA_K_WasNotZero;					    //Thrown when the "k" parameter of a XYA-target wasn't zero, the overshoot correction doent's support this yet.
         


(* --------------------------------------------------------------------------
 * Error category detection.
 * Only one error category can be active. Errors of higher category take
 * precedence over lower categories
 * -------------------------------------------------------------------------- *)

(* Collect Errors of Category 4 *)
g_sMACH.ERH.bErrorCategory4 :=		g_sMACH.ERR.dwCat4_Error_a <>0
										OR	g_sMACH.ERR.dwCat4_Error_b <>0
										OR	g_sMACH.ERR.dwCat4_Error_c <>0;

 (* Collect Errors of Category 3 *)
g_sMACH.ERH.bErrorCategory3 :=	NOT	g_sMACH.ERH.bErrorCategory4
										AND	g_sMACH.ERR.dwCat3_Error <> 0;

 (* Collect Errors of Category 2 *)
g_sMACH.ERH.bErrorCategory2 :=	NOT		g_sMACH.ERH.bErrorCategory4
										AND NOT	g_sMACH.ERH.bErrorCategory3
										AND		g_sMACH.ERR.dwCat2_Error <>0;

 (* Collect Errors of Category 1 *)
g_sMACH.ERH.bErrorCategory1 :=	NOT		g_sMACH.ERH.bErrorCategory4
										AND NOT	g_sMACH.ERH.bErrorCategory3
										AND NOT	g_sMACH.ERH.bErrorCategory2
										AND		g_sMACH.ERR.dwCat1_Error <> 0;

(* Error request reset handling.
 * --------------------------------------------------------------------------
 * If an error of category 2,3 or 4 occures, the buzzer will sound. It
 * will stop if either a) a maximum time is exceeded (only error category 1) or
 *							b) the HMI.bResetError signal is raised
 * The actual reset error signal (MCL.bResetError) will not be generated as
 * long as the buzzer sounds. In practice this means: the first ResetError
 * keypress will stop the buzzer, the second keypress will reset the error.
 * -------------------------------------------------------------------------- *)

(* Generate oneshots on raising edges of the error categories *)
g_sMACH.ERH.RT_ErrorCategory1(CLK := g_sMACH.ERH.bErrorCategory1);
g_sMACH.ERH.RT_ErrorCategory2(CLK := g_sMACH.ERH.bErrorCategory2);
g_sMACH.ERH.RT_ErrorCategory3(CLK := g_sMACH.ERH.bErrorCategory3);
g_sMACH.ERH.RT_ErrorCategory4(CLK := g_sMACH.ERH.bErrorCategory4);

(* Oneshot on the raising edge of MACH.MCL.bResetErrorPulse *)
g_sMACH.ERH.RT_ResetErrorERH(CLK:=g_HMI_MachCommand.CMD.bResetErrorPulse);

(* Error in category 2,3 or 4 active *)
g_sMACH.ERH.bError234Active :=		  g_sMACH.ERH.bErrorCategory2
										OR	  g_sMACH.ERH.bErrorCategory3
										OR	  g_sMACH.ERH.bErrorCategory4;

(* ----------------------------- *)
(* Handle Buzzer					  *)
(* ----------------------------- *)
(*Blinker for beeping*)
Blinker(Enable:=g_sMACH.ERH.bSoundSignalOn,Timelow:= T#500ms, Timehigh:=T#500ms);
g_bDQ_Buzzer := g_sMACH.ERH.bSoundSignalOn AND Blinker.OUT;

(* Buzzer switch on *)
IF		 (			g_sMACH.ERH.RT_ErrorCategory1.Q
		 AND NOT g_sMACH.ERH.bErrorCategory2
		 AND NOT g_sMACH.ERH.bErrorCategory3
		 AND NOT g_sMACH.ERH.bErrorCategory4
		)
	OR (		  	g_sMACH.ERH.RT_ErrorCategory2.Q
		 AND NOT g_sMACH.ERH.bErrorCategory3
		 AND NOT g_sMACH.ERH.bErrorCategory4
		)
	OR (		  g_sMACH.ERH.RT_ErrorCategory3.Q
		 AND NOT g_sMACH.ERH.bErrorCategory4
		)
	OR (		  g_sMACH.ERH.RT_ErrorCategory4.Q
		)
THEN
	IF		bSkipFirstTrigger
	THEN
			bSkipFirstTrigger := FALSE;
	ELSE
			IF NOT (g_sMACH.ERR.bPressStartToCut AND g_HMI_MachCommand.bScanMode) 
			THEN
				g_sMACH.ERH.bSoundSignalOn := TRUE;
			END_IF
	END_IF
END_IF

(* Buzzer timer *)
tBuzzerTimerErr1(IN:= (g_sMACH.ERH.bSoundSignalOn AND NOT g_sMACH.ERH.bError234Active), PT:= T#1s);
tBuzzerTimerErr234(IN:= (g_sMACH.ERH.bSoundSignalOn AND g_sMACH.ERH.bError234Active), PT:= T#3s);

(* Buzzer switch off *)
IF			g_sMACH.ERH.RT_ResetErrorERH.Q
	OR		tBuzzerTimerErr1.Q
	OR		tBuzzerTimerErr234.Q
THEN
			  g_sMACH.ERH.bSoundSignalOn := FALSE;
END_IF

END_PROGRAM
