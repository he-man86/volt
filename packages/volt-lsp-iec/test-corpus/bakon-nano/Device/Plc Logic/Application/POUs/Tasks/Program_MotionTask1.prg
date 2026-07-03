PROGRAM Program_MotionTask1
VAR
	Transform_XY_FrontRear1: Transform_XY_FrontRear;
	rSpeedTableXY: REAL;
	rAccDecTableXY: REAL;
	L_SuspendWatchdog1 : L_SuspendWatchdog;
	initializeArrays : BOOL := true;
END_VAR

IF initializeArrays THEN
	Stack_Init_CuttingPos(IQ_dataArray:=g_aCuttingPositions, IQ_dataArrayInfo := g_sCuttingPositionsInfo);
	Stack_Init_CuttingPos(IQ_dataArray:=g_aWastePositions, IQ_dataArrayInfo := g_sWastePositionsInfo);
	g_sCuttingPositionsInfo.TEMPISWASTE := FALSE;
	g_sWastePositionsInfo.TEMPISWASTE := TRUE;
		
	initializeArrays := FALSE;
END_IF


L_SuspendWatchdog1(bExecute:=TRUE,wNumberOfCycles := 20);
AxisControlMotion();
InputControl();
MACH_AUT_Automatic();
MACH_SUB_CleanCycle();
MACH_SUB_Initialise();

g_uParRondVierkant.strZasParameters.rBottomZPos			 := g_sCalculated.rBottomZPos;
(*g_uParRondVierkant.strZasParameters.rProductHeigt			 := g_sCalculated.rProductHeigt; *)
g_uParRondVierkant.strZasParameters.rAboveProductPos	 := g_sCalculated.rAboveProductPos;
g_uParRondVierkant.strZasParameters.rCrashCheckHeight	 := g_sCalculated.rCrashCheckHeight;
g_uParRondVierkant.strZasParameters.rTopZPos				:= 0;	(* Vaste waarde *)
g_uParRondVierkant.strZasParameters.rSpeedOutProduct	:=(Z_axis.scPar.MaxVelocity / 100) * (g_HMI_RCP_Parameters.rCutSpeedZ_Down1);
g_uParRondVierkant.strZasParameters.rCuttingSpeedDown	:= (Z_axis.scPar.MaxVelocity / 100) * (g_HMI_RCP_Parameters.rCutSpeedZ_Down2)	;
g_uParRondVierkant.strZasParameters.rCuttingSpeedUp		:= (Z_axis.scPar.MaxVelocity / 100) * (g_HMI_RCP_Parameters.rCutSpeedZ_Up1)	;

g_uParRondVierkant.rTrimAcceleration						:=g_uParRondVierkant.rTrimVelocity * 10;
g_uParRondVierkant.rTrimDeceleration						:=g_uParRondVierkant.rTrimVelocity * 10;
rSpeedTableXY	:= SEL(g_HMI_MachCommand.bScanMode,	g_HMI_RCP_Parameters.rSpeedTableXY/100.0,1);
rAccDecTableXY	:= SEL(g_HMI_MachCommand.bScanMode,	g_HMI_RCP_Parameters.rSpeedTableXY/100.0,1);
IF	rSpeedTableXY < 0.3 THEN
	rSpeedTableXY	:= 0.3;
ELSIF	rSpeedTableXY > 1.0 THEN
	rSpeedTableXY	:= 1.0;
END_IF
IF	rAccDecTableXY < 0.3 THEN
	rAccDecTableXY	:= 0.3;
ELSIF	rAccDecTableXY > 1.0 THEN
	rAccDecTableXY	:= 1.0;
END_IF

