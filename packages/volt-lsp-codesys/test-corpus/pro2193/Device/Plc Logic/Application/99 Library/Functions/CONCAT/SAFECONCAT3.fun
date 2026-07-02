// Safely concatenates 3 strings
FUNCTION SAFECONCAT3 : BOOL
VAR_INPUT
	s1			: Stu.CharBufferPtr;	// Result string goes here
	s2			: STRING(80);			// First string to add
	s3			: STRING(80);			// Second string to add
	bufferSize	: INT;					// bufferSize of s1
END_VAR

IF					StrConcatA(pstFrom := ADR(s2), pstTo := s1, iBufferSize := bufferSize) THEN
	SAFECONCAT3 :=	StrConcatA(pstFrom := ADR(s3), pstTo := s1, iBufferSize := bufferSize);
END_IF

END_FUNCTION
