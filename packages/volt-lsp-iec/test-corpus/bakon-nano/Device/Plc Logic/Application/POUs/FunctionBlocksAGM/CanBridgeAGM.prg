PROGRAM CanBridgeAGM
VAR
END_VAR

//Set bus variables to local
g_dwAGM1_PowerLoss 							:= CAN_TO_PLC.dwAGM1_PowerLoss;
g_rAGM1_Frequency 							:= CAN_TO_PLC.rAGM1_Frequency;
g_sMACH.ERR.bAGM1_CommFailure 				:= CAN_TO_PLC.bAGM1_CommFailure;
g_sHMI_Mach_UnitStatus.dwErrorDetailsAGM1 	:= CAN_TO_PLC.dwErrorDetailsAGM1;
g_sMACH.ERR.bUltrasonic1					 := CAN_TO_PLC.bUltrasonic1;

//Set local variables to the bus
PLC_TO_CAN.g_bOnDelayed 								:= g_bOnDelayed;
PLC_TO_CAN.g_bDQ_Ultrasonic1 							:= g_bDQ_Ultrasonic1;
PLC_TO_CAN.g_bTestAGM1									:= g_bTestAGM1;
PLC_TO_CAN.g_HMI_MachCommand.bScanMode					:= g_HMI_MachCommand.bScanMode;
PLC_TO_CAN.g_HMI_RCP_Parameters.dwUltrasonicPower1		:= g_HMI_RCP_Parameters.dwUltrasonicPower1;
PLC_TO_CAN.g_HMI_MCH_Parameters.bUltrasonicEnable1		:= g_HMI_MCH_Parameters.bUltrasonicEnable1;
PLC_TO_CAN.C_rMaxPowerUS1								:= C_rMaxPowerUS1;

END_PROGRAM
