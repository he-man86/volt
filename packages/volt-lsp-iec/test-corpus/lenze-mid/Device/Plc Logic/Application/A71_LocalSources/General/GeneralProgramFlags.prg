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
  AlwaysOff := AlwaysOff RESET;
END_NETWORK
NETWORK 1 LD
  // Always ON
  AlwaysOn := NOT AlwaysOn SET;
END_NETWORK
NETWORK 2 LD
  FirstCycle := (AlwaysOn AND OSfirstflagcycle) RESET;
END_NETWORK
NETWORK 3 LD
  LET en1 := AlwaysOn;
  IF en1 THEN dummyWord := MOVE(0); END_IF
END_NETWORK
NETWORK 4 LD
  tmr_FF50ms(IN := NOT tmr_FF50ms_not.Q, PT := T#100MS);
  tmr_FF50ms_not(IN := FF50ms, PT := T#100MS);
  FF50ms := tmr_FF50ms.Q;
  LST_General.Imp100ms := tmr_FF50ms_not.Q;
END_NETWORK
NETWORK 5 LD
  tmr_FF100ms(IN := NOT tmr_FF100ms_not.Q, PT := T#500MS);
  tmr_FF100ms_not(IN := FF100ms, PT := T#500MS);
  FF100ms := tmr_FF100ms.Q;
  LST_General.Imp200ms := tmr_FF100ms_not.Q;
END_NETWORK
NETWORK 6 LD
  tmr_FF500ms(IN := NOT tmr_FF500ms_not.Q, PT := T#500MS);
  tmr_FF500ms_not(IN := FF500ms, PT := T#500MS);
  FF500ms := tmr_FF500ms.Q;
  LST_General.Imp1s := tmr_FF500ms_not.Q;
END_NETWORK
NETWORK 7 LD
  tmr_FF1s(IN := NOT tmr_FF1s_not.Q, PT := T#1S);
  tmr_FF1s_not(IN := FF1s, PT := T#1S);
  FF1s := tmr_FF1s.Q;
END_NETWORK
NETWORK 8 LD
  PLC_StartUp_Delay(IN := AlwaysOn, PT := T#60S);
  LST_General.StartUpDelayPLC := PLC_StartUp_Delay.Q;
END_NETWORK

END_PROGRAM
