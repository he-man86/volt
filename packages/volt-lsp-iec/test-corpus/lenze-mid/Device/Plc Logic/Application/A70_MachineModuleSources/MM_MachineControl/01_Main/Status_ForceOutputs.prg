PROGRAM Status_ForceOutputs
VAR
END_VAR

NETWORK 0 LD
  LET en1 := TRUE;
  IF en1 THEN LST_InputsOutputs.Serv_IB100 := MOVE(%IB26); END_IF
  LET en2 := TRUE;
  IF en2 THEN LST_InputsOutputs.Serv_IB101 := MOVE(%IB27); END_IF
END_NETWORK
NETWORK 1 LD
  LET en1 := TRUE;
  IF en1 THEN LST_InputsOutputs.Serv_IB132 := MOVE(%IB370); END_IF
  LET en2 := TRUE;
  IF en2 THEN LST_InputsOutputs.Serv_IB133 := MOVE(%IB371); END_IF
  LET en3 := TRUE;
  IF en3 THEN LST_InputsOutputs.Serv_IB136 := MOVE(%IB372); END_IF
  LET en4 := TRUE;
  IF en4 THEN LST_InputsOutputs.Serv_IB137 := MOVE(%IB373); END_IF
END_NETWORK
NETWORK 2 LD
  LET en1 := HMI_Var.ForceOutputs;
  IF en1 THEN LET g1 := ForceOutput(); END_IF
END_NETWORK
NETWORK 3 LD
  LET en1 := NOT HMI_Var.ForceOutputs;
  IF en1 THEN LET g1 := ForceOutput_1(); END_IF
END_NETWORK
NETWORK 4 LD
END_NETWORK

END_PROGRAM
