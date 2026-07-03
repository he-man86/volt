PROGRAM Simulation
VAR
	ATD_Simulate: BOOL;
END_VAR

IF (ATD_Simulate) THEN
Mach1_Safety.Status.Emergency_button01:=TRUE;
Mach1_Safety.Status.Emergency_button02:=TRUE;
Mach1_Safety.Status.Emergency_button03:=TRUE;
Mach1_Safety.Status.Emergency_button04:=TRUE;
Mach1_Safety.Status.Emergency_button05:=TRUE;
Mach1_Safety.Status.EmergencyStopOK :=TRUE;



LST_InputsOutputs.I100_2_Pushbutton_stop_OP0a:=TRUE;
LST_InputsOutputs.I132_2_PB_Stop_OP2a :=TRUE;
LST_InputsOutputs.I100_0_AirpressureOK:=TRUE;
LST_InputsOutputs.I100_3_Selector_switch_auto_manual_OP0a:=FALSE;
LST_InputsOutputs.I100_1_Pushbutton_start_OP0a:=TRUE;

END_IF

END_PROGRAM
