OIB Converter

This small tool converts OpenIntuneBaseline Intune JSON exports into TrustM365 template JSON files.

Usage:

```bash
node cli.js --input <path-to-json-files> --templates BitLocker,Defender,ASR,Firewall,LAPS --out <output-dir>
```

Options:
- `--input` directory containing OpenIntuneBaseline JSON exports (or sample JSONs)
- `--templates` comma-separated list of template keywords to convert
- `--out` output directory (defaults to `backend/data/reference-templates/open-intune-baseline`)
- `--dry-run` print converted JSON to stdout instead of writing

License: output templates include `license: GPL-3.0` and attribution to OpenIntuneBaseline. Do not relicense OIB content.