ModusRondVierkant(
	I_bEnable				:= ModusRV.bEnable, 				(*altijd hoog tijdens bedrijf, deze input valt af bij een noodstop*)
	I_bStartXYA			:= ModusRV.bStartXYA,				(*bij begin van rond of vierkant kun je hiermee naar de eerste snijlijn gaan met XYR, Dit moet een puls zijn*)
	I_bStartZ				:= ModusRV.bStartZ, 					(*hiermee start je ook de Z-as voor de eerste keer, dit signaal moet altijd hoog zijn tijdens het bewerken van een blik*)
	I_TableCheckSensor	:= g_bDI_TableCheck,
	I_bTestMode			:= g_HMI_MachCommand.bTestMode OR g_HMI_MachCommand.bScanMode,
	I_strParameters		:= g_uParRondVierkant, 			(*parameters voor XYR gekoppeld aan data structs, strRondVierkantParameters*)
	I_rSpeedOverride		:=  rSpeedTableXY,		(*snelheidsverhouding om naar eerste snijlijn te gaan en om naar eindposities te gaan als het rond of vierkant klaar is. 1.0 =100%, 0.1 is minimum*)
	I_rAccOverride			:= rAccDecTableXY,		(*acc/decc verhouding om naar eerste snijlijn te gaan en om naar eindposities te gaan als het rond of vierkant klaar is. 1.0 =100%, 0.1 is minimum*)
	I_rX_InfeedPosition	:= g_HMI_MCH_Parameters.rInfeedPosition_X,			(* opleg positie *)
	I_rY_InfeedPrePosition	:= g_HMI_MCH_Parameters.rInfeedPosition_Y + 30,			(* @TODO: preopleg positie als mach par?*)
	I_rY_InfeedPosition	:= g_HMI_MCH_Parameters.rInfeedPosition_Y,			(* opleg positie *)
	I_rA_EndTarget		:= 0,  		(* (g_rEndTargetA) eindpositie nadat rond of vierkant klaar is*)
	IQ_AxisX				:= X_axis ,
	IQ_AxisY				:= Y_axis ,
	IQ_AxisA				:= R_axis ,
	IQ_AxisZ				:= Z_axis ,
	IQ_AxisDummy		:= MasterRondVierkant ,
	IQ_strTarget			:= g_aCuttingPositions , 		(*product array met X,Y en R posities, zie data struct XYA_Target*)
	Q_bReady							=> ModusRV.bReady, 						(*wordt hoog als XYR en Z klaar zijn met bewerken rond of vierkant*)
	Q_bLastCutReadyZOutOfProduct	=> ModusRV.bLastCutReadyZOutOfProduct, (*wordt hoog bij laatste snijlijn als Z uit product komt, XY en R bewegen nu naar eindtargets*)
	Q_bErrorTargetPosInSWLimits		=> , 		(*error doelpositie XYR liggen buiten SW limits*)
	Q_bErrorAccDeccZ					=> , 		(*error ingestelde acc en decc Z*)
	Q_bErrorSpeedZToHigh				=> , 		(*error ingesteld speed Z*)
	Q_nActLineNumber					=> ModusRV.nActLineNumber);					(*act line uit product array*)


(*call transformation for X and Y to front and rear axis*)
(* Feedconstant 204.2035mm with Getriebe i=22 *)
Transform_XY_FrontRear1.scParamRobot.lrFeedConstantA1	:=(204.2035 / 22);
Transform_XY_FrontRear1.scParamRobot.lrFeedConstantA2	:=(204.2035 / 22);

Transform_XY_FrontRear1(
	xEnable:= ,						(*deze enable dient aan te zijn wanneer de transformatie geen fout heeft*)
	xSetRealPosToVirtualAxis:= , 	(*zet dit bitje hoog nadat de absoluutgevers zijn genuld*)
	scParamRobot:= ,
	scLimitRobot:= ,
	Drive_X:=Y_axis ,
	Drive_Y:=X_axis ,
	Drive_A1:= Front_Axis,
	Drive_A2:=  Rear_Axis,
	xBusy=> ,						(*Dit bitje meenemen voordat je de x en y kunt laten draaien,*)
	xError=> , 						(*bij een interne error worden automatisch de echter assen gestopt*)
	xVirtualAxisPositionsSetOK=> , (*Dit bitje geeft aan dat de werkelijk positie van echte assen eenmalig in de x en y zijn geladen*)
	lrActPosX=> ,
	lrActPosY=> );

