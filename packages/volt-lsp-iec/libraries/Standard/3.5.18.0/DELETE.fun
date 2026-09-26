FUNCTION DELETE : STRING(255)
VAR_INPUT
	STR : STRING(255);
	LEN : INT;
	POS : INT;
END_VAR
VAR
	i : DINT;
	k : DINT;
	n : DINT;
	first : DINT;
	start : DINT;
	count : DINT;
END_VAR
(* LEN characters from POS, counting from 1. POSITION 0 IS NOT "DO NOTHING": the range starts at POS - 1, which may
   be negative, and what goes is the part of [POS - 1, POS - 1 + LEN) inside the string. DELETE('abcde', 2, 0) is
   'bcde' (measured str_delete_at_zero, 2026-09-19). *)
DELETE := STR;
IF LEN > 0 THEN
	n := UINT_TO_DINT(LEN_INTERNAL(STR));
	first := INT_TO_DINT(POS) - 1;
	start := MAX(first, 0);
	count := INT_TO_DINT(LEN) + MIN(first, 0);
	IF count > 0 AND start < n THEN
		k := start;
		FOR i := MIN(start + count, n) TO n - 1 DO
			DELETE[k] := STR[i];
			k := k + 1;
		END_FOR
		DELETE[k] := 0;
	END_IF
END_IF
END_FUNCTION