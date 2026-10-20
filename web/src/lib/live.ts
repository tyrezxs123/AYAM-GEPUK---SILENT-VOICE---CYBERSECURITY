/**
 * Live Scan client: microphone -> 1 s PCM frames -> WebSocket -> verdict updates.
 *
 * The browser does no analysis. It captures 16 kHz mono, ships raw frames, and
 * renders whatever the backend says, so the thresholds and the smoothing live
 * in one place (api/app/routes/live.py).
 */
import { floatToPcm16, openMic, TARGET_RATE, type MicHandle } from "./audio";
import { wsBase } from "./api";
import type { LiveMessage } from "./types";

const FRAME_SAMPLES = TARGET_RATE; // 1 second per frame

export interface LiveScanHandlers {
  onMessage(message: LiveMessage): void;
  onLevel?(level: number): void;
  onClose?(reason: string): void;
  onError?(error: string): void;
}

export interface LiveScan {
  stop(): Promise<void>;
  sendTranscript(text: string): void;
}

export async function startLiveScan(handlers: LiveScanHandlers): Promise<LiveScan> {
  const socket = new WebSocket(`${wsBase()}/live`);
  socket.binaryType = "arraybuffer";

  let mic: MicHandle | null = null;
  let stopped = false;
  let pending: Float32Array[] = [];
  let pendingLength = 0;

  const flush = () => {
    while (pendingLength >= FRAME_SAMPLES && socket.readyState === WebSocket.OPEN) {
      const frame = new Float32Array(FRAME_SAMPLES);
      let filled = 0;
      while (filled < FRAME_SAMPLES) {
        const head = pending[0];
        const take = Math.min(head.length, FRAME_SAMPLES - filled);
        frame.set(head.subarray(0, take), filled);
        filled += take;
        if (take === head.length) pending.shift();
        else pending[0] = head.subarray(take);
      }
      pendingLength -= FRAME_SAMPLES;
      socket.send(floatToPcm16(frame).buffer);
    }
  };

  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timeout")), 8000);
    socket.onopen = () => {
      window.clearTimeout(timer);
      resolve();
    };
    socket.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("connection failed"));
    };
  });

  socket.onmessage = (event) => {
    try {
      handlers.onMessage(JSON.parse(event.data as string) as LiveMessage);
    } catch {
      /* ignore malformed frame */
    }
  };
  socket.onclose = () => handlers.onClose?.("closed");
  socket.onerror = () => handlers.onError?.("socket error");

  try {
    mic = await openMic((frame) => {
      if (stopped) return;
      pending.push(frame);
      pendingLength += frame.length;
      handlers.onLevel?.(mic?.level() ?? 0);
      flush();
    });
  } catch (err) {
    socket.close();
    throw err;
  }

  return {
    sendTranscript(text: string) {
      if (socket.readyState === WebSocket.OPEN && text.trim()) {
        socket.send(JSON.stringify({ type: "transcript", text, final: true }));
      }
    },
    async stop() {
      stopped = true;
      pending = [];
      pendingLength = 0;
      await mic?.stop();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "stop" }));
      }
      socket.close();
    },
  };
}
