FUNCTION LEN_INTERNAL : UINT
VAR_IN_OUT
	STR : STRING(255);
END_VAR
(* the characters before the terminator: the one loop every other string function counts with *)
WHILE STR[LEN_INTERNAL] <> 0 DO
	LEN_INTERNAL := LEN_INTERNAL + 1;
END_WHILE
END_FUNCTION