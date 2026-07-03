PROGRAM Calc_Main
VAR

	rCenterPointKnifeInverted: REAL;
	rSizeOfKnife: REAL;
	rCenterPointKnife: REAL;
	n : INT;
	m : INT;
END_VAR

IF g_bCalculationStart AND NOT g_bCalculationDone
THEN
	Calc_Init();
	
	IF NOT g_HMI_MachCommand.bScanMode THEN
		
		(* Knife position 90 degrees: (|) *)
		IF NOT Calc_Ver() THEN
			g_sMACH.ERR.bCalcVerError := TRUE;
		END_IF
		
		IF NOT Calc_Hor() THEN
			g_sMACH.ERR.bCalcHorError := TRUE;
		END_IF
		
		IF NOT Calc_Dia1_Compact() THEN
			g_sMACH.ERR.bCalcDia1Error := TRUE;
		END_IF
		
		IF NOT Calc_Dia2_Compact() THEN
			g_sMACH.ERR.bCalcDia2Error := TRUE;
		END_IF


		(*Loopje om afval posities vooraan te zetten*)
		IF g_HMI_RCP_Parameters.bCutWasteFirst AND (g_bTrimFront OR g_bTrimRear OR g_bTrimLeft OR g_bTrimRight) THEN
			FOR n := g_sCuttingPositionsInfo.index + g_sWastePositionsInfo.index  - 2 TO 1 BY -1 DO
				IF n < g_sWastePositionsInfo.index  THEN
					g_aCuttingPositions[n] := g_aWastePositions[n];
				ELSE
					g_aCuttingPositions[n] := g_aCuttingPositions[n - g_sWastePositionsInfo.index +1];
				END_IF
			END_FOR
		END_IF
	
		(*Loopje voor crash detectie posities*)
		IF gMachConfig.bCrashDetection AND g_HMI_RCP_Parameters.bCutWasteFirst AND 
			(g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x1
			OR	g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x2
			OR g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_1x4
			OR g_HMI_RCP_Parameters.nProductType = Prod_Tray_Rectangle_2x1
			) 
		THEN
			m := g_sCuttingPositionsInfo.index + g_sWastePositionsInfo.index  -2 + g_sWastePositionsInfo.index  -1;
			FOR n := g_sCuttingPositionsInfo.index + g_sWastePositionsInfo.index  -2 TO 1 BY -1 DO
				g_aCuttingPositions[m] := g_aCuttingPositions[n];
				m := m -1;
				IF n < g_sWastePositionsInfo.index  THEN
					g_aCuttingPositions[m] := g_aCuttingPositions[n];
					g_aCuttingPositions[m].bPushAwayProduct := FALSE;
					g_aCuttingPositions[m].bCrashDetectCheck := TRUE;
					m := m - 1;	
				END_IF
			END_FOR
		END_IF 
		
		(* V13.01, delete all impossible cutting positions *)
		Calc_SkipPositions();
	ELSE
		Calc_Service();
	END_IF
		
	Calc_BottomPos();	// Calculate Z bottom pos and pos above product
	
	rSizeOfKnife					:= g_HMI_MCH_Parameters.rSizeOfKnife;
	rCenterPointKnife				:= rSizeOfKnife/2;
	rCenterPointKnifeInverted	:= rSizeOfKnife/2;

	g_rEndTargetX := g_aCuttingPositions[1].X_Target;
	g_rEndTargetY := g_aCuttingPositions[1].Y_Target;
	g_rEndTargetA := g_aCuttingPositions[1].A_Target;
	g_rEndTargetK := g_aCuttingPositions[1].K_Target;
END_IF
g_bCalculationDone := g_bCalculationStart;

END_PROGRAM
