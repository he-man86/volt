FUNCTION fc_CamC_CP_Base : BOOL
VAR_INPUT
	iEN					: BOOL;
	iStartCam			: INT; 
	iMachinePosition 	: INT; 
	iResetFlag			: BOOL;
END_VAR
VAR_OUTPUT

END_VAR
VAR
	tBool: BOOL;
	
	

END_VAR
VAR_IN_OUT
	ioAuxOneShot: BOOL;
END_VAR

NETWORK 0 LD
  tBool := (((iMachinePosition >= iStartCam) AND NOT iResetFlag) AND iEN);
END_NETWORK
NETWORK 1 LD
  fc_CamC_CP_Base := (tbool AND NOT ioAuxOneShot);
END_NETWORK
NETWORK 2 LD
  ioAuxOneShot := tbool;
END_NETWORK

END_FUNCTION
