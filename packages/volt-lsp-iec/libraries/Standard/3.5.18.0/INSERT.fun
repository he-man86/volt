FUNCTION INSERT : STRING(255)
VAR_INPUT
	STR1 : STRING(255);
	STR2 : STRING(255);
	POS : INT;
END_VAR
VAR
	i : DINT;
	k : DINT;
	n : DINT;
END_VAR
(* STR2 after the first POS characters of STR1. POS 0 prepends; a POS below 0 or past the end leaves STR1 as it was:
   INSERT('abc', 'XY', -1) is 'abc'. The result is cut at 255. *)
n := UINT_TO_DINT(LEN_INTERNAL(STR1));
IF POS < 0 OR POS > n THEN
	INSERT := STR1;
ELSE
	FOR i := 0 TO INT_TO_DINT(POS) - 1 DO
		INSERT[k] := STR1[i];
		k := k + 1;
	END_FOR
	i := 0;
	WHILE k < 255 AND STR2[i] <> 0 DO
		INSERT[k] := STR2[i];
		k := k + 1;
		i := i + 1;
	END_WHILE
	i := POS;
	WHILE k < 255 AND i < n DO
		INSERT[k] := STR1[i];
		k := k + 1;
		i := i + 1;
	END_WHILE
	INSERT[k] := 0;
END_IF
END_FUNCTION