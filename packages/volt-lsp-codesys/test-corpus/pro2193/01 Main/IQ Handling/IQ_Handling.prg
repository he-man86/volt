{attribute 'symbol' := 'none'}
PROGRAM IQ_Handling
VAR // Map correct addresses for inputs and outputs
	DI_10		 AT %IB8	 : BYTE;
	DI_11		 AT %IB9	 : BYTE;
	DI_12		 AT %IB10	 : BYTE;
	DI_13		 AT %IB11	 : BYTE;
	DI_14		 AT %IB12	 : BYTE;
	DI_15		 AT %IB13	 : BYTE;
	DI_16		 AT %IB14	 : BYTE;
	DI_17		 AT %IB15	 : BYTE;
	DI_18		 AT %IB16	 : BYTE;
	DI_19		 AT %IB17	 : BYTE;
	DI_20		 AT %IB18	 : BYTE;
	DI_21		 AT %IB19	 : BYTE;
	DI_22		 AT %IB20	 : BYTE;
	DI_30		 AT %IB570	 : BYTE;
	DI_31		 AT %IB571	 : BYTE;
	DI_32		 AT %IB572	 : BYTE;
	DI_33		 AT %IB573	 : BYTE;
	DI_40		 AT %IB594	 : BYTE;
	DI_41		 AT %IB595	 : BYTE;
	DI_42		 AT %IB596	 : BYTE;
	DI_43		 AT %IB597	 : BYTE;
	DI_44		 AT %IB598	 : BYTE;
	DI_45		 AT %IB599	 : BYTE;
	DI_50		 AT %IB618	 : BYTE;
	DI_51		 AT %IB619	 : BYTE;
	DI_52		 AT %IB620	 : BYTE;
	DI_53		 AT %IB621	 : BYTE;
	DI_54		 AT %IB622	 : BYTE;

	DQ_10		 AT %QB1	 : BYTE;
	DQ_11		 AT %QB2	 : BYTE;
	DQ_12		 AT %QB3	 : BYTE;
	DQ_13		 AT %QB4	 : BYTE;
	DQ_14		 AT %QB5	 : BYTE;
	DQ_15		 AT %QB6	 : BYTE;
	DQ_16		 AT %QB7	 : BYTE;
	DQ_17		 AT %QB8	 : BYTE;
	DQ_18		 AT %QB9	 : BYTE;
	DQ_19		 AT %QB10	 : BYTE;
	DQ_20		 AT %QB11	 : BYTE;
	DQ_30		 AT %QB304	 : BYTE;
	DQ_31		 AT %QB305	 : BYTE;
	DQ_32		 AT %QB306	 : BYTE;
	DQ_33		 AT %QB307	 : BYTE;
	DQ_34		 AT %QB308	 : BYTE;
	DQ_35		 AT %QB309	 : BYTE;
	DQ_36		 AT %QB310	 : BYTE;
	DQ_40		 AT %QB311	 : BYTE;
	DQ_41		 AT %QB312	 : BYTE;
	DQ_42		 AT %QB313	 : BYTE;
	DQ_43		 AT %QB314	 : BYTE;
	DQ_44		 AT %QB315	 : BYTE;
	DQ_45		 AT %QB316	 : BYTE;
	DQ_46		 AT %QB317	 : BYTE;
	DQ_50		 AT %QB318	 : BYTE;
	DQ_51		 AT %QB319	 : BYTE;
	DQ_52		 AT %QB320	 : BYTE;
	DQ_53		 AT %QB321	 : BYTE;
	DQ_54		 AT %QB322	 : BYTE;
END_VAR

VAR
	{attribute 'symbol' := 'readwrite'}	selectedSlice			: IQSlices;
	{attribute 'symbol' := 'readwrite'}	selectedSliceForce		: BOOL;
	{attribute 'symbol' := 'readwrite'}	selectedSliceInfo		: Slice_Type;
	{attribute 'symbol' := 'read'}		sliceDictionary			: STRING(GenerateSliceDictionary.maxLength);

	InputControl			: ARRAY[GVL_IQ.InputSliceStart..GVL_IQ.InputSliceEnd] OF MapperInputs;
	OutputControl			: ARRAY[GVL_IQ.OutputSliceStart..GVL_IQ.OutputSliceEnd] OF MapperOutputs;
END_VAR

{IF defined (IsSimulationMode)}
	//RETURN;
{END_IF}

Initialize();
SelectSlice();
CopyHomingSensors();
CopyPilzSafetyStatus();

G1_mapping();
G3_mapping();
G4_mapping();
G5_mapping();

AQ_21.AO1	:= TO_INT(XiUnits.Unit[1].Charger[1].MapAnalogOut());
AQ_21.AO2	:= TO_INT(XiUnits.Unit[1].Charger[2].MapAnalogOut());

END_PROGRAM

METHOD PRIVATE CopyHomingSensors
VAR
	servoDriveHomeable		: IHomeable;
	servoDriveNamed			: IAbleToRegister;
	i, i0, index			: UINT;
END_VAR
%FOLDER Methods
// Copy homing sensors of all servo motors
FOR i := 1 TO GlobalVars.fbModuleManager.servoDrivesCount DO

	i0 := i - 1;	// Get zero based number, needed for modulo calculation.

	// Check if correct page is selected
	IF selectedSlice = IQSlices.HomingSensors1 AND i0 / 8 = 0
	OR selectedSlice = IQSlices.HomingSensors2 AND i0 / 8 = 1
	OR selectedSlice = IQSlices.HomingSensors3 AND i0 / 8 = 2
	THEN
		index := (i0 MOD 8) + 1;	// Generate an index from 1 to 8

		IF __QUERYINTERFACE(GlobalVars.fbModuleManager.servoDrives[i], servoDriveHomeable) THEN
			selectedSliceInfo.component[index].actValue := servoDriveHomeable.HomingSensor;
		END_IF
		IF __QUERYINTERFACE(GlobalVars.fbModuleManager.servoDrives[i], servoDriveNamed) THEN
			selectedSliceInfo.component[index].name := servoDriveNamed.InstanceName;
		ELSE
			selectedSliceInfo.component[index].name := CONCAT('Servodrive #', TO_STRING(i));
		END_IF
	END_IF
END_FOR

// Only add BFU servos if there is a BFU (with separate module manager)
{IF defined (pou: BFU)}

// Copy homing sensors of all servo motors
FOR i := 1 TO GlobalVars_BFU.fbModuleManager.servoDrivesCount DO

	i0 := i - 1 + GlobalVars.fbModuleManager.servoDrivesCount;	// Get zero based number, needed for modulo calculation. Add SER servo count to continue numbering

	// Check if correct page is selected
	IF selectedSlice = IQSlices.HomingSensors1 AND i0 / 8 = 0
	OR selectedSlice = IQSlices.HomingSensors2 AND i0 / 8 = 1
	OR selectedSlice = IQSlices.HomingSensors3 AND i0 / 8 = 2
	THEN
		index := (i0 MOD 8) + 1;	// Generate an index from 1 to 8

		IF __QUERYINTERFACE(GlobalVars_BFU.fbModuleManager.servoDrives[i], servoDriveHomeable) THEN
			selectedSliceInfo.component[index].actValue := servoDriveHomeable.HomingSensor;
		END_IF
		IF __QUERYINTERFACE(GlobalVars_BFU.fbModuleManager.servoDrives[i], servoDriveNamed) THEN
			selectedSliceInfo.component[index].name := servoDriveNamed.InstanceName;
		ELSE
			selectedSliceInfo.component[index].name := CONCAT('Servodrive #', TO_STRING(i));
		END_IF
	END_IF
END_FOR

{END_IF}
END_METHOD

METHOD PRIVATE CopyPilzSafetyStatus
%FOLDER Methods
// Onderstaande code is tijdelijk!!! dit moet mooier.

IF selectedSlice = IQSlices.PilzSafety1 THEN
	selectedSliceInfo.component[1].name		:= 'PNOZMulti Statusled: O Fault';
	selectedSliceInfo.component[2].name		:= 'PNOZMulti Statusled: I Fault';
	selectedSliceInfo.component[3].name		:= 'PNOZMulti Statusled: Fault';
	selectedSliceInfo.component[4].name		:= 'PNOZMulti Statusled: Diag';
	selectedSliceInfo.component[5].name		:= 'PNOZMulti Statusled: Run';
	selectedSliceInfo.component[6].name		:= 'Hold to run button';
	selectedSliceInfo.component[7].name		:= 'Operator switch';
	selectedSliceInfo.component[8].name		:= 'Service switch';
	selectedSliceInfo.component[1].actValue	:= PNOZMulti2.xLedOFault;
	selectedSliceInfo.component[2].actValue	:= PNOZMulti2.xLedIFault;
	selectedSliceInfo.component[3].actValue	:= PNOZMulti2.xLedFault;
	selectedSliceInfo.component[4].actValue	:= PNOZMulti2.xLedDiag;
	selectedSliceInfo.component[5].actValue	:= PNOZMulti2.xLedRun;
	selectedSliceInfo.component[6].actValue	:= PNOZMulti2.xHoldToRunButton;
	selectedSliceInfo.component[7].actValue	:= PNOZMulti2.xOperatorSwitch;
	selectedSliceInfo.component[8].actValue	:= PNOZMulti2.xServiceSwitch;

