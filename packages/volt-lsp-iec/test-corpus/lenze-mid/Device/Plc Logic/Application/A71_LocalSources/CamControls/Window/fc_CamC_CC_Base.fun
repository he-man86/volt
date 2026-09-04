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
  LET en1 := ;
  IF en1 THEN (i_intStartCam < i_intStopCam); END_IF
  LET en2 := en1;
  IF en2 THEN (i_lrMachinePosition >= i_intStartCam); END_IF
  LET en3 := en2;
  IF en3 THEN (i_lrMachinePosition <= i_intStopCam); END_IF
  LET en4 := ;
  IF en4 THEN (i_lrMachinePosition >= i_intStartCam); END_IF
  LET en5 := ;
  IF en5 THEN (i_lrMachinePosition <= i_intStopCam); END_IF
  LET en6 := ;
  IF en6 THEN (i_intStartCam > i_intStopCam); END_IF
  o_xCamControl := (i_xEnable AND (en3 OR (en6 AND (en4 OR en5))));
END_NETWORK

END_FUNCTION
