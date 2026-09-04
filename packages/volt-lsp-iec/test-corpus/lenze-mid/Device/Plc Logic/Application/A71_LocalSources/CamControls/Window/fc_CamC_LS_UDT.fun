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

NETWORK 0 LD
  MOVE(, iActualPos);
END_NETWORK
NETWORK 1 LD
  fc_CamC_LS_UDT := fc_CamC_LS_Base2(, iActualSpeed, ioUDTCamControlLS.LowSpeed.SetSpeed, ioUDTCamControlLS.HighSpeed.SetSpeed, ioUDTCamControlLS.LowSpeed.Start, ioUDTCamControlLS.LowSpeed.Stop, ioUDTCamControlLS.HighSpeed.Start, ioUDTCamControlLS.HighSpeed.Stop, iActualPos, ioUDTCamControlLS.Calculation.OSStart, ioUDTCamControlLS.Calculation.OSStop, ioUDTCamControlLS.Calculation.FFStarted);
END_NETWORK

END_FUNCTION
