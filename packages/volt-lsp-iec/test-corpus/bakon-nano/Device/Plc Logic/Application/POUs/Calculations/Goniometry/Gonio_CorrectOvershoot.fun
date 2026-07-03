FUNCTION Gonio_CorrectOvershoot : BOOL
//Returns wheter the cut is possible.
VAR_INPUT
	settings : Gonio_Settings;			
END_VAR

VAR_IN_OUT
	xya		: XYA_Target;				//The target to correct
END_VAR

VAR
	pI				: Gonio_Point;
	pNW				: Gonio_Point;
	pNE				: Gonio_Point;
	pSE				: Gonio_Point;
	pSW				: Gonio_Point;
	keepOutTop 		: Gonio_Line;	
	keepOutLeft     : Gonio_Line;	
	keepOutRight    : Gonio_Line;	
	keepOutBottom   : Gonio_Line;	
	cut				: Gonio_Line;
	impossibleCut	: BOOL;
	dY				: REAL;
	dX				: REAL;
	tangent			: REAL;
	marginYMax		: REAL;			
	marginYMin		: real;
	marginXMax		: real;
	marginXMin		: REAL;
	l1				: REAL;
	l2				: REAL;
	dTop			: REAL;
	dBottom			: REAL;
	dLeft			: REAL;
	dRight			: REAL;
END_VAR

//Check if the left and right margins make any sense
IF settings.marginXMax <= settings.marginXMin THEN
	xya.bCutPosPossible := FALSE;
	Gonio_CorrectOvershoot := FALSE;
	g_sMACH.ERR.bMarginsInOvershootCorrectionInvalid := TRUE;
	RETURN;
END_IF

//Check if the top and bottom margins make any sense
IF settings.marginYMax <= settings.marginYMin THEN
	xya.bCutPosPossible := FALSE;
	Gonio_CorrectOvershoot := FALSE;
	g_sMACH.ERR.bMarginsInOvershootCorrectionInvalid := TRUE;
	RETURN;
END_IF

//Make sure the knife axis is within the line representing the knife
IF settings.knifeLength <= settings.knifeAxis THEN
	xya.bCutPosPossible := FALSE;
	Gonio_CorrectOvershoot := FALSE;
	g_sMACH.ERR.bKnifeSettingsIncorrect := TRUE;
	RETURN;
END_IF

IF xya.K_Target <> 0 THEN
	g_sMACH.ERR.bXYA_K_WasNotZero := TRUE;
END_IF


impossibleCut := false;

//Calculate the margin adjustment
//The adjustment is nessesary for slabs because the knife doesnt need to stay witin the margins, but the axis does.

l1 := settings.knifeAxis;			//Representing the distance from the center to the right of the knife (knife at 0 deg)
l2 := settings.knifeLength - l1;	//Representing the distance from the center to the left of the knife (knife at 0 deg)

//When rotating the right side of the knife moves towards the top of the table therefore:
dTop	:= -l1 * ABS(SIN(xya.A_Target * C_rPi / 180));
dBottom	:= l2 * ABS(SIN(xya.A_Target * C_rPi / 180));
dRight	:= -l1 * ABS(COS(xya.A_Target * C_rPi / 180));
dLeft	:= l2 * ABS(COS(xya.A_Target * C_rPi / 180));

//Calculate the new margins.
marginYMax	:= settings.marginYMax + SEL(settings.adjustYMax, 0, dBottom);
marginYMin	:= settings.marginYMin + SEL(settings.adjustYMin, 0, dTop);
marginXMax	:= settings.marginXMax + SEL(settings.adjustXMax, 0, dLeft);
marginXMin	:= settings.marginXMin + SEL(settings.adjustXMin, 0, dRight);

//Check if corrected margins are still withing table limits
(*
IF marginYMax > SEL(gMachConfig.bXL,C_rMaxOvershootY,C_rMaxOvershootY_XL) THEN
	marginYMax := SEL(gMachConfig.bXL,C_rMaxOvershootY,C_rMaxOvershootY_XL);
END_IF
IF marginXMax > SEL(gMachConfig.bXL,C_rMaxOvershootX,C_rMaxOvershootX_XL) THEN
	marginXMax := SEL(gMachConfig.bXL,C_rMaxOvershootX,C_rMaxOvershootX_XL);
END_IF
IF marginYMin < C_rMinOvershootY THEN
	marginYMin := C_rMinOvershootY;
END_IF
IF marginXMin < C_rMinOvershootX THEN
	marginXMin := C_rMinOvershootX;
END_IF
*)


// Create the 4 corners of the margin rectangle.
pNW.X 			:= marginXMin;//+1;
pNE.X 			:= marginXMax;//-1;
pSE.X 			:= marginXMax;//-1;
pSW.X 			:= marginXMin;//+1;
pNW.Y 			:= marginYMax;//-1;
pNE.Y 			:= marginYMax;//-1;
pSE.Y 			:= marginYMin;//+1;
pSW.Y 			:= marginYMin;//+1;

// Create 4 lines representing the margin rectangle.
keepOutTop.p1	:= pNW;
keepOutLeft.p1  := pNE;
keepOutRight.p1 := pNW;
keepOutBottom.p1:= pSW;
keepOutTop.p2	:= pNE; 
keepOutLeft.p2  := pSE; 
keepOutRight.p2 := pSW; 
keepOutBottom.p2:= pSE; 


//------------------------ Start of algorithm ------------------------\\

