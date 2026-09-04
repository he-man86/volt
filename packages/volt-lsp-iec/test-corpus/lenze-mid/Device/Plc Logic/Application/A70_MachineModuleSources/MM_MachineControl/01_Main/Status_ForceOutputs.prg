PROGRAM Status_ForceOutputs
VAR
END_VAR

NETWORK 0 LD
  LET g9 := TRUE;
  LET en1 := g9;
  IF en1 THEN LST_InputsOutputs.Serv_IB100 := MOVE(%IB26); END_IF
  LET en2 := g9;
  IF en2 THEN LST_InputsOutputs.Serv_IB101 := MOVE(%IB27); END_IF
END_NETWORK
NETWORK 1 LD
  LET g13 := TRUE;
  LET en1 := g13;
  IF en1 THEN LST_InputsOutputs.Serv_IB132 := MOVE(%IB370); END_IF
  LET en2 := g13;
  IF en2 THEN LST_InputsOutputs.Serv_IB133 := MOVE(%IB371); END_IF
  LET en3 := g13;
  IF en3 THEN LST_InputsOutputs.Serv_IB136 := MOVE(%IB372); END_IF
  LET en4 := g13;
  IF en4 THEN LST_InputsOutputs.Serv_IB137 := MOVE(%IB373); END_IF
END_NETWORK
NETWORK 2 LD
  LET en1 := HMI_Var.ForceOutputs;
  IF en1 THEN ForceOutput(); END_IF
END_NETWORK
NETWORK 3 LD
  LET en1 := NOT HMI_Var.ForceOutputs;
  IF en1 THEN ForceOutput_1(); END_IF
END_NETWORK
NETWORK 4 LD
END_NETWORK

END_PROGRAM
