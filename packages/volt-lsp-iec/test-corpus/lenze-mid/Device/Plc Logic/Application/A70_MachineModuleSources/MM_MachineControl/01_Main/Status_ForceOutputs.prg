PROGRAM Status_ForceOutputs
VAR
END_VAR
IMPLEMENTATION LD
NETWORK
  VAR_TEMP g9 : BOOL; END_VAR
  g9 := TRUE;
  MOVE(EN := g9, %IB26, => LST_InputsOutputs.Serv_IB100);
  MOVE(EN := g9, %IB27, => LST_InputsOutputs.Serv_IB101);
END_NETWORK
NETWORK
  VAR_TEMP g13 : BOOL; END_VAR
  g13 := TRUE;
  MOVE(EN := g13, %IB370, => LST_InputsOutputs.Serv_IB132);
  MOVE(EN := g13, %IB371, => LST_InputsOutputs.Serv_IB133);
  MOVE(EN := g13, %IB372, => LST_InputsOutputs.Serv_IB136);
  MOVE(EN := g13, %IB373, => LST_InputsOutputs.Serv_IB137);
END_NETWORK
NETWORK
  ForceOutput(EN := HMI_Var.ForceOutputs);
END_NETWORK
NETWORK
  ForceOutput_1(EN := NOT HMI_Var.ForceOutputs);
END_NETWORK
NETWORK
END_NETWORK

END_PROGRAM
