// Helper functions to set or reset bits in integers
{attribute 'no_explicit_call' := 'Static helper class to do various operations on bits in integers'}
{attribute 'hide_all_locals'}
PROGRAM BitLogic
VAR
	uInput		: PointerSizesUnion;
END_VAR

END_PROGRAM

// Population count: Count the number of bits that are 1 in a byte
METHOD PUBLIC CountByte : USINT
VAR_INPUT
	in	: BYTE;			// Count number of 1's
END_VAR

// This method uses Brian Kernighan's algorithm. Google it for more info.
WHILE in <> 0 DO
	in			:= in AND (in - 1);		// Subtracting 1 from a number flips all the bits after the rightmost set bit, including the rightmost set bit itself
	CountByte	:= CountByte + 1;
END_WHILE
END_METHOD

// Population count: Count the number of bits that are 1 in a dword
METHOD PUBLIC CountDWord : USINT
VAR_INPUT
	in	: DWORD;		// Count number of 1's
END_VAR

// This method uses Brian Kernighan's algorithm. Google it for more info.
WHILE in <> 0 DO
	in			:= in AND (in - 1);
	CountDWord	:= CountDWord + 1;
END_WHILE
END_METHOD

// Population count: Count the number of bits that are 1 in a word
METHOD PUBLIC CountWord : USINT
VAR_INPUT
	in	: WORD;			// Count number of 1's
END_VAR

// This method uses Brian Kernighan's algorithm. Google it for more info.
WHILE in <> 0 DO
	in			:= in AND (in - 1);
	CountWord	:= CountWord + 1;
END_WHILE
END_METHOD

// Extract a single bit from any integer type (usefull in FOR loops)
METHOD PUBLIC Extract : BOOL
VAR_INPUT
	in	: ANY_INT;		// extract bit from this integer
	N	: USINT(0..63);	// position of bit on the nth position from right (right is lowest bit)
END_VAR
ValidateInput(in.diSize, N);

uInput.p1_Byte := in.pValue;

