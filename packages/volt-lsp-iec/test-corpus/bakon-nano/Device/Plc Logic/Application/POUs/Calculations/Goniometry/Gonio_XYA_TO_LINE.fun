FUNCTION Gonio_XYA_TO_LINE : Gonio_Line
VAR_INPUT
END_VAR

VAR_IN_OUT
	settings 	: Gonio_Settings;
	xya			: XYA_Target;
END_VAR


VAR
	line : Gonio_Line;
	l1 	: REAL;
	l2 	: REAL;
	dx1 : REAL;
	dx2 : REAL;	
	dy1 : REAL;
	dy2 : REAL;	
	
END_VAR

l1 := settings.knifeAxis;
l2 := settings.knifeLength - l1;

dX1 := l1 * COS((xya.A_Target + 180) * C_rPi / 180);
dY1 := l1 * SIN((xya.A_Target + 180) * C_rPi / 180);
dX2 := l2 * COS((xya.A_Target + 0) * C_rPi / 180);
dY2 := l2 * SIN((xya.A_Target + 0) * C_rPi / 180);

line.p1.X := xya.X_Target + Math_Round(dx1,Settings.precision);
line.p1.Y := xya.Y_Target + Math_Round(dy1,Settings.precision);
line.p2.X := xya.X_Target + Math_Round(dx2,Settings.precision);
line.p2.Y := xya.Y_Target + Math_Round(dy2,Settings.precision);

Gonio_XYA_TO_LINE:=line;
RETURN;

END_FUNCTION