//Correct bottom
//Convert the XYA target to a line representing the cut
cut := Gonio_XYA_TO_LINE(settings:= settings, xya := xya);
//Check if the cut collides with the bottom margin
IF Gonio_LineCollision(LineA := cut, LineB := keepOutBottom) THEN
	//If so, calculate the point of intersection
	IF Gonio_LineIntersection(LineA := cut, LineB := keepOutBottom, intersection := pI) THEN
		//Calculate how much the cut needs to be moved in the Y direction in order not to collide.
		dY := pI.Y - MIN(cut.p1.Y, cut.p2.Y);
		dY := Math_Round(value := dY, precision := settings.Precision);
		//Calculate how much the cut needs to be moved in the X direction in order not to collide.
		tangent := TAN(xya.A_Target * C_rPi / 180);
		dX := SEL(tangent = 0, dY / tangent, 0);
		dX := Math_Round(value := dX, precision := settings.Precision);
		
		//Add them to the XYA target.
		xya.Y_Target := xya.Y_Target + dY;//Ceiling(dY);
		xya.X_Target := xya.X_Target + dX;//Ceiling(dX);
	ELSE
		//Cut is parralel to the line, no fix
		(*impossibleCut := TRUE;
		Gonio_CorrectOvershoot := FALSE;
		g_sMACH.ERR.bIntersectionNotFound:=TRUE;
		RETURN;*)
	END_IF
END_IF

//correct top
cut := Gonio_XYA_TO_LINE(settings:= settings, xya := xya);
IF Gonio_LineCollision(LineA := cut, LineB := keepOutTop) THEN
	IF Gonio_LineIntersection(LineA := cut, LineB := keepOutTop, intersection := pI) THEN
		dY := pI.Y - MAX(cut.p1.Y, cut.p2.Y);
		dY := Math_Round(value := dY, precision := settings.Precision);
		tangent := TAN(xya.A_Target * C_rPi / 180);
		dX := SEL(tangent = 0, dY / tangent, 0);
		dX := Math_Round(value := dX, precision := settings.Precision);
		//Add them to the XYA target.
		xya.Y_Target := xya.Y_Target + dY;//Ceiling(dY);
		xya.X_Target := xya.X_Target + dX;//Ceiling(dX);
	ELSE
		//Cut is parralel to the line, no fix
		(*impossibleCut := TRUE;
		Gonio_CorrectOvershoot := FALSE;
		g_sMACH.ERR.bIntersectionNotFound:=TRUE;
		RETURN;*)
	END_IF
END_IF

//correct right
cut := Gonio_XYA_TO_LINE(settings:= settings, xya := xya);
IF Gonio_LineCollision(LineA := cut, LineB := keepOutRight) THEN
	IF Gonio_LineIntersection(LineA := cut, LineB := keepOutRight, intersection := pI) THEN
		dX := pI.X - MIN(cut.p1.X, cut.p2.X);
		dX := Math_Round(value := dX, precision := settings.Precision);
		dY := TAN(xya.A_Target * C_rPi / 180) * dX;
		dY := Math_Round(value :=	dY,precision := settings.precision);
		xya.X_Target := xya.X_Target + dX;
		xya.Y_Target := xya.Y_Target + dY;
	ELSE
		//Cut is parralel to the line, no fix
		(*impossibleCut := TRUE;
		Gonio_CorrectOvershoot := FALSE;
		g_sMACH.ERR.bIntersectionNotFound:=TRUE;
		RETURN;*)
	END_IF
END_IF

//correct left
cut := Gonio_XYA_TO_LINE(settings:= settings, xya := xya);
IF Gonio_LineCollision(LineA := cut, LineB := keepOutLeft) THEN
	IF Gonio_LineIntersection(LineA := cut, LineB := keepOutLeft, intersection := pI) THEN
		dX := pI.X - MAX(cut.p1.X, cut.p2.X);
		dX := Math_Round(value := dX, precision := settings.Precision);
		dY := TAN(xya.A_Target * C_rPi / 180) * dX;
		dY := Math_Round(value :=	dY,precision := settings.precision);
		xya.X_Target := xya.X_Target + dX;
		xya.Y_Target := xya.Y_Target + dY;
	ELSE
		//Cut is parralel to the line, no fix
		(*impossibleCut := TRUE;
		Gonio_CorrectOvershoot := FALSE;
		g_sMACH.ERR.bIntersectionNotFound:=TRUE;
		RETURN;*)
	END_IF
END_IF


//------------------------  End of algorithm  ------------------------\\


//Make sure the xya target is still within the margins
IF 	   xya.X_Target > marginXMax
	OR xya.X_Target < marginXMin
	OR xya.Y_Target < marginYMin
	OR xya.Y_Target > marginYMax 	
THEN
	impossibleCut := TRUE;
	g_sMACH.ERR.bOvershootCorrectionImpossible := TRUE;
END_IF

//Make sure the cut has no collisions left. 
//Explisitly chosen to use a different algoritm than the one used in the "Gonio_LineCollision" check.
cut := Gonio_XYA_TO_LINE(settings:= settings, xya := xya);
IF     cut.P1.X > marginXMax +1
	OR cut.P1.X < marginXMin -1
	OR cut.P2.X > marginXMax +1
	OR cut.P2.X < marginXMin -1
	OR cut.P1.Y > marginYMax +1
	OR cut.P1.Y < marginYMin -1
	OR cut.P2.Y > marginYMax +1
	OR cut.P2.Y < marginYMin -1
THEN
	impossibleCut := TRUE;
	g_sMACH.ERR.bOvershootCorrectionImpossible := TRUE;
END_IF


xya.bCutPosPossible := NOT impossibleCut;
Gonio_CorrectOvershoot := NOT impossibleCut;


RETURN;

END_FUNCTION
