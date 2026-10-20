# SuaraSah

**Jangan percaya suara. Sahkan asalnya.** · *Don't trust the voice. Verify its origin.*

A bilingual (BM/English) mobile web app that tells an ordinary Malaysian whether a voice they
are hearing can be trusted — in seconds, with no technical knowledge.

Two ideas, kept strictly separate:

| | What it does | What it can return |
| --- | --- | --- |
| **Verify what is real** | Cryptographic voice provenance: an Ed25519 signature over perceptual fingerprints of the audio | `VERIFIED` · `TAMPERED` · `REPLAYED` · `EXPIRED` |
| **Warn about what looks fake** | AI-voice screening + BM/EN scam-phrase rules | a risk level only — **never** `VERIFIED` |

> Only cryptographic verification can return VERIFIED. Detection can raise a warning; it can
> never grant trust. This rule is enforced in code (`api/app/service.py`), not just in the pitch.

---

## Run it

Two processes: a FastAPI backend and a Next.js PWA.

```bash
cd api && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
```

```bash
cd web && npm install
```

Then from the repo root:

```bash
./dev.ps1
```

- Web: <http://localhost:3000>
- API: <http://localhost:8000> · interactive docs at `/docs`

On macOS/Linux use `./dev.sh`. To run them by hand:

```bash
cd api && .venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
```

```bash
cd web && npm run dev
```

The web app finds the API automatically: it reuses the hostname that served the page and
switches to port 8000, so a phone on the venue LAN works with no rebuild. Override with
`NEXT_PUBLIC_API_BASE` in `web/.env.local`.

### Demoing on a real phone (read this one)

`getUserMedia()` only works in a **secure context**. `localhost` counts as secure; a plain
`http://192.168.x.x` does **not**. Over the LAN without TLS, the Live Scan and the recorder
are dead on arrival. So generate a local certificate covering your LAN IPs:

```bash
bash scripts/make-dev-cert.sh
```

```bash
./dev.ps1 -Https
```

On the phone, open `https://<laptop-ip>:8000/health` **first** and accept the certificate
warning, then open `https://<laptop-ip>:3000`. If you skip the API host, the app loads but
every call fails silently — browsers do not prompt twice.

Add to the home screen to get the installed, full-screen PWA.

---

## The three flows

Every task is at most three taps from the home screen.

**Semak Audio** (Verify, no login) — pick a WhatsApp voice note or record what you are
hearing, get one card: a verdict word, a colour, an icon, and 2–3 concrete next steps.

**Imbas Panggilan** (Live Scan) — put the call on speakerphone, hold the phone close. First
verdict in a few seconds, updates every ~2 s, the card turns red only after two consecutive
high windows, and the phone vibrates on that transition.

**Tandatangan Suara** (Sign my voice) — register this device once, record up to 60 s, get back
a signed WAV to send on WhatsApp. The private key is generated in the browser and never leaves it.

---

## How the security actually works

The watermark carries **only a pointer**. Trust comes from a signature over the audio's
*content fingerprints*, checked segment by segment. A watermark alone never makes audio VERIFIED.

### Signing

1. The browser creates an **Ed25519** key pair. With WebCrypto the private key is
   **non-extractable** — page scripts can ask the browser to sign, but cannot read the key.
   `@noble/ed25519` is the documented fallback, and the app reports which path is in use.
2. The server issues a session: `session_id`, 128-bit `nonce`, `issued_at`, `expires_at`.
3. Audio is resampled to 16 kHz mono, the 16-bit `ref` is **embedded first**, and only then is
   the audio split into 2 s segments and fingerprinted. Fingerprinting the *watermarked* audio
   means the signed fingerprints describe exactly the file the recipient receives.
4. The device signs
   `DOMAIN ‖ session_id ‖ nonce ‖ issued_at ‖ expires_at ‖ context ‖ SHA-256(fingerprints)`,
   each field length-prefixed so two different field sets can never collide.
5. The server verifies the signature **before** storing anything, returns the signed WAV, and
   drops the audio. No table holds audio.

The client **rebuilds those bytes itself** and refuses to sign if they differ from what the
server sent (`web/src/lib/device-key.ts`). A compromised backend therefore cannot steer a
device into signing a payload describing someone else's audio. The Python and TypeScript
payload builders are verified byte-identical in the browser.

### Why not SHA-256 of the samples

WhatsApp re-encodes every voice note to Opus, so a plain hash would mark every legitimately
forwarded clip as TAMPERED. We use a Haitsma–Kalker style perceptual hash: 33 log-spaced bands
across 300–3400 Hz, and the sign of the *second* difference of band energy (across bands, then
across time). The double difference cancels constant gain and slow channel colouring, so the
hash survives ±6 dB, resampling and lossy compression — while still changing completely if the
speech is replaced. Matching is by bit error rate with a small alignment search.

### Verdict rules (first match wins)

