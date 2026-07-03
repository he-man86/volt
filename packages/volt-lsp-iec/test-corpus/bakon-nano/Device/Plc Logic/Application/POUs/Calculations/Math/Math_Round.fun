FUNCTION Math_Round : REAL
VAR_INPUT
	value	: REAL;
	precision : REAL;
END_VAR
VAR
	neg : REAL;
	a : REAL;
	b : INT;
END_VAR

neg := SEL(value < 0,1,-1);
a := value * neg;
b := REAL_TO_INT(a/precision);
Math_Round := INT_TO_REAL(b) * precision * neg;		//A mod precsision
RETURN;



(*

neg := SEL(value < 0,1,-1);


c := a + precision - b;

IF b = 0 THEN
	c := c + precision;
END_IF

Math_RoundUp := c * neg;
RETURN;
*)

END_FUNCTION
