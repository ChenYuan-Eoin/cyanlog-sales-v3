#!/usr/bin/env python3
"""Local format-preservation proof for Word 97-2003 native comments.

This process itself is not a production security boundary: Python parses the
compound file and verification outputs on the host while only LibreOffice is
sandboxed.  It may therefore be used only with trusted, pinned fixtures.  A
production adapter must run this entire process in a minimal isolated worker.
"""

from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass
from hashlib import sha256
import html
import json
import os
from pathlib import Path
import platform
import resource
import shutil
import signal
import subprocess
import sys
import tempfile
from typing import Any

import olefile
from docx import Document
from pypdf import PdfReader


CFB_MAGIC = bytes.fromhex("d0cf11e0a1b11ae1")
MAX_SOURCE_BYTES = 64 * 1024 * 1024
MAX_PAYLOAD_BYTES = 2 * 1024 * 1024
MAX_COMMENTS = 80
MAX_ANCHOR_CHARS = 8_000
MAX_COMMENT_CHARS = 20_000
MAX_COMMENT_ENV_BYTES = 200_000
DEFAULT_TIMEOUT_SECONDS = 45
PROOF_SCOPE = "trusted-fixture-local-proof"


class WorkerFailure(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class CommentItem:
    anchor: str
    comment: str


BASIC_SOURCE = r'''REM  *****  BASIC  *****

Sub Main
  On Error GoTo Failed

  Dim inputPath As String
  Dim outputPath As String
  Dim statusPath As String
  Dim itemCount As Integer
  inputPath = Environ("DOC_WORKER_INPUT")
  outputPath = Environ("DOC_WORKER_OUTPUT")
  statusPath = Environ("DOC_WORKER_STATUS")
  itemCount = CInt(Environ("DOC_WORKER_ITEM_COUNT"))

  Dim loadArgs(3) As New com.sun.star.beans.PropertyValue
  loadArgs(0).Name = "Hidden"
  loadArgs(0).Value = True
  loadArgs(1).Name = "ReadOnly"
  loadArgs(1).Value = False
  loadArgs(2).Name = "MacroExecutionMode"
  loadArgs(2).Value = 0
  loadArgs(3).Name = "UpdateDocMode"
  loadArgs(3).Value = 0

  Dim document As Object
  document = StarDesktop.loadComponentFromURL(ConvertToURL(inputPath), "_blank", 0, loadArgs())
  If IsNull(document) Or IsEmpty(document) Then
    WriteStatus statusPath, "error|open_failed"
    StarDesktop.terminate()
    Exit Sub
  End If

  Dim sourceText As String
  sourceText = document.Text.String
  Dim index As Integer
  For index = 0 To itemCount - 1
    Dim anchorText As String
    Dim commentText As String
    anchorText = Environ("DOC_WORKER_ANCHOR_" & CStr(index))
    commentText = Environ("DOC_WORKER_COMMENT_" & CStr(index))

    Dim descriptor As Object
    descriptor = document.createSearchDescriptor()
    descriptor.SearchString = anchorText
    descriptor.SearchCaseSensitive = True
    descriptor.SearchWords = False

    Dim found As Object
    found = document.findFirst(descriptor)
    If IsNull(found) Or IsEmpty(found) Then
      document.close(True)
      WriteStatus statusPath, "error|anchor_missing|" & CStr(index)
      StarDesktop.terminate()
      Exit Sub
    End If

    Dim duplicate As Object
    duplicate = document.findNext(found.End, descriptor)
    If Not IsNull(duplicate) And Not IsEmpty(duplicate) Then
      document.close(True)
      WriteStatus statusPath, "error|anchor_ambiguous|" & CStr(index)
      StarDesktop.terminate()
      Exit Sub
    End If

    Dim annotation As Object
    annotation = document.createInstance("com.sun.star.text.TextField.Annotation")
    annotation.Author = "ONES 业务运营"
    annotation.Initials = "ONES"
    annotation.Content = commentText
    found.Text.insertTextContent(found, annotation, True)
  Next index

  If document.Text.String <> sourceText Then
    document.close(True)
    WriteStatus statusPath, "error|text_changed_before_save"
    StarDesktop.terminate()
    Exit Sub
  End If

  Dim storeArgs(1) As New com.sun.star.beans.PropertyValue
  storeArgs(0).Name = "FilterName"
  storeArgs(0).Value = "MS Word 97"
  storeArgs(1).Name = "Overwrite"
  storeArgs(1).Value = True
  document.storeAsURL(ConvertToURL(outputPath), storeArgs())
  document.close(True)
  WriteStatus statusPath, "ok|" & CStr(itemCount)
  StarDesktop.terminate()
  Exit Sub

Failed:
  WriteStatus statusPath, "error|runtime|" & CStr(Err) & "|" & Error$
  StarDesktop.terminate()
End Sub

Sub WriteStatus(statusPath As String, value As String)
  Dim fileNumber As Integer
  fileNumber = FreeFile
  Open statusPath For Output As #fileNumber
  Print #fileNumber, value
  Close #fileNumber
End Sub
'''


def sha256_file(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def normalized_office_text(raw: bytes) -> str:
    return raw.decode("utf-8-sig", errors="strict").replace("\r\n", "\n").rstrip("\n")


def validate_source(path: Path) -> None:
    if not path.is_file():
        raise WorkerFailure("DOC_SOURCE_MISSING", "DOC source file does not exist")
    size = path.stat().st_size
    if size <= len(CFB_MAGIC) or size > MAX_SOURCE_BYTES:
        raise WorkerFailure("DOC_SOURCE_SIZE_INVALID", "DOC source size is outside the worker limit")
    if path.read_bytes()[: len(CFB_MAGIC)] != CFB_MAGIC or not olefile.isOleFile(str(path)):
        raise WorkerFailure("DOC_SOURCE_NOT_CFB", "DOC source is not an OLE2 compound file")

    with olefile.OleFileIO(str(path)) as compound:
        streams = {
            "/".join(parts).casefold()
            for parts in compound.listdir(streams=True, storages=False)
        }
    if "worddocument" not in streams or not ({"0table", "1table"} & streams):
        raise WorkerFailure("DOC_SOURCE_NOT_WORD", "OLE2 source lacks required WordDocument/table streams")


def stream_hashes(path: Path, prefixes: tuple[str, ...]) -> dict[str, str]:
    result: dict[str, str] = {}
    folded_prefixes = tuple(prefix.casefold() for prefix in prefixes)
    with olefile.OleFileIO(str(path)) as compound:
        for parts in compound.listdir(streams=True, storages=False):
            name = "/".join(parts)
            folded_name = name.casefold()
            if not any(
                folded_name == prefix.rstrip("/") or folded_name.startswith(prefix)
                for prefix in folded_prefixes
            ):
                continue
            result[name] = sha256(compound.openstream(parts).read()).hexdigest()
    return result


def overlapping_occurrences(text: str, needle: str) -> int:
    if not needle:
        return 0
    count = 0
    cursor = 0
    while True:
        cursor = text.find(needle, cursor)
        if cursor < 0:
            return count
        count += 1
        cursor += 1


def build_items(payload: dict[str, Any]) -> list[CommentItem]:
    items: list[CommentItem] = []
    for decision in payload.get("decision_drafts") or []:
        anchor = decision.get("source_anchor") or {}
        exact_text = str(anchor.get("exact_text") or "").strip()
        comment = str(decision.get("customer_comment") or "").strip()
        revision = str(decision.get("revision_text") or "").strip()
        if not comment and revision:
            comment = f"建议受控替换为：{revision}"
        if exact_text and comment:
            items.append(CommentItem(exact_text, comment))

    for annotation in payload.get("annotations") or []:
        anchor = str(annotation.get("selected_text") or "").strip()
        comment = str(annotation.get("comment") or "").strip()
        if anchor and comment:
            items.append(CommentItem(anchor, comment))

    deduped: list[CommentItem] = []
    seen: set[tuple[str, str]] = set()
    for item in items:
        key = (item.anchor, item.comment)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)

    if not deduped:
        raise WorkerFailure("DOC_NO_TEXT_COMMENTS", "DOC export has no exact text-anchored customer comments")
    if len(deduped) > MAX_COMMENTS:
        raise WorkerFailure("DOC_TOO_MANY_COMMENTS", "DOC export exceeds the per-file comment limit")
    for item in deduped:
        if len(item.anchor) > MAX_ANCHOR_CHARS or len(item.comment) > MAX_COMMENT_CHARS:
            raise WorkerFailure("DOC_COMMENT_TOO_LARGE", "DOC comment anchor or content exceeds the worker limit")
    total_env_bytes = sum(len(item.anchor.encode("utf-8")) + len(item.comment.encode("utf-8")) for item in deduped)
    if total_env_bytes > MAX_COMMENT_ENV_BYTES:
        raise WorkerFailure("DOC_COMMENT_PAYLOAD_TOO_LARGE", "DOC text comments exceed the isolated process environment limit")
    return deduped


def write_profile(profile: Path) -> None:
    standard = profile / "user" / "basic" / "Standard"
    standard.mkdir(parents=True, mode=0o700)
    (profile / "user" / "basic" / "script.xlc").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<library:libraries xmlns:library="http://openoffice.org/2000/library" '
        'xmlns:xlink="http://www.w3.org/1999/xlink"><library:library '
        'library:name="Standard" library:link="false"/></library:libraries>\n',
        encoding="utf-8",
    )
    (profile / "user" / "basic" / "dialog.xlc").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<library:libraries xmlns:library="http://openoffice.org/2000/library" '
        'xmlns:xlink="http://www.w3.org/1999/xlink"><library:library '
        'library:name="Standard" library:link="false"/></library:libraries>\n',
        encoding="utf-8",
    )
    (standard / "script.xlb").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<library:library xmlns:library="http://openoffice.org/2000/library" '
        'library:name="Standard" library:readonly="false" library:passwordprotected="false">'
        '<library:element library:name="Module1"/></library:library>\n',
        encoding="utf-8",
    )
    (standard / "dialog.xlb").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<library:library xmlns:library="http://openoffice.org/2000/library" '
        'library:name="Standard" library:readonly="false" library:passwordprotected="false"/>\n',
        encoding="utf-8",
    )
    (standard / "Module1.xba").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<script:module xmlns:script="http://openoffice.org/2000/script" '
        'script:name="Module1" script:language="StarBasic">'
        f'{html.escape(BASIC_SOURCE)}</script:module>\n',
        encoding="utf-8",
    )
    (profile / "user" / "registrymodifications.xcu").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<oor:items xmlns:oor="http://openoffice.org/2001/registry" '
        'xmlns:xs="http://www.w3.org/2001/XMLSchema" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n'
        '<item oor:path="/org.openoffice.Setup/Office"><prop oor:name="ooSetupInstCompleted" '
        'oor:op="fuse"><value>true</value></prop></item>\n'
        '<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop '
        'oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>\n'
        '<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop '
        'oor:name="DisableMacrosExecution" oor:op="fuse"><value>false</value></prop></item>\n'
        '<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop '
        'oor:name="DisableActiveContent" oor:op="fuse"><value>true</value></prop></item>\n'
        '<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop '
        'oor:name="DisablePythonRuntime" oor:op="fuse"><value>true</value></prop></item>\n'
        '<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop '
        'oor:name="DisableOLEAutomation" oor:op="fuse"><value>true</value></prop></item>\n'
        '</oor:items>\n',
        encoding="utf-8",
    )


