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
  GeneralProgramFlags(TRUE);
END_NETWORK
NETWORK 1 LD
  fc_Information(TRUE);
END_NETWORK
NETWORK 2 LD
  WordConvertor_v2(ioSafetyStatusUDT := Mach1_Safety.Status, ioSafetyControlUDT := Mach1_Safety.Control);
END_NETWORK
NETWORK 3 LD
  LET g16 := NOT HMI_Var.ForceOutputs;
  Mach1_MIDS(g16);
  fc_Visualisation_HMI(g16);
  SMC_BitsToBytes(g16);
END_NETWORK
NETWORK 4 LD
  Status_ForceOutputs(TRUE);
END_NETWORK
NETWORK 5 LD
  LST_General.FirstCycle := ;
END_NETWORK
NETWORK 6 LD
  Bugs.checkconnection := BLINK_0(ENABLE := TRUE, TIMELOW := T#1S, TIMEHIGH := T#1S);
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
