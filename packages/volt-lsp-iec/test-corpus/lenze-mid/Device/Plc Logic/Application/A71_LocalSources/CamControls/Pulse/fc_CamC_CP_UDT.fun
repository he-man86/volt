FUNCTION fc_CamC_CP_UDT : BOOL
VAR_INPUT
	iEN						: BOOL;
	iMachinePosition		: INT;
	iResetFlag				: BOOL;

END_VAR
VAR_OUTPUT

END_VAR
VAR
	
END_VAR
VAR_IN_OUT
	ioPulse	: UDT_CamPulse;
END_VAR

NETWORK 0 LD
  ioPulse.MachinePos_HMI := MOVE(iMachinePosition);
END_NETWORK
NETWORK 1 LD
  LET g1 := fc_CamC_CP_Base(iEN, ioPulse.Start, iMachinePosition, iResetFlag);
  fc_CamC_CP_UDT := g1;
  ioPulse.Active := g1;
END_NETWORK

END_FUNCTION
