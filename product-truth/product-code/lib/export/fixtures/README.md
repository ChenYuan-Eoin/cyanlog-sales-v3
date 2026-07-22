# Word binary fixture provenance

`apache-poi-SimpleMacro.docm.b64` is a base64 encoding of Apache POI's
`test-data/document/SimpleMacro.docm` at commit
`4554f204cbbf00ecbcaed134fe57e43a1779a612`.

- Upstream file: <https://github.com/apache/poi/blob/4554f204cbbf00ecbcaed134fe57e43a1779a612/test-data/document/SimpleMacro.docm>
- Raw size: 15,517 bytes
- Git blob: `123b8157f3dacb7fb678460a35e57315d0777c94`
- SHA-256: `fd591958fcf5322f72c0a740e9606309c949254bda4c3d9bd966481ddf220563`
- License: Apache License 2.0; see <https://github.com/apache/poi/blob/4554f204cbbf00ecbcaed134fe57e43a1779a612/legal/LICENSE>

The pinned upstream `LICENSE` and `NOTICE` are redistributed beside these
fixtures as `APACHE-POI-LICENSE.txt` and `APACHE-POI-NOTICE.txt`.

The fixture is decoded only inside tests and its macros are never executed.
It provides a real Word-origin VBA project for static package validation and
byte-for-byte macro asset preservation checks.

The DOCM gate also requires the exact static parsers pinned in
`requirements.txt`; neither parser executes VBA. A fresh environment must run
`python3 -m pip install -r requirements.txt` before export or acceptance.
From the app root, `pnpm test:g5-file` runs the Word/PDF file gate and fails
closed when those Python dependencies are absent. `pnpm test:g5-acceptance`
combines the complete Vitest suite with the file gate.

`apache-poi-SimpleMacro.doc.b64` is the Word 97-2003 binary fixture from the
same pinned Apache POI commit.

- Upstream file: <https://github.com/apache/poi/blob/4554f204cbbf00ecbcaed134fe57e43a1779a612/test-data/document/SimpleMacro.doc>
- Raw size: 36,864 bytes
- SHA-256: `39e9608c711d38f298ed20a5bfae12fcdaed6f4be2be4d26db670475216ca393`
- License: Apache License 2.0, inherited from the pinned Apache POI repository

The DOC integration gate uses this only as a trusted local fixture. It sets
document `MacroExecutionMode` to never, disables active content, denies remote
network access to LibreOffice, bounds subprocess runtime resources, and
requires every `Macros/**` and `ObjectPool/**` OLE stream to match byte for
byte before publishing the annotated DOC. This is a format-preservation proof,
not a production security boundary: Python and its verification parsers are
still outside the LibreOffice sandbox.

`apache-poi-word-with-embedded.doc.gz.b64` is a deterministic gzip+base64
encoding of Apache POI's real `word_with_embeded.doc` object fixture at the
same pinned commit.

- Upstream file: <https://github.com/apache/poi/blob/4554f204cbbf00ecbcaed134fe57e43a1779a612/test-data/document/word_with_embeded.doc>
- Raw size: 117,248 bytes
- SHA-256: `206acf1f7eb7b7d2075e04015d005ae9bb56f025560f2583ad3878257bc4c7`
- License: Apache License 2.0, inherited from the pinned Apache POI repository
- Contents: 27 `ObjectPool/**` streams across two Excel objects, one
  PowerPoint object and one Word object

This fixture is intentionally a red gate. LibreOffice currently renumbers the
object storages and loses visible embedded-object previews during the DOC
round trip. The integration test therefore requires
`DOC_OBJECT_STREAM_CHANGED` and no published output. Do not weaken this check
to ignore storage names: G5 remains incomplete until object identity,
rendering and activation are all independently proven inside a whole-worker
container or microVM.
