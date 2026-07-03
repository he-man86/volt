PROGRAM pgHMI
VAR
	fbCoordSystemOffsetEdit: CoordSystemOffsetEdit;
END_VAR

fbCoordSystemOffsetEdit();
UN01_HMI.EM02_PalletPositionActuals_HMI[1].iActualNrOfBoxes:=UN01_HMI.EM02_PalletPositionActuals_HMI[1].iActualNrOfBoxes+1;
UN01_HMI.EM02_PalletPositionActuals_HMI[1].iActualStackRows:=UN01_HMI.EM02_PalletPositionActuals_HMI[1].iActualStackRows+1;

END_PROGRAM
