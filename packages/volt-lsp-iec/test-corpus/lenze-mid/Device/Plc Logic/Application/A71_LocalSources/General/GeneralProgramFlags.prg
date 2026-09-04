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

NETWORK 0 LD
  // Always Off
  AlwaysOff := AlwaysOff SET;
END_NETWORK
NETWORK 1 LD
  // Always ON
  AlwaysOn := NOT AlwaysOn SET;
END_NETWORK
NETWORK 2 LD
  FirstCycle := (AlwaysOn AND OSfirstflagcycle) SET;
END_NETWORK
NETWORK 3 LD
  MOVE(AlwaysOn, 0);
END_NETWORK
NETWORK 4 LD
  LET g2 := ;
  FF50ms := tmr_FF50ms(IN := (g2 AND NOT tmr_FF50ms_not.Q), PT := T#100MS);
  LST_General.Imp100ms := tmr_FF50ms_not(IN := (g2 AND FF50ms), PT := T#100MS);
END_NETWORK
NETWORK 5 LD
  LET g1 := ;
  FF100ms := tmr_FF100ms(IN := (g1 AND NOT tmr_FF100ms_not.Q), PT := T#500MS);
  LST_General.Imp200ms := tmr_FF100ms_not(IN := (g1 AND FF100ms), PT := T#500MS);
END_NETWORK
NETWORK 6 LD
  LET g3 := ;
  FF500ms := tmr_FF500ms(IN := (g3 AND NOT tmr_FF500ms_not.Q), PT := T#500MS);
  LST_General.Imp1s := tmr_FF500ms_not(IN := (g3 AND FF500ms), PT := T#500MS);
END_NETWORK
NETWORK 7 LD
  LET g4 := ;
  FF1s := tmr_FF1s(IN := (g4 AND NOT tmr_FF1s_not.Q), PT := T#1S);
  tmr_FF1s_not(IN := (g4 AND FF1s), PT := T#1S);
END_NETWORK
NETWORK 8 LD
  LST_General.StartUpDelayPLC := PLC_StartUp_Delay(IN := AlwaysOn, PT := T#60S);
END_NETWORK

END_PROGRAM
