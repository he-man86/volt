"""
Mirrors `packages/volt-bridges/beckhoff/BeckhoffBridge.Tests/StSplitterTests.cs`.

Cross-language ground truth: the Python splitter MUST produce results
that match the C# splitter on identical inputs. If a future change
diverges them, this catches it.

Run:  python -m unittest discover -s packages/volt-bridges/codesys/CodesysBridge.Tests
"""
# pyright: reportMissingImports=false
import os
import sys
import unittest

# Make the bridge importable when run from anywhere.
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, ".."))

from CodesysBridge.helpers import st_splitter  # noqa: E402


SIMPLE_FB = """\
FUNCTION_BLOCK FB_X
VAR
\tiLocal : INT;
END_VAR

iLocal := iLocal + 1;

END_FUNCTION_BLOCK
"""

FB_WITH_METHOD = """\
FUNCTION_BLOCK FB_X
VAR
\tiLocal : INT;
END_VAR

iLocal := 1;

END_FUNCTION_BLOCK

METHOD Compute : BOOL
VAR_INPUT
\tiDelta : INT;
END_VAR
iLocal := iLocal + iDelta;
Compute := TRUE;
END_METHOD
"""

FB_WITH_ACCESS_MODIFIERS = """\
FUNCTION_BLOCK FB_X
END_FUNCTION_BLOCK

METHOD PROTECTED FINAL Execute : BOOL
END_METHOD
"""

FB_WITH_ACTION = """\
FUNCTION_BLOCK FB_X
VAR
\tx : INT;
END_VAR
END_FUNCTION_BLOCK

ACTION DoIt
x := x + 1;
END_ACTION
"""

FB_WITH_PROPERTY = """\
FUNCTION_BLOCK FB_X
VAR
\tiBacking : INT;
END_VAR
END_FUNCTION_BLOCK

PROPERTY Value : INT
GET
Value := iBacking;
END_GET
SET
iBacking := Value;
END_SET
END_PROPERTY
"""

FB_WITH_PRAGMA_ABOVE_METHOD = """\
FUNCTION_BLOCK FB_X
END_FUNCTION_BLOCK

{attribute 'no_check'}
METHOD Sensitive
END_METHOD
"""

FB_WITH_FOLDER_ANNOTATION = """\
FUNCTION_BLOCK FB_X
END_FUNCTION_BLOCK

METHOD Compute : BOOL    (* folder: helpers *)
END_METHOD
"""

FB_WITHOUT_VAR = """\
FUNCTION_BLOCK FB_X
iCount := iCount + 1;
END_FUNCTION_BLOCK
"""

INTERFACE_WITH_METHOD = """\
INTERFACE ITF_X
METHOD Compute : BOOL
VAR_INPUT
\tiIn : INT;
END_VAR
END_METHOD
END_INTERFACE
"""

GVL_SOURCE = """\
{attribute 'qualified_only'}
VAR_GLOBAL
\tgVal : INT;
END_VAR
"""

DUT_STRUCT_SOURCE = """\
TYPE DUT_X :
STRUCT
\tx : INT;
\ty : INT;
END_STRUCT
END_TYPE
"""


