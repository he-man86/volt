PROGRAM POU
VAR
	L_TS2P_FlexCamState_0: L_TS2P_FlexCamState;
END_VAR

NETWORK 0 FBD
  L_TS2P_FlexCamState_0(xEnable := , xEnableOperation := , xResetError := , xQSPApplication := , xAbort := , xJogPos := , xJogNeg := , xHomeExecute := , lrOverride := , scCtrlBasicMotion := , scPar := , Axis := , scAccessPoints := , MasterValues := , xSyncIn := , xCamChangeInstant := , lrSetOffsetPosX := , lrSetOffsetPosY := , lrSetScalingX := , lrSetScalingY := , CamTable1 := , CamTable2 := , CamTable3 := , CamTable4 := , wSetCamTable := , xCamSequencer := );
END_NETWORK
NETWORK 1 FBD
  ???(Axis := , xEnableInternalControl := , xEnableOperation := , xResetError := , xEnablePositive := , xEnableNegative := , xDisableSWLimit := , lrOverride := , lrOverrideAcc := , lrOverrideJerk := , xQspApplication := , xHalt := , xAbort := , xJogPos := , xJogNeg := , xContinuousUpdate := , xFinishPositioning := , xMoveVelExecute := , xMoveAbsExecute := , xMoveRelExecute := , lrPos_Dist := , lrVel := , lrAcc := , lrDec := , lrJerk := , eDirection := , xHomeExecute := , scHomeExtTP := , xHomeAbsSwitch := , xResetHomePosition := );
END_NETWORK
NETWORK 2 FBD
  ???(xEnableInternalControl := , xEnable := , scCtrlABC := , xResetError := , xRegulatorOn := , xStop := , xHalt := , scPar := , Axis := , xJogPos := , xJogNeg := , xHomeExecute := , xHomeAbsSwitch := , xMoveVelExecute := , xMoveAbsExecute := , xMoveRelExecute := , lrSetPos_Dist := , xDisableSWLimit := , lrOverride := , lrOverrideAcc := , lrOverrideJerk := );
END_NETWORK
NETWORK 3 FBD
  ???(xEnableInternalControl := , xEnable := , scCtrlABC := , xResetError := , xRegulatorOn := , xStop := , xHalt := , scPar := , MasterAxis := , SlaveAxis := , scAccessPoints := , xJogPos := , xJogNeg := , xHomeExecute := , xHomeAbsSwitch := , xEnableHWLimit := , xHWLimitPos := , xHWLimitNeg := , xSyncCam := , xSyncOutInstant := , xCamChangeInstant := , lrSetOffsetMaster := , lrSetOffsetSlave := , lrSetScalingMaster := , lrSetScalingSlave := , CamTable1 := );
END_NETWORK
NETWORK 4 FBD
  ???(xEnableInternalControl := , xEnable := , scCtrlABC := , xResetError := , xRegulatorOn := , xStop := , xHalt := , scPar := , MasterAxis := , SlaveAxis := , scAccessPoints := , xJogPos := , xJogNeg := , xHomeExecute := , xHomeAbsSwitch := , xEnableHWLimit := , xHWLimitPos := , xHWLimitNeg := , xSyncCam := , xSyncOutInstant := , xCamChangeInstant := , lrSetOffsetMaster := , lrSetOffsetSlave := , lrSetScalingMaster := , lrSetScalingSlave := , CamTable1 := , CamTable2 := , CamTable3 := , CamTable4 := , eSetCamTable := , xCamSequencer := );
END_NETWORK

END_PROGRAM
