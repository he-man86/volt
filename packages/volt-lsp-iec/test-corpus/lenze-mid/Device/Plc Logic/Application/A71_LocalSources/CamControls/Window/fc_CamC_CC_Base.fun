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
  LET en1 := i_xEnable;
  IF en1 THEN LET g1 := (i_intStartCam < i_intStopCam); END_IF
  LET en2 := g1;
  IF en2 THEN LET g2 := (i_lrMachinePosition >= i_intStartCam); END_IF
  LET en3 := g2;
  IF en3 THEN LET g3 := (i_lrMachinePosition <= i_intStopCam); END_IF
  LET en4 := i_xEnable;
  IF en4 THEN LET g4 := (i_intStartCam > i_intStopCam); END_IF
  LET en5 := g4;
  IF en5 THEN LET g5 := (i_lrMachinePosition >= i_intStartCam); END_IF
  LET en6 := g4;
  IF en6 THEN LET g6 := (i_lrMachinePosition <= i_intStopCam); END_IF
  o_xCamControl := (g3 OR g5 OR g6);
END_NETWORK

END_FUNCTION