class TestStSplitter(unittest.TestCase):

	def test_fb_with_only_var_section(self):
		r = st_splitter.split_st(SIMPLE_FB)
		self.assertEqual(r.pou_kind, "function_block")
		self.assertEqual(r.pou_name, "FB_X")
		self.assertIn("VAR", r.pou_declaration)
		self.assertIn("END_VAR", r.pou_declaration)
		self.assertIn("iLocal := iLocal + 1;", r.pou_implementation)
		self.assertEqual(len(r.children), 0)

	def test_fb_with_one_method(self):
		r = st_splitter.split_st(FB_WITH_METHOD)
		self.assertEqual(len(r.children), 1)
		m = r.children[0]
		self.assertEqual(m.kind, "method")
		self.assertEqual(m.name, "Compute")
		self.assertEqual(m.return_type, "BOOL")
		self.assertIn("VAR_INPUT", m.declaration)
		self.assertIn("iDelta : INT;", m.declaration)
		self.assertIn("END_VAR", m.declaration)
		self.assertIn("Compute := TRUE;", m.implementation)

	def test_method_with_stacked_access_modifiers(self):
		r = st_splitter.split_st(FB_WITH_ACCESS_MODIFIERS)
		self.assertEqual(len(r.children), 1)
		m = r.children[0]
		self.assertEqual(m.name, "Execute")
		self.assertEqual(m.access_modifier, "PROTECTED")
		self.assertEqual(m.return_type, "BOOL")

	def test_fb_with_action(self):
		r = st_splitter.split_st(FB_WITH_ACTION)
		self.assertEqual(len(r.children), 1)
		c = r.children[0]
		self.assertEqual(c.kind, "action")
		self.assertEqual(c.name, "DoIt")
		self.assertIn("x := x + 1;", c.implementation)

	def test_fb_with_property_get_set(self):
		r = st_splitter.split_st(FB_WITH_PROPERTY)
		self.assertEqual(len(r.children), 1)
		p = r.children[0]
		self.assertEqual(p.kind, "property")
		self.assertEqual(p.name, "Value")
		self.assertEqual(p.data_type, "INT")
		self.assertIsNotNone(p.getter)
		self.assertIsNotNone(p.setter)
		self.assertIn("Value := iBacking;", p.getter.implementation)
		self.assertIn("iBacking := Value;", p.setter.implementation)

	def test_pragma_above_method_stays_with_child(self):
		r = st_splitter.split_st(FB_WITH_PRAGMA_ABOVE_METHOD)
		self.assertEqual(len(r.children), 1)
		m = r.children[0]
		self.assertEqual(m.name, "Sensitive")
		# Pragma should be captured into the child's declaration.
		self.assertIn("no_check", m.declaration)

	def test_folder_annotation_extracted_from_signature(self):
		r = st_splitter.split_st(FB_WITH_FOLDER_ANNOTATION)
		self.assertEqual(len(r.children), 1)
		m = r.children[0]
		self.assertEqual(m.folder, "helpers")

	def test_fb_with_no_var_section(self):
		r = st_splitter.split_st(FB_WITHOUT_VAR)
		self.assertEqual(r.pou_name, "FB_X")
		self.assertEqual(len(r.children), 0)
		self.assertIn("iCount := iCount + 1;", r.pou_implementation)

	def test_interface_with_method_signature(self):
		# The C# splitter's interface fix lives in SplitInterfaceBody —
		# methods inside INTERFACE block are extracted as children.
		r = st_splitter.split_st(INTERFACE_WITH_METHOD)
		self.assertEqual(r.pou_kind, "interface")
		self.assertEqual(r.pou_name, "ITF_X")
		self.assertEqual(len(r.children), 1)
		self.assertEqual(r.children[0].kind, "method")
		self.assertEqual(r.children[0].name, "Compute")
		self.assertEqual(r.children[0].implementation, "")
		self.assertIn("METHOD Compute", r.children[0].declaration)
		self.assertIn("VAR_INPUT", r.children[0].declaration)

	def test_gvl_is_simple_blob(self):
		r = st_splitter.split_st(GVL_SOURCE)
		self.assertEqual(r.pou_kind, "gvl")
		self.assertEqual(len(r.children), 0)
		self.assertIn("VAR_GLOBAL", r.pou_declaration)

	def test_dut_struct_is_simple_blob(self):
		r = st_splitter.split_st(DUT_STRUCT_SOURCE)
		self.assertEqual(r.pou_kind, "structure")
		self.assertEqual(r.pou_name, "DUT_X")
		self.assertEqual(len(r.children), 0)


if __name__ == "__main__":
	unittest.main()
