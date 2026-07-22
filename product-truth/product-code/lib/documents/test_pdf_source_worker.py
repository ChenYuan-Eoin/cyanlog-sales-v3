import importlib.util
import struct
import tempfile
import unittest
from pathlib import Path

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject, NumberObject


MODULE_PATH = Path(__file__).with_name("pdf-source-worker.py")
SPEC = importlib.util.spec_from_file_location("pdf_source_worker", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def write_text_pdf(path: Path) -> None:
    writer = PdfWriter()
    page = writer.add_blank_page(width=600, height=800)
    font = DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type1"),
        NameObject("/BaseFont"): NameObject("/Helvetica"),
    })
    font_ref = writer._add_object(font)
    page[NameObject("/Resources")] = DictionaryObject({
        NameObject("/Font"): DictionaryObject({NameObject("/F1"): font_ref}),
    })
    content = DecodedStreamObject()
    content.set_data(b"BT /F1 18 Tf 72 720 Td (Payment term is 90 days) Tj ET")
    page[NameObject("/Contents")] = writer._add_object(content)
    with path.open("wb") as stream:
        writer.write(stream)


def write_image_only_pdf(path: Path) -> None:
    writer = PdfWriter()
    page = writer.add_blank_page(width=600, height=800)
    image = DecodedStreamObject()
    image.set_data(bytes([255, 255, 255, 0, 0, 0, 0, 0, 0, 255, 255, 255]))
    image.update({
        NameObject("/Type"): NameObject("/XObject"),
        NameObject("/Subtype"): NameObject("/Image"),
        NameObject("/Width"): NumberObject(2),
        NameObject("/Height"): NumberObject(2),
        NameObject("/ColorSpace"): NameObject("/DeviceRGB"),
        NameObject("/BitsPerComponent"): NumberObject(8),
    })
    image_ref = writer._add_object(image)
    page[NameObject("/Resources")] = DictionaryObject({
        NameObject("/XObject"): DictionaryObject({NameObject("/ImScan"): image_ref}),
    })
    content = DecodedStreamObject()
    content.set_data(b"q 600 0 0 800 0 0 cm /ImScan Do Q")
    page[NameObject("/Contents")] = writer._add_object(content)
    with path.open("wb") as stream:
        writer.write(stream)


class PdfSourceWorkerTest(unittest.TestCase):
    def test_extracts_text_and_normalized_line_geometry(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "text.pdf"
            write_text_pdf(source)
            result = MODULE.inspect_pdf(source)
            self.assertEqual(result["page_count"], 1)
            self.assertIn("Payment term is 90 days", result["text"])
            self.assertEqual(len(result["pages"][0]["lines"]), 1)
            line = result["pages"][0]["lines"][0]
            self.assertEqual(line["text"], "Payment term is 90 days")
            for key in ("left", "top", "width", "height"):
                self.assertGreaterEqual(line[key], 0)
                self.assertLessEqual(line[key], 100)

    def test_renders_image_only_scan_without_inventing_text(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "scan.pdf"
            output = Path(directory) / "scan.png"
            write_image_only_pdf(source)
            inspected = MODULE.inspect_pdf(source)
            self.assertEqual(inspected["text"], "")
            self.assertEqual(inspected["pages"][0]["lines"], [])
            rendered = MODULE.render_page(source, output, 1, 144)
            self.assertEqual(rendered["page_count"], 1)
            png = output.read_bytes()
            self.assertTrue(png.startswith(b"\x89PNG\r\n\x1a\n"))
            width, height = struct.unpack(">II", png[16:24])
            self.assertEqual((width, height), (1200, 1600))

    def test_rejects_page_outside_document(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "text.pdf"
            output = Path(directory) / "missing.png"
            write_text_pdf(source)
            with self.assertRaises(MODULE.WorkerError) as raised:
                MODULE.render_page(source, output, 2, 144)
            self.assertEqual(raised.exception.code, "PAGE_OUT_OF_RANGE")
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
