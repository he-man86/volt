PROGRAM MACH_DRV_DriverCall (* call all cylinder drivers *)
VAR
	Ultrasonic1		: DRV_AGM_IO;
	tMainValve		: TOF;
	Cyl_Cleaning	: DRV_CYL1C2D_SafeEnd;
	bCylCleaningCylUpAllowed	: BOOL;
END_VAR

(**********************************************************************************************************)
(*Lampen & Signalen*)
(**********************************************************************************************************)
(*Drv_Lights(
	I_bErrorLevel4:= IQ_sTWD_Data.ERH.bErrorCategory4,
	I_bErrorLevel32:= IQ_sTWD_Data.ERH.bErrorCategory3 OR IQ_sTWD_Data.ERH.bErrorCategory2,
	I_bInitialising:= IQ_sTWD_Data.MCL.bActInitialise,
	I_bWaitForAutomatic:= IQ_sTWD_Data.MCL.nStepCounter = 6,
	I_bAutomatic:= IQ_sTWD_Data.MCL.bActAutomatic,
	I_bESActive:= NOT IQ_sIO_DATA.bDI_SafetyOK,
	I_bFilling:= IQ_sIO_DATA.bDQ_ProductRequest,
	I_bMachineAtTemp:= IQ_sTWD_Data.sHeatingStatus.bTempInTarget OR (sRCP_Parameters.nEnableHeating = 0),
	I_sControl:= IQ_sTWD_Data.sLights,
	Q_bMachinestandby=> ,	Q_bDepositActive=> IQ_sIO_DATA.bDQ_DepositActive,
	Q_bMachineFault=> IQ_sIO_DATA.bDQ_MachineFaultActive,
	Q_bGreenLight=> IQ_sIO_DATA.bDQ_MachineStandby,	(*AC Dit is misschien niet helemaal logisch bedraad?....*)
	Q_bOrangeLight=>IQ_sIO_DATA.bDQ_SignalOrange ,
	Q_bRedLight=> IQ_sIO_DATA.bDQ_SignalRed);
*)

(***************************************************************************************************************************)

(**********************************************************************************************************)
(* Airvalve:  *)
(**********************************************************************************************************)
tMainValve(IN := (g_sMACH.aut.bActAutomatic AND g_bDI_StartButton) OR g_bDQ_Ultrasonic1, PT := REAL_TO_TIME(g_HMI_MCH_Parameters.rTimeSwitchOffAirvalve * 60 * 1000));	(* Input HMI in minutes! *)
g_bDQ_MainValve := tMainValve.Q;

(**********************************************************************************************************)
(* Ultrasonic AGM *)
(**********************************************************************************************************)
Ultrasonic1(
	I_bCMD_Enable		:= g_bDI_ES_DirectOK AND (g_HMI_MCH_Parameters.bUltrasonicEnable1 OR g_sMACH.MCL.bActManual),
	I_bCMD_Start		:= (g_bCMD_US_Start1 AND NOT g_HMI_MachCommand.bScanMode) AND (g_bUS_EnableRV OR g_bUS_EnableCleaning),
	I_bCMD_Test			:= g_bCMD_US_Test1 OR (g_bCMD_US_Start1 AND g_HMI_MachCommand.bScanMode),			(* Only manual command *)
	I_bCMD_Reset		:= (g_HMI_MCH_Parameters.bUltrasonicEnable1 AND g_HMI_MachCommand.CMD.bResetErrorPulse),
	Q_bStart_AGM		:= g_bDQ_Ultrasonic1,
	Q_bTest_AGM			:= g_bTestAGM1);

(**********************************************************************************************************)
(* Cylinder Cleaning water container *)
(**********************************************************************************************************)
IF	gMachConfig.bCleaningUnit
THEN
	g_sMACH.sCleaningContainerControl.bErrorReset := g_HMI_MachCommand.CMD.bResetErrorPulse;

	bCylCleaningCylUpAllowed :=	(g_uStatus_X_Axis.lrActPosition <= 3)// g_HMI_MCH_Parameters.rCleanXPosStart + 1)(*Veilig indien messen voor x positie staan!*)
							AND ((g_uStatus_X_Axis.eStateAxis = L_MC1P_AXIS_STATE.StandStill) OR (g_uStatus_X_Axis.eStateAxis = L_MC1P_AXIS_STATE.Disabled))
							//AND (g_uStatus_Y_Axis.lrActPosition >= g_HMI_MCH_Parameters.rCleanYPosStop - 1)
							//AND ((g_uStatus_Y_Axis.eStateAxis = L_MC1P_AXIS_STATE.StandStill) OR (g_uStatus_Y_Axis.eStateAxis = L_MC1P_AXIS_STATE.Disabled))
							//AND	(g_uStatus_R_Axis.lrActPosition > 89.0)
							//AND	(g_uStatus_R_Axis.lrActPosition < 91.0)
							AND ((g_uStatus_R_Axis.eStateAxis = L_MC1P_AXIS_STATE.StandStill) OR (g_uStatus_R_Axis.eStateAxis = L_MC1P_AXIS_STATE.Disabled));

	Cyl_Cleaning(
		I_bCylEndPos	:= g_bDI_CleaningContainerUp, 
		I_bCylZeroPos	:= g_bDI_CleaningContainerDown, 
		I_bSafeEndOK		:= bCylCleaningCylUpAllowed, 
		I_sControl		:= g_sMACH.sCleaningContainerControl, 
		I_rTimeOut		:= g_HMI_MCH_Parameters.rCleanContainerTimeOut, 
		DRV_ERR_CylEndPos:= g_sMACH.ERR.bCleaningContainerEndPos, 
		DRV_ERR_CylZeroPos:= g_sMACH.ERR.bCleaningContainerZeroPos, 
		DRV_ERR_CylMultiple:= g_sMACH.ERR.bCleaningContainerEndZero,
		DRV_ERR_SafetyNOK	:= g_sMACH.ERR.bCleaningContainerNotSafeToMove, 
		Q_bCylToEndPos	=> g_bDQ_CleaningContainerUp, 
		Q_bCylToZeroPos	=> g_bDQ_CleaningContainerDown, 
		Q_sStatus		=> g_sMACH.sCleaningContainerStatus);

ELSE
		g_sMACH.ERR.bCleaningContainerEndPos	:= FALSE;
		g_sMACH.ERR.bCleaningContainerZeroPos	:= FALSE;
		g_sMACH.ERR.bCleaningContainerEndZero	:= FALSE;
		g_sMACH.ERR.bCleaningContainerNotSafeToMove	:= FALSE;
END_IF

END_PROGRAM
