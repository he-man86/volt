PROGRAM HardwareUnits
VAR
	sw		: ARRAY[1..20] OF StopwatchFB;
END_VAR

__TRY sw[ 1].Start();		InjectionMouldingMachine();		sw[ 1].End();	__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.InjectionMouldingMachine])	GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY	// Handle communication with IMM through Euromap
__TRY sw[ 2].Start();		LabelSuppliers();				sw[ 2].End();	__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.LabelSuppliers])			GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY
__TRY sw[ 3].Start();		CassetteAdjustments();			sw[ 3].End();	__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.CassetteAdjustment])		GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY
__TRY sw[ 4].Start();		Magazines();					sw[ 4].End();	__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.Magazines])					GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY
__TRY sw[ 5].Start();		XiUnits();						sw[ 5].End();	__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.XiUnits])					GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY
__TRY sw[ 6].Start();		XuUnits();						sw[ 6].End();	__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.XuUnits])					GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY
__TRY sw[ 7].Start();		YUnits();						sw[ 7].End();	__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.YUnits])					GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY
__TRY sw[ 8].Start();		RejectStations();				sw[ 8].End();	__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.RejectStations])			GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY
__TRY sw[ 9].Start();		Chains();						sw[ 9].End();	__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.Chains])					GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY
__TRY sw[10].Start();		ZUnits();						sw[10].End();	__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.ZUnits])					GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY
__TRY sw[11].Start();		ZRUnits();						sw[11].End();	__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.ZRUnits])					GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY
__TRY sw[12].Start();		VisionSystems();				sw[12].End();	__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.VisionSystems])				GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY
__TRY sw[13].Start();		Conveyors();					sw[13].End();	__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.Conveyors])					GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY

// BFU
__TRY sw[14].Start();		Fanucs();						sw[14].End();	__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.Fanucs])					GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY
__TRY sw[15].Start();		BufferRacks();					sw[15].End();	__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.BufferRacks])				GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY
__TRY sw[16].Start();		BoxInfeeds();					sw[16].End();	__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.BoxInfeeds])				GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY
__TRY sw[17].Start();		BoxCenterUnits();				sw[17].End();	__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.BoxCenterUnits])			GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY
__TRY sw[18].Start();		BoxPushers();					sw[18].End();	__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.BoxPushers])				GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY
__TRY sw[19].Start();		BoxOutfeeds();					sw[19].End();	__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.BoxOutfeeds])				GVL_Exceptions.xException := TRUE;	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;		__ENDTRY

END_PROGRAM
