PROGRAM fc_CheckRegister
VAR
END_VAR

NETWORK 0 LD "NETWORK 1: Shift CheckRegister"
  fc_ShiftRegister(db_CheckRegister.Positie);
END_NETWORK
NETWORK 1 LD "NETWORK 2: Check for error in dryer"
  fc_CheckNumberOfErrorsRegister(db_CheckRegister.Positie, CTE.posCigarPresentOutfeed, Mach1_Data.Counters.MaxRepetitionNoCigarsDryer.SetValue);
END_NETWORK

END_PROGRAM
