FUNCTION STRCMPA : INT
VAR_INPUT
	PBY1 : POINTER TO BYTE;
	PBY2 : POINTER TO BYTE;
END_VAR
VAR
	i : DINT;
END_VAR
(* how the first bytes that differ order: -1 when PBY1's is lower, 1 when higher, 0 when the
   strings are equal — the sign only (recorded: lib_stu_compare) *)
IF PBY1 = 0 OR PBY2 = 0 THEN
	RETURN;
END_IF
WHILE PBY1[i] <> 0 AND_THEN PBY1[i] = PBY2[i] DO
	i := i + 1;
END_WHILE
IF PBY1[i] < PBY2[i] THEN
	STRCMPA := -1;
ELSIF PBY1[i] > PBY2[i] THEN
	STRCMPA := 1;
END_IF
END_FUNCTION