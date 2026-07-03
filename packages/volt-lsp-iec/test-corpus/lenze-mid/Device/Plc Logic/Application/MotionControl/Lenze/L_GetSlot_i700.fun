FUNCTION L_GetSlot_i700 : INT
VAR_IN_OUT
	Axis: AXIS_REF;
END_VAR
VAR
	pAxisRef_i700: POINTER TO _AXIS_REF_i700;
END_VAR

//'L_GetSlot_i700'
//
//04.2016
//Lenze Vertrieb GmbH, Mirco Guddat

(***********************************************************************************

This function check if the connected axis is an i700 axis an on witch slot it runs.
Return value:
	0 - No i700 axis
	1 - i700 axis on slot 1
	2 - i700 axis on slot 2

***********************************************************************************)

//Check if this is a i700 axis
IF (Axis.eDeviceOrigin = L_MC1P_DriveType.i700) THEN
	pAxisRef_i700:= ADR(Axis);
	IF pAxisRef_i700^.xSlot2 THEN //Check slot 2
		L_GetSlot_i700:= 2;
	ELSE
		L_GetSlot_i700:= 1;
	END_IF
ELSIF (Axis.eDeviceOrigin = L_MC1P_DriveType.i900) THEN
	L_GetSlot_i700:= 1;
ELSIF (Axis.eDeviceOrigin = L_MC1P_DriveType.i500) THEN
	L_GetSlot_i700:= 1;	
ELSE
	L_GetSlot_i700:= 0; //No i700 axis
END_IF

END_FUNCTION
