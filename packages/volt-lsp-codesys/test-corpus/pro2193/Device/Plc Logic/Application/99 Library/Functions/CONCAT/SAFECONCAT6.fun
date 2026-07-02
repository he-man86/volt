// Safely concatenates 6 strings
FUNCTION SAFECONCAT6 : BOOL
VAR_INPUT
	s1			: Stu.CharBufferPtr;	// Result string goes here
	s2			: STRING(80);			// First string to add
	s3			: STRING(80);			// Second string to add
	s4			: STRING(80);			// Third string to add
	s5			: STRING(80);			// Fourth string to add
	s6			: STRING(80);			// Fifth string to add
	bufferSize	: INT;					// bufferSize of s1
END_VAR

IF								StrConcatA(pstFrom := ADR(s2), pstTo := s1, iBufferSize := bufferSize) THEN
	IF							StrConcatA(pstFrom := ADR(s3), pstTo := s1, iBufferSize := bufferSize) THEN
		IF						StrConcatA(pstFrom := ADR(s4), pstTo := s1, iBufferSize := bufferSize) THEN
			IF					StrConcatA(pstFrom := ADR(s5), pstTo := s1, iBufferSize := bufferSize) THEN
				SAFECONCAT6 :=	StrConcatA(pstFrom := ADR(s6), pstTo := s1, iBufferSize := bufferSize);
			END_IF
		END_IF
	END_IF
END_IF

END_FUNCTION
