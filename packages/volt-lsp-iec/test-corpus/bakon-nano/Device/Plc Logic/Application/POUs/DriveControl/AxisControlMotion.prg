PROGRAM AxisControlMotion
VAR
	Z_SetVelocity: REAL;
	KC_AxisBasics_X_axis		: KC_AxisBasics;	(* VIRTUAL AXIS! *)
	KC_AxisBasics_Y_axis		: KC_AxisBasics;	(* VIRTUAL AXIS! *)
	KC_AxisBasics_Front_axis	: KC_AxisBasics;
	KC_AxisBasics_Rear_axis		: KC_AxisBasics;
	KC_AxisBasics_Z_axis		: KC_AxisBasics;
	KC_AxisBasics_R_Axis		: KC_AxisBasics;

	ECSM_AxisDiagnostic_MasterRondVierkant: KC_AxisBasics;(*TODO: Dit wordt een axisBasics*)
	SetRef_Front_Axis	: SetRef_Axis;
	SetRef_Rear_Axis	: SetRef_Axis;
	SetRef_R_Axis		: SetRef_Axis;
	
	fbSetSWLimits_X,
	fbSetSWLimits_Y	: L_MC1P_WriteSWLimit;
	gMachConfig_bXL_mem	: BOOL;
	
END_VAR

//Set limits X
fbSetSWLimits_X(
	Axis:= X_Axis, 
	xExecute:= gMachConfig_bXL_mem <> gMachConfig.bXL, 
	xSetSWLimitPos:= TRUE, 
	lrSWLimitPos:= SEL(gMachConfig.bXL,C_rMaxOvershootX+5,C_rMaxOvershootX_XL + 5), 
	xSetSWLimitNeg:= TRUE, 
	lrSWLimitNeg:= 1, 
);

//Set limits Y
fbSetSWLimits_Y(
	Axis:= Y_Axis, 
	xExecute:= gMachConfig_bXL_mem <> gMachConfig.bXL, 
	xSetSWLimitPos:= TRUE, 
	lrSWLimitPos:= SEL(gMachConfig.bXL,C_rMaxOvershootY+5,C_rMaxOvershootY_XL + 5), 
	xSetSWLimitNeg:= TRUE, 
	lrSWLimitNeg:= 1, 
);

//Store value when both limits are written
IF 	fbSetSWLimits_X.xDone
AND fbSetSWLimits_Y.xDone THEN
	gMachConfig_bXL_mem	:= gMachConfig.bXL;
END_IF
	
/////////////////////////////////////////////////////////////////////////////////////////////////

//Set init values	
IF g_bSUB_InitStart
THEN
	g_uControl_X_Axis.lrVelocity := 300;	//Was 100(* was 50 *)
	g_uControl_Y_Axis.lrVelocity := 300;	//Was 100(* was 50 *)
	g_uControl_Front_Axis.lrVelocity := 300;	//Was 100(* was 50 *)
	g_uControl_Rear_Axis.lrVelocity := 300;	//Was 100(* was 50 *)
	g_uControl_Z_Axis.lrVelocity := 200;	//Was 30
	g_uControl_R_Axis.lrVelocity := 180; //Was 50

	g_uControl_X_Axis.lrAcceleration		:=2000/4;//was 1000;
	g_uControl_Y_Axis.lrAcceleration		:=2000/4;//was 1000;
	g_uControl_Front_Axis.lrAcceleration	:=2000;//was 1000;
	g_uControl_Rear_Axis.lrAcceleration	:=2000;//was 1000;
	g_uControl_Z_Axis.lrAcceleration		:=800;//was 250;
	g_uControl_R_Axis.lrAcceleration		:=800;//was 250;
	
	g_uControl_X_Axis.lrDeceleration		:=X_Axis.scPar.MaxAcceleration;	//Was fSWMaxDeceleration in old motion
	g_uControl_Y_Axis.lrDeceleration		:=Y_Axis.scPar.MaxAcceleration;	//Was fSWMaxDeceleration in old motion
	g_uControl_Front_Axis.lrDeceleration	:=Front_Axis.scPar.MaxAcceleration;	//Was fSWMaxDeceleration in old motion
	g_uControl_Rear_Axis.lrDeceleration		:=Rear_Axis.scPar.MaxAcceleration;	//Was fSWMaxDeceleration in old motion
	g_uControl_Z_Axis.lrDeceleration		:=Z_Axis.scPar.MaxAcceleration;	//Was fSWMaxDeceleration in old motion
	g_uControl_R_Axis.lrDeceleration		:=R_Axis.scPar.MaxAcceleration;	//Was fSWMaxDeceleration in old motion
