FUNCTION FIND : INT
VAR_INPUT
	STR1 : STRING(255);
	STR2 : STRING(255);
END_VAR
VAR
	i : DINT;
	j : DINT;
	n1 : DINT;
	n2 : DINT;
END_VAR
(* where STR2 first starts in STR1, counting from 1; 0 when it does not occur, and FIND of '' is 0 *)
n1 := UINT_TO_DINT(LEN_INTERNAL(STR1));
n2 := UINT_TO_DINT(LEN_INTERNAL(STR2));
IF n2 > 0 THEN
	FOR i := 0 TO n1 - n2 DO
		j := 0;
		WHILE j < n2 AND STR1[i + j] = STR2[j] DO
			j := j + 1;
		END_WHILE
		IF j = n2 THEN
			FIND := DINT_TO_INT(i + 1);
			RETURN;
		END_IF
	END_FOR
END_IF
END_FUNCTION