def resource_limits() -> None:
    limits = [
        (resource.RLIMIT_CPU, 30, 30),
        (resource.RLIMIT_FSIZE, 256 * 1024 * 1024, 256 * 1024 * 1024),
        (resource.RLIMIT_NOFILE, 128, 128),
    ]
    # RLIMIT_NPROC is per-user on macOS. Applying a small value from a desktop
    # process can prevent LibreOffice from starting because unrelated user
    # processes already consume the allowance. Bubblewrap provides the Linux
    # process boundary, where this additional cap remains useful.
    if platform.system() == "Linux":
        limits.append((resource.RLIMIT_NPROC, 64, 64))
    for kind, soft, hard in limits:
        _, current_hard = resource.getrlimit(kind)
        target_hard = hard if current_hard == resource.RLIM_INFINITY else min(hard, current_hard)
        if target_hard < soft:
            raise RuntimeError(f"required resource limit {kind} is unavailable")
        resource.setrlimit(kind, (soft, target_hard))


def sandbox_prefix(backend: str, workspace: Path) -> tuple[list[str], str]:
    if backend == "macos-sandbox-exec":
        if platform.system() != "Darwin" or not Path("/usr/bin/sandbox-exec").is_file():
            raise WorkerFailure("DOC_ISOLATION_UNAVAILABLE", "macOS sandbox-exec backend is unavailable")
        profile = (
            '(version 1) (allow default) (deny network*) '
            '(allow network* (local ip)) '
            '(allow network* (remote unix-socket)) '
            '(allow network* (local unix-socket))'
        )
        return ["/usr/bin/sandbox-exec", "-p", profile], "remote-denied-local-ipc-only"

    if backend == "bubblewrap":
        executable = shutil.which("bwrap")
        if not executable:
            raise WorkerFailure("DOC_ISOLATION_UNAVAILABLE", "bubblewrap backend is unavailable")
        return [
            executable,
            "--die-with-parent",
            "--new-session",
            "--unshare-all",
            "--share-user",
            "--ro-bind", "/", "/",
            "--bind", str(workspace), str(workspace),
            "--proc", "/proc",
            "--dev", "/dev",
            "--chdir", str(workspace),
        ], "network-namespace-unshared"

    raise WorkerFailure("DOC_ISOLATION_UNAVAILABLE", "DOC worker requires macOS sandbox-exec or bubblewrap")


