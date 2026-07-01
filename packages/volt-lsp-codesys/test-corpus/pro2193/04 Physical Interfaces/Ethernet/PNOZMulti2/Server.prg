PROGRAM Server
VAR
	taskInfo				: CmpIecTask.Task_Info2;

END_VAR

__TRY
	taskInfo	:= TaskGetInfo();

PNOZMulti2(
	ipAddress	:= HMI.ipAddressPilz);

__CATCH(GVL_Exceptions.aeExceptionCodes[eExceptionCodes.Ethernet])
	GVL_Exceptions.xException := TRUE;
	GVL_Exceptions.iCounter := GVL_Exceptions.iCounter + 1;
__ENDTRY

END_PROGRAM
