PROGRAM ForceOutput
VAR
END_VAR

NETWORK 0 LD
  LET g2 := HMI_Var.ForceOutputs;
  LST_InputsOutputs.Q100_0_Pilot_light_Alarm_green_ := (g2 AND LST_InputsOutputs.Serv_QB100.0);
  LST_InputsOutputs.Q100_1_Pilot_light_Alarm_orange_ := (g2 AND LST_InputsOutputs.Serv_QB100.1);
  LST_InputsOutputs.Q100_2_Pilot_light_Alarm_red_ := (g2 AND LST_InputsOutputs.Serv_QB100.2);
  LST_InputsOutputs.Q100_3_Pilot_light_Alarm_buzzer_ := (g2 AND LST_InputsOutputs.Serv_QB100.3);
  LST_InputsOutputs.Q100_4_Spare := (g2 AND LST_InputsOutputs.Serv_QB100.4);
  LST_InputsOutputs.Q100_5_Signal_lamp_Start := (g2 AND LST_InputsOutputs.Serv_QB100.5);
  LST_InputsOutputs.Q100_6_Signal_lamp_Stop := (g2 AND LST_InputsOutputs.Serv_QB100.6);
  LST_InputsOutputs.Q100_7_Activate_greasing_system := (g2 AND LST_InputsOutputs.Serv_QB100.7);
  LST_InputsOutputs.Q101_0_REL_release_brake := (g2 AND LST_InputsOutputs.Serv_QB101.0);
  LST_InputsOutputs.Q101_1_PNV_Waterlevel_control := (g2 AND LST_InputsOutputs.Serv_QB101.1);
  LST_InputsOutputs.Q101_2_Enable_GluePump := (g2 AND LST_InputsOutputs.Serv_QB101.2);
  LST_InputsOutputs.Q101_3_Spare := (g2 AND LST_InputsOutputs.Serv_QB101.3);
  LST_InputsOutputs.Q101_4_Spare := (g2 AND LST_InputsOutputs.Serv_QB101.4);
  LST_InputsOutputs.Q101_5_Spare := (g2 AND LST_InputsOutputs.Serv_QB101.5);
  LST_InputsOutputs.Q101_6_Spare := (g2 AND LST_InputsOutputs.Serv_QB101.6);
  LST_InputsOutputs.Q101_7_Spare := (g2 AND LST_InputsOutputs.Serv_QB101.7);
END_NETWORK
NETWORK 1 LD
  LET g1 := HMI_Var.ForceOutputs;
  LST_InputsOutputs.Q132_0_SL_Start_OP2a := (g1 AND LST_InputsOutputs.Serv_QB132.0);
  LST_InputsOutputs.Q132_1_SL_Stop_OP2a := (g1 AND LST_InputsOutputs.Serv_QB132.1);
  LST_InputsOutputs.Q132_2_Enable_power_controllers := (g1 AND LST_InputsOutputs.Serv_QB132.2);
  LST_InputsOutputs.Q132_3_Spare := (g1 AND LST_InputsOutputs.Serv_QB132.3);
  LST_InputsOutputs.Q132_4_CT_Fan_dryer := (g1 AND LST_InputsOutputs.Serv_QB132.4);
  LST_InputsOutputs.Q132_5_Spare := (g1 AND LST_InputsOutputs.Serv_QB132.5);
  LST_InputsOutputs.Q132_6_PNV_Inpusher := (g1 AND LST_InputsOutputs.Serv_QB132.6);
  LST_InputsOutputs.Q132_7_PNV_tilting_inpusher := (g1 AND LST_InputsOutputs.Serv_QB132.7);
  LST_InputsOutputs.Q133_0_Spare := (g1 AND LST_InputsOutputs.Serv_QB133.0);
  LST_InputsOutputs.Q133_1_Spare := (g1 AND LST_InputsOutputs.Serv_QB133.1);
  LST_InputsOutputs.Q133_2_Spare := (g1 AND LST_InputsOutputs.Serv_QB133.2);
  LST_InputsOutputs.Q133_3_Spare := (g1 AND LST_InputsOutputs.Serv_QB133.3);
  LST_InputsOutputs.Q133_4_Spare := (g1 AND LST_InputsOutputs.Serv_QB133.4);
  LST_InputsOutputs.Q133_5_InfeedConv_Fwd := (g1 AND LST_InputsOutputs.Serv_QB133.5);
  LST_InputsOutputs.Q133_6_InfeedConv_Rev := (g1 AND LST_InputsOutputs.Serv_QB133.6);
  LST_InputsOutputs.Q133_7_OutfeedConv_Fwd := (g1 AND LST_InputsOutputs.Serv_QB133.7);
END_NETWORK
NETWORK 2 LD
  LET g0 := HMI_Var.ForceOutputs;
  LST_InputsOutputs.Q136_0_Spare := (g0 AND LST_InputsOutputs.Serv_QB136.0);
  LST_InputsOutputs.Q136_1_Spare := (g0 AND LST_InputsOutputs.Serv_QB136.1);
  LST_InputsOutputs.Q136_2_Spare := (g0 AND LST_InputsOutputs.Serv_QB136.2);
  LST_InputsOutputs.Q136_3_Spare := (g0 AND LST_InputsOutputs.Serv_QB136.3);
  LST_InputsOutputs.Q136_4_Spare := (g0 AND LST_InputsOutputs.Serv_QB136.4);
  LST_InputsOutputs.Q136_5_Spare := (g0 AND LST_InputsOutputs.Serv_QB136.5);
  LST_InputsOutputs.Q136_6_Spare := (g0 AND LST_InputsOutputs.Serv_QB136.6);
  LST_InputsOutputs.Q136_7_Spare := (g0 AND LST_InputsOutputs.Serv_QB132.7);
  LST_InputsOutputs.Q137_0_Spare := (g0 AND LST_InputsOutputs.Serv_QB137.0);
  LST_InputsOutputs.Q137_1_Spare := (g0 AND LST_InputsOutputs.Serv_QB137.1);
  LST_InputsOutputs.Q137_2_Spare := (g0 AND LST_InputsOutputs.Serv_QB137.2);
  LST_InputsOutputs.Q137_3_Spare := (g0 AND LST_InputsOutputs.Serv_QB137.3);
  LST_InputsOutputs.Q137_4_Spare := (g0 AND LST_InputsOutputs.Serv_QB137.4);
  LST_InputsOutputs.Q137_5_Spare := (g0 AND LST_InputsOutputs.Serv_QB137.5);
  LST_InputsOutputs.Q137_6_Spare := (g0 AND LST_InputsOutputs.Serv_QB137.6);
  LST_InputsOutputs.Q137_7_Spare := (g0 AND LST_InputsOutputs.Serv_QB137.7);
END_NETWORK
NETWORK 3 LD
END_NETWORK

END_PROGRAM
