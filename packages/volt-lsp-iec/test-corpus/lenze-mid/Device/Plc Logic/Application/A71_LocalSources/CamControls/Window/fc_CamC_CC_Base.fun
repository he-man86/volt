FUNCTION fc_CamC_CC_Base 
VAR_INPUT
	i_xEnable				: BOOL; 
	i_intStartCam			: INT; 
	i_intStopCam			: INT; 
	i_lrMachinePosition 	: LREAL; 
END_VAR
VAR_OUTPUT
	o_xCamControl			: BOOL; 
END_VAR
VAR
END_VAR

NETWORK 0 LD
  o_xCamControl := (i_xEnable AND (((( < i_intStartCam < i_intStopCam) >= i_lrMachinePosition >= i_intStartCam) <= i_lrMachinePosition <= i_intStopCam) OR (( > i_intStartCam > i_intStopCam) AND (( >= i_lrMachinePosition >= i_intStartCam) OR ( <= i_lrMachinePosition <= i_intStopCam)))));
END_NETWORK

END_FUNCTION
