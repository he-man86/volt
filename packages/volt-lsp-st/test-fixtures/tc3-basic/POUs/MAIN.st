(* =========================================================================================================================
   Main program which calls and uses the other elements
   =========================================================================================================================
   Description: 
   This PLC sample shows the usage of some basic PLC elements which can be used to structure the PLC project.
   The elements, which are used in this project, are program, function block (FB), function, method, structure,
   enumeration and global variable list (GVL).
   =========================================================================================================================
   InfoSys:
   https://infosys.beckhoff.de/content/1033/tc3_plc_intro/2526546571.html?id=6135567195050769302
   https://infosys.beckhoff.de/content/1033/tc3_plc_intro/9007201785015179.html?id=930767890005286929
   ========================================================================================================================= *)
PROGRAM MAIN
VAR
	// Function block sample (the functionality of this FB is explained in the header comment of the FB)
	fbSample1			: FB_Sample;
	bEnable1			: BOOL := TRUE;
	fParameter1			: LREAL := 100.0;
	sReturn1			: STRING;
	
	fbSample2			: FB_Sample;
	bEnable2			: BOOL;
	fParameter2			: LREAL := 150.0;
	sReturn2			: STRING;
	
	// State machine
	fbStateMachine		: FB_StateMachine;
END_VAR

// Call a PROGRAM
SumComparison();

// Call a FB instance with integrated input and output assignment
	// HINT: the complete execution of this FB instance is enabled by default
fbSample1(bEnable := bEnable1, fParameter := fParameter1, sOutput => sReturn1);

	// HINT: to enable the complete execution of this FB instance, write the variable "bEnable2" to TRUE
fbSample2(bEnable := bEnable2, fParameter := fParameter2, sOutput => sReturn2);

// Call a FB method
fbStateMachine.Execute();

END_PROGRAM
