import base64
import hashlib
import importlib.util
import io
import json
import tempfile
import unittest
import warnings
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

from docx import Document


MODULE_PATH = Path(__file__).with_name("word-generator.py")
SPEC = importlib.util.spec_from_file_location("word_generator", MODULE_PATH)
WORD_GENERATOR = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(WORD_GENERATOR)


FIXTURE_B64 = Path(__file__).with_name("fixtures") / "apache-poi-SimpleMacro.docm.b64"
APACHE_FIXTURE_SHA256 = "fd591958fcf5322f72c0a740e9606309c949254bda4c3d9bd966481ddf220563"


def apache_docm_fixture() -> bytes:
    data = base64.b64decode(FIXTURE_B64.read_text())
    assert len(data) == 15_517
    assert hashlib.sha256(data).hexdigest() == APACHE_FIXTURE_SHA256
    return data


def header_only_cfb_fixture() -> bytes:
    data = bytearray(1024)
    data[:8] = bytes.fromhex("D0CF11E0A1B11AE1")
    data[24:26] = (0x3E).to_bytes(2, "little")
    data[26:28] = (3).to_bytes(2, "little")
    data[28:30] = b"\xfe\xff"
    data[30:32] = (9).to_bytes(2, "little")
    data[32:34] = (6).to_bytes(2, "little")
    data[44:48] = (1).to_bytes(4, "little")
    return bytes(data)


def zeroed_vba_streams_fixture() -> bytes:
    with zipfile.ZipFile(io.BytesIO(apache_docm_fixture())) as package:
        project = package.read("word/vbaProject.bin")
    with tempfile.NamedTemporaryFile(suffix=".bin") as temporary:
        temporary.write(project)
        temporary.flush()
        compound = WORD_GENERATOR.olefile.OleFileIO(temporary.name, write_mode=True)
        try:
            for stream in (
                "PROJECT",
                "VBA/_VBA_PROJECT",
                "VBA/dir",
                "VBA/Module1",
                "VBA/ThisDocument",
            ):
                compound.write_stream(stream, b"\x00" * compound.get_size(stream))
        finally:
            compound.close()
        return Path(temporary.name).read_bytes()


def mutate_apache_docm(
    destination: Path,
    replacements: dict[str, bytes] | None = None,
    omit: set[str] | None = None,
    duplicate: tuple[str, bytes] | None = None,
):
    replacements = replacements or {}
    omit = omit or set()
    with zipfile.ZipFile(io.BytesIO(apache_docm_fixture())) as source, zipfile.ZipFile(
        destination, "w"
    ) as output:
        for info in source.infolist():
            if info.filename in omit:
                continue
            output.writestr(info, replacements.get(info.filename, source.read(info.filename)))
        if duplicate:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                output.writestr(duplicate[0], duplicate[1])


