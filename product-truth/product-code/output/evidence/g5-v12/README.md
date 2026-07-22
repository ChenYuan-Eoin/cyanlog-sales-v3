# G5 v12 legacy DOC evidence

This package intentionally records one green format proof and one red product
gate. It is not Production acceptance.

- `SimpleMacro.doc` produces a same-format DOC with one native comment. Source
  and output text hashes match, all 10 macro streams match, and the rendered
  source/output page PNGs are byte-identical.
- `word_with_embeded.doc` contains four real embedded Office objects. The
  LibreOffice round trip changes its `ObjectPool` and visibly loses embedded
  object previews. The accepted result is therefore
  `DOC_OBJECT_STREAM_CHANGED` with no published customer output.
- The local adapter is restricted to `trusted-fixture-local-proof` and is
  unconditionally disabled when `NODE_ENV=production`. Python and verification
  parsers are not yet inside the same isolation boundary, and conversion-path
  macro non-execution has no canary proof.

Decode an artifact on macOS with:

```sh
base64 -D -i simple-macro-annotated.doc.b64 -o simple-macro-annotated.doc
base64 -D -i embedded-objects-source-page-1.png.b64 -o embedded-objects-source-page-1.png
```

The source fixtures, pinned Apache POI license/notice, test logic and exact
SHA-256 values live under `lib/export/fixtures` and in `manifest.json`.
