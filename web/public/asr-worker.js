/**
 * On-device speech-to-text (Whisper via transformers.js), run off the main thread.
 *
 * The scam-phrase check needs words. The Web Speech API only listens to the
 * live microphone, so it cannot transcribe a voice note the user picked from
 * WhatsApp. This worker can: it runs a small multilingual Whisper model in
 * WebAssembly, entirely in the browser. The audio never leaves the device; only
 * the model files are downloaded (once, then cached by the browser).
 */
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5";

env.allowLocalModels = false;

let asr = null;
let loadedModel = null;
let loading = null;

async function ensure(model, id) {
  if (asr && loadedModel === model) return asr;
  if (!loading || loadedModel !== model) {
    loadedModel = model;
    const seen = {};
    loading = pipeline("automatic-speech-recognition", model, {
      dtype: "q8",
      progress_callback: (p) => {
        if (p.status !== "progress" || !p.total) return;
        seen[p.file] = [p.loaded, p.total];
        let loaded = 0;
        let total = 0;
        for (const k in seen) {
          loaded += seen[k][0];
          total += seen[k][1];
        }
        self.postMessage({ id, type: "progress", loaded, total });
      },
    }).then((p) => {
      asr = p;
      return p;
    });
    loading.catch(() => {
      loading = null;
      asr = null;
    });
  }
  return loading;
}

self.onmessage = async (event) => {
  const { id, type, model, samples, language } = event.data;
  try {
    const pipe = await ensure(model, id);
    if (type === "load") {
      self.postMessage({ id, type: "done", text: "" });
      return;
    }
    const seconds = samples.length / 16000;
    const out = await pipe(samples, {
      language,
      task: "transcribe",
      // Whisper loops on unclear audio ("dan dan dan..."); forbid repeated trigrams.
      no_repeat_ngram_size: 3,
      chunk_length_s: seconds > 28 ? 30 : undefined,
      stride_length_s: seconds > 28 ? 5 : undefined,
    });
    self.postMessage({ id, type: "done", text: (out && out.text ? out.text : "").trim() });
  } catch (err) {
    self.postMessage({ id, type: "error", error: String(err && err.message ? err.message : err) });
  }
};
