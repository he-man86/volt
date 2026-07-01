// Safely concatenates 10 strings
FUNCTION SAFECONCAT10 : BOOL
VAR_INPUT
	s1			: Stu.CharBufferPtr;	// Result string goes here
	s2			: STRING(80);			// First string to add
	s3			: STRING(80);			// Second string to add
	s4			: STRING(80);			// Third string to add
	s5			: STRING(80);			// Fourth string to add
	s6			: STRING(80);			// Fifth string to add
	s7			: STRING(80);			// xth string to add
	s8			: STRING(80);			// xth string to add
	s9			: STRING(80);			// xth string to add
	s10			: STRING(80);			// xth string to add
	bufferSize	: INT;					// bufferSize of s1
END_VAR

IF												StrConcatA(pstFrom := ADR(s2), pstTo := s1, iBufferSize := bufferSize) THEN
	IF											StrConcatA(pstFrom := ADR(s3), pstTo := s1, iBufferSize := bufferSize) THEN
		IF										StrConcatA(pstFrom := ADR(s4), pstTo := s1, iBufferSize := bufferSize) THEN
			IF									StrConcatA(pstFrom := ADR(s5), pstTo := s1, iBufferSize := bufferSize) THEN
				IF								StrConcatA(pstFrom := ADR(s6), pstTo := s1, iBufferSize := bufferSize) THEN
					IF							StrConcatA(pstFrom := ADR(s7), pstTo := s1, iBufferSize := bufferSize) THEN
						IF						StrConcatA(pstFrom := ADR(s8), pstTo := s1, iBufferSize := bufferSize) THEN
							IF					StrConcatA(pstFrom := ADR(s9), pstTo := s1, iBufferSize := bufferSize) THEN
								SAFECONCAT10 :=	StrConcatA(pstFrom := ADR(s10), pstTo := s1, iBufferSize := bufferSize);
							END_IF
						END_IF
					END_IF
				END_IF
			END_IF
		END_IF
	END_IF
END_IF

END_FUNCTION
