FUNCTION STRCMPW : INT
VAR_INPUT
	PWD1 : POINTER TO WORD;
	PWD2 : POINTER TO WORD;
END_VAR
VAR
	i : DINT;
END_VAR
(* how the first words that differ order: -1 when PWD1's is lower, 1 when higher, 0 when the
   strings are equal — the sign only (recorded: lib_stu_compare) *)
IF PWD1 = 0 OR PWD2 = 0 THEN
	RETURN;
END_IF
WHILE PWD1[i] <> 0 AND_THEN PWD1[i] = PWD2[i] DO
	i := i + 1;
END_WHILE
IF PWD1[i] < PWD2[i] THEN
	STRCMPW := -1;
ELSIF PWD1[i] > PWD2[i] THEN
	STRCMPW := 1;
END_IF
END_FUNCTION