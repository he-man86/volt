FUNCTION STRCMPW : INT
VAR_INPUT
	PWD1 : POINTER TO WORD;
	PWD2 : POINTER TO WORD;
END_VAR
VAR
	i : DINT;
END_VAR
(* the difference of the first words that differ — negative when PWD1 orders first, 0 when equal *)
IF PWD1 = 0 OR PWD2 = 0 THEN
	RETURN;
END_IF
WHILE PWD1[i] <> 0 AND_THEN PWD1[i] = PWD2[i] DO
	i := i + 1;
END_WHILE
STRCMPW := WORD_TO_INT(PWD1[i]) - WORD_TO_INT(PWD2[i]);
END_FUNCTION