// Reads the 'application info'. Rightclick on Application, Select Properties, Go to Information tab.
{attribute 'hide_all_locals'}
FUNCTION GetProjectInfo : ProjectInfoType
VAR_INPUT
END_VAR
VAR
	pApp		: POINTER TO CmpApp.APPLICATION;
	pAppInfo	: POINTER TO CmpApp.APPLICATION_INFO;
	iecResult	: SysTypes.RTS_IEC_RESULT;
END_VAR

// Get handle to current PLC application
pApp		:= CmpApp.AppGetCurrent(pResult := ADR(iecResult));
IF pApp = 0 THEN
	GetProjectInfo.projectName	:= 'ERROR READING CURRENT APP';
	RETURN;
END_IF

pAppInfo	:= CmpApp.AppGetApplicationInfo(pApp := pApp, pResult := ADR(iecResult));
IF pAppInfo = 0 THEN
	GetProjectInfo.projectName	:= 'ERROR GETTING APPLICATION INFO';
	RETURN;
END_IF

GetProjectInfo.projectName		:= pAppInfo^.pstProjectName^;
GetProjectInfo.author			:= pAppInfo^.pstAuthor^;
GetProjectInfo.version			:= pAppInfo^.pstVersion^;
GetProjectInfo.description		:= pAppInfo^.pstDescription^;
GetProjectInfo.profile			:= pAppInfo^.pstProfile^;
GetProjectInfo.lastChanges		:= DT_TO_STRING(pAppInfo^.dtLastChanges);

IF GetProjectInfo.projectName = '' THEN
	GetProjectInfo.projectName	:= 'INVALID PROJECTNAME';
END_IF
IF LEN(GetProjectInfo.lastChanges) > 3 THEN
	GetProjectInfo.lastChanges	:= RIGHT(GetProjectInfo.lastChanges, LEN(GetProjectInfo.lastChanges) - 3);
END_IF

END_FUNCTION
