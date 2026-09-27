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
(* @volt-implementation LD *)
NETWORK
  o_xCamControl := PARALLEL(IN := i_xEnable, LE(EN := GE(EN := LT(EN := , i_intStartCam, i_intStopCam), i_lrMachinePosition, i_intStartCam), i_lrMachinePosition, i_intStopCam), PARALLEL(IN := GT(EN := , i_intStartCam, i_intStopCam), GE(EN := , i_lrMachinePosition, i_intStartCam), LE(EN := , i_lrMachinePosition, i_intStopCam)));
END_NETWORK

END_FUNCTION
