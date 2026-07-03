PROGRAM VisuDashboardNotifications
VAR
	
END_VAR

g_sHMI_DashboardNotifications.bCabinetError := g_sMACH.ERR.dwCat4_Error_a.6 
											OR g_sMACH.ERR.dwCat4_Error_a.7	
											OR g_sMACH.ERR.dwCat4_Error_a.8 
											OR g_sMACH.ERR.dwCat4_Error_a.22;
											
g_sHMI_DashboardNotifications.bCleaningCilTimout := g_sMACH.ERR.dwCat4_Error_b.07
												OR g_sMACH.ERR.dwCat4_Error_b.08
												OR g_sMACH.ERR.dwCat4_Error_b.09;
												
g_sHMI_DashboardNotifications.bFrontRearmotorError := g_sMACH.ERR.dwCat4_Error_a.29
													OR g_sMACH.ERR.dwCat4_Error_a.30
													OR g_sMACH.ERR.dwCat4_Error_a.31
													OR g_sMACH.ERR.dwCat4_Error_a.9
													OR g_sMACH.ERR.dwCat4_Error_a.10
													OR g_sMACH.ERR.dwCat4_Error_a.13
													OR g_sMACH.ERR.dwCat4_Error_a.14
													OR g_sMACH.ERR.dwCat1_Error.6
													OR g_sMACH.ERR.dwCat1_Error.7;
													
g_sHMI_DashboardNotifications.bHeightCilTimout := g_sMACH.ERR.dwCat4_Error_b.14;

g_sHMI_DashboardNotifications.bHeightMotorError := g_sMACH.ERR.dwCat4_Error_a.11
												OR g_sMACH.ERR.dwCat4_Error_b.14;

g_sHMI_DashboardNotifications.bMainAirError := g_sMACH.ERR.dwCat4_Error_a.1;

g_sHMI_DashboardNotifications.bNSpanel := g_sMACH.ERR.dwCat4_Error_a.0;

g_sHMI_DashboardNotifications.bRmotorError := g_sMACH.ERR.dwCat4_Error_a.31
											OR g_sMACH.ERR.dwCat4_Error_a.12
											OR g_sMACH.ERR.dwCat1_Error.8;
											
g_sHMI_DashboardNotifications.bSafetyScreen := FALSE;

g_sHMI_DashboardNotifications.bUltrasonicError := g_sMACH.ERR.dwCat4_Error_a.5;

g_sHMI_DashboardNotifications.bUltrasonicWarning := g_sMACH.ERR.dwCat1_Error.10;

END_PROGRAM
