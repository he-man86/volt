FUNCTION Stack_Push_CuttingPos : BOOL
//A stack functiones as a FILO buffer. The Push function pushes one item on the stack. (Pop is the counterpart.)
VAR_INPUT
	I_dataArray 		: POINTER TO XYA_Target;		//This has to be a pointer to the actual array.
END_VAR
VAR_IN_OUT
	IQ_dataArrayInfo	: ArrayInfo;				
	IQ_item				: XYA_Target;
END_VAR
VAR

END_VAR

IF(IQ_dataArrayInfo.index < IQ_dataArrayInfo.lowerBound OR IQ_dataArrayInfo.index > IQ_dataArrayInfo.upperbound) THEN
	//The array is full.
	g_sMACH.ERR.bStackIsFull	:= TRUE;
	Stack_Push_CuttingPos := FALSE;
	RETURN;
END_IF

I_dataArray[IQ_dataArrayInfo.index - IQ_dataArrayInfo.lowerBound] := IQ_item;
IQ_dataArrayInfo.index := IQ_dataArrayInfo.index + 1;
Stack_Push_CuttingPos := TRUE;
RETURN;

END_FUNCTION
