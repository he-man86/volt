PROGRAM OutputControl
VAR
	tofResetSafety	: TOF;
END_VAR

g_bDQ_LampStart				:= 		g_sMACH.ERR.bPressStartForManual
								OR	g_sMACH.ERR.bPressStartToCleanInit
								OR	(g_sMACH.ERR.bPressStartToCut AND NOT g_HMI_MachCommand.bScanMode)
								OR	g_sMACH.ERR.bPressStartToInit;
								//OR	g_bDI_MachineInSafePosition;

//Reset signal to safety			
tofResetSafety(
	IN:=g_HMI_MachCommand.CMD.bResetEmergencyStop,
	PT:=T#250MS,
	Q=>g_bDQ_ResetSafety
);

g_HMI_MachCommand.CMD.bResetEmergencyStop := FALSE;	//Auto RESET-bit from HMI

//Start signal to safety
g_bDQ_LightCurtainActive := InputControl.bStartPressed;

(*thirth module *)
g_byOutputs_Module_00.0		:= g_bDQ_ResetSafety;
g_byOutputs_Module_00.1		:= g_bDQ_LightCurtainActive;
g_byOutputs_Module_00.2		:= g_bDQ_MainValve;
g_byOutputs_Module_00.3		:= g_bDQ_Ultrasonic1;
g_byOutputs_Module_00.4		:= g_bDQ_LampStart;
g_byOutputs_Module_00.5		:= g_bDQ_Servo_Power_Reset;
g_byOutputs_Module_00.6		:= g_bDQ_Buzzer;
g_byOutputs_Module_00.7		:= g_bDQ_Spare_17;

(*fourth module *)
g_byOutputs_Module_01.0		:= g_bDQ_CleaningContainerUp;
g_byOutputs_Module_01.1		:= g_bDQ_CleaningContainerDown;
g_byOutputs_Module_01.2		:= g_bDQ_CleaningAirValve;
g_byOutputs_Module_01.3		:= g_bDQ_CleaningWaterValve;
g_byOutputs_Module_01.4		:= g_bDQ_Spare_24;
g_byOutputs_Module_01.5		:= g_bDQ_Spare_25;
g_byOutputs_Module_01.6		:= g_bDQ_Spare_26;
g_byOutputs_Module_01.7		:= g_bDQ_Spare_27;

(*sixth module *)
g_wOutputs_Module_00		:= TO_WORD((TO_REAL(g_iAQ_UltrasonicPower)/100)*16384);
g_wOutputs_Module_01		:= TO_WORD((TO_REAL(g_iAQ_Spare_01)/100)*16384);

(*Data to IO *)
//Digital
%QB1						:= g_byOutputs_Module_00;
%QB2						:= g_byOutputs_Module_01;
//Analog
%QW2						:= g_wOutputs_Module_00;
%QW3						:= g_wOutputs_Module_01;

END_PROGRAM
