(* =================================================================================================================================
   Sample FB showing some basic functionalities
   =================================================================================================================================
   Description: 
   This FB increases a cyclic counter ("nCycleCounter") and divides this counter by an input parameter ("fParameter").
   To avoid a division by zero, which would provoke a runtime exception, this division is only done if the parameter is unequal 0.
   The division result is stored in a local variable ("fDivision").

   If a boolean condition is fulfilled ("bEnable AND stSample.bVar"),
   then the division result is embedded into a text, which is stored in a variable of a structure instance ("stSample.sVar").

   At the end, this STRING variable is assigned to the output variable to return it back to the caller ("sOutput").
   =================================================================================================================================
   InfoSys: https://infosys.beckhoff.de/content/1033/tc3_plc_intro/27021600294502539-1.html?id=3091135132823593756
   ================================================================================================================================= *)
FUNCTION_BLOCK FB_Sample
VAR_INPUT
	bEnable			: BOOL;
	fParameter		: LREAL;
END_VAR
VAR_OUTPUT
	sOutput			: STRING;
END_VAR
VAR
	nCycleCounter	: INT;
	fDivision		: LREAL;
	
	// Structure sample
	stSample		: ST_Sample := (bVar := TRUE);
END_VAR

// Increase cycle COUNTER
nCycleCounter := nCycleCounter + 1;

// Access a GLOBAL variable
IF fParameter <> 0 THEN
	fDivision := nCycleCounter/fParameter;
END_IF

// Access a STRUCTURE instance
IF bEnable AND stSample.bVar THEN
	stSample.sVar := CONCAT('Variable value = ', LREAL_TO_STRING(fDivision));
END_IF

// Assign output variable
sOutput := stSample.sVar;

END_FUNCTION_BLOCK
