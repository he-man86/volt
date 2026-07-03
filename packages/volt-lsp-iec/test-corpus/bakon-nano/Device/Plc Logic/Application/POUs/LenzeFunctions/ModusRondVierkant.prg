(***********************************************************************************
Creation: LENL 		Datum: juli 2012		Version: 1.0.0
 ***********************************************************************************
 FUNCTION:					

Cutting round or square products with XYAZ axis

 ***********************************************************************************
Name							Datum				Changes
Kling 							20.07.2012			Implementation		Version 1.0.0

************************************************************************************
NOTE:	

***********************************************************************************)
PROGRAM ModusRondVierkant

VAR
	MC_SetPosition1					: MC_SetPosition;
	XYA_MoveLineair_Bakon1			: XYA_MoveLineair_Bakon;
	byStepper						: BYTE;
	nLineNumber						: INT;
	nCount							: INT;
	R_TRIG1							: R_TRIG;
	byStepperOLd1					: BYTE;
	rZactPos						: REAL;
	rParaAccTime					: REAL:=0.1;
	Check_Table1					: Check_Table_V2;
	MC_MoveAbsoluteZ				: MC_MoveAbsolute;
	fRampJerkDummyAxis				: LREAL;
	rSlowPart						: REAL;
	nCleanCountProd					: INT;
	nCleanCountCuts					: INT;
	bLastCut						: BOOL;
	MC_HaltZ						: MC_Halt;
	rVelocityZ						: LREAL;
	rAccelerationZ					: LREAL;
	bCrashDetectWasOK				: BOOL;
END_VAR                         	
                                	
VAR_INPUT                       	
	I_bEnable						: BOOL;
	I_bStartXYA						: BOOL;
	I_bStartZ						: BOOL;
	I_TableCheckSensor				: BOOL;
	I_bTestMode						: BOOL;
	//I_bCleanRequest				: BOOL;
	I_strParameters					: strRondVierkantParameters;
	I_rSpeedOverride				: REAL:=0.5;
	I_rAccOverride					: REAL:=0.5;
	I_rX_InfeedPosition				: REAL;
	I_rY_InfeedPrePosition			: REAL;
	I_rY_InfeedPosition				: REAL;
	I_rA_EndTarget					: REAL;
END_VAR                         	
                                	
VAR_IN_OUT                      	
	IQ_AxisX						:AXIS_REF;
	IQ_AxisY						:AXIS_REF;
	IQ_AxisA						:AXIS_REF;
	IQ_AxisZ						:AXIS_REF;
	IQ_AxisDummy					:AXIS_REF;
	IQ_strTarget					: ARRAY [1..C_wNumberOfMotionObjects] OF XYA_Target;
END_VAR                         	
                                	
VAR_OUTPUT                      	
	Q_bReady						: BOOL;
	Q_bLastCutReadyZOutOfProduct	: BOOL;
	Q_bErrorTargetPosInSWLimits		: BOOL;
	Q_bErrorAccDeccZ				: BOOL;
	Q_bErrorSpeedZToHigh			: BOOL;
	Q_nActLineNumber				: INT;
	Q_byCounter						: BYTE;
END_VAR

MC_MoveAbsoluteZ(
	Execute:= ,
	Position:= ,
	Velocity:= ,
	Acceleration:= ,
	Deceleration:= ,
	Direction:=MC_DIRECTION.mcShortestWay ,
	Axis:=IQ_AxisZ ,
	Done=> ,
	CommandAborted=> ,
	Error=> ,
	ErrorID=> );

MC_HaltZ(
	Execute 	:= ,
	Deceleration:= IQ_AxisZ.scPar.MaxAcceleration,	//Was fSWMaxDeceleration in old motion
	Jerk		:= ,
	Axis		:= IQ_AxisZ,
	Done 	=> ,
	Busy 	=> ,
	CommandAborted =>,
	Error	=> ,
	ErrorID => );
	
