# G5 v11 Word DOCM local evidence

This directory preserves the reproducible source, generated output and Word
visual observation for the local DOCM file gate. The source was created by
Microsoft Word 16.111 and contains a real, empty `G5CanaryMacro`; it was never
executed. The exporter and validators only inspect package/OLE/MS-OVBA bytes.

Artifacts are Base64 text so they can be reviewed without Git binary-diff
ambiguity. On macOS, reconstruct them only in an isolated temporary directory:

```sh
base64 -D -i word-source.docm.b64 -o /tmp/g5-word-source.docm
base64 -D -i word-annotated.docm.b64 -o /tmp/g5-word-annotated.docm
base64 -D -i word-open.jpeg.b64 -o /tmp/g5-word-open.jpeg
```

Do not enable or run document macros. `manifest.json` records decoded byte
sizes, SHA-256 values, the three VBA package-part hashes before/after, validator
results, Word version and the exact visible `1/1` native comment observation.
This evidence closes only a local file-format gate; it is not Storage, SaaS,
iPad, deployment or Production proof.