CASE in.diSize OF
	1:	Extract := (SHR(uInput.p1_Byte^,	N) AND 16#00000001) > 0;
	2:	Extract := (SHR(uInput.p2_Word^,	N) AND 16#00000001) > 0;
	4:	Extract := (SHR(uInput.p4_DWord^,	N) AND 16#00000001) > 0;
	8:	Extract := (SHR(uInput.p8_LWord^,	N) AND 16#00000001) > 0;
END_CASE
END_METHOD

// Extract a single bit from a byte type (usefull in FOR loops)
METHOD PUBLIC ExtractFromByte : BOOL
VAR_INPUT
	in	: REFERENCE TO BYTE;	// extract bit from this byte
	N	: BYTE(0..7);			// position of bit on the nth position from right (right is lowest bit)
END_VAR

// This is a separate method from Extract(), because ANY_INT cannot be a reference.
ExtractFromByte := (SHR(in,	N) AND 16#00000001) > 0;
END_METHOD

// Extract a single bit from a DWORD type (usefull in FOR loops)
METHOD PUBLIC ExtractFromDWord : BOOL
VAR_INPUT
	in	: REFERENCE TO DWORD;	// extract bit from this byte
	N	: BYTE(0..31);			// position of bit on the nth position from right (right is lowest bit)
END_VAR

// This is a separate method from Extract(), because ANY_INT cannot be a reference.
ExtractFromDWord := (SHR(in, N) AND 16#00000000_00000000_00000000_00000001) > 0;
END_METHOD

// Extract a single bit from a WORD type (usefull in FOR loops)
METHOD PUBLIC ExtractFromWord : BOOL
VAR_INPUT
	in	: REFERENCE TO WORD;	// extract bit from this byte
	N	: BYTE(0..15);			// position of bit on the nth position from right (right is lowest bit)
END_VAR

// This is a separate method from Extract(), because ANY_INT cannot be a reference.
ExtractFromWord := (SHR(in, N) AND 16#00000000_00000001) > 0;
END_METHOD

// Load a bit into any integer at position N
METHOD PUBLIC Load
VAR_INPUT
	in	: ANY_INT;		// Set or reset a bit in this integer
	val	: BOOL;			// The value to set
	N	: USINT(0..63);	// position of bit on the nth position from right (right is lowest bit)
END_VAR
ValidateInput(in.diSize, N);

uInput.p1_Byte := in.pValue;

CASE in.diSize OF
	1:	uInput.p1_Byte^		:= SEL(val, uInput.p1_Byte^  AND (NOT SHL( BYTE#1, N)),	uInput.p1_Byte^  OR SHL( BYTE#1, N));
	2:	uInput.p2_Word^		:= SEL(val, uInput.p2_Word^	 AND (NOT SHL( WORD#1, N)),	uInput.p2_Word^  OR SHL( WORD#1, N));
	4:	uInput.p4_DWord^	:= SEL(val, uInput.p4_DWord^ AND (NOT SHL(DWORD#1, N)),	uInput.p4_DWord^ OR SHL(DWORD#1, N));
	8:	uInput.p8_LWord^	:= SEL(val, uInput.p8_LWord^ AND (NOT SHL(LWORD#1, N)),	uInput.p8_LWord^ OR SHL(LWORD#1, N));
END_CASE
END_METHOD

// Alternative to Load. Only works with SINT or BYTE. Result is copied to output.
METHOD PUBLIC LoadToByte : BYTE
VAR_INPUT
	in	: BYTE;			// Set or reset a bit in this integer
	val	: BOOL;			// The value to set
	N	: USINT(0..7);	// position of bit on the nth position from right (right is lowest bit)
END_VAR

// This is a separate method from Load(), because ANY_INT cannot be a reference.
LoadToByte	:= TO_BYTE(Util.PUTBIT(
						X	:= in,
						N	:= N,
						B	:= val));
END_METHOD

// Alternative to Load. Only works with DINT or DWORD. Result is copied to output.
METHOD PUBLIC LoadToDWord : DWORD
VAR_INPUT
	in	: DWORD;		// Set or reset a bit in this integer
	val	: BOOL;			// The value to set
	N	: USINT(0..31);	// position of bit on the nth position from right (right is lowest bit)
END_VAR

// This is a separate method from Load(), because ANY_INT cannot be a reference.
LoadToDWord	:= Util.PUTBIT(
						X	:= in,
						N	:= N,
						B	:= val);
END_METHOD

// Alternative to Load. Only works with INT or WORD. Result is copied to output.
METHOD PUBLIC LoadToWord : WORD
VAR_INPUT
	in	: WORD;			// Set or reset a bit in this integer
	val	: BOOL;			// The value to set
	N	: USINT(0..15);	// position of bit on the nth position from right (right is lowest bit)
END_VAR

// This is a separate method from Load(), because ANY_INT cannot be a reference.
LoadToWord	:= TO_WORD(Util.PUTBIT(
						X	:= in,
						N	:= N,
						B	:= val));
END_METHOD

// Toggles a bit in any integer at position N
METHOD PUBLIC Toggle
VAR_INPUT
	in	: ANY_INT;		// extract bit from this integer
	N	: USINT(0..63);	// position of bit on the nth position from right (right is lowest bit)
END_VAR
ValidateInput(in.diSize, N);

uInput.p1_Byte := in.pValue;

CASE in.diSize OF
	1:	uInput.p1_Byte^		:= SHL( BYTE#1, N) XOR in.pValue^;
	2:	uInput.p2_Word^		:= SHL( WORD#1, N) XOR in.pValue^;
	4:	uInput.p4_DWord^	:= SHL(DWORD#1, N) XOR in.pValue^;
	8:	uInput.p8_LWord^	:= SHL(LWORD#1, N) XOR in.pValue^;
END_CASE
END_METHOD

METHOD PRIVATE ValidateInput
VAR_INPUT
	diSize	: DINT;
	N		: USINT;
END_VAR
IF diSize = 1 AND N > 7
OR diSize = 2 AND N > 15
OR diSize = 4 AND N > 31
THEN
	ThrowException('Invalid parameter; index too large');
END_IF
END_METHOD