ELSIF selectedSlice = IQSlices.PilzSafety2 THEN
	selectedSliceInfo.component[1].name		:= 'Estop Cabinet';
	selectedSliceInfo.component[2].name		:= 'Estop Keba';
	selectedSliceInfo.component[3].name		:= 'Estop IMM';
	selectedSliceInfo.component[4].name		:= 'Estop Z1';
	selectedSliceInfo.component[5].name		:= 'Estop M1';
	selectedSliceInfo.component[6].name		:= 'Estop Conveyor';
	selectedSliceInfo.component[7].name		:= '';
	selectedSliceInfo.component[8].name		:= '';
	selectedSliceInfo.component[1].actValue	:= PNOZMulti2.dwSafetyPLCStatus[1].0;
	selectedSliceInfo.component[2].actValue	:= PNOZMulti2.dwSafetyPLCStatus[1].3;
	selectedSliceInfo.component[3].actValue	:= PNOZMulti2.dwSafetyPLCStatus[1].27;
	selectedSliceInfo.component[4].actValue	:= PNOZMulti2.dwSafetyPLCStatus[1].6;
	selectedSliceInfo.component[5].actValue	:= PNOZMulti2.dwSafetyPLCStatus[1].12;
	selectedSliceInfo.component[6].actValue	:= PNOZMulti2.dwSafetyPLCStatus[1].21;
	selectedSliceInfo.component[7].actValue	:= FALSE;
	selectedSliceInfo.component[8].actValue	:= FALSE;

END_IF
END_METHOD

METHOD PRIVATE GenerateSliceDictionary
VAR
	element			: STRING(40);
	slice			: IQSlices;
END_VAR
VAR_INST
	sliceDictionaryLength	: DINT;		// For debugging: check if the maxLength const is big enough
END_VAR
VAR CONSTANT
	maxLength		: INT := 1000;
END_VAR
%FOLDER Methods
sliceDictionary		:= '{';

// Skip the first and the last value in the enumeration
FOR slice := IQSlices.None + 1 TO IQSlices.FinalElement - 1 DO

	// Generate an element like this: '"1":"DI_10",'
	element			:= SEL( slice = IQSlices.FinalElement - 1,
							CONCAT5('"', TO_STRING(TO_INT(slice)), '":"', TO_STRING(slice), '",'),
							CONCAT5('"', TO_STRING(TO_INT(slice)), '":"', TO_STRING(slice), '"'));

	IF NOT StrConcatA(pstFrom := ADR(element), pstTo := ADR(sliceDictionary), iBufferSize := maxLength) THEN
		ThrowException('Increase the maxLength constant!');
	END_IF

END_FOR

element := '}';
IF NOT StrConcatA(pstFrom := ADR(element), pstTo := ADR(sliceDictionary), iBufferSize := maxLength) THEN
	ThrowException('Increase the maxLength constant!');
END_IF

sliceDictionaryLength	:= StrLenA(ADR(sliceDictionary));
END_METHOD

METHOD PRIVATE Initialize
VAR_INST
	{attribute 'init_on_onlchange'}
	xInitialized	: BOOL;
END_VAR
%FOLDER Methods
IF xInitialized THEN
	RETURN;
END_IF

GenerateSliceDictionary();

xInitialized := TRUE;
END_METHOD

METHOD PRIVATE SelectSlice
VAR_INST
	previousSlice				: IQSlices;
	selectedSliceTrigger		: RisingTriggerFB;
	selectedSliceForceTrigger	: RisingTriggerFB;
END_VAR
VAR
	i							: UINT;
END_VAR
%FOLDER Methods
// When forcing outputs is enabled, copy the current state of the output to the force button
IF selectedSliceForceTrigger.Rising(CLK := selectedSliceForce) THEN
	FOR i := 1 TO 8 DO
		selectedSliceInfo.component[i].forceValue	:= selectedSliceInfo.component[i].actValue;
	END_FOR
END_IF

// Copy I/Q info when a new slice is selected
IF selectedSliceTrigger.Rising(CLK := selectedSlice <> previousSlice) THEN
	selectedSliceForce := FALSE;

	FOR i := GVL_IQ.InputSliceStart TO GVL_IQ.InputSliceEnd DO
		InputControl[i].SetSliceRef(0, 0);
	END_FOR
	FOR i := GVL_IQ.OutputSliceStart TO GVL_IQ.OutputSliceEnd DO
		OutputControl[i].SetSliceRef(0, 0);
	END_FOR

	selectedSliceInfo.sliceName	:= '';
	selectedSliceInfo.isOutput	:= FALSE;
	FOR i := 1 TO 8 DO
		selectedSliceInfo.component[i].name			:= '';
		selectedSliceInfo.component[i].actValue		:= FALSE;
		selectedSliceInfo.component[i].forceValue	:= FALSE;
	END_FOR

	CASE selectedSlice OF
		IQSlices.None:
			;
		GVL_IQ.InputSliceStart..GVL_IQ.InputSliceEnd:
			InputControl[selectedSlice].SetSliceRef(selectedSliceInfo, selectedSliceForce);
		GVL_IQ.OutputSliceStart..GVL_IQ.OutputSliceEnd:
			OutputControl[selectedSlice].SetSliceRef(selectedSliceInfo, selectedSliceForce);
		IQSlices.HomingSensors1:
			selectedSliceInfo.sliceName	:= 'Homing sensors #1';
		IQSlices.HomingSensors2:
			selectedSliceInfo.sliceName	:= 'Homing sensors #2';
		IQSlices.HomingSensors3:
			selectedSliceInfo.sliceName	:= 'Homing sensors #3';
		IQSlices.PilzSafety1:
			selectedSliceInfo.sliceName	:= 'PNOZMulti Safety I/O #1';
		IQSlices.PilzSafety2:
			selectedSliceInfo.sliceName	:= 'PNOZMulti Safety I/O #2';

		ELSE
			selectedSliceInfo.sliceName	:= 'Slice not supported!';
	END_CASE

	previousSlice := selectedSlice;
END_IF
END_METHOD

ACTION G1_mapping
InputControl[IQSlices.DI_10](
	sliceNumber	:= IQSlices.DI_10,
	slice		:= DI_10,
	bit1		=> SER.DigIn.emergencyStopOk,								// General - Emergency stop
	bit2		=> ,
	bit3		=> InjectionMouldingMachine.Unit.sensorMouldOpen,			// Y-axis - Mould open sensor
	bit4		=> InjectionMouldingMachine.Unit.sensorIntermediateOpen,	// Y-axis - Intermediate mould open sensor
	bit5		=> YUnits.Unit[1].xClearMould,								// Y-axis - Clear mould signal
	bit6		=> ,
	bit7		=> ,
	bit8		=> SER.DigIn.airconditioningOk,								// General - Airconditioning OK
);

InputControl[IQSlices.DI_11](
	sliceNumber	:= IQSlices.DI_11,
	slice		:= DI_11,
	bit1		=> InjectionMouldingMachine.Unit.xRejectMoulding,			// Euromap 67 - Reject
	bit2		=> InjectionMouldingMachine.Unit.xMouldClosed,				// Euromap 67 - Mould closed
	bit3		=> InjectionMouldingMachine.Unit.xMouldOpen,				// Euromap 67 - Mould open position
	bit4		=> InjectionMouldingMachine.Unit.xIntermediateOpen,			// Euromap 67 - Intermediate mould opening position
	bit5		=> InjectionMouldingMachine.Unit.xAutoOperation,			// Euromap 67 - Enable operation with robot (automatic)
	bit6		=> InjectionMouldingMachine.Unit.Ejectors.inputIsBack,		// Euromap 67 - Ejector back position
	bit7		=> InjectionMouldingMachine.Unit.Ejectors.inputIsForward,	// Euromap 67 - Ejector forward position
	bit8		=> InjectionMouldingMachine.Unit.CorePullers.inputIsBack,	// Euromap 67 - Core pullers 1 in position 1
);

InputControl[IQSlices.DI_12](
	sliceNumber	:= IQSlices.DI_12,
	slice		:= DI_12,
	bit1		=> InjectionMouldingMachine.Unit.CorePullers.inputIsForward,// Euromap 67 - Core pullers 1 in position 2
	bit2		=> InjectionMouldingMachine.Unit.xDoorsClosed,				// General - Gate closed IMM
	bit3		=> SER.DigIn.xSafetyGateRelay,								// General - Safety gates closed
	bit4		=> SER.VacuumPumps.xPhaseCheck,								// General - Phase check
	bit5		=> SER.VacuumPumps.xThermalInputHighVacuum,					// General - Thermal vacuum pump 1 (Vacuum SER)
	bit6		=> BoxInfeeds.Unit[1].vacuumPumpThermalInput,				// General - Thermal vacuum pump 2 (Vacuum BFU)
	bit7		=> ,
	bit8		=> InjectionMouldingMachine.Unit.enableReleaseOfGuardLocking,// (reserved for: Euromap 78 Allowed to open gate from IMM)
);

