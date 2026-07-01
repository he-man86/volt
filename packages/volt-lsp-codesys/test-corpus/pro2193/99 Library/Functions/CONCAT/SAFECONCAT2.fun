// Safely concatenates 2 strings
FUNCTION SAFECONCAT2 : BOOL
VAR_INPUT
	s1			: Stu.CharBufferPtr;	// Result string goes here
	s2			: STRING(80);			// String to add
	bufferSize	: INT;					// bufferSize of s1
END_VAR

SAFECONCAT2 := StrConcatA(pstFrom := ADR(s2), pstTo := s1, iBufferSize := bufferSize);

END_FUNCTION
