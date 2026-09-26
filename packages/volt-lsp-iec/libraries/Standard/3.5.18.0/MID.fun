FUNCTION MID : STRING(255)
VAR_INPUT
	STR : STRING(255);
	LEN : INT;
	POS : INT;
END_VAR
VAR
	i : DINT;
	n : DINT;
	first : DINT;
	last : DINT;
END_VAR
(* POS counts from 1; a POS below 1 or a LEN at or below 0 selects nothing, and the span stops at the end *)
IF POS >= 1 AND LEN > 0 THEN
	n := UINT_TO_DINT(LEN_INTERNAL(STR));
	first := INT_TO_DINT(POS) - 1;
	last := first + INT_TO_DINT(LEN);
	i := first;
	WHILE i < n AND i < last DO
		MID[i - first] := STR[i];
		i := i + 1;
	END_WHILE
	MID[i - first] := 0;
END_IF
END_FUNCTION