IF 		NOT Transform_XY_FrontRear1.xError
		AND	(g_uStatus_X_Axis.bDriveEnabled) //OR (g_uStatus_X_Axis.bDriveEnabled AND g_uControl_X_Axis.bStartManualMode))
		AND	(g_uStatus_Y_Axis.bDriveEnabled) //OR (g_uStatus_Y_Axis.bDriveEnabled AND g_uControl_Y_Axis.bStartManualMode))
		AND	(g_uStatus_Rear_Axis.bDriveEnabled) (*OR (g_uStatus_Rear_Axis.bDriveEnabled AND g_uControl_Rear_Axis.bStartManualMode))*)
		AND	(g_uStatus_Front_Axis.bDriveEnabled) (*OR (g_uStatus_Front_Axis.bDriveEnabled AND g_uControl_Front_Axis.bStartManualMode))*)
		AND (g_sMACH.MCL.bActManual OR g_sMACH.MCL.bActInitialise OR g_sMACH.MCL.bActAutomatic OR g_sMACH.MCL.bActCleaning)
THEN
		Transform_XY_FrontRear1.xEnable	:=TRUE;
ELSE
		Transform_XY_FrontRear1.xEnable	:=FALSE;

END_IF


OutputControl();

(*cycle time calculation*)
(*dwTime				:=TIME_TO_DWORD(TIME());
IF xInit THEN
	dwCycleTime		:=dwTime - dwTimeOld;
END_IF

dwTimeOld			:=dwTime;

rCycleTime			:=DWORD_TO_REAL(dwCycleTime) / 1000;

IF rCycleTimeMin=0 OR rCycleTimeMax=0  THEN
rCycleTimeMin		:=rCycleTime*2;
rCycleTimeMax		:=rCycleTime/2;
END_IF

xInit				:=TRUE;

rCycleTimeMin		:=MIN(rCycleTimeMin,rCycleTime);
rCycleTimeMax		:=MAX(rCycleTimeMax,rCycleTime);
*)

IF g_HMI_MachCommand.bScanMode THEN
	g_sHMI_ScanData.rMaxFrontFollowError := MAX(g_sHMI_ScanData.rMaxFrontFollowError,ABS(g_uStatus_Front_Axis.lrActFollowError));
	g_sHMI_ScanData.rMaxRearFollowError := MAX(g_sHMI_ScanData.rMaxRearFollowError,ABS(g_uStatus_Rear_Axis.lrActFollowError));
	g_sHMI_ScanData.rMaxZFollowError := MAX(g_sHMI_ScanData.rMaxZFollowError,ABS(g_uStatus_Z_Axis.lrActFollowError));
	g_sHMI_ScanData.rMaxRFollowError := MAX(g_sHMI_ScanData.rMaxRFollowError,ABS(g_uStatus_R_Axis.lrActFollowError));
	
	g_sHMI_ScanData.rMaxFrontTorque := MAX(g_sHMI_ScanData.rMaxFrontTorque,ABS(Front_Axis.lrActTorque));
	g_sHMI_ScanData.rMaxRearTorque := MAX(g_sHMI_ScanData.rMaxRearTorque,ABS(Rear_Axis.lrActTorque));
	g_sHMI_ScanData.rMaxZTorque := MAX(g_sHMI_ScanData.rMaxZTorque,ABS(Z_Axis.lrActTorque));
	g_sHMI_ScanData.rMaxRTorque := MAX(g_sHMI_ScanData.rMaxRTorque,ABS(R_Axis.lrActTorque));

	g_sHMI_ScanData.rMaxFrequency	:= MAX(g_sHMI_Mach_UnitStatus.rAGM1_Frequency,g_sHMI_ScanData.rMaxFrequency);
	g_sHMI_ScanData.rMaxPowerLoss	:= MAX(g_sHMI_ScanData.rMaxPowerLoss, g_sHMI_Mach_UnitStatus.dwAGM1_PowerLoss);
ELSE
	g_sHMI_ScanData.rMaxFrontFollowError := 0;
	g_sHMI_ScanData.rMaxRearFollowError := 0;
	g_sHMI_ScanData.rMaxZFollowError := 0;
	g_sHMI_ScanData.rMaxRFollowError := 0;
	
	g_sHMI_ScanData.rMaxFrontTorque := 0;
	g_sHMI_ScanData.rMaxRearTorque := 0;
	g_sHMI_ScanData.rMaxZTorque := 0;
	g_sHMI_ScanData.rMaxRTorque := 0;

	g_sHMI_ScanData.rMaxFrequency	:= 0;
	g_sHMI_ScanData.rMaxPowerLoss	:= 0;	
END_IF

END_PROGRAM