ELSIF g_bSUB_CleanKnifeStart
THEN
	g_uControl_X_Axis.lrVelocity := g_HMI_MCH_Parameters.rCleaningSpeed;
	g_uControl_Y_Axis.lrVelocity := g_HMI_MCH_Parameters.rCleaningSpeed;
	g_uControl_Front_Axis.lrVelocity := g_HMI_MCH_Parameters.rCleaningSpeed;
	g_uControl_Rear_Axis.lrVelocity := g_HMI_MCH_Parameters.rCleaningSpeed;
	g_uControl_Z_Axis.lrVelocity := 200;	//Was 30
	g_uControl_R_Axis.lrVelocity := 180; //Was 50

	g_uControl_X_Axis.lrAcceleration		:=2000;//was 1000;
	g_uControl_Y_Axis.lrAcceleration		:=2000;//was 1000;
	g_uControl_Front_Axis.lrAcceleration	:=2000;//was 1000;
	g_uControl_Rear_Axis.lrAcceleration	:=2000;//was 1000;
	g_uControl_Z_Axis.lrAcceleration		:=800;//was 250;
	g_uControl_R_Axis.lrAcceleration		:=800;//was 250;
	
	g_uControl_X_Axis.lrDeceleration		:=X_Axis.scPar.MaxAcceleration;	//Was fSWMaxDeceleration in old motion
	g_uControl_Y_Axis.lrDeceleration		:=Y_Axis.scPar.MaxAcceleration;	//Was fSWMaxDeceleration in old motion
	g_uControl_Front_Axis.lrDeceleration	:=Front_Axis.scPar.MaxAcceleration;	//Was fSWMaxDeceleration in old motion
	g_uControl_Rear_Axis.lrDeceleration		:=Rear_Axis.scPar.MaxAcceleration;	//Was fSWMaxDeceleration in old motion
	g_uControl_Z_Axis.lrDeceleration		:=Z_Axis.scPar.MaxAcceleration;	//Was fSWMaxDeceleration in old motion
	g_uControl_R_Axis.lrDeceleration		:=R_Axis.scPar.MaxAcceleration;	//Was fSWMaxDeceleration in old motion
ELSE
	g_uControl_Front_Axis.lrVelocity	:= g_HMI_MCH_Parameters.rManualSpeed;
	g_uControl_Rear_Axis.lrVelocity	:= g_HMI_MCH_Parameters.rManualSpeed;
	g_uControl_X_Axis.lrVelocity		:= g_HMI_MCH_Parameters.rManualSpeed;
	g_uControl_Y_Axis.lrVelocity		:= g_HMI_MCH_Parameters.rManualSpeed;
	g_uControl_Z_Axis.lrVelocity		:= g_HMI_MCH_Parameters.rManualSpeed;
	g_uControl_R_Axis.lrVelocity		:= g_HMI_MCH_Parameters.rManualSpeed;

	g_uControl_Front_Axis.lrAcceleration	:= g_HMI_MCH_Parameters.rManualSpeed * 5;
	g_uControl_Rear_Axis.lrAcceleration	:= g_HMI_MCH_Parameters.rManualSpeed * 5;
	g_uControl_X_Axis.lrAcceleration		:= g_HMI_MCH_Parameters.rManualSpeed * 5;
	g_uControl_Y_Axis.lrAcceleration		:= g_HMI_MCH_Parameters.rManualSpeed * 5;
	g_uControl_Z_Axis.lrAcceleration		:= g_HMI_MCH_Parameters.rManualSpeed * 5;
	g_uControl_R_Axis.lrAcceleration		:= g_HMI_MCH_Parameters.rManualSpeed * 5;
	
	g_uControl_X_Axis.lrDeceleration		:=X_Axis.scPar.MaxAcceleration;	//Was fSWMaxDeceleration in old motion
	g_uControl_Y_Axis.lrDeceleration		:=Y_Axis.scPar.MaxAcceleration;	//Was fSWMaxDeceleration in old motion
	g_uControl_Front_Axis.lrDeceleration	:=Front_Axis.scPar.MaxAcceleration;	//Was fSWMaxDeceleration in old motion
	g_uControl_Rear_Axis.lrDeceleration	:=Rear_Axis.scPar.MaxAcceleration;	//Was fSWMaxDeceleration in old motion
	g_uControl_Z_Axis.lrDeceleration		:=Z_Axis.scPar.MaxAcceleration;	//Was fSWMaxDeceleration in old motion
	g_uControl_R_Axis.lrDeceleration		:=R_Axis.scPar.MaxAcceleration;	//Was fSWMaxDeceleration in old motion
