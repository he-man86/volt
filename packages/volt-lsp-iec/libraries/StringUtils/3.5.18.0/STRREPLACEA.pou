FUNCTION STRREPLACEA
VAR_INPUT
	PSTINPUT : POINTER TO STRING(255);
	UIINPUTBUFFERSIZE : UINT;
	PSTREPLACEWITH : POINTER TO STRING(255);
	ILENGTHINPUT : INT;
	ILENGTHTOREPLACE : INT;
	ILENGTHTOREPLACEWITH : INT;
	IPOSITION : INT;
END_VAR
VAR
	buf : ARRAY[0..255] OF BYTE;
	i : DINT;
	n : DINT;
	p : DINT;
	cnt : DINT;
	src : DINT;
	dst : DINT;
	cap : DINT;
END_VAR
(* NOT REPLACE — a raw in-place move, as CODESYS answers it (recorded: lib_stu_replace). With p = IPOSITION - 1:
   1. the bytes from p + ILENGTHTOREPLACE up to ILENGTHINPUT, its terminator included, move to p + ILENGTHTOREPLACEWITH
      — nothing moves when ILENGTHINPUT does not reach past them, so ILENGTHINPUT is the input's LENGTH and a wrong
      one leaves the tail where it was ('abcdef', 1 at 4, length 1 → 'abcXYZ');
   2. the WHOLE of PSTREPLACEWITH is copied over p — its length is not ILENGTHTOREPLACEWITH ('Device.App', 1 for 1 at
      7 → 'DeviceXYZp').
   Both are cut at UIINPUTBUFFERSIZE - 1, with a terminator there; a position past the string changes nothing.
   Worked on a copy of the string with zeros past its terminator, as the recorded buffers were.
   ponytail: real memory past the terminator need not be zero, and a longer string than 255 is not modelled *)
IF PSTINPUT = 0 OR PSTREPLACEWITH = 0 OR IPOSITION < 1 THEN
	RETURN;
END_IF
WHILE PSTINPUT^[n] <> 0 DO
	buf[n] := PSTINPUT^[n];
	n := n + 1;
END_WHILE
p := IPOSITION - 1;
IF p > n THEN
	RETURN;
END_IF
cap := MIN(UINT_TO_DINT(UIINPUTBUFFERSIZE) - 1, 255);
cnt := ILENGTHINPUT - p - ILENGTHTOREPLACE + 1;
src := p + ILENGTHTOREPLACE;
dst := p + ILENGTHTOREPLACEWITH;
IF cnt > 0 THEN
	cnt := MIN(cnt, cap - dst);
	IF dst > src THEN
		FOR i := cnt - 1 TO 0 BY -1 DO
			buf[dst + i] := buf[src + i];
		END_FOR
	ELSE
		FOR i := 0 TO cnt - 1 DO
			buf[dst + i] := buf[src + i];
		END_FOR
	END_IF
	buf[cap] := 0;
END_IF
i := 0;
WHILE PSTREPLACEWITH^[i] <> 0 AND p + i < cap DO
	buf[p + i] := PSTREPLACEWITH^[i];
	i := i + 1;
END_WHILE
i := 0;
WHILE i < cap AND_THEN buf[i] <> 0 DO
	PSTINPUT^[i] := buf[i];
	i := i + 1;
END_WHILE
PSTINPUT^[i] := 0;
END_FUNCTION