| Verdict | Condition |
| --- | --- |
| `TAMPERED` | Known ref, but signature invalid, or any segment fails its fingerprint or lacks the mark, or the key is revoked |
| `REPLAYED` | A signed clip detected inside Live Scan audio, or reused past `expires_at` |
| `EXPIRED` | Valid signature, all segments match, but past `expires_at` |
| `VERIFIED` | Valid signature, all segments match, not expired, key not revoked |
| `UNVERIFIED` | No watermark — plus the detection result |

**One deliberate refinement of the PRD table.** The PRD says "watermark found but signature
invalid → TAMPERED". A watermark whose `ref` matches *no record at all* is not an invalid
signature — we simply have no claim to check, and it can also be a fallback-detector false
positive. Calling that TAMPERED would frighten a user about an innocent clip, so an unknown
ref falls through to `UNVERIFIED` with a note. A ref that *does* resolve and then fails is
TAMPERED, exactly as written. See `api/app/core/verdict.py`.

Expiry and context are *inside* the signature, so they cannot be edited in the database to
revive a stale clip — there is a test asserting exactly that.

---

## Engines: fallbacks today, real models when you want them

Every engine sits behind an adapter in `api/app/engines/`. The product runs **today** on
fallbacks that need no GPU and no model downloads. Switching to the real models is one
install and a restart — no other file changes.

```bash
cd api && .venv/Scripts/pip install -r requirements.txt -r requirements-ml.txt
```

| Role | Fallback (default) | Real model (`requirements-ml.txt`) |
| --- | --- | --- |
| Watermark | `spread-spectrum-fallback-v1` — differential sub-band patchwork | **AudioSeal** 16-bit |
| AI-voice | `heuristic-dsp-v0` — **screening only, no measured EER** | **XLS-R + AASIST** (`eliya/forensics_0.3B_xlsr_wild_deepfake_classifier`) |
| Transcription | the phone's own Web Speech API | **faster-whisper** (BM/EN auto-detect) |

`/health` reports which engines are live, and **the UI prints the engine name and the words
"screening only — not proof" whenever the detector is uncalibrated.** That label is not
decoration: it is what keeps the demo honest when a judge asks what the number means.

### About the fallback watermark

Hard per-bit decoding plus a CRC turned out to be the wrong decoder: Opus reliably flips the
one or two bits sitting under a strong vocal harmonic, failing the CRC even though the overall
pattern still correlates at **+0.99**. So the detector returns a soft statistic and matches it
against the refs we have actually issued, weighting each bit by its own confidence. Random
refs peak around 0.6; the threshold is 0.80.

---

## Measured behaviour

Run the harness against a live API — it drives the real HTTP endpoints, so the numbers are
the ones a judge would get:

```bash
cd api && .venv/Scripts/python ../eval/run_eval.py
```

With the fallback engines and synthetic speech (4 clips × 7 channel conditions):

| Metric | Target | Result |
| --- | --- | --- |
| Signed clip VERIFIED after WhatsApp/Opus re-encode | ≥ 95% | **100%** |
| Unsigned audio wrongly shown VERIFIED | 0% | **0%** |
| Spliced clips caught as TAMPERED | ≥ 90% | **100%** |
| Replayed signed clips caught in Live Scan | ≥ 90% | **100%** |
| Scam-phrase recall on BM/EN scripts | ≥ 80% | **100%** |
| Everyday sentences flagged High risk | 0 | **0** |
| File verify latency (median / p95) | ≤ 5 s | **99 ms / 171 ms** |

Signed clips verified at 100% under all seven conditions: clean, Opus, MP3 128k, GSM 8 kHz,
±6 dB, and −40 dB noise.

> **These came from synthetic speech, not human voices.** They show the provenance pipeline
> behaves correctly. They are **not** evidence about real Malay speech or real voice clones,
> and the AI-voice EER is not measured at all yet. Build the team dataset before putting any
> of this in a pitch:
>
> ```bash
> cd api && .venv/Scripts/python ../eval/make_testset.py scripts
> ```
>
> That writes the lines each member reads (14 scam-style + 10 normal, BM/EN/code-switched).
> Record into `eval/data/real/`, clone the same lines into `eval/data/fake/` — **only team
> members' own voices, only with their consent** — then `make_testset.py conditions` renders
> the channel conditions and `run_eval.py` fills in the EER row.

Backend tests:

```bash
cd api && .venv/Scripts/python -m pytest tests -q
```

22 tests covering all four verdicts, Opus and GSM re-encode, splice localisation, replay,
expiry, key revocation, forged signatures, phrase escalation, and the Live Scan WebSocket.

---

## Repository layout

