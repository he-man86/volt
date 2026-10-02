FUNCTION LEFT : STRING(255)
VAR_INPUT
	STR : STRING(255);
	SIZE : INT;
END_VAR
VAR
	i : DINT;
	n : DINT;
END_VAR
(* SIZE clamps to the string: LEFT('abc', 5) is 'abc', LEFT('abc', -1) is '' *)
n := LIMIT(0, SIZE, UINT_TO_DINT(LEN_INTERNAL(STR)));
FOR i := 0 TO n - 1 DO
	LEFT[i] := STR[i];
END_FOR
LEFT[n] := 0;
END_FUNCTION