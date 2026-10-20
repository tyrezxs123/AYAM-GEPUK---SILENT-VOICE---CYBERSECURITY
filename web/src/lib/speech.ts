/**
 * On-device transcription with the Web Speech API.
 *
 * The scam-phrase check needs text. When the backend has faster-whisper
 * installed it does the transcription itself; when it does not (the common case
 * on a laptop with no GPU), the phone can do it instead and send text up.
 *
 * Support is uneven - Android Chrome yes, Firefox no, iOS Safari partial - so
 * every caller must handle `supported === false` and still show a verdict.
 */
export type SpeechHandler = (text: string, isFinal: boolean) => void;

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type Ctor = new () => SpeechRecognitionLike;

function constructor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechSupported(): boolean {
  return constructor() !== null;
}

export interface SpeechSession {
  supported: boolean;
  stop(): void;
}

/**
 * Starts continuous recognition. `lang` should be "ms-MY" or "en-MY"; Malay
 * recognisers cope with code-switched English reasonably well, and the phrase
 * list covers both languages anyway.
 */
export function startSpeech(lang: string, onText: SpeechHandler, onError?: (e: string) => void): SpeechSession {
  const Ctor = constructor();
  if (!Ctor) return { supported: false, stop: () => undefined };

  let stopped = false;
  let recogniser: SpeechRecognitionLike | null = null;

  const spin = () => {
    if (stopped) return;
    const rec = new Ctor();
    recogniser = rec;
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        onText(result[0].transcript, result.isFinal);
      }
    };
    rec.onerror = (event) => {
      // "no-speech" and "aborted" are routine during a quiet stretch of a call.
      if (event.error !== "no-speech" && event.error !== "aborted") onError?.(event.error);
    };
    // Browsers end the session on their own schedule; restart until we stop.
    rec.onend = () => {
      if (!stopped) window.setTimeout(spin, 250);
    };

    try {
      rec.start();
    } catch {
      /* already started */
    }
  };

  spin();

  return {
    supported: true,
    stop() {
      stopped = true;
      try {
        recogniser?.stop();
      } catch {
        /* ignore */
      }
    },
  };
}
