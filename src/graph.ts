/** Draws the last minute of levels onto a canvas. */
import { type Zone, zone } from "./levels.ts";

/** The vertical range of the graph and the bar meter, in dB. */
export const SCALE = { min: 20, max: 130 } as const;
const GRID: ReadonlyArray<number> = [40, 60, 80, 100, 120];

export type GraphColors = Record<Zone, string> & { grid: string; label: string };

/** Reads the colours from CSS custom properties, so the theme lives in one place. */
export function readColors(element: Element): GraphColors {
  const style: CSSStyleDeclaration = getComputedStyle(element);
  const get: (name: string) => string = (name: string): string =>
    style.getPropertyValue(name).trim();
  return {
    safe: get("--safe"),
    caution: get("--caution"),
    harmful: get("--harmful"),
    grid: get("--grid"),
    label: get("--muted"),
  };
}

/** 0 at the bottom of the scale, 1 at the top, clamped. */
export function position(db: number): number {
  return Math.min(1, Math.max(0, (db - SCALE.min) / (SCALE.max - SCALE.min)));
}

export function drawGraph(
  canvas: HTMLCanvasElement,
  levels: Float32Array,
  colors: GraphColors,
): void {
  const ratio: number = window.devicePixelRatio || 1;
  const width: number = canvas.clientWidth;
  const height: number = canvas.clientHeight;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const ctx: CanvasRenderingContext2D | null = canvas.getContext("2d");
  if (ctx === null) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const y: (db: number) => number = (db: number): number => height - position(db) * height;

  ctx.font = "10px 'Martian Mono Variable', monospace";
  ctx.textBaseline = "bottom";
  ctx.lineWidth = 1;
  for (const db of GRID) {
    const gy = Math.round(y(db)) + 0.5;
    ctx.strokeStyle = colors.grid;
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(width, gy);
    ctx.stroke();
    ctx.fillStyle = colors.label;
    ctx.fillText(String(db), 2, gy - 2);
  }

  // One bar per frame, coloured by zone. 1200 frames across ~350px means
  // several share a pixel column; drawing the loudest of each column keeps
  // short spikes visible.
  const columns: number = Math.max(1, Math.floor(width));
  const perColumn = levels.length / columns;
  for (let c = 0; c < columns; c++) {
    let loudest: number = Number.NaN;
    const from: number = Math.floor(c * perColumn);
    const to: number = Math.max(from + 1, Math.floor((c + 1) * perColumn));
    for (let i: number = from; i < to; i++) {
      const v: number = levels[i]!;
      if (!Number.isNaN(v) && !(v <= loudest)) loudest = v;
    }
    if (Number.isNaN(loudest)) continue;
    const top: number = y(loudest);
    ctx.fillStyle = colors[zone(loudest)];
    ctx.fillRect(c, top, 1, height - top);
  }
}
