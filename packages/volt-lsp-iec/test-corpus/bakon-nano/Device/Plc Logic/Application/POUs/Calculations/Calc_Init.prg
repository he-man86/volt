PROGRAM Calc_Init
VAR
	Cnt_pos: INT;
END_VAR

(* Init array *)
FOR Cnt_pos := 1 TO (C_wNumberOfMotionObjects -1)  BY 1 DO
	g_aCuttingPositions[Cnt_pos].X_Target			:=-50;
	g_aCuttingPositions[Cnt_pos].Y_Target			:=-50;
	g_aCuttingPositions[Cnt_pos].A_Target			:=-50;
	g_aCuttingPositions[Cnt_pos].K_Target			:= 0;
	g_aCuttingPositions[Cnt_pos].bPushAwayProduct 	:= FALSE;
	g_aCuttingPositions[Cnt_pos].rPushAwayDistance 	:= 0;
	g_aCuttingPositions[Cnt_pos].bCutPosPossible 	:= TRUE;
	g_aCuttingPositions[Cnt_pos].bCrashDetectCheck 	:= FALSE;
END_FOR

FOR Cnt_pos := 1 TO 100 BY 1 DO
	g_aWastePositions[Cnt_pos].X_Target				:=-50;
	g_aWastePositions[Cnt_pos].Y_Target				:=-50;
	g_aWastePositions[Cnt_pos].A_Target				:=-50;
	g_aWastePositions[Cnt_pos].K_Target				:= 0;
	g_aWastePositions[Cnt_pos].bPushAwayProduct 	:= FALSE;
	g_aWastePositions[Cnt_pos].rPushAwayDistance 	:= 0;
	g_aWastePositions[Cnt_pos].bCutPosPossible 		:= TRUE;
	g_aWastePositions[Cnt_pos].bCrashDetectCheck	:= FALSE;
END_FOR

(*Minimale Afvalrand limieten bepalen*) 
CASE G_HMI_RCP_Parameters.nProductType OF
	Prod_Tray_Rectangle_1x2, Prod_Tray_Rectangle_1x1, Prod_Tray_Rectangle_1x4, Prod_Tray_Rectangle_2x1 :	(* Tray products *)
	g_HMI_RCP_Parameters.rSizeTrimRight := MAX( g_HMI_RCP_Parameters.rSizeTrimRight, 0);
	g_HMI_RCP_Parameters.rSizeTrimLeft 	:= MAX( g_HMI_RCP_Parameters.rSizeTrimLeft, 0);
	g_HMI_RCP_Parameters.rSizeTrimFront := MAX( g_HMI_RCP_Parameters.rSizeTrimFront, 0);
	g_HMI_RCP_Parameters.rSizeTrimRear  := MAX( g_HMI_RCP_Parameters.rSizeTrimRear, 0);
END_CASE

(* Determine waste strips front and rear *)
g_bTrimRight		:=	g_HMI_RCP_Parameters.rSizeTrimRight > 0 ;
g_bTrimLeft			:=	g_HMI_RCP_Parameters.rSizeTrimLeft > 0 ;
g_bTrimRear			:=	g_HMI_RCP_Parameters.rSizeTrimFront > 0 ;(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)
g_bTrimFront		:=	g_HMI_RCP_Parameters.rSizeTrimRear > 0 ;(*AC 28-11-12: Omgedraaid vanaf HMI INstellingen*)

g_sCuttingPositionsInfo.index := g_sCuttingPositionsInfo.lowerBound;	(* Array counter *)
g_sWastePositionsInfo.index := g_sWastePositionsInfo.lowerBound;

g_sMACH.ERR.bOvershootCorrectionImpossible := FALSE;

END_PROGRAM