```
api/     FastAPI backend
  app/core/       audio_io, fingerprint, watermark, crypto, verdict, phrases, risk, guidance
  app/engines/    pluggable adapters + registry (picks the best available at import)
  app/routes/     /keys /sessions /verify /live /reports
  tests/          end-to-end tests through the real app
web/     Next.js 15 PWA (App Router, Tailwind, TypeScript)
  src/lib/        api, device-key (Ed25519), audio (capture + WAV), live (WS), speech, i18n
  src/components/ VerdictCard, AppShell, Sheets, Feedback, Icons
  public/         manifest, service worker, PCM AudioWorklet, icons
eval/    run_eval.py (PRD §11 metrics), make_testset.py (week-1 dataset)
scripts/ make-dev-cert.sh (TLS for phone demos)
```

### API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/keys` | Register a device public key |
| `POST` | `/keys/{id}/revoke` | Revoke a lost or stolen device |
| `POST` | `/sessions` | Start a signing session |
| `POST` | `/sessions/{id}/prepare` | Upload audio → watermark, fingerprints, payload to sign |
| `POST` | `/sessions/{id}/sign` | Submit the signature → signed WAV |
| `POST` | `/verify` | Upload a file → verdict, risk, flagged phrases |
| `WS` | `/live` | Stream 16 kHz PCM → verdict updates every ~2 s |
| `POST` | `/reports` | Report a scam number (hashed with a per-deployment pepper) |

The PRD sketches two signing endpoints; we use three so that the device never signs bytes it
has not independently rebuilt. That is the only structural deviation.

---

## Design decisions worth knowing

**Raw PCM, not MediaRecorder.** Android Chrome's MediaRecorder produces WebM/Opus, which
libsndfile cannot decode without ffmpeg. The app captures float PCM through an AudioWorklet and
builds the WAV itself, so the upload path has no codec dependency. The same frames feed Live Scan.

**The phone can do the transcription.** When the backend has no Whisper, the browser's Web
Speech API supplies the text and the scam-phrase check still works on a laptop with no GPU.
Both paths feed identical rules, and the response always names the engine that produced the text.

**The API returns keys, not sentences.** `headline_key`, `step_keys`, risk reasons and notes
are all keys mapped to BM and English in `web/src/lib/strings.ts`, so the decision logic lives
in one place and both languages stay in sync.

**Accessibility is in the config, not left to each component.** Base font is 18 px (the primary
persona is 62), tap targets are ≥ 3.5 rem, the layout works at 360 px, and every verdict is
colour **plus** icon **plus** words — never colour alone.

**Trusted senders live on the receiver's phone.** A signature proves a clip came unchanged from
*some* registered device, not that the name on it is the person you think. So a first-time name
shows a warning, and the receiver chooses to trust it.

---

## Claims

**We say:** "SuaraSah proves when a recording came unchanged from a registered sender, and warns
when it didn't."

**We never say:** that it guarantees a human is speaking · that it makes deepfakes impossible ·
that it detects every voice-cloning scam · that it integrates with WhatsApp calls today · that
all Malaysian scam losses come from deepfakes.

### Known limits

- The AI-voice fallback has **no measured EER**. Until `requirements-ml.txt` is installed and
  the team dataset is recorded, treat every risk level as screening, exactly as the UI says.
- Watermark robustness is measured on synthetic speech and on simulated codecs. The
  speakerphone-in-a-room condition cannot be simulated and must be recorded by hand.
- Registration is open: anyone can register the display name "Ayah". The MVP answer is the
  first-time-sender warning plus the receiver's own trusted list. Production swaps in phone-OTP
  identity.
- A compromised or stolen device can still produce VERIFIED clips until its key is revoked.
  Liveness and challenge–response are roadmap, not MVP.
- `.m4a` (iOS voice memos) needs `ffmpeg` on PATH; WAV, MP3, OGG/Opus, FLAC and GSM work out
  of the box.
- SQLite today. The schema is the PRD's, so moving to Supabase/Postgres is a connector swap.

### Still open (from the PRD)

Final product and team name · preliminary submission deadline · member names for roles A–D ·
which voice-cloning tools to use and their licence terms · GPU access for Live Scan · Malaysian
rules on recording a call participant, before claiming PDPA compliance · stretch pick: WhatsApp
bot (S1) or Merge-to-Scan (S2).

---

## Demo script (3 minutes)

| Time | Scene | What judges see |
| --- | --- | --- |
| 0:00–0:25 | Hook | A cloned "Ayah" asking for RM2,000. "Would you know?" |
| 0:25–0:50 | Sign | Real Ayah signs a voice note in one tap |
| 0:50–1:15 | Verify | The signed note after WhatsApp: green **SAH**, with name and time |
| 1:15–1:40 | Tamper | Spliced version: red **DIUBAH**, with the failed 2 s segment highlighted |
| 1:40–2:20 | Live Scan | The clone "calls" on speaker: turns red, "transfer" and "sekarang" flagged |
| 2:20–2:35 | Replay | A real signed clip played into Live Scan: **RAKAMAN LAMA** |
| 2:35–3:00 | Close | Architecture, measured metrics, roadmap |

Record a backup video. The PRD lists venue Wi-Fi failure as a real risk, and the backend runs
fully locally for exactly that reason.
