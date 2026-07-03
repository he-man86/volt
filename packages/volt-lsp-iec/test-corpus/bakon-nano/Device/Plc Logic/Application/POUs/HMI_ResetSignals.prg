PROGRAM HMI_ResetSignals
VAR
END_VAR

g_HMI_MachCommand.CMD.bStartManual	:= FALSE;
g_HMI_MachCommand.CMD.bStopManual	:= FALSE;
g_HMI_MachCommand.CMD.bStartCleaning	:= FALSE;
(*g_HMI_MachCommand.CMD.bStopCleaning	:= FALSE; *)


(*set language to english if language unknown*)
(*
IF	g_HMI_nDefaultLanguage <> 1031 AND
	g_HMI_nDefaultLanguage <> 1033 AND
	g_HMI_nDefaultLanguage <> 1043 AND
	g_HMI_nDefaultLanguage <> 1036
THEN
	g_HMI_nDefaultLanguage	:=1033;
END_IF
*)

END_PROGRAM
