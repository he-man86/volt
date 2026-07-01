{attribute 'symbol' := 'readwrite'}
PROGRAM ProcessModules
VAR
	{attribute 'symbol' := 'none'}	i							: USINT;
	{attribute 'symbol' := 'none'}	ForwardSeverity				: L_IE1P.L_IE1P_ForwardSeverity;	// Forward alarms of children to parent
	{attribute 'symbol' := 'none'}	ForwardSeverityBfu			: L_IE1P.L_IE1P_ForwardSeverity;	// Forward alarms of children to parent
	{attribute 'symbol' := 'none'}	ModuleHandler				: L_IMHP.L_IMHP_ModuleHandler :=
									(
										CompName				:= 'Process Units',
										Layer					:= L_IMHP_Layer.Process_Control,
										CompType				:= L_IMHP_ComponentType.GeneralMachineModule
									);
	{attribute 'symbol' := 'none'}	ModuleHandlerBfu			: L_IMHP.L_IMHP_ModuleHandler :=
									(
										CompName				:= 'Process Units',
										Layer					:= L_IMHP_Layer.Process_Control,
										CompType				:= L_IMHP_ComponentType.GeneralMachineModule
									);
END_VAR
VAR_INPUT
	XYControl					: ARRAY[1..numberOfXYControls] OF XYControlFB
	[
		(
			instanceNo				:= 1,
			moduleManager			:= GlobalVars.fbModuleManager,
			moduleParent			:= ModuleHandler,
		)
	];

	PlaceLabelsInMould			: ARRAY[1..numberOfXYControls] OF PlaceLabelsInMouldFB
	[
		(
			instanceNo				:= 1,
			moduleManager			:= GlobalVars.fbModuleManager,
			moduleParent			:= ModuleHandler,
		)
	];

	TakeoutFromMould			: ARRAY[1..numberOfXYControls] OF TakeoutFromMouldFB
	[
		(
			instanceNo				:= 1,
			moduleManager			:= GlobalVars.fbModuleManager,
			moduleParent			:= ModuleHandler,
		)
	];

	LabelSupply					: ARRAY[1..numberOfXYControls] OF LabelSupplyDrawerFB
	[
		(
			instanceNo				:= 1,
			moduleManager			:= GlobalVars.fbModuleManager,
			moduleParent			:= ModuleHandler,
		)
	];

	DrawerControl				: ARRAY[1..numberOfXYControls] OF DrawerControlFB
	[
		(
			instanceNo				:= 1,
			moduleManager			:= GlobalVars.fbModuleManager,
			moduleParent			:= ModuleHandler,
		)
	];

	{attribute 'symbol' := 'readwrite'}
	TransferLabels				: ARRAY[1..numberOfXYControls] OF TransferLabelsFB
	[
		(
			instanceNo				:= 1,
			moduleManager			:= GlobalVars.fbModuleManager,
			moduleParent			:= ModuleHandler,
		)
	];

	TransferProducts_XuToChain	: ARRAY[1..numberOfXYControls] OF TransferProducts_XuToChain_WithCarrierPlatesFB
	[
		(
			instanceNo				:= 1,
			moduleManager			:= GlobalVars.fbModuleManager,
			moduleParent			:= ModuleHandler,
		)
	];

	TransferProducts_XuToShute	: ARRAY[1..numberOfXYControls] OF TransferProducts_XuToShuteFB
	[
		(
			instanceNo				:= 1,
			moduleManager			:= GlobalVars.fbModuleManager,
			moduleParent			:= ModuleHandler,
		)
	];

	ChainControl				: ChainControlFB
	(
		instanceNo					:= 1,
		moduleManager				:= GlobalVars.fbModuleManager,
		moduleParent				:= ModuleHandler,
	);

	TransferProductsChainToZ	: TransferProducts_ChainToZ_WithCarrierPlatesFB
	(
		instanceNo					:= 1,
		moduleManager				:= GlobalVars.fbModuleManager,
		moduleParent				:= ModuleHandler,
	);

	TransferRejects				: TransferProducts_ChainToReject_WithCarrierPlatesFB
	(
		instanceNo					:= 1,
		moduleManager				:= GlobalVars.fbModuleManager,
		moduleParent				:= ModuleHandler,
	);

	StackingControl				: StackingControlFB
	(
		instanceNo					:= 1,
		moduleManager				:= GlobalVars.fbModuleManager,
		moduleParent				:= ModuleHandler,
	);

	ConveyorControl				: ConveyorControlFB
	(
		instanceNo					:= 1,
		moduleManager				:= GlobalVars.fbModuleManager,
		moduleParent				:= ModuleHandler,
	);


	BfuPickControl				: BfuPickControlFB
	(
		instanceNo					:= 1,
		moduleManager				:= GlobalVars_BFU.fbModuleManager,
		moduleParent				:= ModuleHandlerBfu,
	);

	BfuStackUponBufferControl	: BfuStackUponBufferControlFB
	(
		instanceNo					:= 1,
		moduleManager				:= GlobalVars_BFU.fbModuleManager,
		moduleParent				:= ModuleHandlerBfu,
	);

	BfuPickFromBufferControl	: BfuPickStackFromBufferControlFB
	(
		instanceNo					:= 1,
		moduleManager				:= GlobalVars_BFU.fbModuleManager,
		moduleParent				:= ModuleHandlerBfu,
	);

	BfuPlaceControl				: BfuPlaceControlFB
	(
		instanceNo					:= 1,
		moduleManager				:= GlobalVars_BFU.fbModuleManager,
		moduleParent				:= ModuleHandlerBfu,
	);

	BfuRejectControl			: BfuRejectControlFB
	(
		instanceNo					:= 1,
		moduleManager				:= GlobalVars_BFU.fbModuleManager,
		moduleParent				:= ModuleHandlerBfu,
	);

	BoxFillControl				: BoxFillControlFB
	(
		instanceNo					:= 1,
		moduleManager				:= GlobalVars_BFU.fbModuleManager,
		moduleParent				:= ModuleHandlerBfu,
	);

	BoxOutfeedControl			: BoxOutfeedControlFB
	(
		instanceNo					:= 1,
		moduleManager				:= GlobalVars_BFU.fbModuleManager,
		moduleParent				:= ModuleHandlerBfu,
	);

