// This program calls the different example functions to compare the sum of 2 parameters with a global constant.
PROGRAM SumComparison
VAR
	// Parameters for function samples
	nParam1_FBD							: INT := 50;
	nParam2_FBD							: INT := 55;
	bSumGreaterThanConstant_FBD			: BOOL;
	
	nParam1_FBD_short					: INT := 50;
	nParam2_FBD_short					: INT := 55;
	bSumGreaterThanConstant_FBD_short	: BOOL;
	
	nParam1_ST							: INT := 50;
	nParam2_ST							: INT := 55;
	bSumGreaterThanConstant_ST			: BOOL;
	
	nParam1_ST_short					: INT := 50;
	nParam2_ST_short					: INT := 55;
	bSumGreaterThanConstant_ST_short	: BOOL;
END_VAR

// Call a FUNCTION and assign the return value to a local variable
bSumGreaterThanConstant_FBD			:= F_SumComparison_FBD(			nInput1 := nParam1_FBD,
																	nInput2 := nParam2_FBD);
															
bSumGreaterThanConstant_FBD_short	:= F_SumComparison_FBD_short(	nInput1 := nParam1_FBD_short,
																	nInput2 := nParam2_FBD_short);
																	
bSumGreaterThanConstant_ST			:= F_SumComparison_ST(			nInput1:= nParam1_ST,
																	nInput2:= nParam2_ST);
																	
bSumGreaterThanConstant_ST_short	:= F_SumComparison_ST_short(	nInput1:= nParam1_ST_short,
																	nInput2:= nParam2_ST_short);

END_PROGRAM