def verify_remote_network_denied(backend: str, workspace: Path) -> str:
    prefix, isolation = sandbox_prefix(backend, workspace)
    probe = (
        "import socket; "
        "connection=socket.create_connection(('1.1.1.1', 443), 2); "
        "connection.close()"
    )
    try:
        completed = subprocess.run(
            prefix + [sys.executable, "-c", probe],
            cwd=workspace,
            env={
                "HOME": str(workspace / "home"),
                "TMPDIR": str(workspace / "tmp"),
                "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
                "PYTHONNOUSERSITE": "1",
            },
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=5,
            start_new_session=True,
            preexec_fn=resource_limits,
        )
    except subprocess.TimeoutExpired:
        return isolation
    if completed.returncode == 0:
        raise WorkerFailure("DOC_NETWORK_ISOLATION_FAILED", "isolated DOC process unexpectedly reached a remote IP")
    return isolation


def run_office(
    *,
    soffice: Path,
    backend: str,
    workspace: Path,
    profile: Path,
    args: list[str],
    extra_env: dict[str, str] | None = None,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> subprocess.CompletedProcess[bytes]:
    prefix, _ = sandbox_prefix(backend, workspace)
    command = prefix + [
        str(soffice),
        f"-env:UserInstallation={profile.as_uri()}",
        "--headless",
        "--nologo",
        "--nodefault",
        "--nolockcheck",
        "--norestore",
        "--nofirststartwizard",
        *args,
    ]
    env = {
        "HOME": str(workspace / "home"),
        "TMPDIR": str(workspace / "tmp"),
        "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
        "LANG": "en_US.UTF-8",
        "LC_ALL": "en_US.UTF-8",
        "SAL_USE_VCLPLUGIN": "svp",
    }
    if extra_env:
        env.update(extra_env)

    try:
        process = subprocess.Popen(
            command,
            cwd=workspace,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
            preexec_fn=resource_limits,
        )
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired as error:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            process.kill()
        process.communicate()
        operation = args[0] if args else "unknown"
        raise WorkerFailure("DOC_WORKER_TIMEOUT", f"LibreOffice worker exceeded its deadline during {operation}") from error

    if process.returncode != 0:
        stderr_text = stderr.decode("utf-8", errors="replace").strip()[-1_000:]
        raise WorkerFailure("DOC_WORKER_RUNTIME_FAILED", stderr_text or "LibreOffice worker failed")
    return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)


