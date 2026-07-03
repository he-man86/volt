PROGRAM InputControl
VAR
	bStartPressed		: BOOL;
	tonDelayStartButton : TON;
END_VAR

(*TODO: IO Direct aan Station IO Hangen*)
//The quick brown fox jumps over the lazy dog

(*Data from IO *)
//Digital
g_byInputs_Module_00			:= %IB8;
g_byInputs_Module_01			:= %IB9;
//Analog
g_wInputs_Module_00				:= %IW5;
g_wInputs_Module_01				:= %IW6;
	                                
(*first  module *)                  
g_bDI_ES_DirectOK				:= g_byInputs_Module_00.0;
g_bDI_CircuitBreaker_i700		:= g_byInputs_Module_00.1;
g_bDI_CircuitBreaker_Ultrasonic	:= g_byInputs_Module_00.2;
g_bDI_PressureSwitchOK			:= g_byInputs_Module_00.3;
bStartPressed					:= g_byInputs_Module_00.4 OR (bStartPressed AND NOT tonDelayStartButton.q);
g_bDI_LightCurtainOK			:= g_byInputs_Module_00.5;
g_bDI_MachineInSafePosition		:= g_byInputs_Module_00.6;
g_bDI_TableCheck				:= g_byInputs_Module_00.7;
                                   
(*second module *)                 
g_bDI_Servo_Power_OK			:= g_byInputs_Module_01.0;
g_bDI_CleaningContainerUp		:= g_byInputs_Module_01.1;	//Spare
g_bDI_CleaningContainerDown		:= g_byInputs_Module_01.2;	//Spare
g_bDI_UltraSonic_Error			:= g_byInputs_Module_01.3;
g_bDI_UltraSonic_ErrorCode_1	:= g_byInputs_Module_01.4;
g_bDI_UltraSonic_ErrorCode_2	:= g_byInputs_Module_01.5;
g_bDI_Spare16					:= g_byInputs_Module_01.6;
g_bDI_Spare17					:= g_byInputs_Module_01.7;

tonDelayStartButton(IN:=bStartPressed, PT:=T#500MS);
g_bDI_StartButton := tonDelayStartButton.Q;
	
(*fifth module *)
g_iAI_UltrasonicPower			:= TO_INT(TO_REAL(g_wInputs_Module_00)/16384);
g_iAI_Spare_01					:= TO_INT(TO_REAL(g_wInputs_Module_01)/16384);

END_PROGRAM
