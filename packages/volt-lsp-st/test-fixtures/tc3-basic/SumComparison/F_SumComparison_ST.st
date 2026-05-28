// This function returns TRUE, if the sum of the inputs is greater than the global constant. Otherwise, it returns FALSE.

// This functionality is implemented in an extensive programming way in ST.
// The same functionality in FBD is implemented in: F_SumComparison_FBD
// The short ST variant is implemented in: 			F_SumComparison_ST_short
FUNCTION F_SumComparison_ST : BOOL
VAR_INPUT
	nInput1		: INT;
	nInput2		: INT;
END_VAR
VAR
	nSum		: INT;
END_VAR

nSum := nInput1 + nInput2;

IF nSum > GVL_Basic.cSumComparisonLimit THEN
	F_SumComparison_ST := TRUE;
ELSE
	F_SumComparison_ST := FALSE;
END_IF

END_FUNCTION