END_IF

(*****************************************************************************************************************************************************************)
(* Front axis *)
KC_AxisBasics_Front_axis.strHomingParameters.eHomeMode := L_MC1P_HomeMode.SetPositionDirect;
KC_AxisBasics_Front_axis.strHomingParameters.lrTargetPosition := 0;
KC_AxisBasics_Front_axis.strHomingParameters.eHomeStopMode := 0;
KC_AxisBasics_Front_axis.strHomingParameters.lrAcceleration1 := 500;
KC_AxisBasics_Front_axis.strHomingParameters.lrVelocity1 := 50;
KC_AxisBasics_Front_Axis.lrHomePosition := 0;
g_uControl_Front_Axis.bStartHoming := g_HMI_MachCommand.bSetOffsetFront;

SetRef_Front_Axis(
	I_AxisStatus		:= g_uStatus_Front_Axis,
	IQ_Axis				:= Front_Axis,
	IQ_CmdSetRef	:= g_HMI_MachCommand.bSetOffsetFront,
	IQ_uControl_Axis	:= g_uControl_Front_Axis,
	Q_bRefDone		=> ,
	Q_bError			=> );

IF	g_HMI_MachCommand.bSetOffsetFront
THEN
	g_bAxis_FrontSet	:= FALSE;
END_IF
IF g_uStatus_Front_Axis.bDriveEnabled
AND NOT g_uStatus_Front_Axis.bHomePositionAvailable THEN	//Home position not known
	g_bAxis_FrontSet 	:= FALSE;
END_IF
IF	SetRef_Front_Axis.Q_bRefDone AND g_HMI_MachCommand.bSetOffsetFront  //SetRef_Front_Axis.Q_bRefDone
THEN
	g_bAxis_FrontSet	:= TRUE;
	g_HMI_MachCommand.bSetOffsetFront	:= FALSE;
END_IF
IF	SetRef_Front_Axis.bError
THEN
	g_bAxis_FrontSet	:= FALSE;
	g_sMACH.ERR.bErrorSetRef_Front_Axis	:= TRUE;
	g_HMI_MachCommand.bSetOffsetFront		:= FALSE;
END_IF
g_sMACH.ERR.bAxisFrontNotSet	:= NOT g_bAxis_FrontSet;		(* Warning *)

//g_uControl_Front_Axis.bEnable := bEnableAxisBasics;
g_uControl_Front_Axis.bResetError :=			(g_HMI_MachCommand.CMD.bResetErrorPulse OR g_bFirstCycle)
										AND	(g_uStatus_Front_Axis.xDriveError OR g_uStatus_Front_Axis.xAxisError  OR g_uStatus_Front_Axis.xError OR g_uStatus_Front_Axis.bLuMessage);

KC_AxisBasics_Front_axis(
	AxisControl				:= g_uControl_Front_Axis,
	strHomingParameters		:= ,
	bEnableSWLimits			:= TRUE ,
	bEnableHWLimits			:= FALSE ,
	I_lrTorqueLimitPos_Value	:= 100,
	I_lrTorqueLimitNeg_Value	:= 100,
	AxisName					:= Front_axis ,
	AxisStatus					=> g_uStatus_Front_Axis);

(*****************************************************************************************************************************************************************)
(* Rear axis *)
KC_AxisBasics_Rear_axis.strHomingParameters.eHomeMode := L_MC1P_HomeMode.SetPositionDirect;
KC_AxisBasics_Rear_axis.strHomingParameters.lrTargetPosition := L_MC1P_HomeStopMode.StopPositioning;
KC_AxisBasics_Rear_axis.strHomingParameters.eHomeStopMode := 0;
KC_AxisBasics_Rear_axis.strHomingParameters.lrAcceleration1 := 500;
KC_AxisBasics_Rear_axis.strHomingParameters.lrVelocity1 := 50;
KC_AxisBasics_Rear_Axis.lrHomePosition := 0;
g_uControl_Rear_Axis.bStartHoming := g_HMI_MachCommand.bSetOffsetRear;

