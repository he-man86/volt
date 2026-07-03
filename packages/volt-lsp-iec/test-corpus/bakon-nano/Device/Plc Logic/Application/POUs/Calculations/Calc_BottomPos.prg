PROGRAM Calc_BottomPos
VAR
END_VAR

//Bereken diepste positie van Z-as (Hoogste) afhankelijk van geselecteerd product plaat.

CASE g_HMI_RCP_Parameters.nProductType  OF
	Prod_Tray_Rectangle_1x1:
		g_sCalculated.rBottomZPos		:= g_HMI_MCH_Parameters.rBottomZPosTrayLarge - g_HMI_RCP_Parameters.rStopHeightKnife;
		g_sCalculated.rAboveProductPos	:= MIN((g_HMI_MCH_Parameters.rBottomZPosTrayLarge - g_HMI_RCP_Parameters.rStartHeightKnife - C_rExtraMarginKnifeHeight),(g_HMI_MCH_Parameters.rBottomZPosTrayLarge - g_HMI_MCH_Parameters.rProdHeightTrayMinimum));
		g_sCalculated.rCrashCheckHeight	:= (g_HMI_MCH_Parameters.rBottomZPosTrayLarge - g_HMI_MCH_Parameters.rProdHeightTrayMinimum + 8); // + 5mm
	Prod_Tray_Rectangle_1x2:
		g_sCalculated.rBottomZPos	:= g_HMI_MCH_Parameters.rBottomZPosTraySmall - g_HMI_RCP_Parameters.rStopHeightKnife;
		g_sCalculated.rAboveProductPos := MIN((g_HMI_MCH_Parameters.rBottomZPosTraySmall - g_HMI_RCP_Parameters.rStartHeightKnife - C_rExtraMarginKnifeHeight),(g_HMI_MCH_Parameters.rBottomZPosTraySmall - g_HMI_MCH_Parameters.rProdHeightTrayMinimum));
		g_sCalculated.rCrashCheckHeight	:= (g_HMI_MCH_Parameters.rBottomZPosTraySmall - g_HMI_MCH_Parameters.rProdHeightTrayMinimum + 8); // + 5mm
	Prod_Tray_Rectangle_2x1:		(* V07.01 *)
		g_sCalculated.rBottomZPos		 := g_HMI_MCH_Parameters.rBottomZPosTrayDouble - g_HMI_RCP_Parameters.rStopHeightKnife;
		g_sCalculated.rAboveProductPos := MIN((g_HMI_MCH_Parameters.rBottomZPosTrayDouble - g_HMI_RCP_Parameters.rStartHeightKnife - C_rExtraMarginKnifeHeight),(g_HMI_MCH_Parameters.rBottomZPosTrayDouble - g_HMI_MCH_Parameters.rProdHeightTrayMinimum));
		g_sCalculated.rCrashCheckHeight	:= (g_HMI_MCH_Parameters.rBottomZPosTrayDouble - g_HMI_MCH_Parameters.rProdHeightTrayMinimum + 8); // + 5mm
	Prod_Tray_Rectangle_1x4:
		g_sCalculated.rBottomZPos	:= g_HMI_MCH_Parameters.rBottomZPosTrayTriple - g_HMI_RCP_Parameters.rStopHeightKnife;
		g_sCalculated.rAboveProductPos := MIN((g_HMI_MCH_Parameters.rBottomZPosTrayTriple - g_HMI_RCP_Parameters.rStartHeightKnife - C_rExtraMarginKnifeHeight),(g_HMI_MCH_Parameters.rBottomZPosTrayTriple - g_HMI_MCH_Parameters.rProdHeightTrayMinimum));
		g_sCalculated.rCrashCheckHeight	:= (g_HMI_MCH_Parameters.rBottomZPosTrayTriple -g_HMI_MCH_Parameters.rProdHeightTrayMinimum + 8); // + 5mm
	Prod_Round_POC_2x1:
		g_sCalculated.rBottomZPos	:= g_HMI_MCH_Parameters.rBottomZPosRound - g_HMI_RCP_Parameters.rStopHeightKnife;
		g_sCalculated.rAboveProductPos := MIN((g_HMI_MCH_Parameters.rBottomZPosRound - g_HMI_RCP_Parameters.rStartHeightKnife - C_rExtraMarginKnifeHeight),(g_HMI_MCH_Parameters.rBottomZPosRound - 10));	(* altijd minimaal 10 mm *)
		g_sCalculated.rCrashCheckHeight	:= (g_HMI_MCH_Parameters.rBottomZPosRound - g_HMI_MCH_Parameters.rProdHeightTrayMinimum + 8); // + 5mm
	Prod_Round_POC_2x2:
		g_sCalculated.rBottomZPos	:= g_HMI_MCH_Parameters.rBottomZPosRoundQuatro - g_HMI_RCP_Parameters.rStopHeightKnife;
		g_sCalculated.rAboveProductPos := MIN((g_HMI_MCH_Parameters.rBottomZPosRoundQuatro - g_HMI_RCP_Parameters.rStartHeightKnife - C_rExtraMarginKnifeHeight),(g_HMI_MCH_Parameters.rBottomZPosRoundQuatro - 10));	(* altijd minimaal 10 mm *)
		g_sCalculated.rCrashCheckHeight	:= (g_HMI_MCH_Parameters.rBottomZPosRoundQuatro - g_HMI_MCH_Parameters.rProdHeightTrayMinimum + 8); // + 5mm
	Prod_Slab_Rectangle_2x1:
		g_sCalculated.rBottomZPos	:= g_HMI_MCH_Parameters.rBottomZPosSlabDouble - g_HMI_RCP_Parameters.rStopHeightKnife;
		g_sCalculated.rAboveProductPos := MIN((g_HMI_MCH_Parameters.rBottomZPosSlabDouble - g_HMI_RCP_Parameters.rStartHeightKnife - C_rExtraMarginKnifeHeight),(g_HMI_MCH_Parameters.rBottomZPosSlab - 10));
		g_sCalculated.rCrashCheckHeight	:= (g_HMI_MCH_Parameters.rBottomZPosSlabDouble - g_HMI_MCH_Parameters.rProdHeightTrayMinimum + 8); // + 5mm
