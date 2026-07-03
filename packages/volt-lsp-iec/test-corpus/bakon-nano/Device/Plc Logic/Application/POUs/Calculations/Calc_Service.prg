PROGRAM Calc_Service
VAR
	rStartPointSlab_X: REAL;
	rStartPointSlab_Y: REAL;
	rSizeTrimRear: REAL;
	rSizeTrimRight: REAL;
	nPos: INT;
END_VAR

nPos	:= 1;

	(* Ronde taart *)
	g_aCuttingPositions[nPos].X_Target := g_HMI_MCH_Parameters.rMidPosRoundCake1_X;
	g_aCuttingPositions[nPos].Y_Target := g_HMI_MCH_Parameters.rMidPosRoundCake1_Y;
	g_aCuttingPositions[nPos].A_Target := 0;
	nPos	:= nPos + 1;

	g_aCuttingPositions[nPos].X_Target := g_HMI_MCH_Parameters.rMidPosRoundCake1_X;
	g_aCuttingPositions[nPos].Y_Target := g_HMI_MCH_Parameters.rMidPosRoundCake1_Y;
	g_aCuttingPositions[nPos].A_Target := 90;
	nPos	:= nPos + 1;

	g_aCuttingPositions[nPos].X_Target := g_HMI_MCH_Parameters.rMidPosRoundCake1_X;
	g_aCuttingPositions[nPos].Y_Target := g_HMI_MCH_Parameters.rMidPosRoundCake1_Y;
	g_aCuttingPositions[nPos].A_Target := 45;
	nPos	:= nPos + 1;

	g_aCuttingPositions[nPos].X_Target := g_HMI_MCH_Parameters.rMidPosRoundCake1_X;
	g_aCuttingPositions[nPos].Y_Target := g_HMI_MCH_Parameters.rMidPosRoundCake1_Y;
	g_aCuttingPositions[nPos].A_Target := 135;
	nPos	:= nPos + 1;

	(* Slab verticaal (|) *)
	rStartPointSlab_X	:= MAX(g_HMI_MCH_Parameters.rStartPointSlab_X, g_HMI_MCH_Parameters.rStartPointTrayLarge_X);
	rStartPointSlab_Y	:= MAX(g_HMI_MCH_Parameters.rStartPointSlab_Y, g_HMI_MCH_Parameters.rStartPointTrayLarge_Y);
	rSizeTrimRight	:= 10;
	rSizeTrimRear		:= 10;

	g_aCuttingPositions[nPos].X_Target := rStartPointSlab_X + rSizeTrimRight;
	g_aCuttingPositions[nPos].Y_Target := rStartPointSlab_Y + rSizeTrimRear + g_HMI_MCH_Parameters.rSizeOfKnife/2;
	g_aCuttingPositions[nPos].A_Target := 90;
	nPos	:= nPos + 1;

	g_aCuttingPositions[nPos].X_Target := rStartPointSlab_X + rSizeTrimRight;
	g_aCuttingPositions[nPos].Y_Target := rStartPointSlab_Y + rSizeTrimRear + g_HMI_MCH_Parameters.rSizeOfKnife / 2 + 65;
	g_aCuttingPositions[nPos].A_Target := 90;
	nPos	:= nPos + 1;

	g_aCuttingPositions[nPos].X_Target := rStartPointSlab_X + rSizeTrimRight + 200;
	g_aCuttingPositions[nPos].Y_Target := rStartPointSlab_Y + rSizeTrimRear + g_HMI_MCH_Parameters.rSizeOfKnife / 2 + 65;
	g_aCuttingPositions[nPos].A_Target := 90;
	nPos	:= nPos + 1;

	g_aCuttingPositions[nPos].X_Target := rStartPointSlab_X + rSizeTrimRight + 200;
	g_aCuttingPositions[nPos].Y_Target := rStartPointSlab_Y + rSizeTrimRear + g_HMI_MCH_Parameters.rSizeOfKnife / 2;
	g_aCuttingPositions[nPos].A_Target := 90;
	nPos	:= nPos + 1;

	g_aCuttingPositions[nPos].X_Target := rStartPointSlab_X + rSizeTrimRight + 400;
	g_aCuttingPositions[nPos].Y_Target := rStartPointSlab_Y + rSizeTrimRear + g_HMI_MCH_Parameters.rSizeOfKnife / 2;
	g_aCuttingPositions[nPos].A_Target := 90;
	nPos	:= nPos + 1;

	g_aCuttingPositions[nPos].X_Target := rStartPointSlab_X + rSizeTrimRight + 400;
	g_aCuttingPositions[nPos].Y_Target := rStartPointSlab_Y + rSizeTrimRear + g_HMI_MCH_Parameters.rSizeOfKnife / 2 + 65;
	g_aCuttingPositions[nPos].A_Target := 90;
	nPos	:= nPos + 1;

	(* Slab horizontal (-----) *)
	g_aCuttingPositions[nPos].X_Target := rStartPointSlab_X + rSizeTrimRight + g_HMI_MCH_Parameters.rSizeOfKnife / 2;
	g_aCuttingPositions[nPos].Y_Target := rStartPointSlab_Y + rSizeTrimRear;
	g_aCuttingPositions[nPos].A_Target := 0;
	nPos	:= nPos + 1;

	g_aCuttingPositions[nPos].X_Target := rStartPointSlab_X + rSizeTrimRight + g_HMI_MCH_Parameters.rSizeOfKnife / 2;
	g_aCuttingPositions[nPos].Y_Target := rStartPointSlab_Y + rSizeTrimRear + 100;
	g_aCuttingPositions[nPos].A_Target := 0;
	nPos	:= nPos + 1;

	g_aCuttingPositions[nPos].X_Target := rStartPointSlab_X + rSizeTrimRight + g_HMI_MCH_Parameters.rSizeOfKnife / 2;
	g_aCuttingPositions[nPos].Y_Target := rStartPointSlab_Y + rSizeTrimRear + 200;
	g_aCuttingPositions[nPos].A_Target := 0;
	nPos	:= nPos + 1;

	g_aCuttingPositions[nPos].X_Target := rStartPointSlab_X + rSizeTrimRight + g_HMI_MCH_Parameters.rSizeOfKnife / 2;
	g_aCuttingPositions[nPos].Y_Target := rStartPointSlab_Y + rSizeTrimRear +300;
	g_aCuttingPositions[nPos].A_Target := 0;
	nPos	:= nPos + 1;

	g_aCuttingPositions[nPos].X_Target := rStartPointSlab_X + rSizeTrimRight + g_HMI_MCH_Parameters.rSizeOfKnife / 2;
	g_aCuttingPositions[nPos].Y_Target := rStartPointSlab_Y + rSizeTrimRear + 400;
	g_aCuttingPositions[nPos].A_Target := 0;
	nPos	:= nPos + 1;

	(* Slab diagonaal, 45 graden, NB: vaste waarden, dus met ander mes kloppen de posities niet!!!! (mes tijdens beurs 315mm) *)
	g_aCuttingPositions[nPos].X_Target := 596; (* 1 *)
	g_aCuttingPositions[nPos].Y_Target := 109;
	g_aCuttingPositions[nPos].A_Target := 45;
	nPos	:= nPos + 1;

	g_aCuttingPositions[nPos].X_Target := 571;
	g_aCuttingPositions[nPos].Y_Target := 134;
	g_aCuttingPositions[nPos].A_Target := 45;
	nPos	:= nPos + 1;

	g_aCuttingPositions[nPos].X_Target := 546;
	g_aCuttingPositions[nPos].Y_Target := 159;
	g_aCuttingPositions[nPos].A_Target := 45;
	nPos	:= nPos + 1;

	g_aCuttingPositions[nPos].X_Target := 521; (* 4 *)
	g_aCuttingPositions[nPos].Y_Target := 184;
	g_aCuttingPositions[nPos].A_Target := 45;
	nPos	:= nPos + 1;

	g_aCuttingPositions[nPos].X_Target := 482.3693;
	g_aCuttingPositions[nPos].Y_Target := 195.3693;
	g_aCuttingPositions[nPos].A_Target := 45;
	nPos	:= nPos + 1;

	g_aCuttingPositions[nPos].X_Target := 509.6307;
	g_aCuttingPositions[nPos].Y_Target := 222.6307;
	g_aCuttingPositions[nPos].A_Target := 45;
	nPos	:= nPos + 1;

	g_aCuttingPositions[nPos].X_Target := 509.6307; (* 7 *)
	g_aCuttingPositions[nPos].Y_Target := 272.6307;
	g_aCuttingPositions[nPos].A_Target := 45;
	nPos	:= nPos + 1;

	g_aCuttingPositions[nPos].X_Target := 432.3693;
	g_aCuttingPositions[nPos].Y_Target := 195.3693;
	g_aCuttingPositions[nPos].A_Target := 45;
	nPos	:= nPos + 1;
	g_aCuttingPositions[nPos].X_Target := 382.3693;
	g_aCuttingPositions[nPos].Y_Target := 195.3693;
	g_aCuttingPositions[nPos].A_Target := 45;
	nPos	:= nPos + 1;

	g_aCuttingPositions[nPos].X_Target := 509.6307; (* 10 *)
	g_aCuttingPositions[nPos].Y_Target := 322.6307;
	g_aCuttingPositions[nPos].A_Target := 45;
	nPos	:= nPos + 1;

END_PROGRAM
