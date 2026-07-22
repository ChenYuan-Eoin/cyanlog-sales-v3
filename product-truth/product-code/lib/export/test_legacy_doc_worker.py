import base64
import gzip
from hashlib import sha256
import json
import os
from pathlib import Path
import platform
import runpy
import tempfile
import unittest


WORKER = runpy.run_path(str(Path(__file__).with_name("legacy-doc-worker.py")))
WorkerFailure = WORKER["WorkerFailure"]
build_items = WORKER["build_items"]
overlapping_occurrences = WORKER["overlapping_occurrences"]
process_job = WORKER["process_job"]
sandbox_prefix = WORKER["sandbox_prefix"]
stream_hashes = WORKER["stream_hashes"]
validate_source = WORKER["validate_source"]

FIXTURE_B64 = Path(__file__).with_name("fixtures") / "apache-poi-SimpleMacro.doc.b64"
FIXTURE_SHA256 = "39e9608c711d38f298ed20a5bfae12fcdaed6f4be2be4d26db670475216ca393"
FIXTURE_TEXT = "This is a macro word processing document"
OBJECT_FIXTURE_B64 = Path(__file__).with_name("fixtures") / "apache-poi-word-with-embedded.doc.gz.b64"
OBJECT_FIXTURE_SHA256 = "206acf1f7eb7b7d7d2075e04015d005ae9bb56f025560f2583ad3878257bc4c7"
OBJECT_FIXTURE_TEXT = "I have lots of embedded files in me"


def integration_runtime():
    backend = os.environ.get("DOC_ADAPTER_ISOLATION_BACKEND")
    soffice = os.environ.get("DOC_ADAPTER_SOFFICE_PATH")
    if not backend and platform.system() == "Darwin":
        backend = "macos-sandbox-exec"
    if not soffice and platform.system() == "Darwin":
        soffice = "/Applications/LibreOffice.app/Contents/MacOS/soffice"
    return backend, Path(soffice) if soffice else None


class LegacyDocWorkerUnitTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="legacy-doc-test-")
        self.directory = Path(self.temp.name)
        self.source = self.directory / "source.doc"
        self.source.write_bytes(base64.b64decode(FIXTURE_B64.read_bytes()))
        self.object_source = self.directory / "embedded-objects.doc"
        self.object_source.write_bytes(gzip.decompress(base64.b64decode(OBJECT_FIXTURE_B64.read_bytes())))

    def tearDown(self):
        self.temp.cleanup()

    def test_pinned_apache_doc_fixture_is_real_cfb_word_with_macros(self):
        self.assertEqual(sha256(self.source.read_bytes()).hexdigest(), FIXTURE_SHA256)
        validate_source(self.source)
        macros = stream_hashes(self.source, ("Macros/",))
        self.assertEqual(len(macros), 10)
        self.assertIn("Macros/VBA/Module1", macros)
        self.assertIn("Macros/VBA/dir", macros)
        self.assertEqual(macros, stream_hashes(self.source, ("mAcRoS/",)))

    def test_rejects_a_zip_renamed_as_doc(self):
        fake = self.directory / "renamed.doc"
        fake.write_bytes(b"PK\x03\x04" + b"not a compound file")
        with self.assertRaises(WorkerFailure) as raised:
            validate_source(fake)
        self.assertEqual(raised.exception.code, "DOC_SOURCE_NOT_CFB")

    def test_pinned_apache_object_fixture_has_real_objectpool_streams(self):
        self.assertEqual(sha256(self.object_source.read_bytes()).hexdigest(), OBJECT_FIXTURE_SHA256)
        validate_source(self.object_source)
        objects = stream_hashes(self.object_source, ("ObjectPool/",))
        self.assertEqual(len(objects), 27)
        self.assertIn("ObjectPool/_1269427326/PowerPoint Document", objects)
        self.assertIn("ObjectPool/_1269427460/Workbook", objects)
        self.assertIn("ObjectPool/_1269427461/Workbook", objects)

    def test_builds_only_exact_customer_facing_text_comments_and_deduplicates(self):
        payload = {
            "decision_drafts": [{
                "source_anchor": {"exact_text": FIXTURE_TEXT},
                "customer_comment": "同一批注",
            }],
            "annotations": [{
                "selected_text": FIXTURE_TEXT,
                "comment": "同一批注",
            }, {
                "selected_text": "",
                "comment": "没有原文锚点，不得写入",
            }],
        }
        items = build_items(payload)
        self.assertEqual([(item.anchor, item.comment) for item in items], [(FIXTURE_TEXT, "同一批注")])

    def test_refuses_an_unisolated_backend(self):
        with self.assertRaises(WorkerFailure) as raised:
            sandbox_prefix("none", self.directory)
        self.assertEqual(raised.exception.code, "DOC_ISOLATION_UNAVAILABLE")

    def test_counts_overlapping_exact_text_anchors(self):
        self.assertEqual(overlapping_occurrences("aaaa", "aaa"), 2)
        self.assertEqual(overlapping_occurrences("unique", "unique"), 1)
        self.assertEqual(overlapping_occurrences("missing", "other"), 0)


