PROGRAM Mach1_MotionControl
VAR
//Main Cabinet	
	Maindrive: Camming;
	WrappingDevice: Camming;
	Sidecorrection: Camming_SideCorrection;
	Fan: ATD_FQI;
	Bobbin: ATD_TorqueControl;

//ATF		
	FeedForwardADS: ATD_FQI;
	FeedForwardATF: ATD_FQI;
	Elevator: ATD_FQI;

	FeedForwardWrapper: BasicMovement;
	VirtualMaster_0: VirtualMaster;
	identPolePosition_FeedforwardWrapper: identPolePosition;
	L_MC1P_ChangeMachineData_MainDrive: L_MC1P_ChangeMachineData;
	xMainDriveDoneOnce: BOOL;
	xFeedforwardDoneOnce: BOOL;
	xWrappingDeviceDoneOnce: BOOL;
	L_MC1P_ChangeMachineData_FeedforwardWrapper: L_MC1P_ChangeMachineData;
	L_MC1P_ChangeMachineData_WrappingDevice: L_MC1P_ChangeMachineData;
END_VAR
IMPLEMENTATION LD UNSUPPORTED

END_PROGRAM
