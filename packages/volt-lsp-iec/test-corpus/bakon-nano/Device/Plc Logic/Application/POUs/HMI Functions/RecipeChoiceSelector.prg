PROGRAM RecipeChoiceSelector
VAR
	nOldClmn1Choice : INT;
	nOldClmn2Choice : INT;
	bChoiceSetToZero : BOOL;
END_VAR

/////////// First Column ////////////////////////////////////////////////////////////////////////////////
(*
Choices: 
SlabRound = 1
SlabRound with fingers = 2
Tray = 3
*)

IF g_HMI_MachCommand.CMD.bNewRecipe AND NOT bChoiceSetToZero THEN
	g_sHMI_Recipe_Clmn1_Choice := 0;
	g_sHMI_Recipe_Clmn2_Choice := 0;
	g_sHMI_Recipe_Clmn2_Choice := 0;
	bChoiceSetToZero := TRUE;
END_IF
IF NOT(g_HMI_MachCommand.CMD.bNewRecipe) THEN
	bChoiceSetToZero := FALSE;
END_IF
g_sHMI_RcpClmns.clmn1.SlabRound := gProductOption.Prod_RoundQuatro
								OR gProductOption.Prod_SlabDiagonal
								OR gProductOption.Prod_SlabSquare
								OR gProductOption.Prod_SlabDouble
								OR gProductOption.Prod_SlabTriangle;
								
g_sHMI_RcpClmns.clmn1.SlabRoundFngrs := gProductOption.Prod_Round 
									OR gProductOption.Prod_SlabSquareClamp;
									
g_sHMI_RcpClmns.clmn1.Tray := gProductOption.Prod_TraySquareDouble
								OR gProductOption.Prod_TraySquareLarge
								OR gProductOption.Prod_TraySquareSmall
								OR gProductOption.Prod_TraySquareTriple;
								
(*Reset choice for clmn 2 and 3 when 1 is changed *)
IF nOldClmn1Choice <> g_sHMI_Recipe_Clmn1_Choice THEN
	g_sHMI_Recipe_Clmn2_Choice := 0;
	g_sHMI_Recipe_Clmn3_Choice := 0;
	nOldClmn1Choice := g_sHMI_Recipe_Clmn1_Choice;
END_IF
								
//////////////////////////////////////////////////////////////////////////////////////////////////////////

/////////// Second Column ////////////////////////////////////////////////////////////////////////////////
(*
Choises:
Slab= 1
Slab with Fingers = 2
Round = 3
Round with fingers = 4
Tray Small = 5
Tray Large = 6
Tray double = 7
Tray Quadruple = 8
*)
g_sHMI_RcpClmns.clmn2.Slab := (gProductOption.Prod_SlabDiagonal
								OR gProductOption.Prod_SlabSquare
								OR gProductOption.Prod_SlabDouble
								OR gProductOption.Prod_SlabTriangle)
								AND (g_sHMI_Recipe_Clmn1_Choice = 1);
								
g_sHMI_RcpClmns.clmn2.SlabFingers := gProductOption.Prod_SlabSquareClamp AND (g_sHMI_Recipe_Clmn1_Choice = 2);
								
g_sHMI_RcpClmns.clmn2.Round := gProductOption.Prod_RoundQuatro AND (g_sHMI_Recipe_Clmn1_Choice = 1);

g_sHMI_RcpClmns.clmn2.RoundFingers := gProductOption.Prod_Round AND (g_sHMI_Recipe_Clmn1_Choice = 2 );

g_sHMI_RcpClmns.clmn2.TraySmall := gProductOption.Prod_TraySquareSmall AND (g_sHMI_Recipe_Clmn1_Choice = 3 );

g_sHMI_RcpClmns.clmn2.TrayLarge := gProductOption.Prod_TraySquareLarge AND (g_sHMI_Recipe_Clmn1_Choice = 3 );

g_sHMI_RcpClmns.clmn2.TrayQuadruple := gProductOption.Prod_TraySquareTriple AND (g_sHMI_Recipe_Clmn1_Choice = 3 );
									
g_sHMI_RcpClmns.clmn2.TrayDouble := gProductOption.Prod_TraySquareDouble AND (g_sHMI_Recipe_Clmn1_Choice = 3 );;

(*Reset choice for clmn 3 when 2 is changed *)
IF nOldClmn2Choice <> g_sHMI_Recipe_Clmn2_Choice THEN
	g_sHMI_Recipe_Clmn3_Choice := 0;
	nOldClmn2Choice := g_sHMI_Recipe_Clmn2_Choice;
END_IF								
//////////////////////////////////////////////////////////////////////////////////////////////////////////

/////////// Third Column ////////////////////////////////////////////////////////////////////////////////
(*
Choices: 
Square = 1
Round = 2
Diagonal = 3
*)
g_sHMI_RcpClmns.clmn3.Square := (gProductOption.Prod_SlabSquare
								OR gProductOption.Prod_TraySquareDouble
								OR gProductOption.Prod_TraySquareLarge
								OR gProductOption.Prod_TraySquareSmall
								OR gProductOption.Prod_TraySquareTriple
								OR gProductOption.Prod_SlabSquareClamp)
								AND (g_sHMI_Recipe_Clmn2_Choice <> 3)
								AND (g_sHMI_Recipe_Clmn2_Choice <> 4)
								AND (g_sHMI_Recipe_Clmn2_Choice <> 0);
								
