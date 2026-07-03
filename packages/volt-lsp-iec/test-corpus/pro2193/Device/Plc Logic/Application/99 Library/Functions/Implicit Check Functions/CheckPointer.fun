(* @volt-exclude-from-build *)
// Implicitly generated code : DO NOT EDIT
FUNCTION CheckPointer : POINTER TO BYTE
VAR_INPUT
	ptToTest	: POINTER TO BYTE;	// Destination address of the pointer
	iSize		: DINT;				// Size of the type the pointer points to. (e.g: 20 for POINTER TO ARRAY[0..9] OF INT)
	iGran		: DINT;				// Granularity of the pointer access. This is the size of the biggest non-structured data type in the type the pointer points to. (e.g: 2 for POINTER TO ARRAY[0..9] OF INT)
	bWrite		: BOOL;				// Indicates read or write access. TRUE = write access.
END_VAR

// No standard way of implementation. Fill your own code here
CheckPointer := ptToTest;



// THIS FUNCTION IS DISABLED BECAUSE WE DON'T USE IT.
// IT IS CALLED MANY MANY TIMES AND IT AFFECTS PERFORMANCE

END_FUNCTION
