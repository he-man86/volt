PROGRAM ForceOutput_1
VAR
END_VAR

NETWORK 0 LD
  LET g2 := NOT HMI_Var.ForceOutputs;
  LST_InputsOutputs.Serv_QB100.0 := (g2 AND LST_InputsOutputs.Q100_0_Pilot_light_Alarm_green_);
  LST_InputsOutputs.Serv_QB100.1 := (g2 AND LST_InputsOutputs.Q100_1_Pilot_light_Alarm_orange_);
  LST_InputsOutputs.Serv_QB100.2 := (g2 AND LST_InputsOutputs.Q100_2_Pilot_light_Alarm_red_);
  LST_InputsOutputs.Serv_QB100.3 := (g2 AND LST_InputsOutputs.Q100_3_Pilot_light_Alarm_buzzer_);
  LST_InputsOutputs.Serv_QB100.4 := (g2 AND LST_InputsOutputs.Q100_4_Spare);
  LST_InputsOutputs.Serv_QB100.5 := (g2 AND LST_InputsOutputs.Q100_5_Signal_lamp_Start);
  LST_InputsOutputs.Serv_QB100.6 := (g2 AND LST_InputsOutputs.Q100_6_Signal_lamp_Stop);
  LST_InputsOutputs.Serv_QB100.7 := (g2 AND LST_InputsOutputs.Q100_7_Activate_greasing_system);
  LST_InputsOutputs.Serv_QB101.0 := (g2 AND LST_InputsOutputs.Q101_0_REL_release_brake);
  LST_InputsOutputs.Serv_QB101.1 := (g2 AND LST_InputsOutputs.Q101_1_PNV_Waterlevel_control);
  LST_InputsOutputs.Serv_QB101.2 := (g2 AND LST_InputsOutputs.Q101_2_Enable_GluePump);
  LST_InputsOutputs.Serv_QB101.3 := (g2 AND LST_InputsOutputs.Q101_3_Spare);
  LST_InputsOutputs.Serv_QB101.4 := (g2 AND LST_InputsOutputs.Q101_4_Spare);
  LST_InputsOutputs.Serv_QB101.5 := (g2 AND LST_InputsOutputs.Q101_5_Spare);
  LST_InputsOutputs.Serv_QB101.6 := (g2 AND LST_InputsOutputs.Q101_6_Spare);
  LST_InputsOutputs.Serv_QB101.7 := (g2 AND LST_InputsOutputs.Q101_7_Spare);
END_NETWORK
NETWORK 1 LD
  LET g1 := NOT HMI_Var.ForceOutputs;
  LST_InputsOutputs.Serv_QB132.0 := (g1 AND LST_InputsOutputs.Q132_0_SL_Start_OP2a);
  LST_InputsOutputs.Serv_QB132.1 := (g1 AND LST_InputsOutputs.Q132_1_SL_Stop_OP2a);
  LST_InputsOutputs.Serv_QB132.2 := (g1 AND LST_InputsOutputs.Q132_2_Enable_power_controllers);
  LST_InputsOutputs.Serv_QB132.3 := (g1 AND LST_InputsOutputs.Q132_3_Spare);
  LST_InputsOutputs.Serv_QB132.4 := (g1 AND LST_InputsOutputs.Q132_4_CT_Fan_dryer);
  LST_InputsOutputs.Serv_QB132.5 := (g1 AND LST_InputsOutputs.Q132_5_Spare);
  LST_InputsOutputs.Serv_QB132.6 := (g1 AND LST_InputsOutputs.Q132_6_PNV_Inpusher);
  LST_InputsOutputs.Serv_QB132.7 := (g1 AND LST_InputsOutputs.Q132_7_PNV_tilting_inpusher);
  LST_InputsOutputs.Serv_QB133.0 := (g1 AND LST_InputsOutputs.Q133_0_Spare);
  LST_InputsOutputs.Serv_QB133.1 := (g1 AND LST_InputsOutputs.Q133_1_Spare);
  LST_InputsOutputs.Serv_QB133.2 := (g1 AND LST_InputsOutputs.Q133_2_Spare);
  LST_InputsOutputs.Serv_QB133.3 := (g1 AND LST_InputsOutputs.Q133_3_Spare);
  LST_InputsOutputs.Serv_QB133.4 := (g1 AND LST_InputsOutputs.Q133_4_Spare);
  LST_InputsOutputs.Serv_QB133.5 := (g1 AND LST_InputsOutputs.Q133_5_InfeedConv_Fwd);
  LST_InputsOutputs.Serv_QB133.6 := (g1 AND LST_InputsOutputs.Q133_6_InfeedConv_Rev);
  LST_InputsOutputs.Serv_QB133.7 := (g1 AND LST_InputsOutputs.Q133_7_OutfeedConv_Fwd);
END_NETWORK
NETWORK 2 LD
  LET g0 := NOT HMI_Var.ForceOutputs;
  LST_InputsOutputs.Serv_QB136.0 := (g0 AND LST_InputsOutputs.Q136_0_Spare);
  LST_InputsOutputs.Serv_QB136.1 := (g0 AND LST_InputsOutputs.Q136_1_Spare);
  LST_InputsOutputs.Serv_QB136.2 := (g0 AND LST_InputsOutputs.Q136_2_Spare);
  LST_InputsOutputs.Serv_QB136.3 := (g0 AND LST_InputsOutputs.Q136_3_Spare);
  LST_InputsOutputs.Serv_QB136.4 := (g0 AND LST_InputsOutputs.Q136_4_Spare);
  LST_InputsOutputs.Serv_QB136.5 := (g0 AND LST_InputsOutputs.Q136_5_Spare);
  LST_InputsOutputs.Serv_QB136.6 := (g0 AND LST_InputsOutputs.Q136_6_Spare);
  LST_InputsOutputs.Serv_QB132.7 := (g0 AND LST_InputsOutputs.Q136_7_Spare);
  LST_InputsOutputs.Serv_QB137.0 := (g0 AND LST_InputsOutputs.Q137_0_Spare);
  LST_InputsOutputs.Serv_QB137.1 := (g0 AND LST_InputsOutputs.Q137_1_Spare);
  LST_InputsOutputs.Serv_QB137.2 := (g0 AND LST_InputsOutputs.Q137_2_Spare);
  LST_InputsOutputs.Serv_QB137.3 := (g0 AND LST_InputsOutputs.Q137_3_Spare);
  LST_InputsOutputs.Serv_QB137.4 := (g0 AND LST_InputsOutputs.Q137_4_Spare);
  LST_InputsOutputs.Serv_QB137.5 := (g0 AND LST_InputsOutputs.Q137_5_Spare);
  LST_InputsOutputs.Serv_QB137.6 := (g0 AND LST_InputsOutputs.Q137_6_Spare);
  LST_InputsOutputs.Serv_QB137.7 := (g0 AND LST_InputsOutputs.Q137_7_Spare);
END_NETWORK
NETWORK 3 LD
END_NETWORK

END_PROGRAM
