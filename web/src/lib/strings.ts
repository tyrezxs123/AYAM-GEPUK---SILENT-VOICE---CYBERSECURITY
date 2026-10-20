/**
 * BM / English strings. Bahasa Melayu is the default (PRD F6).
 *
 * The API returns keys, never sentences, so both languages stay in sync and the
 * decision logic lives only in the backend. Rules for wording here:
 *   - no technical words on result screens
 *   - never say "human", "real" or "safe" about unsigned audio
 *   - every verdict is colour + icon + words, never colour alone
 */

export type Lang = "ms" | "en";

const ms = {
  appName: "SuaraSah",
  tagline: "Jangan percaya suara. Sahkan asalnya.",
  langName: "English",
  langSwitch: "Tukar ke English",
  themeLight: "Cerah",
  themeDark: "Gelap",
  themeToggle: "Tukar mod tema",
  langBM: "BM",
  langEN: "ENG",

  // home
  homeVerify: "Semak Audio",
  homeVerifySub: "Nota suara atau fail audio",
  homeLive: "Imbas Panggilan",
  homeLiveSub: "Semasa panggilan, guna pembesar suara",
  homeSign: "Tandatangan Suara",
  homeSignSub: "Hantar nota suara yang boleh disahkan",
  homeFooter: "Hanya tandatangan digital boleh memberi status SAH.",
  install: "Pasang pada telefon",

  // verdict words
  verdict_VERIFIED: "SAH",
  verdict_TAMPERED: "DIUBAH",
  verdict_REPLAYED: "RAKAMAN LAMA",
  verdict_EXPIRED: "TAMAT TEMPOH",
  verdict_UNVERIFIED: "TIDAK SAH",

  // headlines
  head_verified: "Rakaman ini datang tanpa diubah daripada penghantar berdaftar.",
  head_tampered: "Rakaman ini telah diubah selepas ditandatangani. Jangan percaya.",
  head_replayed: "Rakaman lama sedang dimainkan semula.",
  head_expired: "Rakaman ini sudah tamat tempoh.",
  head_unverified_high: "Risiko tinggi. Suara ini mungkin dijana AI.",
  head_unverified_medium: "Berhati-hati. Ada tanda-tanda penipuan.",
  head_unverified_low: "Tiada bukti siapa penghantar.",

  // next steps
  step_verified_still_check_money: "Kalau ada minta duit, tetap telefon semula untuk pastikan.",
  step_save_trusted_sender: "Simpan penghantar ini sebagai dipercayai.",
  step_do_not_act: "Jangan ikut apa-apa arahan dalam rakaman ini.",
  step_call_back_saved_number: "Hubungi semula nombor yang disimpan dalam telefon anda.",
  step_report_number: "Laporkan nombor ini.",
  step_old_recording_reused: "Suara ini mungkin rakaman, bukan orang yang bercakap sekarang.",
  step_ask_safe_word: "Tanya kata kunci keluarga yang hanya dia tahu.",
  step_ask_sender_resend: "Minta penghantar hantar nota suara yang baru.",
  step_hang_up_now: "Letak telefon sekarang.",
  step_never_transfer_on_call: "Jangan sekali-kali pindah duit semasa panggilan.",
  step_no_proof_of_sender: "Tiada tandatangan, jadi kami tidak boleh sahkan siapa yang bercakap.",
  step_call_back_if_money: "Kalau ada sebut duit, telefon semula nombor yang disimpan.",

  // risk reasons
  risk_likely_ai_voice: "Suara ini berkemungkinan besar dijana AI.",
  risk_suspicious_voice_and_scam_pattern: "Suara meragukan dan ada corak penipuan.",
  risk_scam_pattern_call_back: "Ada corak penipuan. Sahkan dengan telefon semula.",
  risk_scam_words_present: "Ada perkataan yang biasa digunakan penipu.",
  risk_voice_uncertain: "Kami tidak pasti tentang suara ini.",
  risk_low_risk_not_verified: "Risiko rendah, tetapi penghantar masih tidak disahkan.",

  level_low: "Risiko rendah",
  level_medium: "Risiko sederhana",
  level_high: "Risiko tinggi",

  // phrase groups
  group_urgency: "Desakan",
  group_money: "Duit",
  group_secrecy: "Rahsia",
  group_authority: "Pihak berkuasa",

  // notes
  note_no_watermark: "Tiada tandatangan digital dalam audio ini.",
  note_watermark_without_record: "Ada tanda tetapi tiada rekod padanan.",
  note_signature_invalid: "Tandatangan tidak sah.",
  note_fingerprint_root_mismatch: "Cap audio tidak sepadan dengan rekod.",
  note_device_key_revoked: "Kunci peranti penghantar telah dibatalkan.",
  note_clip_expired: "Rakaman melepasi tarikh tamat.",
  note_signed_clip_inside_live_audio: "Rakaman bertandatangan dikesan dalam audio langsung.",

  // verify screen
  verifyTitle: "Semak Audio",
  verifyPick: "Pilih fail audio",
  verifyRecord: "Rakam dari pembesar suara",
  verifyStop: "Berhenti rakam",
  verifyHint: "Pilih nota suara dari WhatsApp, atau rakam bunyi yang anda dengar.",
  verifyAgain: "Semak audio lain",
  stage_signature: "Memeriksa tandatangan…",
  stage_voice: "Memeriksa suara…",
  stage_words: "Memeriksa perkataan…",
  senderLabel: "Dirakam oleh",
  recordedAt: "pada",
  contextLabel: "Nota penghantar",
  newSender: "Penghantar baru. Nama boleh didaftar oleh sesiapa, jadi pastikan anda kenal dia.",
  trustedSender: "Penghantar dipercayai",
  saveTrusted: "Simpan sebagai dipercayai",
  savedTrusted: "Disimpan",
  segmentsLabel: "Bahagian yang gagal",
  transcriptLabel: "Apa yang didengar",
  noTranscript: "Tiada teks. Peranti ini tidak menyediakan pengecaman suara.",
  detectionLabel: "Pemeriksaan suara AI",
  screeningOnly: "Saringan sahaja — bukan bukti",

  // live screen
  liveTitle: "Imbas Panggilan",
  liveStart: "Mula imbas",
  liveStop: "Berhenti",
  liveHint: "Letak panggilan pada pembesar suara, dan dekatkan telefon ini.",
  liveWaiting: "Mendengar… keputusan pertama dalam beberapa detik.",
  liveListening: "Sedang mendengar",
  liveFlagged: "Perkataan dikesan",
  liveNothingSaved: "Tiada apa-apa disimpan melainkan anda menekan Lapor.",
  liveRedAlert: "Letak telefon. Hubungi semula nombor yang disimpan.",
  consentTitle: "Sebelum mula",
  consentBody:
    "Mikrofon telefon ini akan digunakan untuk mendengar panggilan pada pembesar suara. Audio diproses sekejap dan tidak disimpan. Di Malaysia, beritahu orang yang anda bercakap dengannya jika anda merakam.",
  consentAgree: "Saya faham, mula",
  consentCancel: "Batal",
  micDenied: "Mikrofon tidak dibenarkan. Benarkan dalam tetapan pelayar.",

  // sign screen
  signTitle: "Tandatangan Suara",
  signName: "Nama anda",
  signNamePlaceholder: "Contoh: Ayah",
  signNameHint: "Nama ini akan dilihat oleh penerima.",
  signRegister: "Daftar peranti ini",
  signRecord: "Mula rakam",
  signRecordStop: "Berhenti dan tandatangan",
  signUpload: "Atau pilih fail",
  signContext: "Nota (pilihan)",
  signContextPlaceholder: "Contoh: Untuk Mak sahaja",
  signExpiry: "Sah selama",
  expiry_1d: "24 jam",
  expiry_7d: "7 hari",
  expiry_30d: "30 hari",
  signing: "Menandatangani…",
  signed: "Siap ditandatangani",
  signedHint: "Hantar fail ini. Penerima boleh semak dalam SuaraSah.",
  download: "Simpan fail",
  shareWhatsapp: "Kongsi",
  signAnother: "Tandatangan lagi",
  deviceReady: "Peranti berdaftar",
  revokeDevice: "Batalkan kunci peranti ini",
  revokeConfirm: "Batalkan kunci? Semua rakaman lama akan hilang status SAH.",
  revoked: "Kunci dibatalkan",
  maxSeconds: "Maksimum 60 detik",

  // report
  reportTitle: "Lapor nombor",
  reportNumber: "Nombor telefon",
  reportSend: "Hantar laporan",
  reportThanks: "Terima kasih. Nombor disimpan sebagai cincangan sahaja.",
  semakMule: "Semak nombor di PDRM Semak Mule",

  // misc
  back: "Kembali",
  errorTitle: "Tidak dapat memproses",
  offline: "Tiada sambungan ke pelayan.",
  apiHint: "Pastikan pelayan SuaraSah berjalan.",
  seconds: "detik",
  engineLabel: "Enjin",
  privacyNote: "Audio diproses dalam ingatan dan tidak disimpan.",
};

