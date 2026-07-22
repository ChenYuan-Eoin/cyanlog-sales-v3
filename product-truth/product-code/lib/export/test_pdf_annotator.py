import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject, NumberObject


MODULE_PATH = Path(__file__).with_name("pdf-annotator.py")
SPEC = importlib.util.spec_from_file_location("pdf_annotator", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class PdfAnnotatorTest(unittest.TestCase):
    def test_adds_standard_annotations_without_changing_page_count(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.pdf"
            output = Path(directory) / "annotated.pdf"
            writer = PdfWriter()
            writer.add_blank_page(width=600, height=800)
            writer.add_blank_page(width=600, height=800)
            with source.open("wb") as stream:
                writer.write(stream)

            result = MODULE.generate_annotated_pdf(str(source), str(output), {
                "decision_drafts": [{
                    "customer_comment": "请明确付款日期。",
                    "source_anchor": {
                        "page": 2,
                        "boxes": [{"left": 10, "top": 20, "width": 40, "height": 5}],
                    },
                }],
            })

            self.assertTrue(result["success"])
            reader = PdfReader(output)
            self.assertEqual(len(reader.pages), 2)
            annotations = reader.pages[1]["/Annots"]
            subtypes = [annotation.get_object()["/Subtype"] for annotation in annotations]
            self.assertIn("/Highlight", subtypes)
            self.assertIn("/Text", subtypes)
            contents = [annotation.get_object().get("/Contents") for annotation in annotations]
            self.assertIn("请明确付款日期。", contents)

    def test_allows_page_point_fallback_without_ocr_boxes(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "scan.pdf"
            output = Path(directory) / "scan-annotated.pdf"
            writer = PdfWriter()
            writer.add_blank_page(width=600, height=800)
            with source.open("wb") as stream:
                writer.write(stream)
            result = MODULE.generate_annotated_pdf(str(source), str(output), {
                "annotations": [{
                    "comment": "扫描件人工批注",
                    "source_anchor": {"page": 1, "anchor_kind": "point", "point": {"x": 0.25, "y": 0.75}},
                }],
            })
            self.assertTrue(result["success"])
            annotation = PdfReader(output).pages[0]["/Annots"][0].get_object()
            self.assertEqual(annotation["/Subtype"], "/Text")
            self.assertAlmostEqual(float(annotation["/Rect"][0]), 141, delta=1)
            self.assertAlmostEqual(float(annotation["/Rect"][1]), 191, delta=1)

    def test_writes_manual_region_as_highlight_and_note(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "scan.pdf"
            output = Path(directory) / "scan-region-annotated.pdf"
            writer = PdfWriter()
            writer.add_blank_page(width=600, height=800)
            with source.open("wb") as stream:
                writer.write(stream)

            result = MODULE.generate_annotated_pdf(str(source), str(output), {
                "annotations": [{
                    "comment": "扫描件区域批注",
                    "source_anchor": {
                        "page": 1,
                        "kind": "region",
                        "region": {"x": 0.1, "y": 0.2, "width": 0.4, "height": 0.1},
                    },
                }],
            })

            self.assertTrue(result["success"])
            annotations = [item.get_object() for item in PdfReader(output).pages[0]["/Annots"]]
            highlight = next(item for item in annotations if item["/Subtype"] == "/Highlight")
            self.assertEqual(highlight["/Contents"], "扫描件区域批注")
            self.assertAlmostEqual(float(highlight["/Rect"][0]), 60, delta=1)
            self.assertAlmostEqual(float(highlight["/Rect"][1]), 560, delta=1)
            self.assertAlmostEqual(float(highlight["/Rect"][2]), 300, delta=1)
            self.assertAlmostEqual(float(highlight["/Rect"][3]), 640, delta=1)
            self.assertTrue(any(item["/Subtype"] == "/Text" for item in annotations))

    def test_preserves_image_only_scan_while_adding_region_and_point_comments(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "image-only-scan.pdf"
            output = Path(directory) / "image-only-scan-annotated.pdf"
            pixels = bytes([
                255, 255, 255, 0, 0, 0,
                0, 0, 0, 255, 255, 255,
            ])

            writer = PdfWriter()
            page = writer.add_blank_page(width=600, height=800)
            image = DecodedStreamObject()
            image.set_data(pixels)
            image.update({
                NameObject("/Type"): NameObject("/XObject"),
                NameObject("/Subtype"): NameObject("/Image"),
                NameObject("/Width"): NumberObject(2),
                NameObject("/Height"): NumberObject(2),
                NameObject("/ColorSpace"): NameObject("/DeviceRGB"),
                NameObject("/BitsPerComponent"): NumberObject(8),
            })
            image_reference = writer._add_object(image)
            page[NameObject("/Resources")] = DictionaryObject({
                NameObject("/XObject"): DictionaryObject({
                    NameObject("/ImScan"): image_reference,
                }),
            })
            content = DecodedStreamObject()
            content.set_data(b"q 600 0 0 800 0 0 cm /ImScan Do Q")
            page[NameObject("/Contents")] = writer._add_object(content)
            with source.open("wb") as stream:
                writer.write(stream)

            self.assertEqual(PdfReader(source).pages[0].extract_text(), "")
            result = MODULE.generate_annotated_pdf(str(source), str(output), {
                "annotations": [
                    {
                        "comment": "扫描 PDF 人工区域批注",
                        "source_anchor": {
                            "page": 1,
                            "kind": "region",
                            "region": {"x": 0.1, "y": 0.2, "width": 0.4, "height": 0.1},
                        },
                    },
                    {
                        "comment": "扫描 PDF 人工点批注",
                        "source_anchor": {
                            "page": 1,
                            "kind": "point",
                            "point": {"x": 0.75, "y": 0.75},
                        },
                    },
                ],
            })

            self.assertTrue(result["success"])
            self.assertEqual(result["anchored"], 2)
            reader = PdfReader(output)
            self.assertEqual(len(reader.pages), 1)
            self.assertEqual(reader.pages[0].extract_text(), "")
            output_image = reader.pages[0]["/Resources"]["/XObject"]["/ImScan"].get_object()
            self.assertEqual(output_image["/Subtype"], "/Image")
            self.assertEqual(output_image["/Width"], 2)
            self.assertEqual(output_image["/Height"], 2)
            self.assertEqual(output_image.get_data(), pixels)
            annotations = [item.get_object() for item in reader.pages[0]["/Annots"]]
            self.assertEqual([item["/Subtype"] for item in annotations].count("/Highlight"), 1)
            self.assertEqual([item["/Subtype"] for item in annotations].count("/Text"), 2)
            contents = [item["/Contents"] for item in annotations]
            self.assertIn("扫描 PDF 人工区域批注", contents)
            self.assertIn("扫描 PDF 人工点批注", contents)

    def test_maps_display_point_through_page_rotation(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "rotated-scan.pdf"
            output = Path(directory) / "rotated-scan-annotated.pdf"
            writer = PdfWriter()
            page = writer.add_blank_page(width=600, height=800)
            page.rotate(90)
            with source.open("wb") as stream:
                writer.write(stream)

            result = MODULE.generate_annotated_pdf(str(source), str(output), {
                "annotations": [{
                    "comment": "旋转页人工批注",
                    "source_anchor": {"page": 1, "kind": "point", "point": {"x": 0.25, "y": 0.75}},
                }],
            })

            self.assertTrue(result["success"])
            annotation = PdfReader(output).pages[0]["/Annots"][0].get_object()
            self.assertEqual(annotation["/Subtype"], "/Text")
            self.assertAlmostEqual(float(annotation["/Rect"][0]), 441, delta=1)
            self.assertAlmostEqual(float(annotation["/Rect"][1]), 191, delta=1)

    def test_rejects_digitally_signed_pdf(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "signed.pdf"
            output = Path(directory) / "signed-annotated.pdf"
            writer = PdfWriter()
            writer.add_blank_page(width=600, height=800)
            writer.root_object[NameObject("/Perms")] = DictionaryObject()
            with source.open("wb") as stream:
                writer.write(stream)

            result = MODULE.generate_annotated_pdf(str(source), str(output), {
                "annotations": [{
                    "comment": "不应写入",
                    "source_anchor": {"page": 1, "kind": "point", "point": {"x": 0.5, "y": 0.5}},
                }],
            })

            self.assertFalse(result["success"])
            self.assertIn("数字签名", result["error"])
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