MC_SetPosition1(
	Execute:= ,
	Position:=0 ,
	Relative:=FALSE ,
	Axis:=IQ_AxisDummy ,
	Done=> ,
	Error=> ,
	ErrorID=> );

XYA_MoveLineair_Bakon1(
	bEnable:= ,
	bPause:= ,
	rMoveMaster		:=359 ,
	strTarget:= ,
	rSpeedOverride	:=I_rSpeedOverride * rSlowPart,
	rAccOverride		:=I_rAccOverride ,
	bPositionMaster	:= ,
	AxisX				:=IQ_AxisX ,
	AxisY				:=IQ_AxisY ,
	AxisA				:=IQ_AxisA ,
	Master				:=IQ_AxisDummy ,
	bReady=> ,
	bBusy=> ,
	bErrorTargetPosInSWLimits=>Q_bErrorTargetPosInSWLimits ,
	nStatus=> );

Check_Table1(
	I_bStartCheck			:= ,				(* Start check when table moves from infeed position to first cutting position *)
	I_bSensor				:= I_TableCheckSensor,
	I_bTestModus			:= I_bTestMode,
	I_nProdTypeSelection	:= SEL(g_HMI_MachCommand.bScanMode, g_HMI_RCP_Parameters.nProductType,-1),
	I_nPartsRoundLeft		:= g_HMI_RCP_Parameters.nPartsRound,
	I_nPartsRoundRight		:= g_HMI_RCP_Parameters.nPartsRoundRight,
	I_rActualPositionY		:= g_uStatus_Y_Axis.lrActPosition,
	Q_TabelCheckOK			=> );

Q_nActLineNumber						:=nLineNumber;

(*Crash detectie sensor*)
IF 	NOT g_uStatus_Z_Axis.bDigIn1 
	AND g_uStatus_Z_Axis.lrActPosition < I_strParameters.strZasParameters.rCrashCheckHeight
	AND (byStepper = 9 OR byStepper = 10)  
	//AND g_HMI_RCP_Parameters.bCutWasteFirst
	AND gMachConfig.bCrashDetection 
	THEN
		g_sMACH.ERR.bCrashDetected := TRUE;
END_IF


IF NOT I_bEnable THEN
	MC_MoveAbsoluteZ.Execute		:=FALSE;
	MC_Setposition1.Execute			:=FALSE;
	XYA_MoveLineair_Bakon1.bEnable	:=FALSE;
	byStepper						:=0;
	nLineNumber						:=C_wNumberOfMotionObjects + 100;
	nCount							:=0;
	Q_byCounter						:=0;
	R_TRIG1(CLK:=FALSE);
	Q_bReady						:=FALSE;
	Q_bLastCutReadyZOutOfProduct	:=FALSE;
	Q_bErrorSpeedZToHigh			:=FALSE;
	Q_bErrorAccDeccZ				:=FALSE;
	g_bUS_EnableRV					:=FALSE;
	Check_Table1.I_bStartCheck		:=FALSE;
	rSlowPart						:= 1;
	MC_HaltZ.Execute				:= FALSE;
	bCrashDetectWasOK := FALSE;
ELSE

	(*actuele jerk time bij onderbreking van beweging*)
	fRampJerkDummyAxis					:=IQ_AxisDummy.scPar.JerkErrorStop;

