FUNCTION Stack_Init_CuttingPos : BOOL
VAR_INPUT
END_VAR
VAR_IN_OUT
	IQ_dataArray 		: ARRAY [*] OF XYA_Target;		//This has to be a reference to the actual array. (Underwater this is actually a pointer with dereferencing done for us.)
	IQ_dataArrayInfo	: ArrayInfo;						
END_VAR
VAR
END_VAR

IQ_dataArrayInfo.index		:= DINT_TO_INT(LOWER_BOUND(IQ_dataArray, 1));
IQ_dataArrayInfo.lowerBound	:= DINT_TO_INT(LOWER_BOUND(IQ_dataArray, 1));
IQ_dataArrayInfo.upperbound	:= DINT_TO_INT(UPPER_BOUND(IQ_dataArray, 1));

Stack_Init_CuttingPos:= TRUE;
RETURN;

END_FUNCTION