(* Set the absoluut encoder on the motor to zero*)
SetRef_Rear_Axis(
	I_AxisStatus		:= g_uStatus_Rear_Axis,
	IQ_Axis				:= Rear_Axis,
	IQ_CmdSetRef	:= g_HMI_MachCommand.bSetOffsetRear,
	IQ_uControl_Axis	:= g_uControl_Rear_Axis,
	Q_bRefDone		=> ,
	Q_bError			=> );
IF	g_HMI_MachCommand.bSetOffsetRear
THEN
	g_bAxis_RearSet	:= FALSE;
END_IF
IF g_uStatus_Rear_Axis.bDriveEnabled
AND NOT g_uStatus_Rear_Axis.bHomePositionAvailable THEN	//Home position not known
	g_bAxis_RearSet := FALSE;
END_IF
IF	SetRef_Rear_Axis.Q_bRefDone
THEN
	g_bAxis_RearSet	:= TRUE;
	g_HMI_MachCommand.bSetOffsetRear	:= FALSE;
END_IF
IF	SetRef_Rear_Axis.bError
THEN
	g_bAxis_RearSet	:= FALSE;
	g_sMACH.ERR.bErrorSetRef_Rear_Axis	:= TRUE;
	g_HMI_MachCommand.bSetOffsetRear		:= FALSE;
END_IF
g_sMACH.ERR.bAxisRearNotSet	:= NOT g_bAxis_RearSet;		(* Warning *)

//g_uControl_Rear_Axis.bEnable := bEnableAxisBasics;
g_uControl_Rear_Axis.bResetError :=	(g_HMI_MachCommand.CMD.bResetErrorPulse OR g_bFirstCycle)
									AND (g_uStatus_Rear_Axis.xDriveError OR g_uStatus_Rear_Axis.xAxisError  OR g_uStatus_Rear_Axis.xError OR g_uStatus_Rear_Axis.bLuMessage);

KC_AxisBasics_Rear_axis(
	AxisControl				:= g_uControl_Rear_Axis,
	strHomingParameters		:= ,
	bEnableSWLimits			:=TRUE ,
	bEnableHWLimits			:=FALSE ,
	I_lrTorqueLimitPos_Value	:= 100,
	I_lrTorqueLimitNeg_Value	:= 100,
	AxisName					:= Rear_axis ,
	AxisStatus					=> g_uStatus_Rear_Axis);

(*****************************************************************************************************************************************************************)
(* X axis (VIRTUAL AXIS!) *)

//g_uControl_X_Axis.bEnable := bEnableAxisBasics;
g_uControl_X_Axis.bResetError :=			(g_HMI_MachCommand.CMD.bResetErrorPulse OR g_bFirstCycle)
										AND	(g_uStatus_X_Axis.xDriveError OR g_uStatus_X_Axis.xAxisError  OR g_uStatus_X_Axis.xError);

KC_AxisBasics_X_axis(
	AxisControl				:= g_uControl_X_Axis,
	strHomingParameters		:= ,
	bEnableSWLimits			:=TRUE ,
	bEnableHWLimits			:=FALSE ,
	I_lrTorqueLimitPos_Value	:= 100,
	I_lrTorqueLimitNeg_Value	:= 100,
	AxisName					:= X_axis ,
	AxisStatus					=> g_uStatus_X_Axis);

(*****************************************************************************************************************************************************************)
(* Y axis (VIRTUAL AXIS!) *)

//g_uControl_Y_Axis.bEnable := bEnableAxisBasics;
g_uControl_Y_Axis.bResetError :=	(g_HMI_MachCommand.CMD.bResetErrorPulse OR g_bFirstCycle)
									AND (g_uStatus_Y_Axis.xDriveError OR g_uStatus_Y_Axis.xAxisError OR g_uStatus_Y_Axis.xError);

KC_AxisBasics_Y_axis(
	AxisControl				:= g_uControl_Y_Axis,
	strHomingParameters		:= ,
	bEnableSWLimits			:=TRUE ,
	bEnableHWLimits			:=FALSE ,
	I_lrTorqueLimitPos_Value	:= 100,
	I_lrTorqueLimitNeg_Value	:= 100,
	AxisName					:= Y_axis ,
	AxisStatus					=> g_uStatus_Y_Axis);

