PROGRAM Calc_SkipPositions
VAR
	nPosCount : INT;
	nPosCountGood	: INT;
	n					: INT;
END_VAR

(* Delete all impossible cutting positions in array *)

(* init counters *)
nPosCount := 1;
nPosCountGood	:= 1;

(* Do while position in array is a valid calculated value *)
WHILE	((g_aCuttingPositions[nPosCount].X_Target <> -50)
	OR	(g_aCuttingPositions[nPosCount].Y_Target <> -50)
	OR	(g_aCuttingPositions[nPosCount].A_Target <> -50))
	AND nPosCount <= C_wNumberOfMotionObjects
DO
	IF	g_aCuttingPositions[nPosCount].bCutPosPossible THEN
		g_aCuttingPositions[nPosCountGood]	:= g_aCuttingPositions[nPosCount];
		nPosCountGood	:= nPosCountGood + 1;
	END_IF
	nPosCount	:= nPosCount + 1;
END_WHILE

(* Delete unused (double) positions *)
FOR n := nPosCountGood TO nPosCount DO
	IF n <= C_wNumberOfMotionObjects THEN
		g_aCuttingPositions[n].X_Target := -50;
		g_aCuttingPositions[n].Y_Target := -50;
		g_aCuttingPositions[n].A_Target := -50;
	END_IF
END_FOR

g_sMACH.ERR.bMessagePosNotPossible := (nPosCountGood <> nPosCount) AND g_HMI_MCH_Parameters.bSkipImpossiblePositions;

END_PROGRAM
