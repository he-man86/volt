PROGRAM fc_CheckRegister
VAR
END_VAR

NETWORK 0 LD
END_NETWORK
NETWORK 1 LD
  db_CheckRegister.CheckRegisterError := fc_CheckNumberOfErrorsRegister(db_CheckRegister.Positie, CTE.posCigarPresentOutfeed, Mach1_Data.Counters.MaxRepetitionNoCigarsDryer.SetValue);
END_NETWORK

END_PROGRAM
