PROGRAM VisuCutsHandler
VAR
	hCutLineCounter : INT;
	nOfVerCuts		: INT;
	vCutLineCounter : INT;
	nOfHorCuts		: INT;
	nOfDiagCuts		: INT;
	rCutAngle		: REAL;
	rCutX			: REAL;
	rCutY			: REAL;
	rLenghtCut		: REAL;
	c_PI			: REAL;
	nDeleteDiagFrom		: INT;
	nPiecesHor			: INT;
	nPiecesVer 			: INT;
	bTriangles			: BOOL;
	rProdSizeX			: REAL;
	rProdSizeY			: REAL;
	nActPartXsize		: INT;
	nActPartYsize		: INT;
	
	sLocalRecipeVar		: sMACH_RCP_Parameters;
END_VAR

c_PI := 3.14159265359;
sLocalRecipeVar := g_HMI_RCP_Parameters_Visu;

nPiecesHor := sLocalRecipeVar.nPartsX;
nPiecesVer := sLocalRecipeVar.nPartsy;
bTriangles := (sLocalRecipeVar.nProductType = Prod_Slab_Triangle_1x1)
			OR ((sLocalRecipeVar.nProductType = Prod_Tray_Rectangle_1x1) AND sLocalRecipeVar.bTrianglesInTray);

(* ProductType = 0 = Slab Square *)
(* ProductType = 1 = Slab triangle *)
(* ProductType = 2 = Slab diagonal *)
(* ProductType = 3 = Round Cake *)
(* ProductType = 4 = Tray Square Small *)
(* ProductType = 5 = Tray Square Large *)	
			
CASE sLocalRecipeVar.nProductType OF
	0,1,2:	rProdSizeX := sLocalRecipeVar.rProdLength_InX;
			rProdSizeY := sLocalRecipeVar.rProdLength_InY;
		
	3:	rProdSizeX := sLocalRecipeVar.rDiameterRound;
		rProdSizeY := sLocalRecipeVar.rDiameterRound;
		
	4:	rProdSizeX := g_HMI_MCH_Parameters.rProdLengthTraySmall_InX;
		rProdSizeY := g_HMI_MCH_Parameters.rProdLengthTraySmall_InY;
		
	5:	rProdSizeX := g_HMI_MCH_Parameters.rProdLengthTrayLarge_InX;
		rProdSizeY := g_HMI_MCH_Parameters.rProdLengthTrayLarge_InY;	
END_CASE		
				

nActPartXsize			:= REAL_TO_INT(rProdSizeX / nPiecesHor);
nActPartYsize			:= REAL_TO_INT(rProdSizeY / nPiecesVer);
g_HMI_RCP_ActPartSize := CONCAT(TO_STRING(nActPartXsize), ' x ');
g_HMI_RCP_ActPartSize := CONCAT(g_HMI_RCP_ActPartSize , TO_STRING(nActPartYsize));
g_HMI_RCP_ActPartSize := CONCAT(g_HMI_RCP_ActPartSize, ' mm');
	
				
(* Make waste visible when waste size is > 0, global function *)
g_sHMI_VisuCutsArray[1].visible := g_HMI_RCP_UseWasteLeft;
g_sHMI_VisuCutsArray[2].visible := g_HMI_RCP_UseWasteRight;
g_sHMI_VisuCutsArray[3].visible := g_HMI_RCP_UseWasteRear;
g_sHMI_VisuCutsArray[4].visible := g_HMI_RCP_UseWasteFront;

//trims op 0 als ze uit staan
		IF NOT(g_HMI_RCP_UseWasteLeft) THEN
			g_HMI_RCP_Parameters_Visu.rSizeTrimLeft := 0;
		END_IF

		IF NOT(g_HMI_RCP_UseWasteRight) THEN
			g_HMI_RCP_Parameters_Visu.rSizeTrimRight := 0;
		END_IF
		
		IF NOT(g_HMI_RCP_UseWasteFront) THEN
			g_HMI_RCP_Parameters_Visu.rSizeTrimFront := 0;
		END_IF
		
		IF NOT(g_HMI_RCP_UseWasteRear) THEN
			g_HMI_RCP_Parameters_Visu.rSizeTrimRear:= 0;
		END_IF


