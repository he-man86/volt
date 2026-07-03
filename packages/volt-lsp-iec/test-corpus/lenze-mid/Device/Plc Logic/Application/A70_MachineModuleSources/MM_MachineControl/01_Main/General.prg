PROGRAM General
VAR
	WordConvertor: SafetyPLC_WordsToUDT;
	WordConvertor_v2: SafetyPLC_WordsToUDT_v2;
	test_IW132: Bools_To_Byte;
	Qtest: BYTE;
	ib26: INT;
	tbool: BOOL;
	TON_0: TON;
	TON_1: TON;
	BLINK_0: BLINK;
	restart1: BOOL;
END_VAR

NETWORK 0 LD
  LET en1 := TRUE;
  IF en1 THEN LET g1 := GeneralProgramFlags(); END_IF
END_NETWORK
NETWORK 1 LD
  LET en1 := TRUE;
  IF en1 THEN LET g1 := fc_Information(); END_IF
END_NETWORK
NETWORK 2 LD
  WordConvertor_v2();
END_NETWORK
NETWORK 3 LD
  LET en1 := NOT HMI_Var.ForceOutputs;
  IF en1 THEN LET g1 := Mach1_MIDS(); END_IF
  LET en2 := NOT HMI_Var.ForceOutputs;
  IF en2 THEN LET g2 := fc_Visualisation_HMI(); END_IF
  LET en3 := NOT HMI_Var.ForceOutputs;
  IF en3 THEN LET g3 := SMC_BitsToBytes(); END_IF
END_NETWORK
NETWORK 4 LD
  LET en1 := TRUE;
  IF en1 THEN LET g1 := Status_ForceOutputs(); END_IF
END_NETWORK
NETWORK 5 LD
  LST_General.FirstCycle :=  RESET;
END_NETWORK
NETWORK 6 LD
  BLINK_0(ENABLE := TRUE, TIMELOW := T#1S, TIMEHIGH := T#1S);
  Bugs.checkconnection := BLINK_0.OUT;
END_NETWORK
NETWORK 7 LD
  TON_0(IN := NOT Bugs.reportConnectionAlive, PT := T#2S);
END_NETWORK
NETWORK 8 LD
  TON_1(IN := Bugs.reportConnectionAlive, PT := T#2S);
END_NETWORK
NETWORK 9 LD
  Bugs.restart := (TON_0.Q OR TON_1.Q);
END_NETWORK

END_PROGRAM
