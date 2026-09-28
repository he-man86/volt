FUNCTION fc_CamC_LS_UDT : bool
VAR_INPUT
	iEnable			:  BOOL;
	iActualSpeed	:  INT;
	iActualPos		: INT;
	iRotflag 	: BOOL;
END_VAR
VAR
END_VAR

VAR_IN_OUT
	ioUDTCamControlLS	: UDT_CamControlLS;
END_VAR
IMPLEMENTATION LD
NETWORK
  MOVE(EN := , iActualPos, => ioUDTCamControlLS.MachinePos_HMI);
END_NETWORK
NETWORK
  fc_CamC_LS_UDT := fc_CamC_LS_Base2(i_xEnable := , i_intActualSpeed := iActualSpeed, i_intVLowSpeed := ioUDTCamControlLS.LowSpeed.SetSpeed, i_intVHighSpeed := ioUDTCamControlLS.HighSpeed.SetSpeed, i_intPosLowSpeedStart := ioUDTCamControlLS.LowSpeed.Start, i_intPosLowSpeedStop := ioUDTCamControlLS.LowSpeed.Stop, i_intPosHighSpeedStart := ioUDTCamControlLS.HighSpeed.Start, i_intPosHighSpeedStop := ioUDTCamControlLS.HighSpeed.Stop, i_lrActualMachPos := iActualPos, OSP_START := ioUDTCamControlLS.Calculation.OSStart, OSP_STOP := ioUDTCamControlLS.Calculation.OSStop, FF_Started := ioUDTCamControlLS.Calculation.FFStarted);
END_NETWORK

END_FUNCTION
