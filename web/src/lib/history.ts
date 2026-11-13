/**
 * Recent checks, kept only on this phone (localStorage). Stores the verdict
 * and a label - never the audio and never the transcript.
 */
import type { Colour, Level, Verdict, VerifyResult } from "./types";

const KEY = "suarasah.history";
const MAX = 25;

export type HistoryKind = "file" | "record" | "live" | "sign";

export interface HistoryEntry {
  id: string;
  at: number;
  kind: HistoryKind;
  verdict: Verdict | "SIGNED";
  colour: Colour;
  level?: Level;
  label: string;
  duration_s?: number;
}

function read(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? (raw as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function write(list: HistoryEntry[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    window.dispatchEvent(new Event("suarasah:history"));
  } catch {
    /* private mode: history simply does not persist */
  }
}

export function listHistory(): HistoryEntry[] {
  return read();
}

export function addHistory(entry: Omit<HistoryEntry, "id" | "at">): void {
  write([{ ...entry, id: Math.random().toString(36).slice(2, 10), at: Date.now() }, ...read()]);
}

export function clearHistory(): void {
  write([]);
}

export function recordResult(result: VerifyResult, kind: HistoryKind, label: string): void {
  if (result.simulated) return; // samples are not real checks
  addHistory({
    kind,
    verdict: result.verdict,
    colour: result.colour,
    level: result.risk?.level,
    label: result.provenance.sender_name ?? label,
    duration_s: result.duration_s,
  });
}

export function historyStats(): { checks: number; flagged: number; verified: number } {
  const list = read();
  return {
    checks: list.filter((e) => e.kind !== "sign").length,
    flagged: list.filter((e) => e.colour === "red" || e.colour === "orange").length,
    verified: list.filter((e) => e.verdict === "VERIFIED").length,
  };
}