InputControl[IQSlices.DI_13](
	sliceNumber	:= IQSlices.DI_13,
	slice		:= DI_13,
	bit1		=> HardwareButtons.StartCycle.buttonInput,					// General - Start button
	bit2		=> HardwareButtons.EndCycle.buttonInput,					// General - Stop button
	bit3		=> HardwareButtons.Reset.buttonInput,						// General - Reset button
	bit4		=> HardwareButtons.EnableIML.buttonInput,					// General - IML button
	bit5		=> HardwareButtons.Homing.buttonInput,						// General - Initialisation button
	bit6		=> HardwareButtons.Stop.buttonInput,						// General - Machine stop (program reset)
	bit7		=> HardwareButtons.F1.buttonInput,							// General - Function 1 button
	bit8		=> HardwareButtons.F2.buttonInput,							// General - Function 2 button
);

InputControl[IQSlices.DI_14](
	sliceNumber	:= IQSlices.DI_14,
	slice		:= DI_14,
	bit1		=> SER.DigIn.fuseOk[1],										// Fuse - Error =C1-10U3
	bit2		=> SER.DigIn.fuseOk[2],										// Fuse - Error =C1-10U5
	bit3		=> SER.DigIn.fuseOk[3],										// Fuse - Error =C1-11U1
	bit4		=> ,
	bit5		=> ,
	bit6		=> ,
	bit7		=> ,
	bit8		=> BFU.DigIn.xSafetyGateRelay,								// General - Gate closed BFU
);

InputControl[IQSlices.DI_15](
	sliceNumber	:= IQSlices.DI_15,
	slice		:= DI_15,
	bit1		=> SER.DigIn.quickStopOk_MUnit,								// General - Quick stop signal M-axis
	bit2		=> SER.DigIn.quickStopOk,									// General - Quick stop signal
	bit3		=> ,
	bit4		=> ,
	bit5		=> Conveyors.UnitReject[1].RejectConveyor.beltRunning,		// Conveyor - Reject conveyor BFU running
	bit6		=> BoxOutfeeds.Unit[1].BoxOutputConveyor.beltRunning,		// Conveyor - Box output conveyor running
	bit7		=> BoxInfeeds.Unit[1].BoxInputConveyor.beltRunning,			// Conveyor - Box input conveyor running
	bit8		=> RejectStations.Unit[1].Conveyor.beltRunning,				// Conveyor - Reject conveyor running
);

InputControl[IQSlices.DI_16](
	sliceNumber	:= IQSlices.DI_16,
	slice		:= DI_16,
	bit1		=> SER.GateZAxis.xSafetyGateClosed,									// General - Safety gate Z sensor status
	bit2		=> SER.GateMAxis.xSafetyGateClosed,									// General - Safety gate M sensor status
	bit3		=> SER.GateSTG.xSafetyGateClosed,									// General - Safety gate STG sensor status
	bit4		=> LabelSuppliers.Unit[1].DrawerHoodSafetyMagnet.xSafetyGateClosed,	// General - Safety drawer hood sensor status
	bit5		=> SER.GateDrawerMAxis.xSafetyGateClosed,							// General - Safety gate M drawer sensor status
	bit6		=> LabelSuppliers.Unit[1].DrawerInSafePosition.SensorInput,			// General - Safety drawer sensor status
	bit7		=> BFU.GateBFU.xSafetyGateClosed,									// General - Safety gate BFU sensor status
	bit8		=> BFU.GateConveyor.xSafetyGateClosed,								// General - Safety gate conveyor sensor status
);

InputControl[IQSlices.DI_17](
	sliceNumber	:= IQSlices.DI_17,
	slice		:= DI_17,
	bit1		=> XuUnits.Unit[1].Vacuum[1].input1,						// Xu-axis - Vacuum 1
	bit2		=> XuUnits.Unit[1].Vacuum[2].input1,						// Xu-axis - Vacuum 2
	bit3		=> XuUnits.Unit[1].Vacuum[3].input1,						// Xu-axis - Vacuum 3
	bit4		=> ,
	bit5		=> ,
	bit6		=> ,
	bit7		=> XiUnits.Unit[1].Charger[2].xChargerCycleOk,				// Xi-axis - Static cycle 2 OK
	bit8		=> XiUnits.Unit[1].Charger[1].xChargerCycleOk,				// Xi-axis - Static cycle 1 OK
);

InputControl[IQSlices.DI_18](
	sliceNumber	:= IQSlices.DI_18,
	slice		:= DI_18,
	bit1		=> SER.DigIn.xAirPressureOK,								// General - Main airvalve - air pressure OK
	bit2		=> SER.VacuumPumps.xHighVacuumtankFull,						// General - High vacuum tank is full
	bit3		=> ,
	bit4		=> InjectionMouldingMachine.Unit.detectMovementIMM,			// General - IMM movement detection
	bit5		=> SER.DigIn.vacuumPumpThermistor,							// General - Thermistor vacuum pump SER
	bit6		=> ,
	bit7		=> Conveyors.Unit[1].AreaFree[1].sensorInput,				// C2-axis - Stacking area free (SER side)
	bit8		=> Conveyors.Unit[1].AreaFree[2].sensorInput,				// C2-axis - Stacking area free
);

InputControl[IQSlices.DI_19](
	sliceNumber	:= IQSlices.DI_19,
	slice		:= DI_19,
	bit1		=> Conveyors.Unit[1].AreaFree[3].sensorInput,				// C2-axis - Stacking area free (BFU side)
	bit2		=> BFU.GateConveyor.ButtonUnLock.buttonInput,				// C2-axis - Open gate conveyor button
	bit3		=> BFU.GateConveyor.ButtonLock.buttonInput,					// C2-axis - Acknowledgement gate conveyor button
	bit4		=> ,
	bit5		=> ,
	bit6		=> ,
	bit7		=> ,
	bit8		=> BoxInfeeds.Unit[1].vacuumPumpThermistor,					// General - Thermistor vacuum pump BFU
);

InputControl[IQSlices.DI_20](
	sliceNumber	:= IQSlices.DI_20,
	slice		:= DI_20,
	bit1		=> ,
	bit2		=> ,
	bit3		=> ,
	bit4		=> ,
	bit5		=> ,
	bit6		=> ,
	bit7		=> ,
	bit8		=> ,
);

InputControl[IQSlices.DI_21](
	sliceNumber	:= IQSlices.DI_21,
	slice		:= DI_21,
	bit1		=> VisionSystems.Unit[1].ready,								// Mevisco - Ready
	bit2		=> VisionSystems.Unit[1].resultToggle,						// Mevisco - Result toggle
	bit3		=> VisionSystems.Unit[1].OK,								// Mevisco - OK
	bit4		=> VisionSystems.Unit[1].bypassMode,						// Mevisco - Bypass mode
	bit5		=> VisionSystems.Unit[1].imageAcquisition,					// Mevisco - Image aquisition
	bit6		=> VisionSystems.Unit[1].idle,								// Mevisco - Idle
	bit7		=> VisionSystems.Unit[1].error,								// Mevisco - Error
	bit8		=> VisionSystems.Unit[1].camOK[1],							// Mevisco - Cam 1 OK
);

InputControl[IQSlices.DI_22](
	sliceNumber	:= IQSlices.DI_22,
	slice		:= DI_22,
	bit1		=> VisionSystems.Unit[1].camOK[2],							// Mevisco - Cam 2 OK
	bit2		=> VisionSystems.Unit[1].camOK[3],							// Mevisco - Cam 3 OK
	bit3		=> VisionSystems.Unit[1].camOK[4],							// Mevisco - Cam 4 OK
	bit4		=> VisionSystems.Unit[1].camOK[5],							// Mevisco - Cam 5 OK
	bit5		=> VisionSystems.Unit[1].camOK[6],							// Mevisco - Cam 6 OK
	bit6		=> VisionSystems.Unit[1].camOK[7],							// Mevisco - Cam 7 OK
	bit7		=> ,
	bit8		=> VisionSystems.Unit[1].triggerSensor,
);

OutputControl[IQSlices.DQ_10](
	sliceNumber	:= IQSlices.DQ_10,
	slice		:= DQ_10,
	bit1		:= SER.ResetSignalOut.Map() OR BFU.ResetSignalOut.Map(),	// General - Global reset
	bit2		:= SER.MainAirValve.Map()									// General - Main airvalve
);

