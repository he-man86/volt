"""
Body-swap unit tests for `helpers.plcopen_xml.replace_body_in_pou`.

Parallel to TC's `ReplaceBodyInPouTests` in C# — both test the
**export-as-template** pattern's load-bearing surgery: take a full
PLCopenXML document, swap just the `<body>` of a named POU, return
the modified document with schema validity intact.

Pure data tests — no live bridge required.

Run:  python -m unittest discover -s packages/volt-bridges/codesys/CodesysBridge.Tests
"""
# pyright: reportMissingImports=false
import os
import sys
import unittest
import xml.etree.ElementTree as ET

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, ".."))

from CodesysBridge.helpers import plcopen_xml  # noqa: E402


# Schema-valid PLCopenXML document — minimum elements both CODESYS and
# TC require for import (fileHeader, contentHeader, coordinateInfo).
# Captured from live CODESYS export of a default FBD POU.
TEMPLATE_FBD_POU = """<?xml version="1.0" encoding="utf-8"?>
<project xmlns="http://www.plcopen.org/xml/tc6_0200">
  <fileHeader companyName="Volt" productName="volt-bridges" productVersion="5.0.0" creationDateTime="2026-05-30T20:00:00Z" />
  <contentHeader name="Test.project" modificationDateTime="2026-05-30T20:00:00Z">
    <coordinateInfo>
      <fbd><scaling x="1" y="1" /></fbd>
    </coordinateInfo>
  </contentHeader>
  <types>
    <dataTypes />
    <pous>
      <pou name="MyFB" pouType="functionBlock">
        <interface />
        <body>
          <FBD>
            <inVariable localId="1">
              <position x="0" y="0" />
              <connectionPointOut />
              <expression>OLD_VAR</expression>
            </inVariable>
          </FBD>
        </body>
        <addData />
      </pou>
    </pous>
  </types>
</project>
"""

NEW_BODY = """<body xmlns="http://www.plcopen.org/xml/tc6_0200">
  <FBD>
    <inVariable localId="100">
      <position x="50" y="50" />
      <connectionPointOut />
      <expression>NEW_VAR</expression>
    </inVariable>
  </FBD>
</body>"""


class TestReplaceBodyInPou(unittest.TestCase):

	def test_swaps_body_preserving_other_elements(self):
		result = plcopen_xml.replace_body_in_pou(TEMPLATE_FBD_POU, "MyFB", NEW_BODY)
		self.assertIsNotNone(result)
		# New body content present
		self.assertIn("NEW_VAR", result)
		# Old body content gone
		self.assertNotIn("OLD_VAR", result)
		# fileHeader / contentHeader / coordinateInfo preserved — these
		# are the elements both vendors validate on import.
		self.assertIn("fileHeader", result)
		self.assertIn("contentHeader", result)
		self.assertIn("coordinateInfo", result)
		# POU name + pouType preserved
		self.assertIn('name="MyFB"', result)
		self.assertIn('pouType="functionBlock"', result)

	def test_returns_none_when_pou_not_in_template(self):
		result = plcopen_xml.replace_body_in_pou(TEMPLATE_FBD_POU, "DOESNT_EXIST", NEW_BODY)
		self.assertIsNone(result)

	def test_returns_none_on_malformed_template(self):
		result = plcopen_xml.replace_body_in_pou("<not-xml>", "MyFB", NEW_BODY)
		self.assertIsNone(result)

	def test_returns_none_on_malformed_new_body(self):
		result = plcopen_xml.replace_body_in_pou(TEMPLATE_FBD_POU, "MyFB", "not xml")
		self.assertIsNone(result)

	def test_rejects_non_body_root_element(self):
		# Passing a bare <FBD>...</FBD> instead of <body><FBD>...</FBD></body>
		# must be rejected — splicing it directly under <pou> would
		# produce a malformed document.
		not_a_body = '<FBD xmlns="http://www.plcopen.org/xml/tc6_0200"><inVariable localId="1"/></FBD>'
		result = plcopen_xml.replace_body_in_pou(TEMPLATE_FBD_POU, "MyFB", not_a_body)
		self.assertIsNone(result)

	def test_handles_BOM_prefix(self):
		# CODESYS prepends a UTF-8 BOM to its export output — make sure
		# the helper tolerates it.
		result = plcopen_xml.replace_body_in_pou("﻿" + TEMPLATE_FBD_POU, "MyFB", NEW_BODY)
		self.assertIsNotNone(result)
		self.assertIn("NEW_VAR", result)

	def test_case_insensitive_name_match(self):
		# Bridge stores names case-sensitively but PLCopenXML imports
		# often round-trip with different casing. Match insensitively.
		result = plcopen_xml.replace_body_in_pou(TEMPLATE_FBD_POU, "myfb", NEW_BODY)
		self.assertIsNotNone(result)
		self.assertIn("NEW_VAR", result)

	def test_result_is_valid_xml(self):
		result = plcopen_xml.replace_body_in_pou(TEMPLATE_FBD_POU, "MyFB", NEW_BODY)
		# Re-parsing the result should not raise.
		root = ET.fromstring(result)
		self.assertIsNotNone(root)


class TestExtractGraphicalBody(unittest.TestCase):
	"""Mirror test for the inverse (pull-side) helper. Pure data.

	Two functions under test: `extract_graphical_body(item)` does the
	COM IO; `extract_body_from_xml(xml_str)` is the pure-data inner
	helper. Most tests exercise the pure-data form directly.
	"""

	def test_extract_body_from_xml_extracts_body(self):
		body = plcopen_xml.extract_body_from_xml(TEMPLATE_FBD_POU)
		self.assertIsNotNone(body)
		self.assertIn("OLD_VAR", body)
		self.assertIn("FBD", body)

	def test_extract_body_from_xml_handles_BOM(self):
		# CODESYS prepends a UTF-8 BOM to export output.
		body = plcopen_xml.extract_body_from_xml("﻿" + TEMPLATE_FBD_POU)
		self.assertIsNotNone(body)
		self.assertIn("OLD_VAR", body)

	def test_extract_body_from_xml_returns_none_on_empty(self):
		self.assertIsNone(plcopen_xml.extract_body_from_xml(""))
		self.assertIsNone(plcopen_xml.extract_body_from_xml(None))

	def test_extract_body_from_xml_returns_none_on_malformed(self):
		self.assertIsNone(plcopen_xml.extract_body_from_xml("<not xml"))

	def test_extract_graphical_body_wrapper_does_IO(self):
		# The wrapper just calls item.export_xml() then delegates.
		class FakeItem:
			def export_xml(self):
				return TEMPLATE_FBD_POU
		body = plcopen_xml.extract_graphical_body(FakeItem())
		self.assertIsNotNone(body)
		self.assertIn("OLD_VAR", body)

	def test_extract_graphical_body_wrapper_handles_io_failure(self):
		class BrokenItem:
			def export_xml(self):
				raise RuntimeError("simulated COM failure")
		self.assertIsNone(plcopen_xml.extract_graphical_body(BrokenItem()))


if __name__ == "__main__":
	unittest.main()