END_VAR
VAR RETAIN PERSISTENT
	XYControlData				: ARRAY[1..ProcessModules.numberOfXYControls] OF XYControl_Data;
END_VAR

VAR CONSTANT
	{attribute 'symbol' := 'none'}	numberOfXYControls		: USINT := 1;	// Number of complete Y/X Units (2 in case of stack moulds)
END_VAR

IF NOT Initialize() THEN
	RETURN;
END_IF

FOR i := 1 TO numberOfXYControls DO
	XYControl[i](					// XYControlFB
		Data						:= XYControlData[1],
		IMM							:= InjectionMouldingMachine.Unit,
		yUnit						:= YUnits.Unit[1],
		xiUnit						:= XiUnits.Unit[1],
		xuUnit						:= XuUnits.Unit[1],
		placeLabelsInMould			:= PlaceLabelsInMould[1],
		takeoutFromMould			:= TakeoutFromMould[1],
		transferLabels				:= TransferLabels[1],
		transferProducts			:= TransferProducts_XuToChain[1],
		transferToRejectShute		:= TransferProducts_XuToShute[1],
	);
	PlaceLabelsInMould[i](			// PlaceLabelsInMouldFB
		xiUnit						:= XiUnits.Unit[1],
	);
	TakeoutFromMould[i](			// TakeoutFromMouldFB
		xuUnit						:= XuUnits.Unit[1],
	);
	LabelSupply[i](					// LabelSupplyDrawerFB
		drawerMagazine				:= LabelSuppliers.Unit[1],
		magazine					:= Magazines.Unit[1],
	);
	DrawerControl[i](				// DrawerControlFF
		drawerMagazine				:= LabelSuppliers.Unit[1],
	);
	TransferLabels[i](				// TransferLabelsFB
		magazine					:= Magazines.Unit[1],
		xiUnit						:= XiUnits.Unit[1],
	);
	TransferProducts_XuToChain[i](	// TransferProducts_XuToChainFB
		chain						:= Chains.Unit[1],
		xuUnit						:= XuUnits.Unit[1],
	);
	TransferProducts_XuToShute[i](	// TransferProducts_XuToShuteFB
		xuUnit						:= XuUnits.Unit[1],
		conveyor					:= RejectStations.Unit[1],
		statistics					:= SER.Statistics,
	);
