FUNCTION Calc_CopyCutsWithOffset : BOOL
//Returns whether the copy was sucsessful
VAR_INPUT
	I_dataArray 		: POINTER TO XYA_Target;		//The array containing the cutting positions
	I_dX				: REAL;							//Offset to add to copy
	I_dY				: REAL;							//Offset to add to copy
	I_firstIndex		: INT;							//Index of first item to be copied	
	I_lastIndex			: INT;							//Index of last item to be copied	If last is eaqual to first, only 1 item will be copied.
	I_bReverseOrder		: BOOL;							//When true, the order gets reversed.	
	I_overshootSettings	: Gonio_Settings;				//Settings that contains the overshoot marigins
END_VAR
VAR_IN_OUT
	IQ_dataArrayInfo	: ArrayInfo;

END_VAR
VAR
	i :INT;
	tempPosition 		: XYA_Target;
	firstInd			: INT;
	lastInd				: INT;
END_VAR

//Check if the input values are valid
IF I_lastIndex < I_firstIndex THEN
	Calc_CopyCutsWithOffset := FALSE;
	g_sMACH.ERR.bAGM1_CommFailure := TRUE;
	RETURN;
END_IF

//Check if the items to be copied are within the limits of the data array
IF I_firstIndex < IQ_dataArrayInfo.lowerBound THEN
	Calc_CopyCutsWithOffset := FALSE;
	g_sMACH.ERR.bAGM1_CommFailure := TRUE;
	RETURN;
END_IF

IF I_lastIndex > IQ_dataArrayInfo.upperbound THEN
	Calc_CopyCutsWithOffset := FALSE;
	g_sMACH.ERR.bAGM1_CommFailure := TRUE;
	RETURN;
END_IF


firstInd 	:= SEL(I_bReverseOrder, I_firstIndex, I_lastIndex);
lastInd 	:= SEL(I_bReverseOrder, I_lastIndex, I_firstIndex);

FOR i:=firstInd TO lastInd BY SEL(I_bReverseOrder, 1, -1) DO
	//Copy the item and move X and Y.
	tempPosition := I_dataArray[i - IQ_dataArrayInfo.lowerBound];
	tempPosition.X_Target := tempPosition.X_Target + I_dX;
	tempPosition.Y_Target := tempPosition.Y_Target + I_dY;
	
	
	IF NOT StorePos(I_rX:= 							tempPosition.X_Target,           
					I_rY:=							tempPosition.Y_Target,
					I_rA:=							tempPosition.A_Target,
					I_rK:=							tempPosition.K_Target,
					I_bIsWaste :=					IQ_dataArrayInfo.TEMPISWASTE,
					I_sOvershootSettings := 		I_overshootSettings)
	THEN 
		
		Calc_CopyCutsWithOffset := FALSE;
		RETURN;
	END_IF  
	
END_FOR

//If noting went wrong, return true.
Calc_CopyCutsWithOffset := TRUE;
RETURN;

END_FUNCTION
