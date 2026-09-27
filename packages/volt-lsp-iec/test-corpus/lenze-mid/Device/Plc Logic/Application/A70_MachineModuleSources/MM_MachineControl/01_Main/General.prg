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
(* @volt-implementation LD *)
NETWORK
  GeneralProgramFlags(EN := TRUE);
END_NETWORK
NETWORK
  fc_Information(EN := TRUE);
END_NETWORK
NETWORK
  WordConvertor_v2(ioSafetyStatusUDT := Mach1_Safety.Status, ioSafetyControlUDT := Mach1_Safety.Control);
END_NETWORK
NETWORK
  VAR_TEMP g16 : BOOL; END_VAR
  g16 := NOT HMI_Var.ForceOutputs;
  Mach1_MIDS(EN := g16);
  fc_Visualisation_HMI(EN := g16);
  SMC_BitsToBytes(EN := g16);
END_NETWORK
NETWORK
  Status_ForceOutputs(EN := TRUE);
END_NETWORK
NETWORK
  LST_General.FirstCycle R= ;
END_NETWORK
NETWORK
  Bugs.checkconnection := BLINK_0(ENABLE := TRUE, TIMELOW := T#1S, TIMEHIGH := T#1S);
END_NETWORK
NETWORK
  TON_0(IN := NOT Bugs.reportConnectionAlive, PT := T#2S);
END_NETWORK
NETWORK
  TON_1(IN := Bugs.reportConnectionAlive, PT := T#2S);
END_NETWORK
NETWORK
  Bugs.restart := (TON_0.Q OR TON_1.Q);
END_NETWORK

END_PROGRAM