class SourceDocxExportTest(unittest.TestCase):
    def test_drops_word_meta_instruction_from_customer_text(self):
        self.assertEqual(
            WORD_GENERATOR.clean_text(
                "请根据实际条款文本核对本评估结果，并在 Word 文档中标注相应的批注文案。"
            ),
            "",
        )

    def test_preserves_template_parts_and_uses_unique_revision_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.docx"
            output = Path(directory) / "output.docx"
            second_output = Path(directory) / "output-with-existing-review.docx"
            document = Document()
            document.styles["Normal"].font.name = "Arial"
            document.sections[0].header.paragraphs[0].text = "UNCHANGED HEADER"
            document.sections[0].footer.paragraphs[0].text = "UNCHANGED FOOTER"
            document.add_paragraph("Clause One original amount is 100.")
            document.add_paragraph("Clause Two original period is 90 days.")
            document.add_paragraph("Clause Three requires a customer comment.")
            document.save(source)

            payload = {
                "export_mode": "source_annotated",
                "decision_drafts": [
                    {
                        "source_anchor": {"exact_text": "original amount is 100", "locator": "rendered"},
                        "revision_text": "amount is 50",
                        "customer_comment": "Please confirm the agreed amount.",
                        "negotiation_result": "customer_agreed",
                    },
                    {
                        "source_anchor": {"exact_text": "original period is 90 days", "locator": "rendered"},
                        "revision_text": "period is 30 days",
                        "customer_comment": "Please confirm the agreed period.",
                        "negotiation_result": "customer_agreed",
                    },
                    {
                        "source_anchor": {"exact_text": "requires a customer comment", "locator": "rendered"},
                        "customer_comment": "Please confirm this clause in writing.",
                        "negotiation_result": "customer_agreed",
                    },
                ],
            }

            result = WORD_GENERATOR.generate_document(str(source), str(output), json.dumps(payload))
            self.assertTrue(result["success"], result)
            self.assertEqual(result["revisions"], 2)
            self.assertEqual(result["anchored"], 3)

            with zipfile.ZipFile(source) as source_zip, zipfile.ZipFile(output) as output_zip:
                for part in ("word/styles.xml", "word/header1.xml", "word/footer1.xml"):
                    self.assertEqual(source_zip.read(part), output_zip.read(part), part)
                document_xml_bytes = output_zip.read("word/document.xml")
                document_xml = document_xml_bytes.decode("utf-8")
                root = ET.fromstring(document_xml_bytes)
                word_ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
                revision_ids = [
                    element.attrib[f"{{{word_ns}}}id"]
                    for tag in ("del", "ins")
                    for element in root.findall(f".//{{{word_ns}}}{tag}")
                ]
                self.assertEqual(len(revision_ids), 4)
                self.assertEqual(len(set(revision_ids)), 4)
                self.assertIn("w:del", document_xml)
                self.assertIn("w:ins", document_xml)
                comments_xml = output_zip.read("word/comments.xml").decode("utf-8")
                self.assertIn("Please confirm this clause in writing.", comments_xml)

            reopened = Document(output)
            self.assertEqual(reopened.sections[0].header.paragraphs[0].text, "UNCHANGED HEADER")
            self.assertEqual(reopened.sections[0].footer.paragraphs[0].text, "UNCHANGED FOOTER")

            second_result = WORD_GENERATOR.generate_document(
                str(output),
                str(second_output),
                json.dumps({
                    "export_mode": "source_annotated",
                    "decision_drafts": [{
                        "source_anchor": {"exact_text": "Clause One", "locator": "rendered"},
                        "customer_comment": "AI comment added without replacing existing review markup.",
                        "negotiation_result": "customer_feedback",
                    }],
                }),
            )
            self.assertTrue(second_result["success"], second_result)
            with zipfile.ZipFile(output) as first_zip, zipfile.ZipFile(second_output) as second_zip:
                for part in ("word/header1.xml", "word/footer1.xml"):
                    self.assertEqual(first_zip.read(part), second_zip.read(part), part)
                first_document = ET.fromstring(first_zip.read("word/document.xml"))
                second_document = ET.fromstring(second_zip.read("word/document.xml"))
                word_ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
                for tag in ("ins", "del"):
                    first_ids = [
                        element.attrib[f"{{{word_ns}}}id"]
                        for element in first_document.findall(f".//{{{word_ns}}}{tag}")
                    ]
                    second_ids = [
                        element.attrib[f"{{{word_ns}}}id"]
                        for element in second_document.findall(f".//{{{word_ns}}}{tag}")
                    ]
                    self.assertEqual(first_ids, second_ids, tag)
                comments_xml = second_zip.read("word/comments.xml").decode("utf-8")
                self.assertIn("Please confirm this clause in writing.", comments_xml)
                self.assertIn("AI comment added without replacing existing review markup.", comments_xml)
                comments_root = ET.fromstring(second_zip.read("word/comments.xml"))
                self.assertEqual(len(comments_root.findall(f"{{{word_ns}}}comment")), 2)

    def test_real_apache_docm_preserves_vba_graph_and_assets_byte_for_byte(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            source = directory / "source.docm"
            output = directory / "output.docm"
            source.write_bytes(apache_docm_fixture())

            payload = {
                "export_mode": "source_annotated",
                "decision_drafts": [{
                    "source_anchor": {
                        "exact_text": "This is a macro word processing document",
                        "locator": "rendered",
                    },
                    "customer_comment": "请确认真实宏文档批注。",
                    "negotiation_result": "customer_agreed",
                }],
            }
            result = WORD_GENERATOR.generate_document(str(source), str(output), json.dumps(payload, ensure_ascii=False))
            self.assertTrue(result["success"], result)
            self.assertTrue(result["macro_project_present"])
            self.assertEqual(result["macro_assets_verified"], 3)
            self.assertEqual(
                WORD_GENERATOR.macro_asset_hashes(str(source)),
                WORD_GENERATOR.macro_asset_hashes(str(output)),
            )
            self.assertTrue(WORD_GENERATOR.validate_docm_package(str(output))["valid"])
            with zipfile.ZipFile(output) as package:
                self.assertIn("请确认真实宏文档批注。", package.read("word/comments.xml").decode("utf-8"))

    def test_allows_macro_enabled_docm_without_a_vba_project(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            base = directory / "base.docx"
            source = directory / "empty-macro-enabled.docm"
            output = directory / "output.docm"
            document = Document()
            document.add_paragraph("唯一需要批注的文字。")
            document.save(base)
            with zipfile.ZipFile(base) as input_zip, zipfile.ZipFile(source, "w") as output_zip:
                for item in input_zip.infolist():
                    data = input_zip.read(item.filename)
                    if item.filename == "[Content_Types].xml":
                        data = data.replace(
                            b"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
                            b"application/vnd.ms-word.document.macroEnabled.main+xml",
                        )
                    output_zip.writestr(item, data)

            result = WORD_GENERATOR.generate_document(str(source), str(output), json.dumps({
                "export_mode": "source_annotated",
                "decision_drafts": [{
                    "source_anchor": {"exact_text": "唯一需要批注的文字。", "locator": "rendered"},
                    "customer_comment": "请确认。",
                }],
            }, ensure_ascii=False))

            self.assertTrue(result["success"], result)
            self.assertFalse(result["macro_project_present"])
            self.assertEqual(result["macro_assets_verified"], 0)

    def test_rejects_docx_renamed_as_docm_without_macro_parts(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            source = directory / "renamed.docm"
            output = directory / "output.docm"
            document = Document()
            document.add_paragraph("唯一需要批注的文字。")
            document.save(source)

            result = WORD_GENERATOR.generate_document(str(source), str(output), json.dumps({
                "decision_drafts": [{
                    "source_anchor": {"exact_text": "唯一需要批注的文字。"},
                    "customer_comment": "请确认。",
                }],
            }, ensure_ascii=False))

            self.assertFalse(result["success"])
            self.assertFalse(result["valid"])
            self.assertEqual(result["error_code"], "DOCM_CONTENT_TYPE_INVALID")
            self.assertFalse(output.exists())

    def test_rejects_header_only_cfb_without_vba_streams(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            source = directory / "invalid.docm"
            output = directory / "output.docm"
            mutate_apache_docm(source, {"word/vbaProject.bin": header_only_cfb_fixture()})

            result = WORD_GENERATOR.generate_document(str(source), str(output), json.dumps({
                "decision_drafts": [{
                    "source_anchor": {"exact_text": "This is a macro word processing document"},
                    "customer_comment": "请确认。",
                }],
            }, ensure_ascii=False))

            self.assertFalse(result["success"])
            self.assertFalse(result["valid"])
            self.assertEqual(result["error_code"], "DOCM_VBA_PROJECT_INVALID")
            self.assertFalse(output.exists())

    def test_rejects_zeroed_vba_streams_even_when_ole_directory_names_survive(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "invalid.docm"
            mutate_apache_docm(source, {"word/vbaProject.bin": zeroed_vba_streams_fixture()})

            result = WORD_GENERATOR.validate_docm_package(str(source))

            self.assertFalse(result["valid"])
            self.assertEqual(result["error_code"], "DOCM_VBA_PROJECT_INVALID")

    def test_rejects_docm_without_package_root_office_document_relationship(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "invalid.docm"
            mutate_apache_docm(source, omit={"_rels/.rels"})

            result = WORD_GENERATOR.validate_docm_package(str(source))

            self.assertFalse(result["valid"])
            self.assertEqual(result["error_code"], "DOCM_PACKAGE_PART_MISSING")

    def test_rejects_macro_free_docm_with_alternate_vba_content_typed_part(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            base = directory / "base.docx"
            source = directory / "invalid.docm"
            document = Document()
            document.add_paragraph("宏启用但没有 VBA Project。")
            document.save(base)
            with zipfile.ZipFile(base) as input_zip, zipfile.ZipFile(source, "w") as output_zip:
                for item in input_zip.infolist():
                    data = input_zip.read(item.filename)
                    if item.filename == "[Content_Types].xml":
                        data = data.replace(
                            b"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
                            b"application/vnd.ms-word.document.macroEnabled.main+xml",
                        ).replace(
                            b"</Types>",
                            b'<Override PartName="/word/evil.bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>',
                        )
                    output_zip.writestr(item, data)
                output_zip.writestr("word/evil.bin", b"orphan project bytes")

            result = WORD_GENERATOR.validate_docm_package(str(source))

            self.assertFalse(result["valid"])
            self.assertEqual(result["error_code"], "DOCM_VBA_GRAPH_INCOMPLETE")

    def test_rejects_non_xml_vba_supplemental_data(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "invalid.docm"
            mutate_apache_docm(source, {"word/vbaData.xml": b"NOT XML"})

            result = WORD_GENERATOR.validate_docm_package(str(source))

            self.assertFalse(result["valid"])
            self.assertEqual(result["error_code"], "DOCM_PACKAGE_INVALID")

    def test_rejects_duplicate_relationship_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "invalid.docm"
            with zipfile.ZipFile(io.BytesIO(apache_docm_fixture())) as fixture:
                rels = fixture.read("word/_rels/document.xml.rels").replace(
                    b"</Relationships>",
                    b'<Relationship Id="rId4" Type="http://example.invalid/duplicate" Target="duplicate.bin"/></Relationships>',
                )
            mutate_apache_docm(source, {"word/_rels/document.xml.rels": rels})

            result = WORD_GENERATOR.validate_docm_package(str(source))

            self.assertFalse(result["valid"])
            self.assertEqual(result["error_code"], "DOCM_PACKAGE_INVALID")

    def test_rejects_relationship_part_whose_source_part_does_not_exist(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "invalid.docm"
            ghost_relationship = (
                b'<?xml version="1.0" encoding="UTF-8"?>'
                b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                b'<Relationship Id="rIdGhost" Type="http://example.invalid/ghost" Target="missing.bin"/>'
                b'</Relationships>'
            )
            mutate_apache_docm(source, duplicate=("word/_rels/ghost.xml.rels", ghost_relationship))

            result = WORD_GENERATOR.validate_docm_package(str(source))

            self.assertFalse(result["valid"])
            self.assertEqual(result["error_code"], "DOCM_PACKAGE_INVALID")

    def test_rejects_internal_relationship_target_that_does_not_exist(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "invalid.docm"
            with zipfile.ZipFile(io.BytesIO(apache_docm_fixture())) as fixture:
                rels = fixture.read("word/_rels/document.xml.rels").replace(
                    b"</Relationships>",
                    b'<Relationship Id="rIdMissingTarget" Type="http://example.invalid/missing" Target="missing.bin"/></Relationships>',
                )
            mutate_apache_docm(source, {"word/_rels/document.xml.rels": rels})

            result = WORD_GENERATOR.validate_docm_package(str(source))

            self.assertFalse(result["valid"])
            self.assertEqual(result["error_code"], "DOCM_PACKAGE_INVALID")

    def test_rejects_part_without_an_effective_content_type(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "invalid.docm"
            mutate_apache_docm(source, duplicate=("word/evil.zzz", b"untyped bytes"))

            result = WORD_GENERATOR.validate_docm_package(str(source))

            self.assertFalse(result["valid"])
            self.assertEqual(result["error_code"], "DOCM_CONTENT_TYPE_INVALID")

    def test_rejects_case_equivalent_conflicting_content_type_override(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "invalid.docm"
            with zipfile.ZipFile(io.BytesIO(apache_docm_fixture())) as fixture:
                content_types = fixture.read("[Content_Types].xml").replace(
                    b"</Types>",
                    b'<Override PartName="/WORD/DOCUMENT.XML" ContentType="application/octet-stream"/></Types>',
                )
            mutate_apache_docm(source, {"[Content_Types].xml": content_types})

            result = WORD_GENERATOR.validate_docm_package(str(source))

            self.assertFalse(result["valid"])
            self.assertEqual(result["error_code"], "DOCM_PACKAGE_INVALID")

    def test_rejects_main_document_that_is_not_wordprocessingml(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "invalid.docm"
            mutate_apache_docm(source, {"word/document.xml": b"NOT XML"})

            result = WORD_GENERATOR.validate_docm_package(str(source))

            self.assertFalse(result["valid"])
            self.assertEqual(result["error_code"], "DOCM_PACKAGE_INVALID")

    def test_rejects_relationship_content_type_outside_a_rels_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "invalid.docm"
            mutate_apache_docm(source, duplicate=("word/misplaced.rels", b"not a relationship part"))

            result = WORD_GENERATOR.validate_docm_package(str(source))

            self.assertFalse(result["valid"])
            self.assertEqual(result["error_code"], "DOCM_CONTENT_TYPE_INVALID")

    def test_rejects_relationship_that_targets_a_relationship_part(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "invalid.docm"
            with zipfile.ZipFile(io.BytesIO(apache_docm_fixture())) as fixture:
                rels = fixture.read("word/_rels/document.xml.rels").replace(
                    b"</Relationships>",
                    b'<Relationship Id="rIdMetadata" Type="http://example.invalid/metadata" Target="_rels/document.xml.rels"/></Relationships>',
                )
            mutate_apache_docm(source, {"word/_rels/document.xml.rels": rels})

            result = WORD_GENERATOR.validate_docm_package(str(source))

            self.assertFalse(result["valid"])
            self.assertEqual(result["error_code"], "DOCM_PACKAGE_INVALID")

    def test_rejects_traversing_vba_relationship_target(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "invalid.docm"
            with zipfile.ZipFile(io.BytesIO(apache_docm_fixture())) as fixture:
                rels = fixture.read("word/_rels/document.xml.rels").replace(
                    b'Target="vbaProject.bin"', b'Target="../orphan/vbaProject.bin"'
                )
            mutate_apache_docm(source, {"word/_rels/document.xml.rels": rels})
            result = WORD_GENERATOR.validate_docm_package(str(source))
            self.assertFalse(result["valid"])
            self.assertEqual(result["error_code"], "DOCM_PACKAGE_INVALID")

    def test_rejects_duplicate_zip_member(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "invalid.docm"
            with zipfile.ZipFile(io.BytesIO(apache_docm_fixture())) as fixture:
                duplicate = fixture.read("word/document.xml")
            mutate_apache_docm(source, duplicate=("word/document.xml", duplicate))
            result = WORD_GENERATOR.validate_docm_package(str(source))
            self.assertFalse(result["valid"])
            self.assertEqual(result["error_code"], "DOCM_ZIP_DUPLICATE_MEMBER")

    def test_rejects_conflicting_vba_content_type_override(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "invalid.docm"
            with zipfile.ZipFile(io.BytesIO(apache_docm_fixture())) as fixture:
                content_types = fixture.read("[Content_Types].xml").replace(
                    b"</Types>",
                    b'<Override PartName="/word/vbaProject.bin" ContentType="application/octet-stream"/></Types>',
                )
            mutate_apache_docm(source, {"[Content_Types].xml": content_types})
            result = WORD_GENERATOR.validate_docm_package(str(source))
            self.assertFalse(result["valid"])
            self.assertEqual(result["error_code"], "DOCM_CONTENT_TYPE_INVALID")

    def test_rejects_multiple_vba_relationships(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "invalid.docm"
            with zipfile.ZipFile(io.BytesIO(apache_docm_fixture())) as fixture:
                rels = fixture.read("word/_rels/document.xml.rels").replace(
                    b"</Relationships>",
                    b'<Relationship Id="rIdExtraVba" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>',
                )
            mutate_apache_docm(source, {"word/_rels/document.xml.rels": rels})
            result = WORD_GENERATOR.validate_docm_package(str(source))
            self.assertFalse(result["valid"])
            self.assertEqual(result["error_code"], "DOCM_VBA_RELATIONSHIP_INVALID")

    def test_rejects_missing_vba_supplemental_data(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "invalid.docm"
            mutate_apache_docm(source, omit={"word/vbaData.xml"})
            result = WORD_GENERATOR.validate_docm_package(str(source))
            self.assertFalse(result["valid"])
            self.assertEqual(result["error_code"], "DOCM_CONTENT_TYPE_INVALID")

    def test_rejects_opc_signed_word_package(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            base = directory / "base.docx"
            source = directory / "signed.docx"
            output = directory / "output.docx"
            document = Document()
            document.add_paragraph("唯一需要批注的文字。")
            document.save(base)
            with zipfile.ZipFile(base) as input_zip, zipfile.ZipFile(source, "w", zipfile.ZIP_DEFLATED) as output_zip:
                for item in input_zip.infolist():
                    output_zip.writestr(item, input_zip.read(item.filename))
                output_zip.writestr("_xmlsignatures/sig1.xml", b"<Signature />")

            result = WORD_GENERATOR.generate_document(str(source), str(output), json.dumps({
                "export_mode": "source_annotated",
                "decision_drafts": [{
                    "source_anchor": {"exact_text": "唯一需要批注的文字。", "locator": "rendered"},
                    "customer_comment": "请确认。",
                }],
            }, ensure_ascii=False))

            self.assertFalse(result["success"])
            self.assertIn("数字签名", result["error"])
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