g_HMI_RCP_ShowRCPwastesettings := g_HMI_RCP_UseWasteLeft OR g_HMI_RCP_UseWasteRight OR g_HMI_RCP_UseWasteRear OR g_HMI_RCP_UseWasteFront;

(* Display vertial lines, for the horizontal pieces *)
(* line 5 - 50 are the lines for horizontal pieces*)
IF nPiecesHor > 1 THEN
	rCutX:=(512.0 / INT_TO_REAL(nPiecesHor));
	//calculate x pos for the lines. width of box is 512, offset is 10 and make visible if used
	nOfVerCuts := nPiecesHor - 1;
	FOR hCutLineCounter := 5 TO (5+(nOfVerCuts-1)) DO 
		g_sHMI_VisuCutsArray[hCutLineCounter].xPos := CONCAT(TO_STRING((rCutX * (hCutLineCounter-4))+10), 'px');
		g_sHMI_VisuCutsArray[hCutLineCounter].visible := TRUE;
	END_FOR
		//make unused lines invisible
	FOR hCutLineCounter := (5+(nOfVerCuts)) TO 50 DO 
		g_sHMI_VisuCutsArray[hCutLineCounter].visible := FALSE;
		g_sHMI_VisuCutsArray[hCutLineCounter].xPos := '0px';
	END_FOR
ELSE
	rCutX:=512.0;
	FOR hCutLineCounter := 5 TO 50 DO //dont display lines when the no of pieces is 0
		g_sHMI_VisuCutsArray[hCutLineCounter].visible := FALSE;
		g_sHMI_VisuCutsArray[hCutLineCounter].xPos := '0px';
	END_FOR
END_IF

(* Display horizontal lines, for the vertical pieces *)
(* line 51 - 95 are the lines for horizontal pieces*)
IF (nPiecesVer > 1) AND NOT(sLocalRecipeVar.nProductType = Prod_Slab_Diagonal_1x1) THEN
	//calculate y pos for the lines. height of box is 300 and make visible if used
	nOfHorCuts := nPiecesVer - 1;
	rCutY:=(300.0 / INT_TO_REAL(nPiecesVer));
	FOR vCutLineCounter := 51 TO (51+(nOfHorCuts-1)) DO 
		g_sHMI_VisuCutsArray[vCutLineCounter].yPos := CONCAT(TO_STRING((rCutY * (vCutLineCounter-50))+10),'px');
		g_sHMI_VisuCutsArray[vCutLineCounter].visible := TRUE;
	END_FOR
		//make unused lines invisible
	FOR vCutLineCounter := (51+nOfHorCuts) TO 95 DO 
		g_sHMI_VisuCutsArray[vCutLineCounter].visible := FALSE;
		g_sHMI_VisuCutsArray[vCutLineCounter].yPos := '0px';
	END_FOR
ELSE
	rCutY:= 300.0;
	FOR vCutLineCounter := 51 TO 95 DO //dont display lines when the no of pieces is 0 or diagonals are cut
		g_sHMI_VisuCutsArray[vCutLineCounter].visible := FALSE;
		g_sHMI_VisuCutsArray[vCutLineCounter].yPos := '0px';
	END_FOR
END_IF