OutputControl[IQSlices.DQ_11](
	sliceNumber	:= IQSlices.DQ_11,
	slice		:= DQ_11,
	bit1		:= HardwareButtons.StartCycle.Map(),						// General - LED system on (start button)
	bit2		:= HardwareButtons.Reset.Map(),								// General - LED error (reset button)
	bit3		:= HardwareButtons.EnableIML.Map(),							// General - LED IML (IML button)
	bit4		:= HardwareButtons.Homing.Map(),							// General - LED initialisation (initialisation button)
	bit5		:= HardwareButtons.F1.Map(),								// General - Led function 1 button
	bit6		:= HardwareButtons.F2.Map(),								// General - Led function 2 button
	bit7		:= HardwareButtons.EndCycle.Map(),							// General - Led stop button
	bit8		:= ,
);

OutputControl[IQSlices.DQ_12](
	sliceNumber	:= IQSlices.DQ_12,
	slice		:= DQ_12,
	bit1		:= BFU.GateConveyor.ButtonUnLock.Map(),						// C2-axis - LED open gate conveyor button
	bit2		:= BFU.GateConveyor.ButtonLock.Map(),						// C2-axis - LED acknowledgement conveyor button
	bit3		:= ProcessModules.TransferProducts_XuToShute[1].PulseOutput.Map(),
	bit4		:= VisionSystems.Unit[1].PulseOutput.Map(),
	bit5		:= ,
	bit6		:= ,
	bit7		:= ,
	bit8		:= VisionSystems.Unit[1].TriggerOutput.Map(),
);

OutputControl[IQSlices.DQ_13](
	sliceNumber	:= IQSlices.DQ_13,
	slice		:= DQ_13,
	bit1		:= InjectionMouldingMachine.Unit.MouldAreaFree.Map(),			// Euromap - Mould area free
	bit2		:= InjectionMouldingMachine.Unit.EnableMouldClosure.Map(),		// Euromap - Enable mould closure
	bit3		:= InjectionMouldingMachine.Unit.EnableFullMouldOpening.Map(),	// Euromap - Enable full mould opening
	bit4		:= InjectionMouldingMachine.Unit.OperationWithRobot.Map(),		// Euromap - Operation with handling device/robot
	bit5		:= InjectionMouldingMachine.Unit.Ejectors.MapEnableBack(),		// Euromap - Enable ejector back
	bit6		:= InjectionMouldingMachine.Unit.Ejectors.MapEnableForward(),	// Euromap - Enable ejector forward
	bit7		:= InjectionMouldingMachine.Unit.CorePullers.MapEnableBack(),	// Euromap - Enable core pullers 1 to position 1
	bit8		:= InjectionMouldingMachine.Unit.CorePullers.MapEnableForward(),// Euromap - Enable core pullers 1 to position 2
);

OutputControl[IQSlices.DQ_14](
	sliceNumber	:= IQSlices.DQ_14,
	slice		:= DQ_14,
	bit1		:= SER.Buzzer.Map(),											// General - Buzzer
	bit2		:= SER.GatesControlIMMCircuit.IMMRequestForOpening.Map(),		// General - Request for opening safety gates
	bit3		:= SER.GatesControlIMMCircuit.IMMAcknowledgement.Map(),			// General - Acknowledgement safety gates inside
	bit4		:= SER.GatesControlIMMCircuit.IMMAcknowledgement.Map(),			// General - Acknowledgement safety gates outside
	bit5		:= SER.EnableFreqInvertersRelay.Map(),							// General - Enable freq. relay
	bit6		:= BoxInfeeds.Unit[1].BoxInputConveyor.MapReverse(),			// General - Start reversed box input conveyor
	bit7		:= BoxInfeeds.Unit[1].VacuumPump.Map(),							// General - Start vacuum pump 2 (Vacuum BFU)
	bit8		:= SER.VacuumPumps.MapHigh(),									// General - Start vacuum pump 1 (Vacuum SER)
);

OutputControl[IQSlices.DQ_15](
	sliceNumber	:= IQSlices.DQ_15,
	slice		:= DQ_15,
	bit1		:= RejectStations.Unit[1].Conveyor.Map(),					// Conveyor - Start reject conveyor
	bit2		:= BoxInfeeds.Unit[1].BoxInputConveyor.Map(),				// Conveyor - Start box input conveyor
	bit3		:= BoxOutfeeds.Unit[1].BoxOutputConveyor.Map(),				// Conveyor - Start box output conveyor
	bit4		:= Conveyors.UnitReject[1].RejectConveyor.Map(),			// Conveyor - Start reject conveyor BFU
	bit5		:= BFU.GateConveyor.MapGate(),								// General - Safety magnet gate conveyor
	bit6		:= LabelSuppliers.Unit[1].DrawerHoodSafetyMagnet.MapGate(),	// General - Safety magnet drawer hood
	bit7		:= SER.GateDrawerMAxis.MapGate(),							// General - Safety magnet gate M drawer
	bit8		:= SER.GateSTG.MapGate(),									// General - Safety magnet gate STG
);

OutputControl[IQSlices.DQ_16](
	sliceNumber	:= IQSlices.DQ_16,
	slice		:= DQ_16,
	bit1		:= SER.GateZAxis.MapAssistCloseGate(),						// General - Assistance close gate cylinder
	bit2		:= SER.GateZAxis.MapAssistOpenGate(),						// General - Assistance open gate cylinder
	bit3		:= SER.GateZAxis.MapAssistUnlock(),							// General - Unlock assistance gate cylinder
	bit4		:= ,
	bit5		:= ,
	bit6		:= BFU.GateBFU.MapGate(),									// General - Safety magnet Gate BFU
	bit7		:= XiUnits.Unit[1].Charger[2].Map(),						// Xi-axis - Start charging label 2
	bit8		:= XiUnits.Unit[1].Charger[1].Map(),						// Xi-axis - Start charging label 1
);

OutputControl[IQSlices.DQ_17](
	sliceNumber	:= IQSlices.DQ_17,
	slice		:= DQ_17,
	bit1		:= XuUnits.Unit[1].Vacuum[1].Map(),							// Xu-axis - Vacuum 1
	bit2		:= XuUnits.Unit[1].Vacuum[2].Map(),							// Xu-axis - Vacuum 2
	bit3		:= XuUnits.Unit[1].Vacuum[3].Map(),							// Xu-axis - Vacuum 3
	bit4		:= XiUnits.Unit[1].Vacuum[1].Map(),							// Xi-axis - Vacuum 1
	bit5		:= XiUnits.Unit[1].Vacuum[2].Map(),							// Xi-axis - Vacuum 2
	bit6		:= XiUnits.Unit[1].Vacuum[3].Map(),							// Xi-axis - Vacuum 3
	bit7		:= XiUnits.Unit[1].Vacuum[4].Map(),							// Xi-axis - Vacuum 4
	bit8		:= XiUnits.Unit[1].Vacuum[5].Map(),							// Xi-axis - Vacuum 5
);

OutputControl[IQSlices.DQ_18](
	sliceNumber	:= IQSlices.DQ_18,
	slice		:= DQ_18,
	bit1		:= XiUnits.Unit[1].Vacuum[6].Map(),							// Xi-axis - Vacuum 6
	bit2		:= XiUnits.Unit[1].Vacuum[7].Map(),							// Xi-axis - Vacuum 7
	bit3		:= XiUnits.Unit[1].Vacuum[8].Map(),							// Xi-axis - Vacuum 8
	bit4		:= XiUnits.Unit[1].Vacuum[9].Map(),							// Xi-axis - Vacuum 9
	bit5		:= XiUnits.Unit[1].Vacuum[10].Map(),						// Xi-axis - Vacuum 10
	bit6		:= XiUnits.Unit[1].Vacuum[11].Map(),						// Xi-axis - Vacuum 11
	bit7		:= XiUnits.Unit[1].Vacuum[12].Map(),						// Xi-axis - Vacuum 12
	bit8		:= ,
);

OutputControl[IQSlices.DQ_19](
	sliceNumber	:= IQSlices.DQ_19,
	slice		:= DQ_19,
	bit1		:= XuUnits.Unit[1].BufferAir.Map(),							// Xu-axis - Buffer air
	bit2		:= XiUnits.Unit[1].BufferAir.Map(),							// Xi-axis - Buffer air
	bit3		:= XiUnits.Unit[1].LockCores.Map(),							// Xi-axis - Lock cores
	bit4		:= ,
	bit5		:= ,														// Xu-axis - (reserved for Shift IN (takeout pos.))
	bit6		:= ,														// Xu-axis - (reserved for Shift OUT (takeover pos.))
	bit7		:= ,
	bit8		:= ,
);

OutputControl[IQSlices.DQ_20](
	sliceNumber	:= IQSlices.DQ_20,
	slice		:= DQ_20,
	bit1		:= ,
	bit2		:= ,
	bit3		:= InjectionMouldingMachine.Unit.ProductionWithoutIML.Map(),
	bit4		:= ,
	bit5		:= VisionSystems.Unit[1].Error_Reset.Map(),					// Mevisco - Error reset
	bit6		:= VisionSystems.Unit[1].DisableTrigger.Map(),				// Mevisco - Disable trigger
	bit7		:= VisionSystems.Unit[1].Activate_BypassMode.Map(),			// Mevisco - Activate bypass mode
	bit8		:= VisionSystems.Unit[1].Cavity_Reset.Map(),				// Mevisco - Cavity reset
);
END_ACTION

