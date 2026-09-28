PROGRAM GeneralProgramFlags
VAR_INPUT
END_VAR
VAR_OUTPUT
END_VAR
VAR
	AlwaysOff: BOOL;
	AlwaysOn: BOOL;
	OS: BOOL;
	first: BOOL;
	flag: BOOL;
	OSfirstflagcycle: BOOL;
	FirstCycle: BOOL;
	dummyWord: INT;
	tmr_FF500ms: TON;
	tmr_FF500ms_not: TON;
	tmr_FF100ms: TON;
	tmr_FF100ms_not: TON;
	tmr_FF50ms: TON;
	tmr_FF50ms_not: TON;
	tmr_FF1s: TON;
	tmr_FF1s_not: TON;
	PLC_StartUp_Delay: TON;
END_VAR
IMPLEMENTATION LD UNSUPPORTED

END_PROGRAM
