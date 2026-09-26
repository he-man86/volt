FUNCTION RIGHT : STRING(255)
VAR_INPUT
	STR : STRING(255);
	SIZE : INT;
END_VAR
VAR
	i : DINT;
	n : DINT;
	start : DINT;
END_VAR
n := UINT_TO_DINT(LEN_INTERNAL(STR));
start := n - LIMIT(0, SIZE, n);
FOR i := start TO n - 1 DO
	RIGHT[i - start] := STR[i];
END_FOR
RIGHT[n - start] := 0;
END_FUNCTION