def office_text(**kwargs: Any) -> str:
    path = kwargs.pop("path")
    completed = run_office(args=["--cat", str(path)], **kwargs)
    return normalized_office_text(completed.stdout)


def convert_file(*, source: Path, output_dir: Path, target: str, filter_name: str, **kwargs: Any) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    run_office(args=["--convert-to", f"{target}:{filter_name}", "--outdir", str(output_dir), str(source)], **kwargs)
    output = output_dir / f"{source.stem}.{target}"
    if not output.is_file():
        raise WorkerFailure("DOC_WORKER_CONVERSION_FAILED", f"LibreOffice did not create {target} verification output")
    return output


def pdf_geometry(path: Path) -> list[tuple[float, float]]:
    reader = PdfReader(str(path))
    return [
        (round(float(page.mediabox.width), 3), round(float(page.mediabox.height), 3))
        for page in reader.pages
    ]


def docx_comment_texts(path: Path) -> list[str]:
    return [comment.text for comment in Document(str(path)).comments]


def process_job(input_path: Path, output_path: Path, payload_path: Path, backend: str, soffice: Path) -> dict[str, Any]:
    validate_source(input_path)
    if payload_path.stat().st_size > MAX_PAYLOAD_BYTES:
        raise WorkerFailure("DOC_PAYLOAD_TOO_LARGE", "DOC comment payload exceeds the worker limit")
    payload = json.loads(payload_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise WorkerFailure("DOC_PAYLOAD_INVALID", "DOC comment payload must be an object")
    items = build_items(payload)

    if not soffice.is_absolute() or not soffice.is_file() or not os.access(soffice, os.X_OK):
        raise WorkerFailure("DOC_SOFFICE_UNAVAILABLE", "Configured soffice executable is unavailable")

    with tempfile.TemporaryDirectory(prefix="ones-doc-worker-") as raw_workspace:
        workspace = Path(raw_workspace).resolve()
        for directory in (workspace / "home", workspace / "tmp", workspace / "items", workspace / "result"):
            directory.mkdir(parents=True, mode=0o700)
        profile = workspace / "profile"
        write_profile(profile)
        source = workspace / "source.doc"
        candidate = workspace / "result" / "annotated.doc"
        status = workspace / "result" / "status.txt"
        shutil.copyfile(input_path, source)
        network_isolation = verify_remote_network_denied(backend, workspace)
        source_macro_hashes = stream_hashes(source, ("Macros/",))
        source_object_hashes = stream_hashes(source, ("ObjectPool/",))
        source_text = office_text(
            soffice=soffice, backend=backend, workspace=workspace, profile=profile, path=source,
        )
        for item in items:
            occurrences = overlapping_occurrences(source_text, item.anchor)
            if occurrences == 0:
                raise WorkerFailure("DOC_ANNOTATION_ANCHOR_MISSING", "DOC exact-text anchor is absent")
            if occurrences > 1:
                raise WorkerFailure("DOC_ANNOTATION_ANCHOR_AMBIGUOUS", "DOC exact-text anchor is not unique")
        comment_env = {
            f"DOC_WORKER_{kind}_{index}": value
            for index, item in enumerate(items)
            for kind, value in (("ANCHOR", item.anchor), ("COMMENT", item.comment))
        }
        run_office(
            soffice=soffice,
            backend=backend,
            workspace=workspace,
            profile=profile,
            args=["macro:///Standard.Module1.Main"],
            extra_env={
                "DOC_WORKER_INPUT": str(source),
                "DOC_WORKER_OUTPUT": str(candidate),
                "DOC_WORKER_STATUS": str(status),
                "DOC_WORKER_ITEM_COUNT": str(len(items)),
                **comment_env,
            },
        )
        status_value = status.read_text(encoding="utf-8").strip() if status.is_file() else ""
        if status_value != f"ok|{len(items)}" or not candidate.is_file():
            if "anchor_missing" in status_value:
                code = "DOC_ANNOTATION_ANCHOR_MISSING"
            elif "anchor_ambiguous" in status_value:
                code = "DOC_ANNOTATION_ANCHOR_AMBIGUOUS"
            else:
                code = "DOC_WORKER_ANNOTATION_FAILED"
            raise WorkerFailure(code, status_value or "LibreOffice did not publish an annotated DOC")

        validate_source(candidate)
        output_macro_hashes = stream_hashes(candidate, ("Macros/",))
        output_object_hashes = stream_hashes(candidate, ("ObjectPool/",))
        if output_macro_hashes != source_macro_hashes:
            raise WorkerFailure("DOC_MACRO_STREAM_CHANGED", "DOC macro streams changed during annotation round-trip")
        if output_object_hashes != source_object_hashes:
            raise WorkerFailure("DOC_OBJECT_STREAM_CHANGED", "DOC embedded ObjectPool streams changed during annotation round-trip")

        output_text = office_text(
            soffice=soffice, backend=backend, workspace=workspace, profile=profile, path=candidate,
        )
        if output_text != source_text:
            raise WorkerFailure("DOC_TEXT_CHANGED", "DOC source text changed during annotation round-trip")

        source_pdf = convert_file(
            soffice=soffice, backend=backend, workspace=workspace, profile=profile,
            source=source, output_dir=workspace / "verify-source-pdf", target="pdf", filter_name="writer_pdf_Export",
        )
        output_pdf = convert_file(
            soffice=soffice, backend=backend, workspace=workspace, profile=profile,
            source=candidate, output_dir=workspace / "verify-output-pdf", target="pdf", filter_name="writer_pdf_Export",
        )
        source_geometry = pdf_geometry(source_pdf)
        output_geometry = pdf_geometry(output_pdf)
        if source_geometry != output_geometry:
            raise WorkerFailure("DOC_PAGE_GEOMETRY_CHANGED", "DOC page count or page dimensions changed during round-trip")

        source_docx = convert_file(
            soffice=soffice, backend=backend, workspace=workspace, profile=profile,
            source=source, output_dir=workspace / "verify-source-docx", target="docx", filter_name="Office Open XML Text",
        )
        output_docx = convert_file(
            soffice=soffice, backend=backend, workspace=workspace, profile=profile,
            source=candidate, output_dir=workspace / "verify-output-docx", target="docx", filter_name="Office Open XML Text",
        )
        source_comments = Counter(docx_comment_texts(source_docx))
        output_comments = Counter(docx_comment_texts(output_docx))
        expected_comments = Counter(item.comment for item in items)
        added_comments = output_comments - source_comments
        if any(added_comments[text] < count for text, count in expected_comments.items()):
            raise WorkerFailure("DOC_NATIVE_COMMENT_MISSING", "DOC output does not contain every requested native comment")

        output_path.parent.mkdir(parents=True, exist_ok=True)
        staged_output = output_path.with_name(f".{output_path.name}.staged")
        shutil.copyfile(candidate, staged_output)
        staged_output.chmod(0o600)
        os.replace(staged_output, output_path)
        return {
            "success": True,
            "anchored": len(items),
            "unlocated": [],
            "source_hash": sha256_file(input_path),
            "output_hash": sha256_file(output_path),
            "source_text_hash": sha256(source_text.encode("utf-8")).hexdigest(),
            "output_text_hash": sha256(output_text.encode("utf-8")).hexdigest(),
            "macro_streams_verified": len(source_macro_hashes),
            "object_streams_verified": len(source_object_hashes),
            "page_geometry": source_geometry,
            "native_comments_added": sum(expected_comments.values()),
            "target_load_macro_policy": "MacroExecutionMode=0",
            "conversion_macro_canary": "not-proven",
            "active_content_policy": "disabled",
            "network_isolation": network_isolation,
            "isolation_backend": backend,
            "proof_scope": PROOF_SCOPE,
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--payload", required=True, type=Path)
    parser.add_argument("--backend", required=True, choices=("macos-sandbox-exec", "bubblewrap"))
    parser.add_argument("--soffice", required=True, type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        result = process_job(
            args.input.resolve(),
            args.output.resolve(),
            args.payload.resolve(),
            args.backend,
            args.soffice.resolve(),
        )
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except WorkerFailure as error:
        args.output.unlink(missing_ok=True)
        print(json.dumps({"success": False, "error_code": error.code, "error": str(error)}, ensure_ascii=False))
        return 2
    except Exception as error:
        args.output.unlink(missing_ok=True)
        print(json.dumps({"success": False, "error_code": "DOC_WORKER_INTERNAL_ERROR", "error": str(error)}, ensure_ascii=False))
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