ACTION G3_Mapping
InputControl[IQSlices.DI_30](
	sliceNumber	:= IQSlices.DI_30,
	slice		:= DI_30,
	bit1		=> Magazines.UnitMotors[1].ButtonReleaseBrake1.buttonInput,					// M-axis - Release brake M1.1-axis button
	bit2		=> Magazines.UnitMotors[1].ButtonReleaseBrake2.buttonInput,					// M-axis - Release brake M1.2-axis button
	bit3		=> SER.GateMAxis.ButtonUnLock.buttonInput,									// General - Unlock/open machine gate M button
	bit4		=> SER.GateDrawerMAxis.ButtonUnLock.buttonInput,							// General - Unlock/open machine gate M drawer button
	bit5		=> SER.CombinedAcknowledgeMAxis.buttonInput,								// General - Acknowledgement machine gate M button
	bit6		=> ProcessModules.DrawerControl[1].ButtonAutoChangeDrawer.buttonInput,		// M-axis - Automatic change drawer button
	bit7		=> ProcessModules.DrawerControl[1].ButtonChangeDrawer.buttonInput,			// M-axis - Change drawer button
	bit8		=> LabelSuppliers.Unit[1].DrawerHoodSafetyMagnet.ButtonUnLock.buttonInput,	// M-axis - Unlock/open drawer hood button
);

InputControl[IQSlices.DI_31](
	sliceNumber	:= IQSlices.DI_31,
	slice		:= DI_31,
	bit1		=> LabelSuppliers.Unit[1].DrawerHoodSafetyMagnet.ButtonLock.buttonInput,	// M-axis - Acknowledgement drawer hood button
	bit2		=> ,
	bit3		=> LabelSuppliers.Unit[1].DrawerChangeCylinder.inputIn,						// M-axis - Change drawer IN (upper drawer take label pos.)
	bit4		=> LabelSuppliers.Unit[1].DrawerChangeCylinder.inputOut,					// M-axis - Change drawer OUT (lower drawer take label pos.)
	bit5		=> LabelSuppliers.Unit[1].LockPins.inputIn,									// M-axis - Lock pins IN (bottom pos.)
	bit6		=> LabelSuppliers.Unit[1].Drawers[enumDrawer.Upper].Lock.SensorInput,		// M-axis - Lock pins OUT 1 (upper drawer locked)
	bit7		=> LabelSuppliers.Unit[1].Drawers[enumDrawer.Lower].Lock.SensorInput,		// M-axis - Lock pins OUT 2 (bottom drawer locked)
	bit8		=> ,
);

InputControl[IQSlices.DI_32](
	sliceNumber	:= IQSlices.DI_32,
	slice		:= DI_32,
	bit1		=> Magazines.Unit[1].Vacuum[1].input1,			// M-axis - Vacuum 1
	bit2		=> Magazines.Unit[1].Vacuum[2].input1,			// M-axis - Vacuum 2
	bit3		=> Magazines.Unit[1].Vacuum[3].input1,			// M-axis - Vacuum 3
	bit4		=> Magazines.Unit[1].Vacuum[4].input1,			// M-axis - Vacuum 4
	bit5		=> Magazines.Unit[1].Vacuum[5].input1,			// M-axis - Vacuum 5
	bit6		=> Magazines.Unit[1].Vacuum[6].input1,			// M-axis - Vacuum 6
	bit7		=> Magazines.Unit[1].flipLabelSensorIn[1],		// M-axis - Flip 1.1 IN (take out label pos)
	bit8		=> Magazines.Unit[1].flipLabelSensorOut[1],		// M-axis - Flip 1.1 OUT (take over label pos)
);

InputControl[IQSlices.DI_33](
	sliceNumber	:= IQSlices.DI_33,
	slice		:= DI_33,
	bit1		=> Magazines.Unit[1].flipLabelSensorIn[2],		// M-axis - Flip 1.2 IN (take out label pos)
	bit2		=> Magazines.Unit[1].flipLabelSensorOut[2],		// M-axis - Flip 1.2 OUT (take over label pos)
	bit3		=> ,
	bit4		=> ,
	bit5		=> ,
	bit6		=> ,
	bit7		=> ,
	bit8		=> ,
);

OutputControl[IQSlices.DQ_30](
	sliceNumber	:= IQSlices.DQ_30,
	slice		:= DQ_30,
	bit1		:= SER.GateMAxis.ButtonUnLock.Map(),									// General - LED open gate M button
	bit2		:= SER.GateDrawerMAxis.ButtonUnLock.Map(),								// General - LED open gate M drawer button
	bit3		:= SER.CombinedAcknowledgeMAxis.Map(),									// General - LED acknowledgement gate M button
	bit4		:= ,
	bit5		:= ProcessModules.DrawerControl[1].ButtonAutoChangeDrawer.Map(),		// M-axis - LED auto change drawer button (system ON)
	bit6		:= ProcessModules.DrawerControl[1].ButtonChangeDrawer.Map(),			// M-axis - LED change drawer button
	bit7		:= LabelSuppliers.Unit[1].DrawerHoodSafetyMagnet.ButtonUnLock.Map(),	// M-axis - LED open drawer hood button
	bit8		:= LabelSuppliers.Unit[1].DrawerHoodSafetyMagnet.ButtonLock.Map(),		// M-axis - LED acknowledgement drawer hood button
);

OutputControl[IQSlices.DQ_31](
	sliceNumber	:= IQSlices.DQ_31,
	slice		:= DQ_31,
	bit1		:= LabelSuppliers.Unit[1].BlowBetweenLabels[1].Map(),	// M-axis - Blow between labels 1
	bit2		:= LabelSuppliers.Unit[1].BlowBetweenLabels[2].Map(),	// M-axis - Blow between labels 2
	bit3		:= CassetteAdjustments.Unit[1].Adjust[1].Map(),			// M-axis - Adjustment 1
	bit4		:= CassetteAdjustments.Unit[1].Adjust[2].Map(),			// M-axis - Adjustment 2
	bit5		:= CassetteAdjustments.Unit[1].Adjust[3].Map(),			// M-axis - Adjustment 3
	bit6		:= CassetteAdjustments.Unit[1].Adjust[4].Map(),			// M-axis - Adjustment 4
	bit7		:= CassetteAdjustments.Unit[1].Adjust[5].Map(),			// M-axis - Adjustment 5
	bit8		:= CassetteAdjustments.Unit[1].Adjust[6].Map(),			// M-axis - Adjustment 6
);

OutputControl[IQSlices.DQ_32](
	sliceNumber	:= IQSlices.DQ_32,
	slice		:= DQ_32,
	bit1		:= CassetteAdjustments.Unit[1].Enable[1].Map(),			// M-axis - Enable 1/2
	bit2		:= CassetteAdjustments.Unit[1].Enable[2].Map(),			// M-axis - Enable 3/4
	bit3		:= CassetteAdjustments.Unit[1].Enable[3].Map(),			// M-axis - Enable 5/6
	bit4		:= CassetteAdjustments.Unit[1].Enable[4].Map(),			// M-axis - Enable 7/8
	bit5		:= CassetteAdjustments.Unit[1].Enable[5].Map(),			// M-axis - Enable 9/10
	bit6		:= CassetteAdjustments.Unit[1].Enable[6].Map(),			// M-axis - Enable 11/12
	bit7		:= CassetteAdjustments.Unit[1].Enable[7].Map(),			// M-axis - Enable 13/14
	bit8		:= CassetteAdjustments.Unit[1].Enable[8].Map(),			// M-axis - Enable 15/16
);

OutputControl[IQSlices.DQ_33](
	sliceNumber	:= IQSlices.DQ_33,
	slice		:= DQ_33,
	bit1		:= LabelSuppliers.Unit[1].BrakeLabel[2].Map(),			// M-axis - Release brake label 2
	bit2		:= SER.GateMAxis.MapGate(),								// M-axis - Gate cylinder
	bit3		:= LabelSuppliers.Unit[1].LockPins.MapIn(),				// M-axis - Lock pins IN (bottom pos.)
	bit4		:= LabelSuppliers.Unit[1].LockPins.MapOut(),			// M-axis - Lock pins OUT (drawer locked)
	bit5		:= LabelSuppliers.Unit[1].BrakeLabel[1].Map(),			// M-axis - Release brake label 1
	bit6		:= ,
	bit7		:= ,
	bit8		:= ,
);

