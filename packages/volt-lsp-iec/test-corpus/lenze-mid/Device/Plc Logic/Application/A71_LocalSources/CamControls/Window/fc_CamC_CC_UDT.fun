FUNCTION fc_CamC_CC_UDT : bool
VAR_INPUT
	iEnable				: BOOL;
	iMachinePosition	: INT;
	
END_VAR

VAR
	tIndex:INT;
	B:INT;
	g:INT;
	E:INT;
	i:INT;
END_VAR
VAR_IN_OUT
	ioCamControl	: UDT_CamControl;
END_VAR

ioCamControl.MachinePos_HMI:=iMachinePosition;
fc_CamC_CC_Base(
	i_xEnable:= 1, 
	i_intStartCam:= ioCamControl.Start, 
	i_intStopCam:=ioCamControl.Stop , 
	i_lrMachinePosition:=ioCamControl.MachinePos_HMI , 
	o_xCamControl=>fc_CamC_CC_UDT );

END_FUNCTION
