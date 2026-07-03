FUNCTION Gonio_LineIntersection : BOOL
//Calculates the point of intersection even if there is no collision between the lines.
//Returns false if the lines are parallel to eachother.
VAR_INPUT
	LineA	: Gonio_Line;
	LineB	: Gonio_Line;
END_VAR
VAR_IN_OUT
	intersection 	: Gonio_Point;
END_VAR
VAR
	denominator : REAL;
	numeratorX	: REAL;	
	numeratorY	: REAL;	
END_VAR

denominator := (LineA.P1.X - LineA.P2.X) * (LineB.P1.Y - LineB.P2.Y) - (LineA.P1.Y - LineA.P2.Y) * (LineB.P1.X - LineB.P2.X);

IF denominator = 0 THEN
	Gonio_LineIntersection := FALSE;
	RETURN;
END_IF

numeratorX := ((LineA.P1.X * LineA.P2.Y - LineA.P1.Y * LineA.P2.X) * (LineB.P1.X - LineB.P2.X) - (LineA.P1.X - LineA.P2.X) * (LineB.P1.X * LineB.P2.Y - LineB.P1.Y * LineB.P2.X));
numeratorY := ((LineA.P1.X * LineA.P2.Y - LineA.P1.Y * LineA.P2.X) * (LineB.P1.Y - LineB.P2.Y) - (LineA.P1.Y - LineA.P2.Y) * (LineB.P1.X * LineB.P2.Y - LineB.P1.Y * LineB.P2.X));

intersection.X := numeratorX / denominator;
intersection.Y := numeratorY / denominator;

Gonio_LineIntersection:=TRUE;
RETURN;

END_FUNCTION
