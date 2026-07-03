FUNCTION fcCompareStructs : BOOL
VAR_INPUT
               PT1 : POINTER TO ARRAY[0..32767] OF BYTE;
               PT2 : POINTER TO ARRAY[0..32767] OF BYTE;
               SIZE1 : INT;
               SIZE2 : INT;
END_VAR
VAR
               START : INT := 0;
               i, j, end : INT;
               firstbyte: BYTE;
END_VAR

(*
version 1.1        12. nov. 2009
programmer     hugo
tested by            oscat
https://github.com/simsum/oscat/blob/master/BUFFER_COMP.EXP
*)

(* @END_DECLARATION := '0' *)
(* search for first character match *)

IF size2 <= size1 THEN
	end := size1 - size2;
	firstbyte := PT2^[0];
	FOR i := START TO end DO
		IF PT1^[i] = firstbyte THEN
	    	(* first character matches, now compare rest of array *)
	    	j := 1;
	    	WHILE j < size2 DO
	    	IF pt2^[j] <> pt1^[j+i] THEN EXIT; END_IF;
	    	j := j + 1;
	    	END_WHILE;
	    	(* when J > size2 a match was found return the position i in buffer1 *)
	    	fcCompareStructs := j = size2;
	    	RETURN;
		END_IF;
	END_FOR;
END_IF;
fcCompareStructs := FALSE;


(*
hm 14. nov. 2008           rev 1.0
               original version

hm         12. nov. 2009   rev 1.1
               performance increase

*)

END_FUNCTION