@unittest.skipUnless(os.environ.get("DOC_WORKER_INTEGRATION") == "1", "set DOC_WORKER_INTEGRATION=1")
class LegacyDocWorkerIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="legacy-doc-integration-")
        self.directory = Path(self.temp.name)
        self.source = self.directory / "source.doc"
        self.source.write_bytes(base64.b64decode(FIXTURE_B64.read_bytes()))
        self.object_source = self.directory / "embedded-objects.doc"
        self.object_source.write_bytes(gzip.decompress(base64.b64decode(OBJECT_FIXTURE_B64.read_bytes())))
        self.output = self.directory / "annotated.doc"
        backend, soffice = integration_runtime()
        if not backend or not soffice or not soffice.is_file():
            self.fail("DOC integration requires an explicit isolation backend and soffice executable")
        self.backend = backend
        self.soffice = soffice

    def tearDown(self):
        self.temp.cleanup()

    def write_payload(self, anchor=FIXTURE_TEXT, comment="ONES DOC 隔离 Worker 原生批注"):
        payload = self.directory / "payload.json"
        payload.write_text(json.dumps({
            "export_mode": "source_annotated",
            "risks": [],
            "annotations": [{"selected_text": anchor, "comment": comment}],
            "decision_drafts": [],
        }, ensure_ascii=False), encoding="utf-8")
        return payload

    def test_real_doc_round_trip_preserves_text_page_macro_streams_and_native_comment(self):
        result = process_job(
            self.source,
            self.output,
            self.write_payload(),
            self.backend,
            self.soffice,
        )
        self.assertTrue(result["success"])
        self.assertEqual(result["source_text_hash"], result["output_text_hash"])
        self.assertEqual(result["macro_streams_verified"], 10)
        self.assertEqual(result["native_comments_added"], 1)
        self.assertEqual(result["target_load_macro_policy"], "MacroExecutionMode=0")
        self.assertEqual(result["conversion_macro_canary"], "not-proven")
        self.assertEqual(result["active_content_policy"], "disabled")
        self.assertEqual(result["proof_scope"], "trusted-fixture-local-proof")
        self.assertIn(result["network_isolation"], {
            "remote-denied-local-ipc-only",
            "network-namespace-unshared",
        })
        self.assertEqual(result["page_geometry"], [(612.0, 792.0)])
        self.assertEqual(
            stream_hashes(self.source, ("Macros/",)),
            stream_hashes(self.output, ("Macros/",)),
        )
        self.assertEqual(self.output.stat().st_mode & 0o777, 0o600)

    def test_missing_anchor_fails_closed_without_publishing_output(self):
        with self.assertRaises(WorkerFailure) as raised:
            process_job(
                self.source,
                self.output,
                self.write_payload(anchor="不存在的 DOC 原文锚点"),
                self.backend,
                self.soffice,
            )
        self.assertEqual(raised.exception.code, "DOC_ANNOTATION_ANCHOR_MISSING")
        self.assertFalse(self.output.exists())

    def test_real_embedded_objects_remain_a_red_gate_and_publish_nothing(self):
        with self.assertRaises(WorkerFailure) as raised:
            process_job(
                self.object_source,
                self.output,
                self.write_payload(anchor=OBJECT_FIXTURE_TEXT, comment="对象往返门禁批注"),
                self.backend,
                self.soffice,
            )
        self.assertEqual(raised.exception.code, "DOC_OBJECT_STREAM_CHANGED")
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