END_FOR

ChainControl(						// ChainControlFB
	transferRejects					:= TransferRejects,
	transferProducts				:= TransferProductsChainToZ,
	chain							:= Chains.Unit[1],
	camera							:= VisionSystems.Unit[1],
	statistics						:= SER.Statistics,
	xuUnit							:= XuUnits.Unit[1],
);
TransferProductsChainToZ(			// TransferProducts_ChainToZFB
	chain							:= Chains.Unit[1],
	zUnit							:= ZUnits.Unit[1],
);
TransferRejects(					// TransferProducts_ChainToRejectFB
	chain							:= Chains.Unit[1],
	reject							:= RejectStations.Unit[1],
);
StackingControl(					// StackingControlFB
	zUnit							:= ZUnits.Unit[1],
	conveyor						:= Conveyors.Unit[1],
	statistics						:= 0,//SER.Statistics,	Chain counts stats
);
ConveyorControl(					// ConveyorControlFB
	conveyor						:= Conveyors.Unit[1],
	rejectConveyor					:= Conveyors.UnitReject[1],
);

BfuPickControl(						// BfuPickControlFB
	conveyor						:= Conveyors.Unit[1],
	fanuc							:= Fanucs.Unit[1],
	bufferRack						:= BufferRacks.Unit[1],
);
BfuStackUponBufferControl(			// BfuStackUponBufferControlFB
	fanuc							:= Fanucs.Unit[1],
	bufferRack						:= BufferRacks.Unit[1],
);
BfuPickFromBufferControl(			// BfuPickStackFromBufferControlFB
	fanuc							:= Fanucs.Unit[1],
	bufferRack						:= BufferRacks.Unit[1],
	boxCenterUnit					:= BoxCenterUnits.Unit[1],
);
BfuPlaceControl(					// BfuPlaceControlFB
	fanuc							:= Fanucs.Unit[1],
	boxCenterUnit					:= BoxCenterUnits.Unit[1],
);
BfuRejectControl(					// BfuRejectControlFB
	conveyor						:= Conveyors.UnitReject[1],
	fanuc							:= Fanucs.Unit[1],
);
BoxFillControl(						// BoxFillControlFB
	boxInfeed						:= BoxInfeeds.Unit[1],
	boxCenterUnit					:= BoxCenterUnits.Unit[1],
	boxPusher						:= BoxPushers.Unit[1],
);
BoxOutfeedControl(					// BoxOutfeedControlFB
	boxPusher						:= BoxPushers.Unit[1],
	boxOutfeed						:= BoxOutfeeds.Unit[1],
);


ForwardSeverity(
	xEnable						:= TRUE,
	ModuleHandler				:= ModuleHandler,
	xForwardFromChildModules	:= TRUE,
	xDisableForwardToParent		:= ,
	xBusy						=> ,
	xError						=> ,
	eErrorID					=> );
ForwardSeverityBfu(
	xEnable						:= TRUE,
	ModuleHandler				:= ModuleHandlerBfu,
	xForwardFromChildModules	:= TRUE,
	xDisableForwardToParent		:= ,
	xBusy						=> ,
	xError						=> ,
	eErrorID					=> );

END_PROGRAM

METHOD PRIVATE Initialize : BOOL
VAR_INST
	{attribute 'init_on_onlchange'}
	isInitialized	: BOOL;
END_VAR
IF isInitialized THEN
	Initialize	:= TRUE;
	RETURN;
END_IF

// Connect Lenze module handler to base module handler
ModuleHandler.SetParent(
				ModuleHandlerParent	:= GlobalVars.fbModuleManager.ModuleHandler,
				RelationShip		:= L_IMHP.L_IMHP_RelationshipID.ApplicationView);

ModuleHandlerBfu.SetParent(
				ModuleHandlerParent	:= GlobalVars_BFU.fbModuleManager.ModuleHandler,
				RelationShip		:= L_IMHP.L_IMHP_RelationshipID.ApplicationView);


isInitialized	:= TRUE;
Initialize		:= TRUE;
END_METHOD