(* Display diagonal lines, for triangles *)
(* line 100 - 150 are the lines for diagonal lines*)
IF bTriangles THEN
	rCutAngle := -((ATAN(rCuty/rCutX)) * (180/c_PI));
	nOfDiagCuts := nPiecesVer + (nPiecesHor-1);
	rLenghtCut := SQRT((rCutX * rCutX) + (rCuty * rCuty));
	FOR vCutLineCounter := 1 TO nOfDiagCuts DO 
		g_sHMI_VisuCutsArray[vCutLineCounter+99].visible := TRUE;
		g_sHMI_VisuCutsArray[vCutLineCounter+99].rotation := rCutAngle;
		IF (nPiecesHor >= nPiecesVer) THEN
			IF vCutLineCounter <= (nPiecesVer) THEN
				g_sHMI_VisuCutsArray[vCutLineCounter+99].yPos := CONCAT(TO_STRING((rCutY * (vCutLineCounter))+10),'px');
				g_sHMI_VisuCutsArray[vCutLineCounter+99].xPos := CONCAT(TO_STRING(10), 'px');
				g_sHMI_VisuCutsArray[vCutLineCounter+99].length := CONCAT(TO_STRING(rLenghtCut * vCutLineCounter),'px');
			ELSIF (vCutLineCounter > (nPiecesVer)) AND (vCutLineCounter <= (nPiecesHor)) THEN
				g_sHMI_VisuCutsArray[vCutLineCounter+99].yPos := CONCAT(TO_STRING((300)+10),'px');
				g_sHMI_VisuCutsArray[vCutLineCounter+99].xPos := CONCAT(TO_STRING((rCutX * ((vCutLineCounter - (nPiecesVer)))+10)), 'px');
				g_sHMI_VisuCutsArray[vCutLineCounter+99].length := CONCAT(TO_STRING(rLenghtCut *nPiecesVer),'px');
			ELSE
				g_sHMI_VisuCutsArray[vCutLineCounter+99].visible := TRUE;
				g_sHMI_VisuCutsArray[vCutLineCounter+99].yPos := CONCAT(TO_STRING((300)+10),'px');
				g_sHMI_VisuCutsArray[vCutLineCounter+99].xPos := CONCAT(TO_STRING((rCutX * ((vCutLineCounter - (nPiecesVer)))+10)), 'px');
				g_sHMI_VisuCutsArray[vCutLineCounter+99].length :=  CONCAT(TO_STRING(rLenghtCut * (nPiecesHor-(vCutLineCounter - nPiecesVer))),'px');
			END_IF
		ELSE
			IF vCutLineCounter <= (nPiecesHor) THEN
				g_sHMI_VisuCutsArray[vCutLineCounter+99].yPos := CONCAT(TO_STRING((rCutY * (vCutLineCounter))+10),'px');
				g_sHMI_VisuCutsArray[vCutLineCounter+99].xPos := CONCAT(TO_STRING(10), 'px');
				g_sHMI_VisuCutsArray[vCutLineCounter+99].length := CONCAT(TO_STRING(rLenghtCut * vCutLineCounter),'px');
			ELSIF (vCutLineCounter > (nPiecesHor)) AND (vCutLineCounter <= (nPiecesVer)) THEN
				g_sHMI_VisuCutsArray[vCutLineCounter+99].yPos := CONCAT(TO_STRING((rCutY * (vCutLineCounter))+10),'px');
				g_sHMI_VisuCutsArray[vCutLineCounter+99].xPos := CONCAT(TO_STRING(10), 'px');
				g_sHMI_VisuCutsArray[vCutLineCounter+99].length := CONCAT(TO_STRING(rLenghtCut *nPiecesHor),'px');
			ELSE
				g_sHMI_VisuCutsArray[vCutLineCounter+99].yPos := CONCAT(TO_STRING((300)+10),'px');
				g_sHMI_VisuCutsArray[vCutLineCounter+99].xPos := CONCAT(TO_STRING((rCutX * ((vCutLineCounter - (nPiecesVer)))+10)), 'px');
				g_sHMI_VisuCutsArray[vCutLineCounter+99].length :=  CONCAT(TO_STRING(rLenghtCut * (nPiecesHor-(vCutLineCounter - nPiecesVer))),'px');
			END_IF
		END_IF
	END_FOR
	nDeleteDiagFrom := (100+nOfDiagCuts);
ELSE
	nDeleteDiagFrom := 100;
END_IF

//make all diagonal lines we don't need, invisible.
FOR vCutLineCounter := nDeleteDiagFrom TO 150 DO //dont display lines when the no of pieces is 0
	g_sHMI_VisuCutsArray[vCutLineCounter].visible := FALSE;
	g_sHMI_VisuCutsArray[vCutLineCounter].yPos := '0px';
	g_sHMI_VisuCutsArray[vCutLineCounter].xPos := '0px';
	g_sHMI_VisuCutsArray[vCutLineCounter].length := '0px';
	g_sHMI_VisuCutsArray[vCutLineCounter].rotation := 0.0;
END_FOR

END_PROGRAM
