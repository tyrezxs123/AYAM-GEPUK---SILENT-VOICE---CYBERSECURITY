# Evaluation

Two scripts. Both run against the real HTTP API, so what they report is what a judge would get.

## `run_eval.py` — the PRD Section 11 metrics

```bash
cd api && .venv/Scripts/python ../eval/run_eval.py
```

Signs clips, pushes them through seven channel conditions, splices them, replays them into the
Live Scan path, measures scam-phrase recall and false alarms, and times the verify path. Writes
`eval/out/report.md` and `report.json`, and exits non-zero if any metric misses its target.

Options: `--api` (default `http://localhost:8000`), `--clips`, `--data`, `--out`.

The API applies rate limits that a full run will trip. For a local evaluation only, start the
backend with `SUARASAH_RL_DISABLE=1`. Never set that on anything reachable from outside.

With no dataset present it falls back to synthetic speech and says so, loudly, in the report.

## `make_testset.py` — the week-1 dataset

```bash
cd api && .venv/Scripts/python ../eval/make_testset.py scripts
cd api && .venv/Scripts/python ../eval/make_testset.py conditions
cd api && .venv/Scripts/python ../eval/make_testset.py check
```

`scripts` writes `data/recording-scripts.md`: 14 scam-style and 10 normal lines in BM, English
and code-switched Malay-English. Each team member records all of them into `data/real/` as
`<person>-<nn>.wav`.

`conditions` renders clean, WhatsApp/Opus, MP3 128k and GSM 8 kHz versions of everything in
`data/real/` and `data/fake/`.

The **speakerphone** condition cannot be simulated — play each clip out of a phone's
loudspeaker and record it with a second device into `data/conditions/speakerphone/`.

### Consent

Clone **only** team members' own voices, **only** with their explicit agreement. Keep every clip
inside `eval/data/` (gitignored, never committed). Record which cloning tool produced each file
and its licence terms — the PRD lists that as an open question, and a judge may ask.

## What the numbers mean

- **Signed-clip survival** and **false acceptance** measure the provenance pipeline. These are
  the claims the pitch rests on.
- **AI-voice EER** needs `data/real/` and `data/fake/`. Without them the row reads
  "no dataset" — which is the honest answer, not a gap to paper over.
- **Phrase recall** is measured on transcripts passed directly to `/verify`, so it isolates the
  rule engine from transcription quality. Report ASR quality separately.
- **False alarms on everyday sentences** matter as much as recall. An app that shouts at an
  ordinary call gets uninstalled.