const en: Record<keyof typeof ms, string> = {
  appName: "SuaraSah",
  tagline: "Don't trust the voice. Verify its origin.",
  langName: "Bahasa Melayu",
  langSwitch: "Switch to Bahasa Melayu",
  themeLight: "Light",
  themeDark: "Dark",
  themeToggle: "Toggle theme mode",
  langBM: "BM",
  langEN: "ENG",

  homeVerify: "Verify Audio",
  homeVerifySub: "A voice note or an audio file",
  homeLive: "Live Scan",
  homeLiveSub: "During a call, on speakerphone",
  homeSign: "Sign My Voice",
  homeSignSub: "Send voice notes that can be verified",
  homeFooter: "Only a cryptographic signature can return VERIFIED.",
  install: "Install on phone",

  verdict_VERIFIED: "VERIFIED",
  verdict_TAMPERED: "CHANGED",
  verdict_REPLAYED: "OLD RECORDING",
  verdict_EXPIRED: "EXPIRED",
  verdict_UNVERIFIED: "NOT VERIFIED",

  head_verified: "This recording came unchanged from a registered sender.",
  head_tampered: "This recording was changed after signing. Do not trust it.",
  head_replayed: "An old recording is being reused.",
  head_expired: "This recording has passed its expiry date.",
  head_unverified_high: "High risk. This voice may be AI-generated.",
  head_unverified_medium: "Be careful. There are signs of a scam.",
  head_unverified_low: "No proof of who sent this.",

  step_verified_still_check_money: "If money is involved, still call back to confirm.",
  step_save_trusted_sender: "Save this sender as trusted.",
  step_do_not_act: "Do not follow any instruction in this recording.",
  step_call_back_saved_number: "Call back using the number saved in your phone.",
  step_report_number: "Report this number.",
  step_old_recording_reused: "This may be a recording, not someone speaking now.",
  step_ask_safe_word: "Ask the family safe word that only they would know.",
  step_ask_sender_resend: "Ask the sender for a fresh voice note.",
  step_hang_up_now: "Hang up now.",
  step_never_transfer_on_call: "Never transfer money while still on a call.",
  step_no_proof_of_sender: "There is no signature, so we cannot confirm who is speaking.",
  step_call_back_if_money: "If money is mentioned, call back on your saved number.",

  risk_likely_ai_voice: "This voice is most likely AI-generated.",
  risk_suspicious_voice_and_scam_pattern: "Suspicious voice plus a scam pattern.",
  risk_scam_pattern_call_back: "Scam pattern found. Verify by calling back.",
  risk_scam_words_present: "Words commonly used by scammers were found.",
  risk_voice_uncertain: "We are not sure about this voice.",
  risk_low_risk_not_verified: "Low risk, but the sender is still not verified.",

  level_low: "Low risk",
  level_medium: "Medium risk",
  level_high: "High risk",

  group_urgency: "Urgency",
  group_money: "Money",
  group_secrecy: "Secrecy",
  group_authority: "Authority",

  note_no_watermark: "No digital signature found in this audio.",
  note_watermark_without_record: "A mark was found but no matching record exists.",
  note_signature_invalid: "The signature is not valid.",
  note_fingerprint_root_mismatch: "Audio fingerprints do not match the record.",
  note_device_key_revoked: "The sender's device key has been revoked.",
  note_clip_expired: "The recording is past its expiry date.",
  note_signed_clip_inside_live_audio: "A signed recording was detected inside live audio.",

  verifyTitle: "Verify Audio",
  verifyPick: "Choose an audio file",
  verifyRecord: "Record from speakerphone",
  verifyStop: "Stop recording",
  verifyHint: "Pick a voice note from WhatsApp, or record what you are hearing.",
  verifyAgain: "Check another file",
  stage_signature: "Checking signature…",
  stage_voice: "Checking voice…",
  stage_words: "Checking words…",
  senderLabel: "Recorded by",
  recordedAt: "on",
  contextLabel: "Sender's note",
  newSender: "New sender. Anyone can register a name, so make sure you know them.",
  trustedSender: "Trusted sender",
  saveTrusted: "Save as trusted",
  savedTrusted: "Saved",
  segmentsLabel: "Parts that failed",
  transcriptLabel: "What was heard",
  noTranscript: "No text. This device does not provide speech recognition.",
  detectionLabel: "AI-voice check",
  screeningOnly: "Screening only — not proof",

  liveTitle: "Live Scan",
  liveStart: "Start scan",
  liveStop: "Stop",
  liveHint: "Put the call on speakerphone and hold this phone close.",
  liveWaiting: "Listening… first result in a few seconds.",
  liveListening: "Listening",
  liveFlagged: "Flagged words",
  liveNothingSaved: "Nothing is saved unless you tap Report.",
  liveRedAlert: "Hang up. Call back on your saved number.",
  consentTitle: "Before you start",
  consentBody:
    "This phone's microphone will listen to the call on speakerphone. Audio is processed briefly and not stored. In Malaysia, tell the other person if you are recording.",
  consentAgree: "I understand, start",
  consentCancel: "Cancel",
  micDenied: "Microphone blocked. Allow it in your browser settings.",

  signTitle: "Sign My Voice",
  signName: "Your name",
  signNamePlaceholder: "For example: Ayah",
  signNameHint: "The receiver will see this name.",
  signRegister: "Register this device",
  signRecord: "Start recording",
  signRecordStop: "Stop and sign",
  signUpload: "Or choose a file",
  signContext: "Note (optional)",
  signContextPlaceholder: "For example: For Mak only",
  signExpiry: "Valid for",
  expiry_1d: "24 hours",
  expiry_7d: "7 days",
  expiry_30d: "30 days",
  signing: "Signing…",
  signed: "Signed and ready",
  signedHint: "Send this file. The receiver can check it in SuaraSah.",
  download: "Save file",
  shareWhatsapp: "Share",
  signAnother: "Sign another",
  deviceReady: "Device registered",
  revokeDevice: "Revoke this device key",
  revokeConfirm: "Revoke the key? All older recordings lose VERIFIED status.",
  revoked: "Key revoked",
  maxSeconds: "Up to 60 seconds",

  reportTitle: "Report a number",
  reportNumber: "Phone number",
  reportSend: "Send report",
  reportThanks: "Thank you. The number is stored only as a hash.",
  semakMule: "Check the number on PDRM Semak Mule",

  back: "Back",
  errorTitle: "Could not process this",
  offline: "No connection to the server.",
  apiHint: "Make sure the SuaraSah server is running.",
  seconds: "seconds",
  engineLabel: "Engine",
  privacyNote: "Audio is processed in memory and not stored.",
};

export type StringKey = keyof typeof ms;

export const dictionaries: Record<Lang, Record<StringKey, string>> = { ms, en };

export function t(lang: Lang, key: StringKey): string {
  return dictionaries[lang][key] ?? key;
}

/** Maps an API key (headline_key, step_keys, risk reason, note) to a sentence. */
export function tKey(lang: Lang, prefix: string, key: string | undefined): string {
  if (!key) return "";
  const full = `${prefix}_${key}` as StringKey;
  const value = dictionaries[lang][full];
  return value ?? key;
}