(*****************************************************************************************************************************************************************)
(* Z axis *)
KC_AxisBasics_Z_axis.strHomingParameters.eHomeMode := L_MC1P_HomeMode.CcwLimitSwitch;		(*negative to endswitch and positive to flank endswitch,connect endswitch to DI1 and DI2*)
KC_AxisBasics_Z_axis.strHomingParameters.eHomeStopMode := L_MC1P_HomeStopMode.AbsolutePositioning; (*Vervolg in absolute positionering*)
KC_AxisBasics_Z_axis.strHomingParameters.lrTargetPosition := 0;							(*home offset*)
KC_AxisBasics_Z_axis.strHomingParameters.lrAcceleration1 := 400;
KC_AxisBasics_Z_axis.strHomingParameters.lrVelocity1 := 20;
KC_AxisBasics_Z_Axis.lrHomePosition := -5;

//g_uControl_Z_Axis.bEnable := bEnableAxisBasics;
g_uControl_Z_Axis.bResetError := (g_HMI_MachCommand.CMD.bResetErrorPulse OR g_bFirstCycle)
									AND (g_uStatus_Z_Axis.xDriveError OR g_uStatus_Z_Axis.xAxisError OR g_uStatus_Z_Axis.xError OR g_uStatus_Z_Axis.bLuMessage);

KC_AxisBasics_Z_axis(
	AxisControl				:= g_uControl_Z_Axis,
	strHomingParameters		:= ,
	bEnableSWLimits			:= TRUE ,
	bEnableHWLimits			:= TRUE ,
	xIgnorePosLimit			:= TRUE,
	I_lrTorqueLimitPos_Value	:= 250,
	I_lrTorqueLimitNeg_Value	:= 250,
	AxisName					:= Z_axis ,
	AxisStatus					=> g_uStatus_Z_Axis);

Z_SetVelocity:=Z_axis.lrSetVelocity;

(*****************************************************************************************************************************************************************)
(* R axis *)
KC_AxisBasics_R_axis.strHomingParameters.eHomeMode := L_MC1P_HomeMode.SetPositionDirect;
KC_AxisBasics_R_Axis.strHomingParameters.eHomeStopMode := L_MC1P_HomeStopMode.StopPositioning;
KC_AxisBasics_R_axis.strHomingParameters.lrTargetPosition:=0;
KC_AxisBasics_R_Axis.lrHomePosition := 0;
g_uControl_R_Axis.bStartHoming := g_HMI_MachCommand.bSetOffsetR; 

(* Set the absoluut encoder on the motor to zero*)
SetRef_R_Axis(
	I_AxisStatus		:= g_uStatus_R_Axis,
	IQ_Axis				:= R_Axis,
	IQ_CmdSetRef		:= g_HMI_MachCommand.bSetOffsetR,
	IQ_uControl_Axis	:= g_uControl_R_Axis,
	Q_bRefDone			=> ,
	Q_bError			=> );
IF	g_HMI_MachCommand.bSetOffsetR
THEN
	g_bAxis_RSet	:= FALSE;
END_IF
IF g_uStatus_R_Axis.bDriveEnabled
AND NOT g_uStatus_R_Axis.bHomePositionAvailable THEN	//Home position not known
	g_bAxis_RSet 	:= FALSE;
END_IF
IF	SetRef_R_Axis.Q_bRefDone
THEN
	g_bAxis_RSet	:= TRUE;
	g_HMI_MachCommand.bSetOffsetR	:= FALSE;
END_IF
IF	SetRef_R_Axis.bError
THEN
	g_bAxis_RSet	:= FALSE;
	g_sMACH.ERR.bErrorSetRef_R_Axis	:= TRUE;
	g_HMI_MachCommand.bSetOffsetR		:= FALSE;
END_IF
g_sMACH.ERR.bAxisRNotSet	:= NOT g_bAxis_RSet;		(* Warning *)

//	g_uControl_R_Axis.bEnable := bEnableAxisBasics;
g_uControl_R_Axis.bResetError := (g_HMI_MachCommand.CMD.bResetErrorPulse OR g_bFirstCycle)
									AND (g_uStatus_R_Axis.xDriveError OR g_uStatus_R_Axis.xAxisError OR  g_uStatus_R_Axis.xError OR g_uStatus_R_Axis.bLuMessage);