g_sHMI_RcpClmns.clmn3.Triangle := (gProductOption.Prod_SlabSquare
								OR gProductOption.Prod_TraySquareLarge
								OR gProductOption.Prod_SlabSquareClamp)
								AND (g_sHMI_Recipe_Clmn2_Choice <> 2)
								AND (g_sHMI_Recipe_Clmn2_Choice <> 3)
								AND (g_sHMI_Recipe_Clmn2_Choice <> 4)
								AND (g_sHMI_Recipe_Clmn2_Choice <> 0);
									
g_sHMI_RcpClmns.clmn3.Diagonal := (gProductOption.Prod_SlabSquare
								OR gProductOption.Prod_SlabSquareClamp)
								AND (g_sHMI_Recipe_Clmn2_Choice <> 2)
								AND (g_sHMI_Recipe_Clmn2_Choice <> 3)
								AND (g_sHMI_Recipe_Clmn2_Choice <> 4)
								AND (g_sHMI_Recipe_Clmn2_Choice <> 0);
								
								
//////////////////////////////////////////////////////////////////////////////////////////////////////////

//////////select correct product in recipe////////////////////////////////////////////////////////////////
IF (g_sHMI_Recipe_Clmn1_Choice = 1) AND (g_sHMI_Recipe_Clmn2_Choice = 1) AND (g_sHMI_Recipe_Clmn3_Choice = 1) THEN
	g_HMI_RCP_Parameters_Visu.nProductType := Prod_Slab_Rectangle_1x1;
ELSIF (g_sHMI_Recipe_Clmn1_Choice = 1) AND (g_sHMI_Recipe_Clmn2_Choice = 1) AND (g_sHMI_Recipe_Clmn3_Choice = 2) THEN
	g_HMI_RCP_Parameters_Visu.nProductType := Prod_Slab_Triangle_1x1;
ELSIF (g_sHMI_Recipe_Clmn1_Choice = 1) AND (g_sHMI_Recipe_Clmn2_Choice = 1) AND (g_sHMI_Recipe_Clmn3_Choice = 3) THEN
	g_HMI_RCP_Parameters_Visu.nProductType := Prod_Slab_Diagonal_1x1;
ELSIF (g_sHMI_Recipe_Clmn1_Choice = 2) AND (g_sHMI_Recipe_Clmn2_Choice = 2) AND (g_sHMI_Recipe_Clmn3_Choice = 1) THEN
	g_HMI_RCP_Parameters_Visu.nProductType := Prod_Slab_Rectangle_1x1_Clamp;
ELSIF (g_sHMI_Recipe_Clmn1_Choice = 2) AND (g_sHMI_Recipe_Clmn2_Choice = 3) THEN
	g_HMI_RCP_Parameters_Visu.nProductType := Prod_Round_POC_2x1;
ELSIF (g_sHMI_Recipe_Clmn1_Choice = 2) AND (g_sHMI_Recipe_Clmn2_Choice = 4) THEN
	g_HMI_RCP_Parameters_Visu.nProductType := Prod_Round_POC_2x1;
ELSIF (g_sHMI_Recipe_Clmn1_Choice = 3) AND (g_sHMI_Recipe_Clmn2_Choice = 5) AND (g_sHMI_Recipe_Clmn3_Choice = 1)THEN
	g_HMI_RCP_Parameters_Visu.nProductType := Prod_Tray_Rectangle_1x2;
ELSIF (g_sHMI_Recipe_Clmn1_Choice = 3) AND (g_sHMI_Recipe_Clmn2_Choice = 6) AND (g_sHMI_Recipe_Clmn3_Choice = 1)THEN
	g_HMI_RCP_Parameters_Visu.nProductType := Prod_Tray_Rectangle_1x1;
	g_HMI_RCP_Parameters_Visu.bTrianglesInTray := FALSE;
ELSIF (g_sHMI_Recipe_Clmn1_Choice = 3) AND (g_sHMI_Recipe_Clmn2_Choice = 6) AND (g_sHMI_Recipe_Clmn3_Choice = 2)THEN
	g_HMI_RCP_Parameters_Visu.nProductType := Prod_Tray_Rectangle_1x1;
	g_HMI_RCP_Parameters_Visu.bTrianglesInTray := TRUE;
ELSIF (g_sHMI_Recipe_Clmn1_Choice = 3) AND (g_sHMI_Recipe_Clmn2_Choice = 7) THEN
	g_HMI_RCP_Parameters_Visu.nProductType := Prod_Tray_Rectangle_2x1;
ELSIF (g_sHMI_Recipe_Clmn1_Choice = 3) AND (g_sHMI_Recipe_Clmn2_Choice = 7) THEN
	g_HMI_RCP_Parameters_Visu.nProductType := Prod_Tray_Rectangle_1x4;
END_IF
//////////////////////////////////////////////////////////////////////////////////////////////////////////

END_PROGRAM