OutputControl[IQSlices.DQ_34](
	sliceNumber	:= IQSlices.DQ_34,
	slice		:= DQ_34,
	bit1		:= Magazines.Unit[1].Vacuum[1].Map(),				// M-axis - Vacuum 1
	bit2		:= Magazines.Unit[1].Vacuum[2].Map(),				// M-axis - Vacuum 2
	bit3		:= Magazines.Unit[1].Vacuum[3].Map(),				// M-axis - Vacuum 3
	bit4		:= Magazines.Unit[1].Vacuum[4].Map(),				// M-axis - Vacuum 4
	bit5		:= Magazines.Unit[1].Vacuum[5].Map(),				// M-axis - Vacuum 5
	bit6		:= Magazines.Unit[1].Vacuum[6].Map(),				// M-axis - Vacuum 6
	bit7		:= Magazines.Unit[1].VacuumAdditional[1].Map(),		// M-axis - Vacuum additional 1
	bit8		:= Magazines.Unit[1].VacuumAdditional[2].Map(),		// M-axis - Vacuum additional 2
);

OutputControl[IQSlices.DQ_35](
	sliceNumber	:= IQSlices.DQ_35,
	slice		:= DQ_35,
	bit1		:= Magazines.Unit[1].BufferAir.Map(),				// M-axis - Buffer air
	bit2		:= Magazines.Unit[1].FlipLabel.MapIn(),				// M-axis - Flip 1 IN (take out label pos)
	bit3		:= Magazines.Unit[1].FlipLabel.MapOut(),			// M-axis - Flip 1 OUT (take over label pos)
	bit4		:= ,
	bit5		:= ,
	bit6		:= ,
	bit7		:= ,
	bit8		:= ,
);

OutputControl[IQSlices.DQ_36](
	sliceNumber	:= IQSlices.DQ_36,
	slice		:= DQ_36,
	bit1		:= LabelSuppliers.Unit[1].DrawerChangeCylinder.MapIn(),		// M-axis - Change drawer IN (upper drawer take label pos.)
	bit2		:= LabelSuppliers.Unit[1].DrawerChangeCylinder.MapOut(),	// M-axis - Change drawer OUT (lower drawer take label pos.)
	bit3		:= LabelSuppliers.Unit[1].UnlockChangeDrawer.Map(),			// General - Unlock change drawer cylinder
	bit4		:= ,
	bit5		:= ,
	bit6		:= ,
	bit7		:= ,
	bit8		:= Magazines.Unit[1].IonizingBar.Map(),			// M-axis - Ionisation
);
END_ACTION

ACTION G4_Mapping
InputControl[IQSlices.DI_40](
	sliceNumber	:= IQSlices.DI_40,
	slice		:= DI_40,
	bit1		=> SER.GateZAxis.ButtonUnLock.buttonInput,					// General - Open gate Z button
	bit2		=> SER.GateSTG.ButtonUnLock.buttonInput,					// General - Open gate STG button
	bit3		=> SER.CombinedAcknowledgeZAxis.buttonInput,				// General - Acknowledgement gate button
	bit4		=> ProcessModules.ConveyorControl.ButtonStartNewStack.buttonInput,	// Z-axis - Start new stack button
	bit5		=> ProcessModules.XYControl[1].ButtonSampleShot.buttonInput,// Camera - Sample shot button
	bit6		=> ,
	bit7		=> ZUnits.Unit[1].ButtonReleaseBrake.buttonInput,			// Z-axis - Release brake Z-axis button
	bit8		=> ZRUnits.Unit[1].ButtonReleaseBrake.buttonInput,
);

InputControl[IQSlices.DI_41](
	sliceNumber	:= IQSlices.DI_41,
	slice		:= DI_41,
	bit1		=> ZUnits.Unit[1].Vacuum[1,1].input1,						// Z-axis - Vacuum 1 (lowest) (IMM side)
	bit2		=> ZUnits.Unit[1].Vacuum[1,2].input1,						// Z-axis - Vacuum 2
	bit3		=> ZUnits.Unit[1].Vacuum[1,3].input1,						// Z-axis - Vacuum 3
	bit4		=> ZUnits.Unit[1].Vacuum[1,4].input1,						// Z-axis - Vacuum 4
	bit5		=> ZUnits.Unit[1].Vacuum[1,5].input1,						// Z-axis - Vacuum 5
	bit6		=> ZUnits.Unit[1].Vacuum[1,6].input1,						// Z-axis - Vacuum 6
	bit7		=> ZUnits.Unit[1].Vacuum[2,1].input1,						// Z-axis - Vacuum 7 (lowest) (robot side)
	bit8		=> ZUnits.Unit[1].Vacuum[2,2].input1,						// Z-axis - Vacuum 8
);

InputControl[IQSlices.DI_42](
	sliceNumber	:= IQSlices.DI_42,
	slice		:= DI_42,
	bit1		=> ZUnits.Unit[1].Vacuum[2,3].input1,						// Z-axis - Vacuum 9
	bit2		=> ZUnits.Unit[1].Vacuum[2,4].input1,						// Z-axis - Vacuum 10
	bit3		=> ZUnits.Unit[1].Vacuum[2,5].input1,						// Z-axis - Vacuum 11
	bit4		=> ZUnits.Unit[1].Vacuum[2,6].input1,						// Z-axis - Vacuum 12
	bit5		=> ZUnits.Unit[1].extendSensorIn[1],						// Z-axis - Extend 1-6 IN
	bit6		=> ZUnits.Unit[1].extendSensorIn[2],						// Z-axis - Extend 7-12 IN
	bit7		=> ZUnits.Unit[1].Shift.inputIn,							// Z-axis - Shift IN (first takeover pos.)
	bit8		=> ZUnits.Unit[1].Shift.inputOut,							// Z-axis - Shift OUT (stacking pos.)
);

InputControl[IQSlices.DI_43](
	sliceNumber	:= IQSlices.DI_43,
	slice		:= DI_43,
	bit1		=> Chains.Unit[1].OpenProductCarrierXu[1].inputIn,			// C1-axis - Product carrier 1 IN (product clamped) (TOG side) (upper cylinder)
	bit2		=> Chains.Unit[1].OpenProductCarrierXu[1].inputOut,			// C1-axis - Product carrier 1 OUT (take over pos.) (TOG side) (upper cylinder)
	bit3		=> Chains.Unit[1].OpenProductCarrierXu[2].inputIn,			// C1-axis - Product carrier 2 IN (product clamped) (TOG side)
	bit4		=> Chains.Unit[1].OpenProductCarrierXu[2].inputOut,			// C1-axis - Product carrier 2 OUT (take over pos.) (TOG side)
	bit5		=> Chains.Unit[1].OpenProductCarrierXu[3].inputIn,			// C1-axis - Product carrier 3 IN (product clamped) (TOG side)
	bit6		=> Chains.Unit[1].OpenProductCarrierXu[3].inputOut,			// C1-axis - Product carrier 3 OUT (take over pos.) (TOG side)
	bit7		=> Chains.Unit[1].OpenProductCarrierXu[4].inputIn,			// C1-axis - Product carrier 4 IN (product clamped) (TOG side)
	bit8		=> Chains.Unit[1].OpenProductCarrierXu[4].inputOut,			// C1-axis - Product carrier 4 OUT (take over pos.) (TOG side)
);

InputControl[IQSlices.DI_44](
	sliceNumber	:= IQSlices.DI_44,
	slice		:= DI_44,
	bit1		=> Chains.Unit[1].OpenProductCarrierXu[5].inputIn,			// C1-axis - Product carrier 5 IN (product clamped) (TOG side)
	bit2		=> Chains.Unit[1].OpenProductCarrierXu[5].inputOut,			// C1-axis - Product carrier 5 OUT (take over pos.) (TOG side)
	bit3		=> Chains.Unit[1].OpenProductCarrierXu[6].inputIn,			// C1-axis - Product carrier 6 IN (product clamped) (TOG side) (lower cylinder)
	bit4		=> Chains.Unit[1].OpenProductCarrierXu[6].inputOut,			// C1-axis - Product carrier 6 OUT (take over pos.) (TOG side) (lower cylinder)
	bit5		=> Chains.Unit[1].OpenProductCarrierZ[2].inputIn,			// C1-axis - Product carrier 1 IN (product clamped) (STG side) (upper cylinder)
	bit6		=> Chains.Unit[1].OpenProductCarrierZ[3].inputIn,			// C1-axis - Product carrier 2 IN (product clamped) (STG side)
	bit7		=> Chains.Unit[1].OpenProductCarrierZ[4].inputIn,			// C1-axis - Product carrier 3 IN (product clamped) (STG side)
	bit8		=> Chains.Unit[1].OpenProductCarrierZ[5].inputIn,			// C1-axis - Product carrier 4 IN (product clamped) (STG side)
);

