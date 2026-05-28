// This function returns TRUE, if the sum of the inputs is greater than the global constant. Otherwise, it returns FALSE.

// This functionality is implemented in a short programming way in ST.
// The same functionality in FBD is implemented in: F_SumComparison_FBD_short
// The extensive ST variant is implemented in: 		F_SumComparison_ST
FUNCTION F_SumComparison_ST_short : BOOL
VAR_INPUT
	nInput1		: INT;
	nInput2		: INT;
END_VAR

F_SumComparison_ST_short := ((nInput1 + nInput2) > GVL_Basic.cSumComparisonLimit);

END_FUNCTION
