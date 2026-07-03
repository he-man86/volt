PROGRAM MACH_MIS_Miscellaneous
VAR
	TONMinute: TON;
	bMinute	: BOOL;

END_VAR

(* Machine producing hours *)
TONMinute(IN:=g_sMACH.AUT.bActAutomatic AND NOT bMinute, PT:=T#60s);
bMinute := TONMinute.Q;
IF bMinute THEN
	 g_sHMI_CountersInfinite.nMinuteCount := g_sHMI_CountersInfinite.nMinuteCount + 1;
END_IF
IF g_sHMI_CountersInfinite.nMinuteCount >= 60 THEN
	g_sHMI_CountersInfinite.nMinuteCount := 0;
	g_sHMI_CountersInfinite.dnHourCount := g_sHMI_CountersInfinite.dnHourCount + 1;
END_IF

(* Maintenance necessary after x running hours *)
g_sMACH.ERR.bMaintenanceNecessary := 			g_sHMI_CountersInfinite.dnHourCount >= (g_HMI_dnLastMaintenance + g_HMI_MCH_Parameters.dnMaintenanceInterval)
											AND	g_HMI_MCH_Parameters.dnMaintenanceInterval > 0;
IF g_HMI_MachCommand.CMD.bMaintenanceDone
THEN
	g_HMI_dnLastMaintenance := g_sHMI_CountersInfinite.dnHourCount;
END_IF

IF			g_HMI_nDefaultLanguage <> 1043	(* nederlands *)
	AND	g_HMI_nDefaultLanguage <> 1033	(* engels *)
	AND	g_HMI_nDefaultLanguage <> 1031	(* duits *)
	AND	g_HMI_nDefaultLanguage <> 1034	(* spaans *)
	AND	g_HMI_nDefaultLanguage <> 1036	(* frans *)
	AND g_HMI_nDefaultLanguage <> 1040	(* Italiaans*)
	AND	g_HMI_nDefaultLanguage <> 1045	(* pools *)
	AND	g_HMI_nDefaultLanguage <> 1048	(* roemeens *)
	AND g_HMI_nDefaultLanguage <> 1049	(* Russian*)
	AND	g_HMI_nDefaultLanguage <> 1050	(* kroatisch *)
	AND g_HMI_nDefaultLanguage <> 1061	(* Ests*)
	AND g_HMI_nDefaultLanguage <> 2052	(* Chinees*)
	AND g_HMI_nDefaultLanguage <> 1029	(* Tsjechisch*)
	AND g_HMI_nDefaultLanguage <> 2070	(* Portugees*)
	AND g_HMI_nDefaultLanguage <> 1053	(* Zweeds *)
	
THEN
	g_sMACH.ERR.bLanguageValueInvalid	:= TRUE;
END_IF
IF	g_sMACH.ERR.bLanguageValueInvalid
THEN
	g_HMI_nDefaultLanguage := 1033;	(* English, US *)
END_IF

END_PROGRAM