InputControl[IQSlices.DI_45](
	sliceNumber	:= IQSlices.DI_45,
	slice		:= DI_45,
	bit1		=> Chains.Unit[1].OpenProductCarrierZ[6].inputIn,			// C1-axis - Product carrier 5 IN (product clamped) (STG side)
	bit2		=> Chains.Unit[1].OpenProductCarrierZ[7].inputIn,			// C1-axis - Product carrier 6 IN (product clamped) (STG side)
	bit3		=> Chains.Unit[1].OpenProductCarrierZ[8].inputIn,			// C1-axis - Product carrier 7 IN (product clamped) (STG side)
	bit4		=> Chains.Unit[1].OpenProductCarrierZ[9].inputIn,			// C1-axis - Product carrier 8 IN (product clamped) (STG side)
	bit5		=> Chains.Unit[1].OpenProductCarrierReject[1].inputIn,		// C1-axis - Product carrier reject IN (product not rejected)
	bit6		=> Chains.Unit[1].ChainFree.sensorInput,					// C1-axis - Product on reject pos.
	bit7		=> Chains.Unit[1].OpenProductCarrierZ[1].inputIn,			// C1-axis - Product carrier 1 IN (product clamped) (STG side) (upper cylinder)
	bit8		=> RejectStations.Unit[1].AreaFree.sensorInput,				// Conveyor - Reject area free
);

OutputControl[IQSlices.DQ_40](
	sliceNumber	:= IQSlices.DQ_40,
	slice		:= DQ_40,
	bit1		:= SER.GateZAxis.ButtonUnLock.Map(),						// General - LED open gate Z button
	bit2		:= SER.GateSTG.ButtonUnLock.Map(),							// General - LED open gate STG button
	bit3		:= SER.CombinedAcknowledgeZAxis.Map(),						// General - LED acknowledgement gate button
	bit4		:= ,
	bit5		:= ,
	bit6		:= SER.Stacklight.Green.Map(),								// General - Signallight system on
	bit7		:= SER.Stacklight.Amber.Map(),								// General - Signallight warning
	bit8		:= SER.Stacklight.Red.Map(),								// General - Signallight alarm active
);

OutputControl[IQSlices.DQ_41](
	sliceNumber	:= IQSlices.DQ_41,
	slice		:= DQ_41,
	bit1		:= ZUnits.Unit[1].Vacuum[1,1].Map(),						// Z-axis - Vacuum 1 (IMM side) (lowest)
	bit2		:= ZUnits.Unit[1].Vacuum[1,2].Map(),						// Z-axis - Vacuum 2 (IMM side)
	bit3		:= ZUnits.Unit[1].Vacuum[1,3].Map(),						// Z-axis - Vacuum 3 (IMM side)
	bit4		:= ZUnits.Unit[1].Vacuum[1,4].Map(),						// Z-axis - Vacuum 4 (IMM side)
	bit5		:= ZUnits.Unit[1].Vacuum[1,5].Map(),						// Z-axis - Vacuum 5 (IMM side)
	bit6		:= ZUnits.Unit[1].Vacuum[1,6].Map(),						// Z-axis - Vacuum 6 (IMM side) (upper)
	bit7		:= ZUnits.Unit[1].Vacuum[2,1].Map(),						// Z-axis - Vacuum 7 (robot side) (lowest)
	bit8		:= ZUnits.Unit[1].Vacuum[2,2].Map(),						// Z-axis - Vacuum 8 (robot side)
);

OutputControl[IQSlices.DQ_42](
	sliceNumber	:= IQSlices.DQ_42,
	slice		:= DQ_42,
	bit1		:= ZUnits.Unit[1].Vacuum[2,3].Map(),					// Z-axis - Vacuum 9 (robot side)
	bit2		:= ZUnits.Unit[1].Vacuum[2,4].Map(),					// Z-axis - Vacuum 10 (robot side)
	bit3		:= ZUnits.Unit[1].Vacuum[2,5].Map(),					// Z-axis - Vacuum 11 (robot side)
	bit4		:= ZUnits.Unit[1].Vacuum[2,6].Map(),					// Z-axis - Vacuum 12 (robot side) (upper)
	bit5		:= ,
	bit6		:= Chains.Unit[1].OpenProductCarrierZ[1].Map(),			// C1-axis - Product carrier 1 (STG side) (lower cylinder) (normal clamped)
	bit7		:= ZUnits.Unit[1].IonizingBar.Map(),					// Z-axis - Ionisation
	bit8		:= SER.GateZAxis.MapGate(),								// Z-axis - Gate cylinder
);

OutputControl[IQSlices.DQ_43](
	sliceNumber	:= IQSlices.DQ_43,
	slice		:= DQ_43,
	bit1		:= ZUnits.Unit[1].Shift.MapIn(),						// Z-axis - Shift IN (first takeover pos.) (cav 7-12)
	bit2		:= ZUnits.Unit[1].Shift.MapOut(),						// Z-axis - Shift OUT (stacking pos.)
	bit3		:= ZUnits.Unit[1].Extend[1,1].Map(),					// Z-axis - Extend 1 (IMM side) (lowest)
	bit4		:= ZUnits.Unit[1].Extend[1,2].Map(),					// Z-axis - Extend 2 (IMM side)
	bit5		:= ZUnits.Unit[1].Extend[1,3].Map(),					// Z-axis - Extend 3 (IMM side)
	bit6		:= ZUnits.Unit[1].Extend[1,4].Map(),					// Z-axis - Extend 4 (IMM side)
	bit7		:= ZUnits.Unit[1].Extend[1,5].Map(),					// Z-axis - Extend 5 (IMM side)
	bit8		:= ZUnits.Unit[1].Extend[1,6].Map(),					// Z-axis - Extend 6 (IMM side) (upper)
);

OutputControl[IQSlices.DQ_44](
	sliceNumber	:= IQSlices.DQ_44,
	slice		:= DQ_44,
	bit1		:= ZUnits.Unit[1].Extend[2,1].Map(),					// Z-axis - Extend 7 (robot side) (lowest)
	bit2		:= ZUnits.Unit[1].Extend[2,2].Map(),					// Z-axis - Extend 8 (robot side)
	bit3		:= ZUnits.Unit[1].Extend[2,3].Map(),					// Z-axis - Extend 9 (robot side)
	bit4		:= ZUnits.Unit[1].Extend[2,4].Map(),					// Z-axis - Extend 10 (robot side)
	bit5		:= ZUnits.Unit[1].Extend[2,5].Map(),					// Z-axis - Extend 11 (robot side)
	bit6		:= ZUnits.Unit[1].Extend[2,6].Map(),					// Z-axis - Extend 12 (robot side) (upper)
	bit7		:= ZUnits.Unit[1].BufferAir.Map(),						// Z-axis - Buffer air
	bit8		:= ,
);

OutputControl[IQSlices.DQ_45](
	sliceNumber	:= IQSlices.DQ_45,
	slice		:= DQ_45,
	bit1		:= Chains.Unit[1].OpenProductCarrierXu[1].Map(),		// C1-axis - Product carrier 1 (TOG side) (upper cylinder) (normal clamped)
	bit2		:= Chains.Unit[1].OpenProductCarrierXu[2].Map(),		// C1-axis - Product carrier 2 (TOG side) (normal clamped)
	bit3		:= Chains.Unit[1].OpenProductCarrierXu[3].Map(),		// C1-axis - Product carrier 3 (TOG side) (normal clamped)
	bit4		:= Chains.Unit[1].OpenProductCarrierXu[4].Map(),		// C1-axis - Product carrier 4 (TOG side) (normal clamped)
	bit5		:= Chains.Unit[1].OpenProductCarrierXu[5].Map(),		// C1-axis - Product carrier 5 (TOG side) (normal clamped)
	bit6		:= Chains.Unit[1].OpenProductCarrierXu[6].Map(),		// C1-axis - Product carrier 6 (TOG side) (lower cylinder) (normal clamped)
	bit7		:= Chains.Unit[1].OpenProductCarrierZ[2].Map(),			// C1-axis - Product carrier 2 (STG side) (normal clamped)
	bit8		:= Chains.Unit[1].OpenProductCarrierZ[3].Map(),			// C1-axis - Product carrier 3 (STG side) (normal clamped)
);

OutputControl[IQSlices.DQ_46](
	sliceNumber	:= IQSlices.DQ_46,
	slice		:= DQ_46,
	bit1		:= Chains.Unit[1].OpenProductCarrierZ[4].Map(),			// C1-axis - Product carrier 3 (STG side) (normal clamped)
	bit2		:= Chains.Unit[1].OpenProductCarrierZ[5].Map(),			// C1-axis - Product carrier 4 (STG side) (normal clamped)
	bit3		:= Chains.Unit[1].OpenProductCarrierZ[6].Map(),			// C1-axis - Product carrier 5 (STG side) (normal clamped)
	bit4		:= Chains.Unit[1].OpenProductCarrierZ[7].Map(),			// C1-axis - Product carrier 6 (STG side) (normal clamped)
	bit5		:= Chains.Unit[1].OpenProductCarrierZ[8].Map(),			// C1-axis - Product carrier 7 (STG side) (normal clamped)
	bit6		:= Chains.Unit[1].OpenProductCarrierZ[9].Map(),			// C1-axis - Product carrier 8 (STG side) (lower cylinder) (normal clamped)
	bit7		:= Chains.Unit[1].OpenProductCarrierReject[1].Map(),	// C1-axis - Product carrier reject (normal retracted)
	bit8		:= RejectStations.Unit[1].BlowOff.Map(),				// C1-axis - Blow off products (reject)
);
END_ACTION