(*	R_TRIG1(CLK:=(IQ_AxisZ.lrActPosition <= (I_strParameters.strZasParameters.rBottomZPos - I_strParameters.strZasParameters.rProductHeigt)) AND
				(IQ_AxisZ.lrActPosition >= (I_strParameters.strZasParameters.rBottomZPos - I_strParameters.strZasParameters.rProductHeigt - 10))); *)
	R_TRIG1(CLK:=(IQ_AxisZ.lrActPosition <= (I_strParameters.strZasParameters.rAboveProductPos)) AND
				(IQ_AxisZ.lrActPosition >= (I_strParameters.strZasParameters.rAboveProductPos - 10)));

	IF R_TRIG1.Q THEN
		byStepperOld1					:=byStepper;
		rZactPos							:=IQ_AxisZ.lrActPosition;
	END_IF

	CASE byStepper OF
	0:	IF I_bStartXYA THEN
			Q_bLastCutReadyZOutOfProduct	:=FALSE;
			Q_bReady							:=FALSE;
			nLineNumber						:=C_wNumberOfMotionObjects + 100;
			byStepper							:=2;
		END_IF

	(*check position table for XYA*)
	2:	FOR nCount:=C_wNumberOfMotionObjects TO 1 BY -1 DO
			IF (IQ_strTarget[nCount].X_Target >= 0) AND (IQ_strTarget[nCount].Y_Target >= 0) AND (IQ_strTarget[nCount].A_Target >= 0) THEN
				nLineNumber:=nCount;
			END_IF
		END_FOR
		IF nLineNumber = (C_wNumberOfMotionObjects + 100) THEN
			Q_bReady := TRUE;
			byStepper:=0;
		ELSE
			byStepper:=3;
		END_IF

	(* Go to the left in order to start the table check*)
	3:	XYA_MoveLineair_Bakon1.strTarget.X_Target:=C_rTargetX_TableCheck;
		XYA_MoveLineair_Bakon1.strTarget.Y_Target:=40;		(* @TODO: Mach Par ? *)
		XYA_MoveLineair_Bakon1.strTarget.A_Target:=IQ_strTarget[nLineNumber].A_Target;

		XYA_MoveLineair_Bakon1.bPositionMaster	:=TRUE;
		XYA_MoveLineair_Bakon1.bEnable			:=TRUE;

		IF XYA_MoveLineair_Bakon1.bReady THEN
			XYA_MoveLineair_Bakon1.bPositionMaster:=FALSE;
			XYA_MoveLineair_Bakon1.bEnable	:=FALSE;
			rSlowPart				:= 0.7;
			bCrashDetectWasOK := FALSE;
			byStepper				:=4;
		END_IF

	(* Go to the rear and start the table check*)
	4:	XYA_MoveLineair_Bakon1.strTarget.X_Target:=C_rTargetX_TableCheck;
		XYA_MoveLineair_Bakon1.strTarget.Y_Target:=SEL(gMachConfig.bXL, 265,390);		(* @TODO: Mach Par ? *)
		XYA_MoveLineair_Bakon1.strTarget.A_Target:=IQ_strTarget[nLineNumber].A_Target;

		XYA_MoveLineair_Bakon1.bPositionMaster	:=TRUE;
		XYA_MoveLineair_Bakon1.bEnable			:=TRUE;

		Check_Table1.I_bStartCheck			:= TRUE;		(* Check if table correspondents with recipe *)
		IF Check_Table1.Q_bCrashDetectionOK THEN
			bCrashDetectWasOK := TRUE;
		END_IF
		IF XYA_MoveLineair_Bakon1.bReady THEN
			IF	Check_Table1.Q_TabelCheckOK AND bCrashDetectWasOK THEN
				Check_Table1.I_bStartCheck				:= FALSE;
				XYA_MoveLineair_Bakon1.bPositionMaster	:=FALSE;
				XYA_MoveLineair_Bakon1.bEnable			:=FALSE;
				rSlowPart					:= 1.0;
				bCrashDetectWasOK := FALSE;
				byStepper					:=5;
			ELSE
				g_sMACH.ERR.bCrashDetectFault 	:= NOT bCrashDetectWasOK;
				g_sMACH.ERR.bWrongTable			:= NOT Check_Table1.Q_TabelCheckOK;
				Check_Table1.I_bStartCheck		:= FALSE;
			END_IF
		END_IF

	(*start first positioning of XYA*)
	5:	XYA_MoveLineair_Bakon1.strTarget:=IQ_strTarget[nLineNumber];
		XYA_MoveLineair_Bakon1.bPositionMaster	:=TRUE;
		XYA_MoveLineair_Bakon1.bEnable			:=TRUE;

		IF XYA_MoveLineair_Bakon1.bReady THEN
			XYA_MoveLineair_Bakon1.bPositionMaster:=FALSE;
			XYA_MoveLineair_Bakon1.bEnable	:=FALSE;
			(*nLineNumber					:=nLineNumber+1; *)
			byStepper						:=6;
		END_IF

	(*wait for startsignal Z*)
	6:	IF I_bStartZ THEN
			byStepper						:=8;
		END_IF

	(*set dummy to zero pos*)
	8:	MC_Setposition1.Execute			:=TRUE;
		IF MC_Setposition1.Done THEN
			MC_Setposition1.Execute	:=FALSE;
			IF IQ_strTarget[nLineNumber].bCrashDetectCheck AND g_uStatus_Z_Axis.lrActPosition < I_strParameters.strZasParameters.rAboveProductPos-8 THEN //AC Aanpassing 24-07-2018
				byStepper						:=9;
			ELSE
				byStepper						:=10;
			END_IF
		END_IF

	(*In between step for quick start i.c.w. edge detection*)
	9:	MC_MoveAbsoluteZ.Position		:= I_strParameters.strZasParameters.rCrashCheckHeight - 10; 	
		rVelocityZ	:= I_strParameters.strZasParameters.rCuttingSpeedDown;
		rAccelerationZ	:= I_strParameters.strZasParameters.rCuttingSpeedDown / rParaAccTime;
		MC_MoveAbsoluteZ.Velocity		:=rVelocityZ;
		MC_MoveAbsoluteZ.Acceleration	:=rAccelerationZ;
		MC_MoveAbsoluteZ.Deceleration	:=MC_MoveAbsoluteZ.Acceleration;
		MC_MoveAbsoluteZ.Execute		:= NOT g_sMACH.ERR.bCrashDetected; // TRUE;
		IF MC_MoveAbsoluteZ.Done OR g_sMACH.ERR.bCrashDetected THEN		(* Crash detection *)
			MC_MoveAbsoluteZ.Execute		:=FALSE;
			IF g_sMACH.ERR.bCrashDetected THEN	(* Crash detection *)
				MC_HaltZ.Execute	:= TRUE;
				IF MC_HaltZ.Done THEN
					MC_HaltZ.Execute	:= FALSE;
					byStepper	:= 12;
				END_IF
			ELSE
				byStepper		:= 10;
			END_IF
		END_IF
	(*z-as to bottom pos*)
	10:
		MC_MoveAbsoluteZ.Position		:=SEL(IQ_strTarget[nLineNumber].bCrashDetectCheck, I_strParameters.strZasParameters.rBottomZPos, I_strParameters.strZasParameters.rCrashCheckHeight);
		IF g_HMI_MachCommand.bScanMode THEN
			rVelocityZ		:= 480;
			rAccelerationZ	:= 480 / rParaAccTime;
		ELSIF IQ_strTarget[nLineNumber].bCrashDetectCheck THEN  // Langzamere snelheid tijdens crash check
			rVelocityZ	:= g_HMI_MCH_Parameters.rSpeedZ_CrashDetect;
			rAccelerationZ	:= 50 / rParaAccTime;
		ELSE
			rVelocityZ	:= I_strParameters.strZasParameters.rCuttingSpeedDown;
			rAccelerationZ	:= I_strParameters.strZasParameters.rCuttingSpeedDown / rParaAccTime;
		END_IF
		MC_MoveAbsoluteZ.Velocity		:=rVelocityZ;
		MC_MoveAbsoluteZ.Acceleration	:=rAccelerationZ;
		MC_MoveAbsoluteZ.Deceleration	:=MC_MoveAbsoluteZ.Acceleration;
		MC_MoveAbsoluteZ.Execute		:= NOT g_sMACH.ERR.bCrashDetected; // TRUE;
		IF MC_MoveAbsoluteZ.Done OR g_sMACH.ERR.bCrashDetected THEN		(* Crash detection *)
			MC_MoveAbsoluteZ.Execute		:=FALSE;
			IF g_sMACH.ERR.bCrashDetected THEN	(* Crash detection *)
				MC_HaltZ.Execute	:= TRUE;
				IF MC_HaltZ.Done THEN
					MC_HaltZ.Execute	:= FALSE;
					byStepper	:= 12;
				END_IF
			ELSE
				byStepper		:= 12;
			END_IF
		END_IF

	(*z-as to above or top product pos*)
	12:
		IF		((IQ_strTarget[nLineNumber+1].X_Target = -50)	(* controleer de volgende positie *)
			AND	(IQ_strTarget[nLineNumber+1].Y_Target = -50)
			AND	(IQ_strTarget[nLineNumber+1].A_Target = -50))
			OR	g_sMACH.ERR.bCrashDetected
		THEN
			MC_MoveAbsoluteZ.Position		:=I_strParameters.strZasParameters.rTopZPos;
			MC_MoveAbsoluteZ.Velocity		:=SEL(g_HMI_MachCommand.bScanMode,	I_strParameters.strZasParameters.rCuttingSpeedUp,480);//I_strParameters.strZasParameters.rCuttingSpeedUp;			(* Std V02.09, was voorheen rSpeedOutProduct *)
			IF R_TRIG1.Q THEN
				Q_bLastCutReadyZOutOfProduct		:=TRUE;
			END_IF
		ELSE
			MC_MoveAbsoluteZ.Position		:=I_strParameters.strZasParameters.rAboveProductPos;
			MC_MoveAbsoluteZ.Velocity		:=SEL(g_HMI_MachCommand.bScanMode,	I_strParameters.strZasParameters.rCuttingSpeedUp,480);//I_strParameters.strZasParameters.rCuttingSpeedUp;
		END_IF

		MC_MoveAbsoluteZ.Acceleration	:=(MC_MoveAbsoluteZ.Velocity / rParaAccTime);
		MC_MoveAbsoluteZ.Deceleration	:=MC_MoveAbsoluteZ.Acceleration;
		MC_MoveAbsoluteZ.Execute		:=TRUE;
		IF		MC_MoveAbsoluteZ.Done
			//OR	R_TRIG1.Q
		THEN
				Q_byCounter					:=Q_byCounter + BOOL_TO_BYTE(NOT g_sMACH.ERR.bCrashDetected);
				IQ_strTarget[nLineNumber].X_Target	:=-50;
				IQ_strTarget[nLineNumber].Y_Target	:=-50;
				IQ_strTarget[nLineNumber].A_Target	:=-50;
				nLineNumber					:=nLineNumber+1;
				bLastCut	:= 	(IQ_strTarget[nLineNumber].X_Target = -50)	// Laatste snede
							AND	(IQ_strTarget[nLineNumber].Y_Target = -50)
							AND	(IQ_strTarget[nLineNumber].A_Target = -50);
				IF	bLastCut THEN
					nCleanCountProd	:= nCleanCountProd + 1;	// ophogen productteller
				END_IF
				nCleanCountCuts	:= nCleanCountCuts + 1; // ophogen snijteller
				IF g_HMI_RCP_Parameters.nCleanAfterNProd = 0 THEN
					nCleanCountCuts := 0;
					nCleanCountProd := 0;	
				END_IF
				byStepper					:=14;
		END_IF

	(*start next positioning of XYA or Cleaning cycle or Last cut *)
	14:	(* Clean request *)
		IF		((g_HMI_MachCommand.CMD.bCleanKnifeRequest AND (g_HMI_RCP_Parameters.nCleanProdOrCuts = nCleanAfterProducts) AND bLastCut)
			OR	(g_HMI_MachCommand.CMD.bCleanKnifeRequest AND (g_HMI_RCP_Parameters.nCleanProdOrCuts = nCleanAfterCuts))
			OR  ((nCleanCountProd >= g_HMI_RCP_Parameters.nCleanAfterNProd) AND (g_HMI_RCP_Parameters.nCleanAfterNProd <> 0) AND (g_HMI_RCP_Parameters.nCleanProdOrCuts = nCleanAfterProducts))
			OR  ((nCleanCountCuts >= g_HMI_RCP_Parameters.nCleanAfterNProd) AND (g_HMI_RCP_Parameters.nCleanAfterNProd <> 0) AND (g_HMI_RCP_Parameters.nCleanProdOrCuts = nCleanAfterCuts)))
			AND	gMachConfig.bCleaningUnit
			AND NOT g_sMACH.ERR.bCrashDetected
		THEN
			nCleanCountProd	:= 0;
			nCleanCountCuts	:= 0;
			g_bCleanRequest	:= TRUE;
		END_IF
	
		(*start next positioning of XYA or Cleaning cycle or Last cut *)
		IF		bLastCut
			OR	g_bCleanRequest
			OR	g_sMACH.ERR.bCrashDetected
		THEN
			MC_MoveAbsoluteZ.Velocity	:=SEL(g_HMI_MachCommand.bScanMode,	I_strParameters.strZasParameters.rCuttingSpeedUp,480);//I_strParameters.strZasParameters.rCuttingSpeedUp;I_strParameters.strZasParameters.rSpeedOutProduct;			(* Std V02.09, snelheid boven product hoger *)
			MC_MoveAbsoluteZ.Execute	:=FALSE;						(* Std V02.09, snelheid boven product hoger *)
			IF	(bLastCut AND NOT g_bCleanRequest) OR g_sMACH.ERR.bCrashDetected THEN
				byStepper					:=20;
			ELSE
				g_bCleanRequest	:= FALSE;
				g_HMI_MachCommand.CMD.bCleanKnifeRequest	:= FALSE;
				g_bSUB_CleanKnifeStart		:= TRUE;
				byStepper					:=16;
			END_IF
		ELSE
			MC_MoveAbsoluteZ.Execute	:=FALSE;
			XYA_MoveLineair_Bakon1.strTarget	:= IQ_strTarget[nLineNumber];
			XYA_MoveLineair_Bakon1.bPositionMaster	:=TRUE;
			XYA_MoveLineair_Bakon1.bEnable			:=TRUE;
			IF XYA_MoveLineair_Bakon1.bReady THEN
				XYA_MoveLineair_Bakon1.bPositionMaster:=FALSE;
				XYA_MoveLineair_Bakon1.bEnable	:=FALSE;
				(*IQ_strTarget[nLineNumber].X_Target	:=-50;
				IQ_strTarget[nLineNumber].Y_Target	:=-50;
				IQ_strTarget[nLineNumber].A_Target	:=-50;
				nLineNumber							:=nLineNumber+1; *)
				byStepper						:=8;
			END_IF
		END_IF

	(* Wait for Cleaning cycle done *)
	16:
	IF	g_bSUB_CleanKnifeDone
	THEN
		g_bSUB_CleanKnifeStart			:= FALSE;
	END_IF
	
	IF NOT g_bSUB_CleanKnifeStart THEN
		IF	bLastCut THEN
			byStepper					:=20;		
		ELSE
			XYA_MoveLineair_Bakon1.strTarget	:= IQ_strTarget[nLineNumber];
			XYA_MoveLineair_Bakon1.bPositionMaster	:=TRUE;
			XYA_MoveLineair_Bakon1.bEnable			:=TRUE;
			IF XYA_MoveLineair_Bakon1.bReady THEN
				XYA_MoveLineair_Bakon1.bPositionMaster:=FALSE;
				XYA_MoveLineair_Bakon1.bEnable	:=FALSE;
				byStepper						:=8;
			END_IF
		END_IF
	END_IF		
		
	(*pos back XYA to operator place pre position *)
	20:
		MC_MoveAbsoluteZ.Execute	:= TRUE;						(* Std V02.09, snelheid boven product hoger *)
		XYA_MoveLineair_Bakon1.strTarget.X_Target:=I_rX_InfeedPosition;
		XYA_MoveLineair_Bakon1.strTarget.Y_Target:=I_rY_InfeedPrePosition;
		XYA_MoveLineair_Bakon1.strTarget.A_Target:=0;	// Ivm beperkte hoogte Nano mes altijd naar 0 graden!!   I_rA_EndTarget;
		XYA_MoveLineair_Bakon1.bPositionMaster	:=TRUE;
		XYA_MoveLineair_Bakon1.bEnable			:=TRUE;
		IF XYA_MoveLineair_Bakon1.bReady THEN
			XYA_MoveLineair_Bakon1.bPositionMaster	:=FALSE;
			XYA_MoveLineair_Bakon1.bEnable			:=FALSE;
			//nCleanCount					:= nCleanCount + 1;
			byStepper								:=22;
		END_IF

	(*pos back XYA to operator place position *)
	22:
		rSlowPart			:= 0.25;
		XYA_MoveLineair_Bakon1.strTarget.X_Target:=I_rX_InfeedPosition;

		IF I_bTestMode THEN
			XYA_MoveLineair_Bakon1.strTarget.Y_Target:=I_rY_InfeedPrePosition;
		ELSE
			XYA_MoveLineair_Bakon1.strTarget.Y_Target:=I_rY_InfeedPosition;
		END_IF
		IF	MC_MoveAbsoluteZ.Done THEN
			MC_MoveAbsoluteZ.Execute	:=FALSE;
			XYA_MoveLineair_Bakon1.strTarget.A_Target:=I_rA_EndTarget;
			XYA_MoveLineair_Bakon1.bPositionMaster	:=TRUE;
			XYA_MoveLineair_Bakon1.bEnable			:=TRUE;
		END_IF
		IF XYA_MoveLineair_Bakon1.bReady
		THEN
			XYA_MoveLineair_Bakon1.bPositionMaster	:=FALSE;
			XYA_MoveLineair_Bakon1.bEnable			:=FALSE;
			rSlowPart								:=1;
			Q_bReady								:=TRUE;
			Q_byCounter								:=0;
			byStepper								:=0;
		END_IF

	END_CASE

	IF (MC_MoveAbsoluteZ.Acceleration > IQ_AxisZ.scPar.MaxAcceleration) OR
		(MC_MoveAbsoluteZ.Acceleration > IQ_AxisZ.scPar.MaxAcceleration) THEN
		Q_bErrorAccDeccZ:=TRUE;
	ELSE
		Q_bErrorAccDeccZ:=FALSE;
	END_IF
	IF (I_strParameters.strZasParameters.rSpeedOutProduct > IQ_AxisZ.scPar.MaxVelocity) OR
		(I_strParameters.strZasParameters.rCuttingSpeedDown > IQ_AxisZ.scPar.MaxVelocity) OR
		(I_strParameters.strZasParameters.rCuttingSpeedUp > IQ_AxisZ.scPar.MaxVelocity) THEN
		Q_bErrorSpeedZToHigh:=TRUE;
	ELSE
		Q_bErrorSpeedZToHigh:=FALSE;
	END_IF

	g_bUS_EnableRV	:= 		((IQ_AxisZ.lrActPosition >= (I_strParameters.strZasParameters.rBottomZPos - g_HMI_RCP_Parameters.rUSHeightStart)) AND byStepper = 10)
						OR	((IQ_AxisZ.lrActPosition >= (I_strParameters.strZasParameters.rBottomZPos - g_HMI_RCP_Parameters.rUSHeightStop)) AND byStepper = 12);

END_IF

END_PROGRAM