KC_AxisBasics_R_axis(
	AxisControl					:= g_uControl_R_Axis,
	strHomingParameters			:= ,
	bEnableSWLimits				:= TRUE ,
	bEnableHWLimits				:= FALSE ,
	I_lrTorqueLimitPos_Value	:= 100,
	I_lrTorqueLimitNeg_Value	:= 100,
	AxisName					:= R_axis ,
	AxisStatus					=> g_uStatus_R_Axis);

(*****************************************************************************************************************************************************************)

g_sHMI_Mach_UnitStatus.dwDriveErrorIDXaxis		:= KC_AxisBasics_X_axis.AxisStatus.dwDriveErrorID;		(* X axis error code*)
g_sHMI_Mach_UnitStatus.dwDriveErrorIDYaxis		:= KC_AxisBasics_Y_axis.AxisStatus.dwDriveErrorID;		(* Y axis error code*)
g_sHMI_Mach_UnitStatus.dwDriveErrorIDFrontAxis	:= KC_AxisBasics_Front_axis.AxisStatus.dwDriveErrorID;	(* Front axis error code*)
g_sHMI_Mach_UnitStatus.dwDriveErrorIDRearAxis	:= KC_AxisBasics_Rear_axis.AxisStatus.dwDriveErrorID;	(* Rear axis error code*)
g_sHMI_Mach_UnitStatus.dwDriveErrorIDZaxis		:= KC_AxisBasics_Z_axis.AxisStatus.dwDriveErrorID;		(* Z axis error code*)
g_sHMI_Mach_UnitStatus.dwDriveErrorIDRaxis		:= KC_AxisBasics_R_axis.AxisStatus.dwDriveErrorID;		(* R axis error code*)

g_sHMI_Mach_UnitStatus.eAxisErrorIDXaxis		:= KC_AxisBasics_X_axis.AxisStatus.eAxisErrorID;
g_sHMI_Mach_UnitStatus.eAxisErrorIDYaxis		:= KC_AxisBasics_Y_axis.AxisStatus.eAxisErrorID;
g_sHMI_Mach_UnitStatus.eAxisErrorIDFrontaxis	:= KC_AxisBasics_Front_axis.AxisStatus.eAxisErrorID;
g_sHMI_Mach_UnitStatus.eAxisErrorIDRearaxis		:= KC_AxisBasics_Rear_axis.AxisStatus.eAxisErrorID;
g_sHMI_Mach_UnitStatus.eAxisErrorIDZaxis		:= KC_AxisBasics_Z_axis.AxisStatus.eAxisErrorID;
g_sHMI_Mach_UnitStatus.eAxisErrorIDRaxis		:= KC_AxisBasics_R_axis.AxisStatus.eAxisErrorID;

g_sHMI_Mach_UnitStatus.eErrorIDXaxis			:= KC_AxisBasics_X_axis.AxisStatus.eErrorID;
g_sHMI_Mach_UnitStatus.eErrorIDYaxis			:= KC_AxisBasics_Y_axis.AxisStatus.eErrorID;
g_sHMI_Mach_UnitStatus.eErrorIDFrontaxis		:= KC_AxisBasics_Front_axis.AxisStatus.eErrorID;
g_sHMI_Mach_UnitStatus.eErrorIDRearaxis			:= KC_AxisBasics_Rear_axis.AxisStatus.eErrorID;
g_sHMI_Mach_UnitStatus.eErrorIDZaxis			:= KC_AxisBasics_Z_axis.AxisStatus.eErrorID;
g_sHMI_Mach_UnitStatus.eErrorIDRaxis			:= KC_AxisBasics_R_axis.AxisStatus.eErrorID;

(*****************************************************************************************************************************************************************)
(*axis diagnostic for dummy axis*)
(*TODO: Dit moet KC_AxisBasics worden en MC_Power weglaten in XYA_MoveLineair*)
ECSM_AxisDiagnostic_MasterRondVierkant.AxisControl.bResetError := g_HMI_MachCommand.CMD.bResetErrorPulse;
ECSM_AxisDiagnostic_MasterRondVierkant.AxisControl.bEnableDrive := TRUE;
ECSM_AxisDiagnostic_MasterRondVierkant.AxisControl.lrQuickStopDec := 2000;

ECSM_AxisDiagnostic_MasterRondVierkant(
	AxisControl:= , 
	strHomingParameters:= , 
	bEnableSWLimits:= , 
	bEnableHWLimits:= ,
	I_bVirtual := TRUE, 
	AxisName:= MasterRondVierkant, 
	AxisStatus=> );

END_PROGRAM