ACTION G5_Mapping
InputControl[IQSlices.DI_50](
	sliceNumber	:= IQSlices.DI_50,
	slice		:= DI_50,
	bit1		=> BFU.GateBFU.ButtonUnLock.buttonInput,						// General - Open gate button
	bit2		=> BFU.GateBFU.ButtonLock.buttonInput,							// General - Acknowledgement gate button
	bit3		=> ProcessModules.BoxFillControl.ButtonStartNewBox.buttonInput,	// General - Start new box button
	bit4		=> PNOZMulti2.ButtonResetSafetyMat.buttonInput,					// General - Reset safety mat button
	bit5		=> BfuButtons.StartCycle.buttonInput,							// General - Start button
	bit6		=> BfuButtons.EndCycle.buttonInput,								// General - Stop button
	bit7		=> BfuButtons.Reset.buttonInput,								// General - Reset button
	bit8		=> BfuButtons.EmptyBFU.buttonInput,								// General - Empty button
);

InputControl[IQSlices.DI_51](
	sliceNumber	:= IQSlices.DI_51,
	slice		:= DI_51,
	bit1		=> BoxCenterUnits.Unit[1].OpenBoxLongSideIn[1],					// Box centering unit - Open box long side 1 IN (front side)
	bit2		=> BoxCenterUnits.Unit[1].OpenBoxLongSideOut[1],				// Box centering unit - Open box long side 1 OUT (box open) (front side)
	bit3		=> BoxCenterUnits.Unit[1].OpenBoxLongSideIn[2],					// Box centering unit - Open box long side 2 IN (back side)
	bit4		=> BoxCenterUnits.Unit[1].OpenBoxLongSideOut[2],				// Box centering unit - Open box long side 2 OUT (box open) (back side)
	bit5		=> BoxCenterUnits.Unit[1].OpenBoxShortSideIn[1],				// Box centering unit - Open box short side 1 IN (left side)
	bit6		=> BoxCenterUnits.Unit[1].OpenBoxShortSideOut[1],				// Box centering unit - Open box short side 1 OUT (box open) (left side)
	bit7		=> BoxCenterUnits.Unit[1].OpenBoxShortSideIn[2],				// Box centering unit - Open box short side 2 IN (right side)
	bit8		=> BoxCenterUnits.Unit[1].OpenBoxShortSideOut[2],				// Box centering unit - Open box short side 2 OUT (box open) (right side)
);

InputControl[IQSlices.DI_52](
	sliceNumber	:= IQSlices.DI_52,
	slice		:= DI_52,
	bit1		=> BoxCenterUnits.Unit[1].Lift.inputIn,							// Box centering unit - Lift IN (up)
	bit2		=> BoxCenterUnits.Unit[1].Lift.inputOut,						// Box centering unit - Lift OUT (down)
	bit3		=> Conveyors.UnitReject[1].AreaFree.sensorInput,				// Reject conveyor - Stacking area free
	bit4		=> BoxInfeeds.Unit[1].sensorLiftIn[1],							// Box input conveyor - Lift box 1 IN (down)
	bit5		=> BoxInfeeds.Unit[1].sensorLiftIn[2],							// Box input conveyor - Lift box 2 IN (down)
	bit6		=> BoxInfeeds.Unit[1].clampSecondBoxIn[1],						// Box input conveyor - Stopper 1 IN (box free) (IMM side)
	bit7		=> BoxInfeeds.Unit[1].clampSecondBoxIn[2],						// Box input conveyor - Stopper 2 IN (box free) (IMM side)
	bit8		=> BoxInfeeds.Unit[1].SecondBoxDetection.sensorInput,			// Box input conveyor - Second box detection
);

InputControl[IQSlices.DI_53](
	sliceNumber	:= IQSlices.DI_53,
	slice		:= DI_53,
	bit1		=> BoxOutfeeds.Unit[1].BoxOutputConveyorFull.sensorInput,			// Box output conveyor - Box output conveyor full
	bit2		=> ProcessModules.BoxOutfeedControl.ButtonStartConveyor.buttonInput,// Box output conveyor - Start box output conveyor button
	bit3		=> ,
	bit4		=> ,
	bit5		=> BoxPushers.Unit[1].Pusher.inputIn,								// Pusher - Pusher IN (box infeed side)
	bit6		=> BoxPushers.Unit[1].Pusher.inputOut,								// Pusher - Pusher OUT
	bit7		=> BoxCenterUnits.Unit[1].sensorBoxInFillPosition.sensorInput,		// Pusher - Box in fill position
	bit8		=> BoxPushers.Unit[1].sensorBoxAtOutfeedPosition.sensorInput,		// Pusher - Pusher area free
);

InputControl[IQSlices.DI_54](
	sliceNumber	:= IQSlices.DI_54,
	slice		:= DI_54,
	bit1		=> BufferRacks.Unit[1].StackDetection.sensorInput,			// Stack unit - Product clear sensor
	bit2		=> ,
	bit3		=> ,
	bit4		=> ,
	bit5		=> ,
	bit6		=> ,
	bit7		=> ,
	bit8		=> BFU.DigIn.xAirPressureOK,								// General - Main airvalve BFU - air pressure OK
);

OutputControl[IQSlices.DQ_50](
	sliceNumber	:= IQSlices.DQ_50,
	slice		:= DQ_50,
	bit1		:= BFU.GateBFU.ButtonUnLock.Map(),							// General - LED open gate button
	bit2		:= BFU.GateBFU.ButtonLock.Map(),							// General - LED acknowledgement button
	bit3		:= PNOZMulti2.ButtonResetSafetyMat.Map(),					// General - LED reset safety mat button
	bit4		:= BfuButtons.StartCycle.Map(),								// General - LED start button
	bit5		:= BfuButtons.Reset.Map(),									// General - LED reset button
	bit6		:= ,
	bit7		:= ,
	bit8		:= ,
);

OutputControl[IQSlices.DQ_51](
	sliceNumber	:= IQSlices.DQ_51,
	slice		:= DQ_51,
	bit1		:= BFU.WorkingLights.Map(),										// General - Work light
	bit2		:= ProcessModules.BoxOutfeedControl.ButtonStartConveyor.Map(),	// Box output conveyor - LED start box output conveyor button
	bit3		:= ,
	bit4		:= ,
	bit5		:= ,
	bit6		:= BFU.Stacklight.Green.Map(),								// General - Signallight system on
	bit7		:= BFU.Stacklight.Amber.Map(),								// General - Signallight warning
	bit8		:= BFU.Stacklight.Red.Map(),								// General - Signallight alarm active
);

OutputControl[IQSlices.DQ_52](
	sliceNumber	:= IQSlices.DQ_52,
	slice		:= DQ_52,
	bit1		:= BoxInfeeds.Unit[1].Lift.MapIn(),							// Box input conveyor - Lift box IN (down)
	bit2		:= BoxInfeeds.Unit[1].Lift.MapOut(),						// Box input conveyor - Lift box OUT (up)
	bit3		:= BoxCenterUnits.Unit[1].OpenBoxLongSide.MapIn(),			// Box centering unit - Open box long side IN (front, back side)
	bit4		:= BoxCenterUnits.Unit[1].OpenBoxLongSide.MapOut(),			// Box centering unit - Open box long side OUT (box open)
	bit5		:= BoxCenterUnits.Unit[1].OpenBoxShortSide.MapIn(),			// Box centering unit - Open box short side IN (left, right side)
	bit6		:= BoxCenterUnits.Unit[1].OpenBoxShortSide.MapOut(),		// Box centering unit - Open box short side OUT (box open)
	bit7		:= BoxInfeeds.Unit[1].ClampSecondBox.Map(),					// Box input conveyor - Box stop
	bit8		:= ,
);

OutputControl[IQSlices.DQ_53](
	sliceNumber	:= IQSlices.DQ_53,
	slice		:= DQ_53,
	bit1		:= BoxCenterUnits.Unit[1].Lift.MapIn(),						// Box centering unit - Lift IN (up)
	bit2		:= BoxCenterUnits.Unit[1].Lift.MapOut(),					// Box centering unit - Lift OUT (down)
	bit3		:= BoxPushers.Unit[1].Pusher.MapIn(),						// Pusher - Pusher IN (infeed pos.)
	bit4		:= BoxPushers.Unit[1].Pusher.MapOut(),						// Pusher - Pusher OUT
	bit5		:= BoxPushers.Unit[1].UnlockPusher.Map(),					// Pusher - Assistance pusher cylinder
	bit6		:= ,
	bit7		:= ,
	bit8		:= ,
);

OutputControl[IQSlices.DQ_54](
	sliceNumber	:= IQSlices.DQ_54,
	slice		:= DQ_54,
	bit1		:= BFU.MainAirValve.Map(),									// General - Main airvalve BFU
	bit2		:= ,
);
END_ACTION
