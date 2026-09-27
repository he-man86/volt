PROGRAM fc_CheckRegister
VAR
END_VAR
(* @volt-implementation LD *)
NETWORK TITLE: "NETWORK 1: Shift CheckRegister"
  fc_ShiftRegister(ioPositie := db_CheckRegister.Positie);
END_NETWORK
NETWORK TITLE: "NETWORK 2: Check for error in dryer"
  fc_CheckNumberOfErrorsRegister(iPositie := db_CheckRegister.Positie, iPositionToCheck := CTE.posCigarPresentOutfeed, iAmountOfErrors := Mach1_Data.Counters.MaxRepetitionNoCigarsDryer.SetValue, oError => db_CheckRegister.CheckRegisterError);
END_NETWORK

END_PROGRAM
