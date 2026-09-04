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

NETWORK 0 LD
  VirtualMaster_0(ioDataExchange := Data_Exchange_Motion.Servo_VirtualMaster, i_xPositionIsRetain := TRUE, i_lrWindowStandstill := 1, i_lrJogVel := 5, i_VelMax := 600, ioSlaveAxis := LM_VirtualMaster);
END_NETWORK
NETWORK 1 LD
  xMainDriveDoneOnce S= L_MC1P_ChangeMachineData_MainDrive(Axis := Axis_MainDrive, xExecute := (Axis_MainDrive.xCommunicationOK AND NOT Axis_MainDrive.xDriveEnabled), xSetFeedconstant := , lrFeedconstant := , xSetGearFactor := , dwGearDenominator := , dwGearNumerator := , xSetAddGearFactor := , dwAddGearDenominator := , dwAddGearNumerator := , xSetPosResolution := , dwPosResolution := , xSetOrientation := TRUE, xOrientation := LST_InputsOutputs.I100_5_ConfigSelectionRightMachine, xSetTraversingRange := , eTraversingRange := , xSetCycleLength := , lrCycleLength := );
END_NETWORK
NETWORK 2 LD
  Data_Exchange_Motion.Servo_MainDrive.Control.Enable := (Data_Exchange_Motion.Servo_MainDrive.Control.Enable AND xMainDriveDoneOnce);
END_NETWORK
NETWORK 3 LD TITLE: "Main drive motion"
  LET en1 := ;
  IF en1 THEN Maindrive(ioDataExchange := Data_Exchange_Motion.Servo_MainDrive, i_xOnlyPositiveDirectionSync := TRUE, i_lrWindowStandstill := 1, i_lrJogVel := 2, i_lrSyncVel := 10, i_NormalCamRefTable := Cam_MainDrive, i_ByPassCamRefTable := , i_CamCyclic := TRUE, i_MasterAbsolute := TRUE, i_SlaveAbsolute := TRUE, ioMasterAxis := LM_VirtualMaster, ioSlaveAxis := Axis_MainDrive); END_IF
END_NETWORK
NETWORK 4 LD
  xWrappingDeviceDoneOnce S= L_MC1P_ChangeMachineData_WrappingDevice(Axis := Axis_OverrollingDevice, xExecute := (Axis_OverrollingDevice.xCommunicationOK AND NOT Axis_OverrollingDevice.xDriveEnabled), xSetFeedconstant := , lrFeedconstant := , xSetGearFactor := , dwGearDenominator := , dwGearNumerator := , xSetAddGearFactor := , dwAddGearDenominator := , dwAddGearNumerator := , xSetPosResolution := , dwPosResolution := , xSetOrientation := TRUE, xOrientation := NOT LST_InputsOutputs.I100_5_ConfigSelectionRightMachine, xSetTraversingRange := , eTraversingRange := , xSetCycleLength := , lrCycleLength := );
END_NETWORK
NETWORK 5 LD
  Data_Exchange_Motion.Servo_WrappingDevice.Control.Enable := (Data_Exchange_Motion.Servo_WrappingDevice.Control.Enable AND xWrappingDeviceDoneOnce);
END_NETWORK
NETWORK 6 LD TITLE: "Wrapping device"
  LET en1 := ;
  IF en1 THEN WrappingDevice(ioDataExchange := Data_Exchange_Motion.Servo_WrappingDevice, i_xOnlyPositiveDirectionSync := FALSE, i_lrWindowStandstill := 5, i_lrJogVel := 10, i_lrSyncVel := 10, i_NormalCamRefTable := CamRefWikkelnest, i_ByPassCamRefTable := , i_CamCyclic := TRUE, i_MasterAbsolute := TRUE, i_SlaveAbsolute := FALSE, ioMasterAxis := LM_VirtualMaster, ioSlaveAxis := Axis_OverrollingDevice); END_IF