ELSE
		g_sCalculated.rBottomZPos	:= g_HMI_MCH_Parameters.rBottomZPosSlab - g_HMI_RCP_Parameters.rStopHeightKnife;
		g_sCalculated.rAboveProductPos := MIN((g_HMI_MCH_Parameters.rBottomZPosSlab - g_HMI_RCP_Parameters.rStartHeightKnife - C_rExtraMarginKnifeHeight),(g_HMI_MCH_Parameters.rBottomZPosSlab - 10));
		g_sCalculated.rCrashCheckHeight	:= (g_HMI_MCH_Parameters.rBottomZPosSlab - g_HMI_MCH_Parameters.rProdHeightTrayMinimum + 8); // + 5mm
END_CASE

g_sCalculated.rCrashCheckHeight := MIN(g_sCalculated.rCrashCheckHeight, g_sCalculated.rBottomZPos-1);


IF g_HMI_MachCommand.bScanMode THEN
		g_sCalculated.rBottomZPos	:= MIN(g_HMI_MCH_Parameters.rBottomZPosSlab,
										MIN(g_HMI_MCH_Parameters.rBottomZPosSlabDouble,
										MIN(g_HMI_MCH_Parameters.rBottomZPosRoundQuatro,
										MIN(g_HMI_MCH_Parameters.rBottomZPosRound,
										MIN(g_HMI_MCH_Parameters.rBottomZPosTrayDouble,
										MIN(g_HMI_MCH_Parameters.rBottomZPosTrayLarge,
										MIN(g_HMI_MCH_Parameters.rBottomZPosTraySmall,
										g_HMI_MCH_Parameters.rBottomZPosTrayTriple)))))));
		g_sCalculated.rAboveProductPos := 0;	
END_IF

g_sCalculated.rAboveProductPos := SEL(g_sMACH.MCL.bActCleaning,g_sCalculated.rAboveProductPos,0); //AC Correctie voor schoonmaak bedrijf waarbij er nog geen bottompos is ingesteld

END_PROGRAM
