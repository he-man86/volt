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
(* @volt-implementation LD *)
NETWORK
  MOVE(EN := , iMachinePosition, => ioPulse.MachinePos_HMI);
END_NETWORK
NETWORK
  fc_CamC_CP_UDT :=
  ioPulse.Active := fc_CamC_CP_Base(iEN := iEN, iStartCam := ioPulse.Start, iMachinePosition := iMachinePosition, iResetFlag := iResetFlag, ioAuxOneShot := ioPulse.OSP);
END_NETWORK

END_FUNCTION
