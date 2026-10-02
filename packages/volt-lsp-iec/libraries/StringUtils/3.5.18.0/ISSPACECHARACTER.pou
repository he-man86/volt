FUNCTION ISSPACECHARACTER : BOOL
VAR_INPUT
	WCHARACTER : WORD;
END_VAR
(* a space, one of the control characters TAB, LF, VT, FF, CR, or the no-break space 16#A0 (recorded: lib_stu_chars).
   ponytail: the other Unicode spaces (16#2000.., 16#3000) are unasked — a fixture decides them *)
ISSPACECHARACTER := WCHARACTER = 16#20 OR (WCHARACTER >= 16#09 AND WCHARACTER <= 16#0D) OR WCHARACTER = 16#A0;
END_FUNCTION