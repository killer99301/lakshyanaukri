# Parked: a reader for Hindi vacancy tables on scanned pages (B2.6)

Stopped on 2026-10-29 at the owner's request: a difficult notice goes through
the paste route instead (see tests/cms/bpsc-paste.test.ts), and the scan reader
stays best-effort with its checks. Kept so it can be picked up again.

- `b26-hindi-table-reader.patch`: the unfinished changes to
  src/lib/cms/importer/scan-tables.ts (applies on b9d1089).
- `table-lexicon.ts.txt`: the unfinished heading lexicon
  (src/lib/cms/importer/table-lexicon.ts).
- `bpsc-72-page{1,2}-transcription.json`: Gemini's real transcriptions of
  BPSC 72nd CCE pages 1-2. Not checked: rows 4 and 17 of सारणी I are misread
  (the figures in the page images differ).

Not tested, not wired in. Do not apply without the owner's go-ahead.
