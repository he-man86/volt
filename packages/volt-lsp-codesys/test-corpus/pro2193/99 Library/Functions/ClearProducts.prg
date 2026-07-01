// Helper functions to clear product (or stack) data
{attribute 'no_explicit_call' := 'Static helper class with methods to reset product data'}
{attribute 'hide_all_locals'}
PROGRAM ClearProducts
VAR
	upper, lower, i, j		: DINT;
END_VAR
VAR CONSTANT
	// Empty product struct that we use to override and initialize product data
	emptyProduct			: ProductType		:= (Present := FALSE);
	emptyStack				: StackStatusType	:= (Present := FALSE, Initialized := TRUE);
END_VAR

END_PROGRAM

// Clear an array of products
METHOD PUBLIC Array1D
VAR_IN_OUT
	aProducts			: ARRAY[*] OF ProductType;
END_VAR
lower	:= LOWER_BOUND(aProducts, 1);
upper	:= UPPER_BOUND(aProducts, 1);

FOR i := lower TO upper DO
	Single(aProducts[i]);
END_FOR
END_METHOD

// Clear a two-dimensional array of products
METHOD PUBLIC Array2D
VAR_IN_OUT
	aProducts			: ARRAY[*,*] OF ProductType;
END_VAR
lower	:= LOWER_BOUND(aProducts, 1);
upper	:= UPPER_BOUND(aProducts, 1);

FOR i := lower TO upper DO
	FOR j := LOWER_BOUND(aProducts, 2) TO UPPER_BOUND(aProducts, 2) DO
		Single(aProducts[i, j]);
	END_FOR
END_FOR
END_METHOD

// Clear all products in a (stack) mould
METHOD PUBLIC Mould
VAR_IN_OUT
	aProducts			: ARRAY[1..GVL_Constants.MaxMouldLevels] OF ARRAY[1..GVL_Constants.MaxProductsInX, 1..GVL_Constants.MaxProductsInY] OF ProductType;
END_VAR
VAR
	k					: DINT;
END_VAR
FOR k := 1 TO GVL_Constants.MaxMouldLevels DO
	Array2D(aProducts[k]);
END_FOR
END_METHOD

// Clear all data in a Product struct
METHOD PUBLIC Single
VAR_IN_OUT
	Product				: ProductType;
END_VAR
Product	:= emptyProduct;
END_METHOD

// Clear all data in a Stack struct
METHOD PUBLIC Stack
VAR_INPUT
	clearStack			: REFERENCE TO StackStatusType;
END_VAR
IF __ISVALIDREF(clearStack) THEN
	clearStack	:= emptyStack;
END_IF
END_METHOD

// Clear an array of stacks
METHOD PUBLIC StackArray1D
VAR_IN_OUT
	aStacks			: ARRAY[*] OF StackStatusType;
END_VAR
lower	:= LOWER_BOUND(aStacks, 1);
upper	:= UPPER_BOUND(aStacks, 1);

FOR i := lower TO upper DO
	Stack(aStacks[i]);
END_FOR
END_METHOD

// Clear a two-dimensional array of stacks
METHOD PUBLIC StackArray2D
VAR_IN_OUT
	aStacks			: ARRAY[*,*] OF StackStatusType;
END_VAR
lower	:= LOWER_BOUND(aStacks, 1);
upper	:= UPPER_BOUND(aStacks, 1);

FOR i := lower TO upper DO
	FOR j := LOWER_BOUND(aStacks, 2) TO UPPER_BOUND(aStacks, 2) DO
		Stack(aStacks[i, j]);
	END_FOR
END_FOR
END_METHOD