END_NETWORK
NETWORK 7 LD TITLE: "Side correction"
  LET en1 := ;
  IF en1 THEN Sidecorrection(ioDataExchange := Data_Exchange_Motion.Servo_SideCorrection, i_xOnlyPositiveDirectionSync := FALSE, i_lrWindowStandstill := 5, i_lrJogVel := 100, i_lrSyncVel := 10, i_NormalCamRefTable := CamRefKantcorrectie, i_ByPassCamRefTable := CamRefKantcorrectie, i_CamCyclic := TRUE, i_MasterAbsolute := TRUE, i_SlaveAbsolute := FALSE, ioMasterAxis := LM_VirtualMaster, ioSlaveAxis := Axis_SideCorrection, i_NormalCamRefTableNeg := CamRefKantcorrectie_Neg); END_IF
END_NETWORK
NETWORK 8 LD
  xFeedforwardDoneOnce S= L_MC1P_ChangeMachineData_FeedforwardWrapper(Axis := Axis_FeedFowardWrapper, xExecute := (Axis_FeedFowardWrapper.xCommunicationOK AND NOT Axis_FeedFowardWrapper.xDriveEnabled), xSetFeedconstant := , lrFeedconstant := , xSetGearFactor := , dwGearDenominator := , dwGearNumerator := , xSetAddGearFactor := , dwAddGearDenominator := , dwAddGearNumerator := , xSetPosResolution := , dwPosResolution := , xSetOrientation := TRUE, xOrientation := LST_InputsOutputs.I100_5_ConfigSelectionRightMachine, xSetTraversingRange := , eTraversingRange := , xSetCycleLength := , lrCycleLength := );
END_NETWORK
NETWORK 9 LD
  identPolePosition_FeedforwardWrapper(execute := (xFeedforwardDoneOnce AND Axis_FeedFowardWrapper.xCommunicationOK AND NOT Axis_FeedFowardWrapper.xSTOActive), ioAxis := Axis_FeedFowardWrapper);
END_NETWORK
NETWORK 10 LD
  Data_Exchange_Motion.FeedForwardWrapper.Control.Enable := (Data_Exchange_Motion.FeedForwardWrapper.Control.Enable AND identPolePosition_FeedforwardWrapper.doneOnce);
END_NETWORK
NETWORK 11 LD TITLE: "Feed forward wrapper DTA"
  FeedForwardWrapper(ioDataExchange := Data_Exchange_Motion.FeedForwardWrapper, TouchProbeSensor := NOT LST_InputsOutputs.I101_0_Wrapper_present, i_lrWindowStandstill := 5, i_lrJogVel := 10, ioSlaveAxis := Axis_FeedFowardWrapper);
END_NETWORK
NETWORK 12 LD TITLE: "FQI Bobbin"
  Bobbin(lrAcc := 6000, lrDec := 6000, ioAxis := Axis_Bobbin, DataIO := Data_Exchange_Motion.FQI_Bobbin, lrTorque := Data_Exchange_Motion.BobbinTorque);
END_NETWORK
NETWORK 13 LD TITLE: "FQI Fan"
  Fan(lrAcc := 500, lrDec := 75, ioAxis := Axis_Fan, DataIO := Data_Exchange_Motion.FQI_Fan);
END_NETWORK
NETWORK 14 LD TITLE: "FQI FeedForward ADS"
  FeedForwardADS(lrAcc := 6000, lrDec := 6000, ioAxis := Axis_FeedForwardADS, DataIO := Data_Exchange_Motion.FQI_FeedforwardADS);
END_NETWORK
NETWORK 15 LD TITLE: "FQI FeedForward  ATF"
  FeedForwardATF(lrAcc := 6000, lrDec := 1500, ioAxis := Axis_FeedForwardATF, DataIO := Data_Exchange_Motion.FQI_FeedforwardATF);
END_NETWORK
NETWORK 16 LD TITLE: "FQI Elevator"
  Elevator(lrAcc := 50, lrDec := 200, ioAxis := Axis_Elevator, DataIO := Data_Exchange_Motion.FQI_ElevatorATF);
END_NETWORK

END_PROGRAM
