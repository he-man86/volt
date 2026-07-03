FUNCTION Gonio_LineCollision : BOOL
//Returns whether the lines collide
VAR_INPUT
	LineA	: Gonio_Line;
	LineB	: Gonio_Line;
END_VAR
VAR
	denominator	: REAL;
    numerator1 : REAL;
    numerator2 : REAL;
	rr: REAL;
	ss: REAL;
END_VAR

denominator := ((LineA.P2.X - LineA.P1.X) * (LineB.P2.Y - LineB.P1.Y)) - ((LineA.P2.Y - LineA.P1.Y) * (LineB.P2.X - LineB.P1.X));
numerator1 := ((LineA.P1.Y - LineB.P1.Y) * (LineB.P2.X - LineB.P1.X)) - ((LineA.P1.X - LineB.P1.X) * (LineB.P2.Y - LineB.P1.Y));
numerator2 := ((LineA.P1.Y - LineB.P1.Y) * (LineA.P2.X - LineA.P1.X)) - ((LineA.P1.X - LineB.P1.X) * (LineA.P2.Y - LineA.P1.Y));

// Detect coincident lines
IF denominator = 0 THEN
	Gonio_LineCollision := numerator1 = 0 AND numerator2 = 0;
	RETURN;
END_IF


rr := numerator1 / denominator;
ss := numerator2 / denominator;
Gonio_LineCollision :=  (rr >= 0 AND rr <= 1) AND (ss >= 0 AND ss <= 1);

RETURN;

END_FUNCTION
