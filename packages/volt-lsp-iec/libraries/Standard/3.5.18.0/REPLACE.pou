FUNCTION REPLACE : STRING(255)
VAR_INPUT
	STR1 : STRING(255);
	STR2 : STRING(255);
	L : INT;
	P : INT;
END_VAR
(* a DELETE, then an INSERT at P - 1 raised to 0. Every measured REPLACE agrees: REPLACE('abc', 'XY', 1, 0) is
   'XYabc' and REPLACE('abc', 'XY', 2, 5) is 'abc'. *)
REPLACE := INSERT(DELETE(STR1, L, P), STR2, MAX(P - 1, 0));
END_FUNCTION