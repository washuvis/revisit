import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';

/**
 * ChromatogramView (modern analysis-tool UI) + peak editing model
 * - Focus + Context with viewport window
 * - Canvas draws signal + axes/ticks/grid
 * - SVG overlay draws cursor/tooltip + peaks (draggable handles) + delete-on-hover
 * - 'Peak Editing Mode' toggle: when ON peaks are movable + deletable; when OFF they are locked
 *
 * Fixes applied:
 * 1) Handle drags now correctly set peakDragRef.mode='handle' (prevents snapping/jumps).
 * 2) onOverlayPointerMove now branches explicitly on drag.mode ('handle' vs 'move') only.
 * 3) Delete “×” now actually deletes (was incorrectly starting a drag).
 * 4) Coordinate conversion unified: uses SVG bounding rect for peak interactions.
 */

type Pt = { x: number; y: number };

type ZoomMode = 'scroll' | 'clickToZoom' | 'magnifier' | 'boxZoom' | 'rangeBrush';
type DragHandleKind = 'start' | 'apex' | 'end';

type Peak = {
  id: string;
  label: string; // 'Peak 1', etc (editable)
  startX: number;
  apexX: number;
  endX: number;
};

// function isKeyPressed(e: { metaKey?: boolean; ctrlKey?: boolean }) {
//   return !!(e.metaKey || e.ctrlKey);
// }
function isUndoKey(ev: KeyboardEvent) {
  // Cmd+Z (macOS) / Ctrl+Z (Windows/Linux)
  return (ev.key === 'z' || ev.key === 'Z') && (ev.metaKey || ev.ctrlKey) && !ev.shiftKey;
}

function isResetKey(ev: KeyboardEvent) {
  // "r" as an explicit reset affordance across modes (avoids relying on double-click).
  return (ev.key === 'r' || ev.key === 'R') && !ev.metaKey && !ev.ctrlKey && !ev.altKey;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function fmt(n: number) {
  const a = Math.abs(n);
  if (a >= 100) return n.toFixed(1);
  if (a >= 10) return n.toFixed(2);
  return n.toFixed(3);
}

function extentX(data: Pt[]): [number, number] {
  if (!data || data.length === 0) return [0, 1];
  let min = Infinity;
  let max = -Infinity;
  for (const p of data) {
    if (p.x < min) min = p.x;
    if (p.x > max) max = p.x;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) return [min, min + 1e-9];
  return [min, max];
}

function extentYInDomain(data: Pt[], domainX: [number, number]): [number, number] {
  if (!data || data.length === 0) return [-1, 1];

  const [x0, x1] = domainX;
  let min = Infinity;
  let max = -Infinity;

  for (const p of data) {
    if (p.x >= x0 && p.x <= x1) {
      if (p.y < min) min = p.y;
      if (p.y > max) max = p.y;
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = Infinity;
    max = -Infinity;
    for (const p of data) {
      if (p.y < min) min = p.y;
      if (p.y > max) max = p.y;
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return [-1, 1];

  const pad = (max - min) * 0.08 || 1;
  return [min - pad, max + pad];
}

function makeLinear(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const m = (r1 - r0) / (d1 - d0 || 1);
  return {
    f: (v: number) => r0 + (v - d0) * m,
    inv: (px: number) => d0 + (px - r0) / (m || 1),
  };
}

function nearestByX(data: Pt[], x: number): Pt | null {
  if (!data || data.length === 0) return null;

  // assumes data is roughly sorted by x (recommended)
  let lo = 0;
  let hi = data.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const xm = data[mid].x;
    if (xm < x) lo = mid + 1;
    else hi = mid - 1;
  }
  const i1 = clamp(lo, 0, data.length - 1);
  const i0 = clamp(lo - 1, 0, data.length - 1);
  const p0 = data[i0];
  const p1 = data[i1];
  return Math.abs(p0.x - x) <= Math.abs(p1.x - x) ? p0 : p1;
}

function clampToDomain(x: number, dom: [number, number]) {
  return clamp(x, dom[0], dom[1]);
}

function enforcePeakOrder(p: Peak): Peak {
  let { startX, apexX, endX } = p;
  if (startX > endX) [startX, endX] = [endX, startX];
  apexX = clamp(apexX, startX, endX);
  return {
    ...p, startX, apexX, endX,
  };
}

type EventMeta = Record<string, unknown>;

type ZoomController = {
  domainX: [number, number];
  fullDomainX: [number, number];
  setDomainX: (d: [number, number], meta?: EventMeta) => void;
  zoomAtX: (anchorX: number, factor: number, meta?: EventMeta) => void;
  panByPx: (dxPx: number, viewWidthPx: number, meta?: EventMeta) => void;
  reset: (meta?: EventMeta) => void;
  undo: (meta?: EventMeta) => void;
  setDomainFromPixelSpan: (px0: number, px1: number, viewWidthPx: number, meta?: EventMeta) => void;
};

function useZoomController(opts: {
  data: Pt[];
  initialDomainX?: [number, number];
  minWindowFrac?: number;
  onLogEvent?: (evt: Record<string, unknown>) => void;
}): ZoomController {
  const {
    data,
    initialDomainX,
    minWindowFrac = 0.002,
    onLogEvent,
  } = opts;
  const fullDomainX = useMemo(() => extentX(data), [data]);
  const minWindow = useMemo(() => {
    const w = fullDomainX[1] - fullDomainX[0];
    return Math.max(w * minWindowFrac, Number.EPSILON);
  }, [fullDomainX, minWindowFrac]);

  const [domainX, _setDomainX] = useState<[number, number]>(() => initialDomainX ?? fullDomainX);

  const domainXRef = useRef<[number, number]>(initialDomainX ?? fullDomainX);
  useEffect(() => {
    domainXRef.current = domainX;
  }, [domainX]);

  const zoomHistoryRef = useRef<[number, number][]>([]);
  const pushZoomHistory = useCallback((prevDomain: [number, number]) => {
    const stack = zoomHistoryRef.current;
    const last = stack[stack.length - 1];
    if (last && Math.abs(last[0] - prevDomain[0]) < 1e-12 && Math.abs(last[1] - prevDomain[1]) < 1e-12) return;
    stack.push(prevDomain);
    if (stack.length > 80) stack.splice(0, stack.length - 80);
    onLogEvent?.({
      type: 'zoom_history_push',
      pushedDomainX: prevDomain,
      stackDepth: stack.length,
      t: performance.now(),
    });
  }, [onLogEvent]);

  const sanitize = useCallback(
    (d: [number, number]) => {
      let [a, b] = d[0] <= d[1] ? d : ([d[1], d[0]] as [number, number]);
      const fullW = fullDomainX[1] - fullDomainX[0];

      // limit zoom out to viewport fill
      if (b - a >= fullW) return fullDomainX;

      // min window
      if (b - a < minWindow) {
        const mid = (a + b) / 2;
        a = mid - minWindow / 2;
        b = mid + minWindow / 2;
      }

      const winW = b - a;

      if (a < fullDomainX[0]) {
        a = fullDomainX[0];
        b = a + winW;
      }
      if (b > fullDomainX[1]) {
        b = fullDomainX[1];
        a = b - winW;
      }

      return [a, b] as [number, number];
    },
    [fullDomainX, minWindow],
  );

  const setDomainX = useCallback(
    (d: [number, number], meta: Record<string, unknown> = {}) => {
      const preDomainX = domainXRef.current;
      const postDomainX = sanitize(d);

      if (Math.abs(preDomainX[0] - postDomainX[0]) < 1e-12 && Math.abs(preDomainX[1] - postDomainX[1]) < 1e-12) return;

      const source = meta.source ?? meta.type ?? 'setDomainX';
      if (meta.pushHistory !== false) pushZoomHistory(preDomainX);

      _setDomainX(postDomainX);

      onLogEvent?.({
        type: 'domain_change',
        source,
        preDomainX,
        postDomainX,
        anchorX: meta.anchorX,
        factor: meta.factor,
        zoomMode: meta.zoomMode,
        t: performance.now(),
      });

      onLogEvent?.({
        type: meta.type ?? 'domain_set',
        domainX: postDomainX,
        preDomainX,
        postDomainX,
        ...meta,
        t: performance.now(),
      });
    },
    [sanitize, onLogEvent, pushZoomHistory],
  );

  const reset = useCallback(
    (meta: Record<string, unknown> = {}) => {
      const preDomainX = domainXRef.current;
      const postDomainX = fullDomainX;
      const source = meta.source ?? 'reset';

      pushZoomHistory(preDomainX);
      _setDomainX(fullDomainX);

      onLogEvent?.({
        type: 'domain_change',
        source,
        preDomainX,
        postDomainX,
        zoomMode: meta.zoomMode,
        t: performance.now(),
      });

      onLogEvent?.({
        type: 'reset', domainX: fullDomainX, preDomainX, postDomainX, ...meta, t: performance.now(),
      });
    },
    [fullDomainX, onLogEvent, pushZoomHistory],
  );

  const zoomAtX = useCallback(
    (anchorX: number, factor: number, meta: Record<string, unknown> = {}) => {
      const [a, b] = domainX;
      const w = b - a;
      const newW = w / (factor || 1);
      const t = (anchorX - a) / (w || 1);
      const newA = anchorX - t * newW;
      const newB = newA + newW;
      setDomainX([newA, newB], {
        ...meta, type: 'zoom', anchorX, factor,
      });
    },
    [domainX, setDomainX],
  );

  const panByPx = useCallback(
    (dxPx: number, viewWidthPx: number, meta: Record<string, unknown> = {}) => {
      const [a, b] = domainX;
      const w = b - a;
      const dxDomain = (dxPx / (viewWidthPx || 1)) * w;
      setDomainX([a - dxDomain, b - dxDomain], { ...meta, type: 'pan', dxPx });
    },
    [domainX, setDomainX],
  );

  // Note: this helper is NOT used for focus box zoom anymore; we use focusXScale.inv so padding is respected.
  const setDomainFromPixelSpan = useCallback(
    (px0: number, px1: number, viewWidthPx: number, meta: Record<string, unknown> = {}) => {
      const [a, b] = domainX;
      const xScale = makeLinear([0, viewWidthPx], [a, b]);
      const d0 = xScale.f(px0);
      const d1 = xScale.f(px1);
      setDomainX([d0, d1], { ...meta, type: 'box_zoom' });
    },
    [domainX, setDomainX],
  );

  useEffect(
    () => {
      _setDomainX(
        (d) => sanitize(d),
      );
    },
    [fullDomainX[0], fullDomainX[1]],
  );

  // const undo = useCallback((meta: Record<string, unknown> = {}) => {
  //   const stack = zoomHistoryRef.current;
  //   if (!stack.length) return;

  //   const preDomainX = domainXRef.current;
  //   const postDomainX = stack.pop() as [number, number];

  //   _setDomainX(postDomainX);

  //   onLogEvent?.({
  //     type: 'domain_change',
  //     source: meta.source ?? 'undo',
  //     preDomainX,
  //     postDomainX,
  //     zoomMode: meta.zoomMode,
  //     t: performance.now(),
  //   });

  //   onLogEvent?.({
  //     type: 'zoom_history_undo',
  //     preDomainX,
  //     postDomainX,
  //     stackDepth: stack.length,
  //     ...meta,
  //     t: performance.now(),
  //   });
  // }, [onLogEvent]);
  return {
    domainX, fullDomainX, setDomainX, zoomAtX, panByPx, reset, setDomainFromPixelSpan,
  };
}

type DrawOptions = {
  showY?: boolean;
  showYLabel?: boolean;
  showXLabel?: boolean;
  showGrid?: boolean;
  fontSize?: number;
  tickCountX?: number;
  tickCountY?: number;
  lineWidth?: number;
  lineAlpha?: number;
};

function drawLineCanvas(
  ctx: CanvasRenderingContext2D,
  data: Pt[],
  xDomain: [number, number],
  yDomain: [number, number],
  w: number,
  h: number,
  padding: { l: number; r: number; t: number; b: number },
  options?: DrawOptions,
  labels: { x: string; y: string } = { x: 'Time', y: 'Intensity' },
) {
  const showY = options?.showY ?? true;
  const showYLabel = options?.showYLabel ?? true;
  const showXLabel = options?.showXLabel ?? true;
  const showGrid = options?.showGrid ?? true;
  const fontSize = options?.fontSize ?? 12;

  const tickCountX = options?.tickCountX ?? 6;
  const tickCountY = options?.tickCountY ?? 5;

  const lineWidth = options?.lineWidth ?? 1.6;
  const lineAlpha = options?.lineAlpha ?? 0.92;

  const innerW = w - padding.l - padding.r;
  const innerH = h - padding.t - padding.b;

  const xScale = makeLinear(xDomain, [padding.l, padding.l + innerW]);
  const yScale = makeLinear(yDomain, [padding.t + innerH, padding.t]);

  const x = xScale.f;
  const y = yScale.f;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  const axisCol = 'rgba(17,24,39,0.22)';
  const gridCol = 'rgba(17,24,39,0.06)';
  const tickCol = 'rgba(17,24,39,0.18)';
  const textCol = 'rgba(17,24,39,0.78)';

  const xTicks: { dv: number; px: number }[] = [];
  for (let i = 0; i < tickCountX; i += 1) {
    const t = tickCountX === 1 ? 0 : i / (tickCountX - 1);
    const dv = xDomain[0] + t * (xDomain[1] - xDomain[0]);
    xTicks.push({ dv, px: x(dv) });
  }

  const yTicks: { dv: number; py: number }[] = [];
  if (showY) {
    for (let i = 0; i < tickCountY; i += 1) {
      const t = tickCountY === 1 ? 0 : i / (tickCountY - 1);
      const dv = yDomain[0] + t * (yDomain[1] - yDomain[0]);
      yTicks.push({ dv, py: y(dv) });
    }
  }

  if (showGrid) {
    ctx.strokeStyle = gridCol;
    ctx.lineWidth = 1;
    if (showY) {
      for (const yt of yTicks) {
        ctx.beginPath();
        ctx.moveTo(padding.l, yt.py);
        ctx.lineTo(padding.l + innerW, yt.py);
        ctx.stroke();
      }
    }
    for (const xt of xTicks) {
      ctx.beginPath();
      ctx.moveTo(xt.px, padding.t);
      ctx.lineTo(xt.px, padding.t + innerH);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = axisCol;
  ctx.lineWidth = 1;
  if (showY) {
    ctx.beginPath();
    ctx.moveTo(padding.l, padding.t);
    ctx.lineTo(padding.l, padding.t + innerH);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(padding.l, padding.t + innerH);
  ctx.lineTo(padding.l + innerW, padding.t + innerH);
  ctx.stroke();

  const tickLen = 6;
  ctx.fillStyle = textCol;
  ctx.font = `${fontSize}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;

  ctx.textAlign = 'center';
  for (const xt of xTicks) {
    const py = padding.t + innerH;
    ctx.strokeStyle = tickCol;
    ctx.beginPath();
    ctx.moveTo(xt.px, py);
    ctx.lineTo(xt.px, py + tickLen);
    ctx.stroke();
    ctx.fillText(fmt(xt.dv), xt.px, py + tickLen + 14);
  }

  if (showY) {
    ctx.textAlign = 'right';
    for (const yt of yTicks) {
      const px0 = padding.l;
      ctx.strokeStyle = tickCol;
      ctx.beginPath();
      ctx.moveTo(px0 - tickLen, yt.py);
      ctx.lineTo(px0, yt.py);
      ctx.stroke();
      ctx.fillText(fmt(yt.dv), px0 - tickLen - 8, yt.py + 4);
    }
  }

  ctx.fillStyle = 'rgba(17,24,39,0.70)';
  ctx.font = `600 ${Math.max(fontSize, 12)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;

  if (showXLabel) {
    ctx.textAlign = 'center';
    ctx.fillText(labels.x ?? 'Time', padding.l + innerW / 2, h - 8);
  }

  if (showY && showYLabel) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const yLabelX = padding.l - 56;
    const yLabelY = padding.t + innerH / 2;
    ctx.translate(yLabelX, yLabelY);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(labels.y ?? 'Intensity', 0, 0);
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
  }

  ctx.strokeStyle = `rgba(17,24,39,${lineAlpha})`;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();

  let started = false;
  for (const p of data) {
    if (p.x >= xDomain[0] && p.x <= xDomain[1]) {
      const px = x(p.x);
      const py = y(p.y);
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
    }
  }
  ctx.stroke();
}

/**
 * Use SVG's boundingClientRect so we’re in the same coordinate system
 * as peak handle rendering.
 */
function clientXToSvgPx(e: React.PointerEvent): number {
  const tgt = e.currentTarget as unknown;
  const svg: SVGSVGElement | null = tgt.ownerSVGElement ?? (tgt.tagName === 'svg' ? tgt : null);
  const rect = (svg ?? tgt).getBoundingClientRect();
  return e.clientX - rect.left;
}

function modeLabel(m: ZoomMode) {
  switch (m) {
    case 'scroll':
      return 'Scroll zoom';
    case 'clickToZoom':
      return 'Click-to-zoom';
    case 'magnifier':
      return 'Magnifier';
    case 'boxZoom':
      return 'Box zoom';
    case 'rangeBrush':
      return 'Range brush';
    default:
      return m;
  }
}

type ChromatogramViewProps = {
  parameters?: {
    dataPath?: string;
    zoomMode?: ZoomMode;
    onLogEvent?: (evt: LogEvent) => void;
    [key: string]: unknown;
  };
  onLogEvent?: (evt: LogEvent) => void;
  data?: Pt[];
  dataPath?: string;
  width?: number;
  height?: number;
  zoomMode?: ZoomMode;
  initialDomainX?: [number, number];
  zoomStepFactor?: number;
  title?: string;
  subtitle?: string;
  xLabel?: string;
  yLabel?: string;
};

export default function ChromatogramView(rawProps: ChromatogramViewProps) {
  const parameters = rawProps?.parameters ?? rawProps ?? {};

  const width: number = parameters.width ?? rawProps.width ?? 920;
  const height: number = parameters.height ?? rawProps.height ?? 420;
  const zoomMode: ZoomMode = parameters.zoomMode ?? rawProps.zoomMode ?? 'scroll';
  const initialDomainX: [number, number] | undefined = parameters.initialDomainX ?? rawProps.initialDomainX;
  const onLogEvent: ((evt: Record<string, unknown>) => void) | undefined = parameters.onLogEvent ?? rawProps.onLogEvent;
  const zoomStepFactor: number = parameters.zoomStepFactor ?? rawProps.zoomStepFactor ?? 1.5;
  const dataPath: string | undefined = parameters.dataPath ?? rawProps.dataPath;

  const title: string = parameters.title ?? rawProps.title ?? 'Chromatogram';
  const subtitle: string = parameters.subtitle ?? rawProps.subtitle ?? '';
  const xLabel: string = parameters.xLabel ?? rawProps.xLabel ?? 'Time';
  const yLabel: string = parameters.yLabel ?? rawProps.yLabel ?? 'Intensity';

  const [data, setData] = useState<Pt[]>(() => {
    const direct = (parameters.data ?? rawProps.data) as Pt[] | undefined;
    return Array.isArray(direct) ? direct : [];
  });
  const [isLoading, setIsLoading] = useState<boolean>(() => {
    const direct = (parameters.data ?? rawProps.data) as Pt[] | undefined;
    return !Array.isArray(direct) && !!dataPath;
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!dataPath) {
        setIsLoading(false);
        return;
      }
      try {
        setIsLoading(true);
        setError(null);

        const base = new URL(import.meta.env.BASE_URL ?? '/', window.location.origin);
        const url = new URL(dataPath.replace(/^\//, ''), base).toString();

        const res = await fetch(url);
        if (!res.ok) throw new Error(`Fetch failed (${res.status})`);

        const json = await res.json();
        const arr = Array.isArray(json) ? json : json?.data;
        if (!Array.isArray(arr)) throw new Error('JSON not an array (expected [] or {data: []})');

        if (!cancelled) {
          setData(arr as Pt[]);
          setIsLoading(false);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          const message = e instanceof Error ? e.message : String(e);

          setError(message);
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dataPath]);

  const contextH = 96;
  const gap = 16;

  // more breathing room
  const padding = useMemo(() => ({
    l: 86,
    r: 20,
    t: 18,
    b: 44,
  }), []);

  const ctxPadding = useMemo(() => ({
    l: 20,
    r: 20,
    t: 10,
    b: 22,
  }), []);

  const focusCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const focusOffscreenRef = useRef<HTMLCanvasElement | null>(null); // for magnifier
  const contextCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const zoom = useZoomController({ data, initialDomainX, onLogEvent });

  const [hoverPx, setHoverPx] = useState<number | null>(null);
  const [lensPx, setLensPx] = useState<{ x: number; y: number } | null>(null);
  // Lens redesign: persistent toggle + adjustable magnification.
  const [lensEnabled, setLensEnabled] = useState<boolean>(false);
  const [lensMag, setLensMag] = useState<number>(2.2);

  // Local reversibility for techniques that are otherwise one-way (box/click).
  // We store a stack of prior domains for undo/backtracking.
  const zoomHistoryRef = useRef<[number, number][]>([]);
  const pushZoomHistory = useCallback((prevDomain: [number, number]) => {
    const stack = zoomHistoryRef.current;
    const last = stack[stack.length - 1];
    // avoid pushing duplicates
    if (last && Math.abs(last[0] - prevDomain[0]) < 1e-12 && Math.abs(last[1] - prevDomain[1]) < 1e-12) return;
    stack.push(prevDomain);
    if (stack.length > 80) stack.splice(0, stack.length - 80);
  }, []);

  // ---- Peaks ----
  const [peaks, setPeaks] = useState<Peak[]>([]);
  const [editPeaks, setEditPeaks] = useState<boolean>(false);
  const [selectedPeakId, setSelectedPeakId] = useState<string | null>(null);
  const [hoverPeakId, setHoverPeakId] = useState<string | null>(null);

  // Peak placement mode (not currently initiated by Add Peak in this file)
  const [placingPeak, setPlacingPeak] = useState<{
    id: string;
    startPx: number | null;
    lastPx: number | null;
    isActive: boolean;
  } | null>(null);

  const peakDragRef = useRef<
    | {
        mode: 'handle';
        peakId: string;
        kind: DragHandleKind;
        pointerId: number;
        grabOffsetPx: number;
      }
    | {
        mode: 'move';
        peakId: string;
        pointerId: number;
        lastPx: number;
      }
    | null
  >(null);

  const activeDragPeakId = peakDragRef.current?.peakId ?? null;

  // Focus drag state for pan/box zoom (separate from peak drag)
  type ContextWindowDrag = {
    kind: 'contextWindow';
    // add fields you actually store, e.g.:
    startPx: number;
    startDomainX: [number, number];
  };

  type OtherDrag =
    | { kind: 'boxZoom'; startPx: number; startPy: number }
    | { kind: 'pan'; startPx: number; startDomainX: [number, number] }
    | { kind: 'peakHandle'; peakId: string; handle: 'start' | 'apex' | 'end' }
    | { kind: 'peakMove'; peakId: string; startPx: number; startDomainX: [number, number] };

  type DragState = ContextWindowDrag | OtherDrag;

  const dragRef = useRef<DragState | null>(null);

  const yDomainFocus = useMemo(() => extentYInDomain(data, zoom.domainX), [data, zoom.domainX]);
  const fullYDomain = useMemo(() => extentYInDomain(data, zoom.fullDomainX), [data, zoom.fullDomainX]);

  const focusXScale = useMemo(() => {
    const innerW = width - padding.l - padding.r;
    return makeLinear(zoom.domainX, [padding.l, padding.l + innerW]);
  }, [zoom.domainX, width, padding.l, padding.r]);

  const focusYScale = useMemo(() => {
    const innerH = height - padding.t - padding.b;
    return makeLinear(yDomainFocus, [padding.t + innerH, padding.t]);
  }, [yDomainFocus, height, padding.t, padding.b]);

  const contextXScale = useMemo(() => {
    const innerW = width - ctxPadding.l - ctxPadding.r;
    return makeLinear(zoom.fullDomainX, [ctxPadding.l, ctxPadding.l + innerW]);
  }, [zoom.fullDomainX, width, ctxPadding.l, ctxPadding.r]);

  const viewportPx = useMemo(() => {
    const x0 = contextXScale.f(zoom.domainX[0]);
    const x1 = contextXScale.f(zoom.domainX[1]);
    return [x0, x1] as [number, number];
  }, [contextXScale, zoom.domainX]);

  const hoverPoint = useMemo(() => {
    if (hoverPx == null) return null;
    const innerW = width - padding.l - padding.r;
    const clampedX = clamp(hoverPx, padding.l, padding.l + innerW);
    const dataX = focusXScale.inv(clampedX);
    const p = nearestByX(data, dataX);
    if (!p) return null;
    return {
      px: clampedX,
      x: p.x,
      y: p.y,
      py: focusYScale.f(p.y),
    };
  }, [data, focusXScale, focusYScale, hoverPx, padding.l, padding.r, width]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && placingPeak?.isActive) {
        const { id } = placingPeak;
        setPeaks((prev) => prev.filter((p) => p.id !== id));
        setPlacingPeak(null);
        onLogEvent?.({ type: 'peak_place_cancel', peakId: id, t: performance.now() });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placingPeak, onLogEvent]);

  // Keep selection stable when peaks change
  useEffect(() => {
    if (peaks.length === 0) {
      setSelectedPeakId(null);
      return;
    }
    if (selectedPeakId && peaks.some((p) => p.id === selectedPeakId)) return;
    setSelectedPeakId(peaks[peaks.length - 1].id);
  }, [peaks, selectedPeakId]);

  // Warm up first draw so first interaction is smooth
  // useEffect(() => {
  //   if (!data || data.length === 0) return;
  //   const id = window.requestAnimationFrame(() => {
  //     const fctx = focusCanvasRef.current?.getContext('2d');
  //     if (fctx) {
  //       fctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  //       fctx.measureText('0.000 10.000 100.0 Intensity Time');
  //     }
  //     requestDraw();
  //   });
  //   return () => window.cancelAnimationFrame(id);
  //   // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [data.length, width, height]);

  const requestDraw = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;

      const focusCanvas = focusCanvasRef.current;
      const contextCanvas = contextCanvasRef.current;
      if (!focusCanvas || !contextCanvas) return;

      const fctx = focusCanvas.getContext('2d');
      const cctx = contextCanvas.getContext('2d');
      if (!fctx || !cctx) return;

      const dpr = window.devicePixelRatio || 1;

      const resizeCanvas = (cnv: HTMLCanvasElement, w: number, h: number) => {
        const rw = Math.floor(w * dpr);
        const rh = Math.floor(h * dpr);
        if (cnv.width !== rw || cnv.height !== rh) {
          cnv.width = rw;
          cnv.height = rh;
          cnv.style.width = `${w}px`;
          cnv.style.height = `${h}px`;
        }
      };

      resizeCanvas(focusCanvas, width, height);
      resizeCanvas(contextCanvas, width, contextH);

      fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // drawLineCanvas(
      //   fctx,
      //   data,
      //   zoom.domainX,
      //   yDomainFocus,
      //   width,
      //   height,
      //   padding,
      //   { x: xLabel, y: yLabel },
      //   { showY: true, showYLabel: true, showXLabel: true, showGrid: true, fontSize: 12, tickCountX: 6, tickCountY: 5 }
      // );

      // --- Focus draw via offscreen so magnifier can sample pixels ---
      if (!focusOffscreenRef.current) focusOffscreenRef.current = document.createElement('canvas');
      const off = focusOffscreenRef.current;

      resizeCanvas(off, width, height);

      const offCtx = off.getContext('2d');
      if (!offCtx) return;

      // draw focus plot to offscreen
      offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawLineCanvas(
        offCtx,
        data,
        zoom.domainX,
        yDomainFocus,
        width,
        height,
        padding,
        { x: xLabel, y: yLabel },
        {
          showY: true,
          showYLabel: true,
          showXLabel: true,
          showGrid: true,
          fontSize: 12,
          tickCountX: 6,
          tickCountY: 5,
        },
      );

      // copy offscreen to visible focus canvas
      fctx.setTransform(1, 0, 0, 1, 0, 0);
      fctx.clearRect(0, 0, off.width, off.height);
      fctx.drawImage(off, 0, 0);

      // apply magnifier (pixel-space)
      const lensActive = zoomMode === 'magnifier' && lensEnabled && lensPx != null;
      if (lensActive) {
        const LENS_R = 56; // match SVG circle radius
        const MAG = clamp(lensMag, 1.2, 6.0); // magnification factor (user-adjustable)

        // lens center in CSS px -> device px
        const cx = lensPx!.x * dpr;
        const cy = lensPx!.y * dpr;
        const r = LENS_R * dpr;

        // source rect is smaller (so it gets magnified into the lens)
        const srcW = (2 * r) / MAG;
        const srcH = (2 * r) / MAG;
        const srcX = cx - srcW / 2;
        const srcY = cy - srcH / 2;

        // clamp source rect to offscreen bounds to avoid sampling outside
        const sX = clamp(srcX, 0, off.width - srcW);
        const sY = clamp(srcY, 0, off.height - srcH);

        fctx.save();
        fctx.beginPath();
        fctx.arc(cx, cy, r, 0, Math.PI * 2);
        fctx.clip();

        // draw magnified content into clipped circle
        fctx.drawImage(
          off,
          sX,
          sY,
          srcW,
          srcH,
          cx - r,
          cy - r,
          2 * r,
          2 * r,
        );

        fctx.restore();
      }

      drawLineCanvas(
        cctx,
        data,
        zoom.fullDomainX,
        fullYDomain,
        width,
        contextH,
        ctxPadding,
        { x: xLabel, y: yLabel },
        {
          showY: false,
          showYLabel: false,
          showXLabel: true,
          showGrid: false,
          fontSize: 10,
          tickCountX: 4,
          tickCountY: 0,
          lineAlpha: 0.65,
          lineWidth: 1.2,
        },
      );

      // Context viewport overlay
      cctx.save();
      const [vx0, vx1] = viewportPx;
      const innerH = contextH - ctxPadding.t - ctxPadding.b;
      const top = ctxPadding.t;

      cctx.fillStyle = 'rgba(17,24,39,0.08)';
      cctx.fillRect(vx0, top, vx1 - vx0, innerH);

      cctx.strokeStyle = 'rgba(17,24,39,0.28)';
      cctx.lineWidth = 1;
      cctx.strokeRect(vx0, top, vx1 - vx0, innerH);

      const handleW = 10;
      const handleR = 5;
      const drawHandle = (hx: number) => {
        cctx.fillStyle = 'rgba(17,24,39,0.18)';
        const x = hx - handleW / 2;
        const y = top;
        const w = handleW;
        const h = innerH;

        cctx.beginPath();
        cctx.moveTo(x + handleR, y);
        cctx.lineTo(x + w - handleR, y);
        cctx.quadraticCurveTo(x + w, y, x + w, y + handleR);
        cctx.lineTo(x + w, y + h - handleR);
        cctx.quadraticCurveTo(x + w, y + h, x + w - handleR, y + h);
        cctx.lineTo(x + handleR, y + h);
        cctx.quadraticCurveTo(x, y + h, x, y + h - handleR);
        cctx.lineTo(x, y + handleR);
        cctx.quadraticCurveTo(x, y, x + handleR, y);
        cctx.closePath();
        cctx.fill();

        cctx.strokeStyle = 'rgba(17,24,39,0.35)';
        cctx.lineWidth = 1;
        for (let k = -2; k <= 2; k += 2) {
          cctx.beginPath();
          cctx.moveTo(hx + k, y + h * 0.35);
          cctx.lineTo(hx + k, y + h * 0.65);
          cctx.stroke();
        }
      };

      if (zoomMode === 'rangeBrush') {
        drawHandle(vx0);
        drawHandle(vx1);
      }

      cctx.restore();
    });
  }, [
    contextH,
    ctxPadding,
    data,
    fullYDomain,
    height,
    padding,
    viewportPx,
    width,
    xLabel,
    yDomainFocus,
    yLabel,
    zoom.domainX,
    zoom.fullDomainX,
  ]);

  useEffect(() => {
    requestDraw();
  }, [requestDraw]);

  useEffect(() => {
    // when data arrives / size known, do an eager draw so first interaction is smooth
    if (!data || data.length === 0) return;

    // schedule after paint so refs exist and layout is stable
    const id = window.requestAnimationFrame(() => {
      requestDraw();
    });
    // return () => window.cancelAnimationFrame(id);
    window.cancelAnimationFrame(id);
  }, [data.length, width, height, requestDraw]);

  // If the user switches away from magnifier mode, ensure the lens is off and hidden.
  useEffect(() => {
    if (zoomMode !== 'magnifier' && (lensEnabled || lensPx)) {
      setLensEnabled(false);
      setLensPx(null);
    }
  }, [zoomMode, lensEnabled, lensPx]);

  // Global keyboard affordances for fairness:
  // - Undo (Cmd/Ctrl+Z) for click/box modes via a local zoom history stack.
  // - Reset (R) across modes.
  // - Magnifier: persistent toggle (Meta/Ctrl), commit (Enter), cancel (Esc).
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      // Reset (explicit, consistent)
      if (!editPeaks && isResetKey(ev)) {
        zoomHistoryRef.current = [];
        zoom.reset({ source: 'key_reset', zoomMode });
        requestDraw();
        return;
      }

      // Undo (local reversibility) for otherwise one-way zoom styles
      if (!editPeaks && (zoomMode === 'boxZoom' || zoomMode === 'clickToZoom') && isUndoKey(ev)) {
        const prev = zoomHistoryRef.current.pop();
        if (prev) {
          // zoom.setDomainX(prev, { source: 'undo', zoomMode });
          undo({ source: 'mode_switch', zoomMode });
          requestDraw();
        }
        ev.preventDefault();
        return;
      }

      // Magnifier: toggle + commit/cancel
      if (!editPeaks && zoomMode === 'magnifier') {
        if (ev.key === 'Meta' || ev.key === 'Control') {
          setLensEnabled((v) => {
            const next = !v;
            // When disabling, clear the lens location.
            if (!next) setLensPx(null);
            return next;
          });
          requestDraw();
          return;
        }

        if (ev.key === 'Escape') {
          setLensEnabled(false);
          setLensPx(null);
          requestDraw();
          return;
        }

        if (ev.key === 'Enter' && lensEnabled && lensPx) {
          // Promote lens to a persistent zoom around lens center.
          const anchorX = focusXScale.inv(lensPx.x);
          pushZoomHistory(zoom.domainX);
          zoom.zoomAtX(anchorX, clamp(lensMag, 1.2, 6.0), { source: 'lens_commit', zoomMode });
          setLensEnabled(false);
          setLensPx(null);
          requestDraw();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    editPeaks,
    focusXScale,
    lensEnabled,
    lensMag,
    lensPx,
    pushZoomHistory,
    requestDraw,
    zoom,
    zoomMode,
  ]);

  // ----------------------------
  // Peak actions
  // ----------------------------
  const addPeak = useCallback(() => {
    const id = `peak_${Math.random().toString(16).slice(2)}`;
    const label = `Peak ${peaks.length + 1}`;

    // 0.5 inch ≈ 48 CSS px (96 px per inch)
    const spanPx = 48;

    const innerW = width - padding.l - padding.r;
    const midPx = padding.l + innerW / 2;

    // Convert px span to domain span using current focus scale
    const startX = focusXScale.inv(clamp(midPx - spanPx, padding.l, padding.l + innerW));
    const endX = focusXScale.inv(clamp(midPx + spanPx, padding.l, padding.l + innerW));
    const apexX = focusXScale.inv(midPx);

    const peak: Peak = enforcePeakOrder({
      id,
      label,
      startX,
      apexX,
      endX,
    });

    setPeaks((prev) => [...prev, peak]);
    setSelectedPeakId(id);

    // Automatically switch into peak mode so user can adjust immediately
    setEditPeaks(true);

    onLogEvent?.({ type: 'peak_add', peak, t: performance.now() });
  }, [focusXScale, onLogEvent, padding.l, padding.r, peaks.length, width]);

  const deletePeak = useCallback(
    (peakId: string) => {
      setPeaks((prev) => prev.filter((p) => p.id !== peakId));
      onLogEvent?.({ type: 'peak_delete', peakId, t: performance.now() });
      if (selectedPeakId === peakId) setSelectedPeakId(null);
      if (hoverPeakId === peakId) setHoverPeakId(null);
      if (peakDragRef.current?.peakId === peakId) peakDragRef.current = null;
    },
    [hoverPeakId, onLogEvent, selectedPeakId],
  );

  const updatePeakLabel = useCallback(
    (peakId: string, label: string) => {
      setPeaks((prev) => prev.map((p) => (p.id === peakId ? { ...p, label } : p)));
      onLogEvent?.({
        type: 'peak_label',
        peakId,
        label,
        t: performance.now(),
      });
    },
    [onLogEvent],
  );

  // ----------------------------
  // Peak dragging handlers (SVG overlay)
  // ----------------------------
  const onOverlayPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = peakDragRef.current;
    if (!drag) return;

    const px = clientXToSvgPx(e);
    const innerW = width - padding.l - padding.r;
    const plotPx = clamp(px, padding.l, padding.l + innerW);

    // Handle move: update only one of start/apex/end
    if (drag.mode === 'handle') {
      const xVal = clampToDomain(focusXScale.inv(plotPx), zoom.fullDomainX);

      setPeaks((prev) => prev.map((p) => {
        if (p.id !== drag.peakId) return p;
        const next = drag.kind === 'start'
          ? { ...p, startX: xVal }
          : drag.kind === 'apex'
            ? { ...p, apexX: xVal }
            : { ...p, endX: xVal };
        return enforcePeakOrder(next);
      }));
      return;
    }

    // Band move: translate whole peak span
    if (drag.mode === 'move') {
      const dxPx = plotPx - drag.lastPx;
      drag.lastPx = plotPx;

      const domainW = zoom.domainX[1] - zoom.domainX[0];
      const dxDomain = (dxPx / (innerW || 1)) * domainW;

      setPeaks((prev) => prev.map((p) => {
        if (p.id !== drag.peakId) return p;
        const moved: Peak = {
          ...p,
          startX: p.startX + dxDomain,
          apexX: p.apexX + dxDomain,
          endX: p.endX + dxDomain,
        };

        const full = zoom.fullDomainX;
        const minX = Math.min(moved.startX, moved.apexX, moved.endX);
        const maxX = Math.max(moved.startX, moved.apexX, moved.endX);
        let shift = 0;
        if (minX < full[0]) shift = full[0] - minX;
        if (maxX > full[1]) shift = full[1] - maxX;

        return enforcePeakOrder({
          ...moved,
          startX: moved.startX + shift,
          apexX: moved.apexX + shift,
          endX: moved.endX + shift,
        });
      }));

      onLogEvent?.({
        type: 'peak_move',
        peakId: drag.peakId,
        dxDomain,
        t: performance.now(),
      });
    }
  }, [focusXScale, onLogEvent, padding.l, padding.r, width, zoom.domainX, zoom.fullDomainX]);

  const onOverlayPointerUp = useCallback((e: React.PointerEvent) => {
    const drag = peakDragRef.current;
    if (!drag) return;

    peakDragRef.current = null;
    onLogEvent?.({
      type: drag.mode === 'move' ? 'peak_move_end' : 'peak_drag_end',
      peakId: drag.peakId,
      t: performance.now(),
    });

    e.stopPropagation();
    e.preventDefault();
  }, [onLogEvent]);

  // ----------------------------
  // Focus interactions (pan/zoom) — disabled while editing peaks
  // ----------------------------
  const onFocusPointerMove = useCallback((e: React.PointerEvent) => {
    if (editPeaks) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    setHoverPx(px);

    if (placingPeak?.isActive && placingPeak.startPx != null) {
      const px2 = e.clientX - rect.left;
      setPlacingPeak((pp) => (pp ? { ...pp, lastPx: px2 } : pp));

      const innerW = width - padding.l - padding.r;
      const x0 = clamp(placingPeak.startPx, padding.l, padding.l + innerW);
      const x1 = clamp(px2, padding.l, padding.l + innerW);

      const d0 = focusXScale.inv(Math.min(x0, x1));
      const d1 = focusXScale.inv(Math.max(x0, x1));
      const apex = focusXScale.inv(clamp(px2, padding.l, padding.l + innerW));

      setPeaks((prev) => prev.map((p) => {
        if (p.id !== placingPeak.id) return p;
        return enforcePeakOrder({
          ...p,
          startX: d0,
          endX: d1,
          apexX: apex,
        });
      }));

      return;
    }

    // Magnifier (persistent lens): when enabled, the lens follows the pointer.
    if (zoomMode === 'magnifier' && lensEnabled) {
      setLensPx({ x: px, y: e.clientY - rect.top });
      requestDraw(); // important so canvas updates as lens moves
    }

    if (editPeaks) return;

    const dr = dragRef.current;
    if (!dr?.isActive) return;

    if (dr.kind === 'pan') {
      const dx = px - dr.lastPx;
      dr.lastPx = px;
      zoom.panByPx(dx, width, { source: 'focus_drag_pan', zoomMode });
      requestDraw();
    } else if (dr.kind === 'box') {
      dr.lastPx = px;
    }
  }, [editPeaks, focusXScale, placingPeak, padding.l, padding.r, requestDraw, width, zoom, zoomMode]);

  const onFocusPointerDown = useCallback((e: React.PointerEvent) => {
    if (editPeaks) return;
    if (zoomMode === 'clickToZoom') return;

    if (placingPeak?.isActive) {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const px = e.clientX - rect.left;

      setPlacingPeak((pp) => (pp ? { ...pp, startPx: px, lastPx: px } : pp));
      onLogEvent?.({
        type: 'peak_place_start',
        peakId: placingPeak.id,
        px,
        t: performance.now(),
      });
      return;
    }

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = e.clientX - rect.left;

    if (zoomMode === 'boxZoom') {
      // Box zoom redesign: Alt+click performs a local stepwise zoom-out (no reset).
      if (e.altKey) {
        pushZoomHistory(zoom.domainX);
        const anchorX = focusXScale.inv(px);
        zoom.zoomAtX(anchorX, 1 / zoomStepFactor, { source: 'alt+click_zoom_out', zoomMode });
        onLogEvent?.({ type: 'box_zoom_out', anchorX, t: performance.now() });
        requestDraw();
        return;
      }
      dragRef.current = {
        kind: 'box',
        startPx: px,
        lastPx: px,
        isActive: true,
      };
      onLogEvent?.({ type: 'box_start', px, t: performance.now() });
      return;
    }

    dragRef.current = {
      kind: 'pan',
      startPx: px,
      lastPx: px,
      isActive: true,
    };
    onLogEvent?.({ type: 'pan_start', px, t: performance.now() });
  }, [editPeaks, onLogEvent, placingPeak, zoomMode]);

  const onFocusPointerUp = useCallback((e: React.PointerEvent) => {
    if (editPeaks) return;

    if (placingPeak?.isActive && placingPeak.startPx != null) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const px = e.clientX - rect.left;

      const innerW = width - padding.l - padding.r;
      const x0 = clamp(placingPeak.startPx, padding.l, padding.l + innerW);
      const x1 = clamp(px, padding.l, padding.l + innerW);

      const dragged = Math.abs(x1 - x0);
      if (dragged < 6) {
        const apex = focusXScale.inv(clamp(px, padding.l, padding.l + innerW));
        const w = (zoom.domainX[1] - zoom.domainX[0]) * 0.06;
        const startX = apex - w;
        const endX = apex + w;

        setPeaks((prev) => prev.map((p) => (p.id === placingPeak.id ? enforcePeakOrder({
          ...p, startX, apexX: apex, endX,
        }) : p)));
      }

      onLogEvent?.({ type: 'peak_place_commit', peakId: placingPeak.id, t: performance.now() });
      setEditPeaks(true);
      setPlacingPeak(null);
      return;
    }

    const dr = dragRef.current;
    dragRef.current = null;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = e.clientX - rect.left;

    if (dr?.kind === 'box') {
      const innerW = width - padding.l - padding.r;

      const x0 = clamp(dr.startPx, padding.l, padding.l + innerW);
      const x1 = clamp(px, padding.l, padding.l + innerW);

      if (Math.abs(x1 - x0) > 6) {
        const d0 = focusXScale.inv(x0);
        const d1 = focusXScale.inv(x1);
        zoom.setDomainX([d0, d1], { source: 'focus_box', zoomMode });
        onLogEvent?.({
          type: 'box_commit',
          px0: x0,
          px1: x1,
          d0,
          d1,
          t: performance.now(),
        });
      } else {
        onLogEvent?.({ type: 'box_cancel', t: performance.now() });
      }
      requestDraw();
      return;
    }

    onLogEvent?.({ type: 'gesture_end', t: performance.now(), zoomMode });
    requestDraw();
  }, [editPeaks, focusXScale, onLogEvent, padding.l, padding.r, placingPeak, requestDraw, width, zoom, zoomMode]);

  const onFocusWheel = useCallback((e: React.WheelEvent) => {
    // if (editPeaks) return;
    // Scroll zoom mode: wheel controls main zoom.
    // Magnifier mode: wheel controls lens magnification (when lens is enabled).
    if (zoomMode === 'magnifier') {
      if (!lensEnabled) return;
      e.preventDefault();
      const delta = clamp(e.deltaY, -80, 80);
      const step = Math.exp(-delta * 0.01);
      setLensMag((m) => {
        const next = clamp(m * step, 1.2, 6.0);
        onLogEvent?.({
          type: 'lens_mag',
          lensMag: next,
          deltaY: e.deltaY,
          t: performance.now(),
        });
        return next;
      });
      requestDraw();
    }

    if (zoomMode !== 'scroll') return;

    if (e.cancelable) e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const anchorX = focusXScale.inv(px);

    const delta = clamp(e.deltaY, -60, 60);
    const k = 0.015;
    const factor = Math.exp(-delta * k);
    zoom.zoomAtX(anchorX, 1 / factor, { source: 'wheel', zoomMode, deltaY: e.deltaY });
    requestDraw();
  }, [editPeaks, focusXScale, requestDraw, zoom, zoomMode]);

  const onFocusClick = useCallback((e: React.MouseEvent) => {
    if (editPeaks) return;
    // if (zoomMode !== 'clickToZoom') return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const anchorX = focusXScale.inv(px);

    // Click-to-zoom:
    // - plain click zooms in stepwise;
    // - Alt+click zooms out stepwise;
    if (zoomMode === 'clickToZoom') {
      if (e.altKey) {
        zoom.zoomAtX(anchorX, 1 / zoomStepFactor, { type: 'click_zoom_out', source: 'alt+click', zoomMode });
      } else {
        zoom.zoomAtX(anchorX, zoomStepFactor, { type: 'click_zoom_in', source: 'click', zoomMode });
      }
      requestDraw();
    }

    // Box zoom: add local stepwise zoom-out without reset for parity (Alt+click).
    // if (zoomMode === 'boxZoom' && e.altKey) {
    //   zoom.zoomAtX(anchorX, 1 / zoomStepFactor, { type: 'box_zoom_out', source: 'alt+click', zoomMode });
    //   requestDraw();
    // }
  }, [editPeaks, focusXScale, requestDraw, zoom, zoomMode, zoomStepFactor]);

  // disabled doudble click to reset since there is a dedication reset button
  // const onFocusDoubleClick = useCallback(
  //   (e: React.MouseEvent) => {
  //     if (editPeaks) return;
  //     zoom.reset({ source: 'double_click', zoomMode, reason: 'double_click' });
  //     requestDraw();
  //   },
  //   [editPeaks, requestDraw, zoom, zoomMode]
  // );

  // Context interactions (range brush)
  const onContextPointerDown = useCallback((e: React.PointerEvent) => {
    if (editPeaks) return;
    if (zoomMode !== 'rangeBrush') return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = e.clientX - rect.left;

    const [vx0, vx1] = viewportPx;
    const nearLeft = Math.abs(px - vx0) < 10;
    const nearRight = Math.abs(px - vx1) < 10;
    const inside = px > vx0 && px < vx1;

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      kind: 'contextWindow',
      lastPx: px,
      isActive: true,
      nearLeft,
      nearRight,
      inside,
    };

    onLogEvent?.({
      type: 'context_drag_start',
      px,
      nearLeft,
      nearRight,
      inside,
      t: performance.now(),
    });
  }, [editPeaks, onLogEvent, viewportPx, zoomMode]);

  const onContextPointerMove = useCallback((e: React.PointerEvent) => {
    if (editPeaks) return;
    const dr = dragRef.current;
    if (!dr?.isActive || dr.kind !== 'contextWindow' || zoomMode !== 'rangeBrush') return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = e.clientX - rect.left;

    const innerW = width - ctxPadding.l - ctxPadding.r;
    const pxClamped = clamp(px, ctxPadding.l, ctxPadding.l + innerW);

    const fullX = zoom.fullDomainX;
    const scale = makeLinear([ctxPadding.l, ctxPadding.l + innerW], fullX);

    if (dr.inside && !dr.nearLeft && !dr.nearRight) {
      const dx = pxClamped - dr.lastPx;
      dr.lastPx = pxClamped;
      const dDx = scale.f(dx + ctxPadding.l) - scale.f(ctxPadding.l);
      zoom.setDomainX([zoom.domainX[0] + dDx, zoom.domainX[1] + dDx], { source: 'context_window_pan', zoomMode });
    } else if (dr.nearLeft) {
      const newD0 = scale.f(pxClamped);
      zoom.setDomainX([newD0, zoom.domainX[1]], { source: 'context_left_handle', zoomMode });
    } else if (dr.nearRight) {
      const newD1 = scale.f(pxClamped);
      zoom.setDomainX([zoom.domainX[0], newD1], { source: 'context_right_handle', zoomMode });
    } else {
      const mid = scale.f(pxClamped);
      const w = zoom.domainX[1] - zoom.domainX[0];
      zoom.setDomainX([mid - w / 2, mid + w / 2], { source: 'context_recenter', zoomMode });
    }

    requestDraw();
  }, [ctxPadding.l, ctxPadding.r, editPeaks, requestDraw, viewportPx, width, zoom, zoomMode]);

  const onContextPointerUp = useCallback(() => {
    if (editPeaks) return;
    const dr = dragRef.current;
    if (dr?.kind === 'contextWindow') onLogEvent?.({ type: 'context_drag_end', t: performance.now() });
    dragRef.current = null;
    requestDraw();
  }, [editPeaks, onLogEvent, requestDraw]);

  // ----------------------------
  // SVG overlay (focus): cursor/tooltip + box rubber band + peaks
  // ----------------------------
  const focusOverlay = useMemo(() => {
    const innerW = width - padding.l - padding.r;
    const innerH = height - padding.t - padding.b;

    const hoverX = hoverPx != null ? clamp(hoverPx, padding.l, padding.l + innerW) : null;

    // box zoom rubber band (read from dragRef)
    const dr = dragRef.current;
    let boxRect: { x: number; w: number } | null = null;
    if (!editPeaks && zoomMode === 'boxZoom' && dr?.isActive && dr.kind === 'box') {
      const x0 = clamp(dr.startPx, padding.l, padding.l + innerW);
      const x1 = clamp(dr.lastPx, padding.l, padding.l + innerW);
      const left = Math.min(x0, x1);
      const right = Math.max(x0, x1);
      boxRect = { x: left, w: right - left };
    }

    const lens = zoomMode === 'magnifier' && lensEnabled && lensPx
      ? { x: clamp(lensPx.x, padding.l, padding.l + innerW), y: clamp(lensPx.y, padding.t, padding.t + innerH) }
      : null;

    const tip = hoverPoint
      ? { x: clamp(hoverPoint.px + 12, padding.l + 8, width - 220), y: clamp(hoverPoint.py - 34, padding.t + 10, padding.t + innerH - 46) }
      : null;

    const svgInteractive = editPeaks || peakDragRef.current != null; // allow finishing a drag even if toggle flips

    // FIX: handle down now sets mode:'handle' (no currentPx / offsets)
    const onHandleDown = (peak: Peak, kind: DragHandleKind) => (e: React.PointerEvent<SVGElement>) => {
      if (!editPeaks) return;
      e.stopPropagation();
      e.preventDefault();

      (e.currentTarget as SVGGraphicsElement).setPointerCapture(e.pointerId);
      // const target = e.currentTarget as Element;

      peakDragRef.current = {
        mode: 'handle',
        peakId: peak.id,
        kind,
        pointerId: e.pointerId,
        grabOffsetPx: 0,
      };

      setSelectedPeakId(peak.id);
      onLogEvent?.({
        type: 'peak_drag_start',
        peakId: peak.id,
        kind,
        t: performance.now(),
      });
    };

    const railY = padding.t + 12;
    const yTop = padding.t;
    const yBot = padding.t + innerH;

    return (
      <svg
        width={width}
        height={height}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          pointerEvents: svgInteractive ? 'auto' : 'none',
          zIndex: 2,
        }}
        // Only attach these when interactive; otherwise they steal events from the div
        onPointerMove={svgInteractive ? onOverlayPointerMove : undefined}
        onPointerUp={svgInteractive ? onOverlayPointerUp : undefined}
        onPointerCancel={svgInteractive ? onOverlayPointerUp : undefined}
      >
        {hoverX != null && (
          <line
            x1={hoverX}
            x2={hoverX}
            y1={padding.t}
            y2={padding.t + innerH}
            stroke="rgba(17,24,39,0.20)"
            strokeWidth={1}
            pointerEvents="none"
          />
        )}

        {hoverPoint && (
          <>
            <circle cx={hoverPoint.px} cy={hoverPoint.py} r={3.5} fill="rgba(17,24,39,0.9)" pointerEvents="none" />
            <circle cx={hoverPoint.px} cy={hoverPoint.py} r={7} fill="rgba(17,24,39,0.08)" pointerEvents="none" />
          </>
        )}

        {hoverPoint && tip && (
          <>
            <rect
              x={tip.x}
              y={tip.y}
              width={208}
              height={44}
              rx={10}
              fill="rgba(255,255,255,0.94)"
              stroke="rgba(17,24,39,0.12)"
              pointerEvents="none"
            />
            <text x={tip.x + 12} y={tip.y + 18} fontSize={12} fill="rgba(17,24,39,0.85)" pointerEvents="none">
              {xLabel}
              :
              {fmt(hoverPoint.x)}
            </text>
            <text x={tip.x + 12} y={tip.y + 34} fontSize={12} fill="rgba(17,24,39,0.85)" pointerEvents="none">
              {yLabel}
              :
              {fmt(hoverPoint.y)}
            </text>
          </>
        )}

        {boxRect && (
          <rect
            x={boxRect.x}
            y={padding.t}
            width={boxRect.w}
            height={innerH}
            rx={6}
            fill="rgba(17,24,39,0.06)"
            stroke="rgba(17,24,39,0.35)"
            strokeWidth={1}
            pointerEvents="none"
          />
        )}

        {lens && (
          <circle
            cx={lens.x}
            cy={lens.y}
            r={56}
            fill="rgba(255,255,255,0.06)"
            stroke="rgba(17,24,39,0.35)"
            strokeWidth={1}
            pointerEvents="none"
          />
        )}

        {/* Peak placement rubber-band */}
        {placingPeak?.isActive && placingPeak.startPx != null && placingPeak.lastPx != null && (
          <rect
            x={Math.min(placingPeak.startPx, placingPeak.lastPx)}
            y={padding.t}
            width={Math.abs(placingPeak.lastPx - placingPeak.startPx)}
            height={height - padding.t - padding.b}
            rx={8}
            fill="rgba(17,24,39,0.06)"
            stroke="rgba(17,24,39,0.35)"
            strokeWidth={1}
            pointerEvents="none"
          />
        )}

        {peaks.map((pp) => {
          const p = enforcePeakOrder(pp);

          const alwaysShow = p.id === selectedPeakId || p.id === activeDragPeakId;

          const inView = alwaysShow
            || (p.startX >= zoom.domainX[0] && p.startX <= zoom.domainX[1])
            || (p.apexX >= zoom.domainX[0] && p.apexX <= zoom.domainX[1])
            || (p.endX >= zoom.domainX[0] && p.endX <= zoom.domainX[1]);

          if (!inView) return null;

          const xStart = clamp(focusXScale.f(p.startX), padding.l, padding.l + innerW);
          const xApex = clamp(focusXScale.f(p.apexX), padding.l, padding.l + innerW);
          const xEnd = clamp(focusXScale.f(p.endX), padding.l, padding.l + innerW);

          const spanLeft = Math.min(xStart, xEnd);
          const spanW = Math.max(10, Math.abs(xEnd - xStart));

          const isSelected = p.id === selectedPeakId;
          const isHover = p.id === hoverPeakId;
          const isActiveDrag = p.id === activeDragPeakId;

          const lineStrokeApex = isSelected || isActiveDrag ? 'rgba(17,24,39,0.92)' : 'rgba(17,24,39,0.80)';
          const lineStrokeEdge = isSelected || isActiveDrag ? 'rgba(17,24,39,0.55)' : 'rgba(17,24,39,0.40)';

          const railFill = isSelected || isActiveDrag ? 'rgba(17,24,39,0.14)' : 'rgba(17,24,39,0.10)';

          const handleFill = isSelected || isActiveDrag ? 'rgba(17,24,39,0.96)' : 'rgba(17,24,39,0.88)';
          const handleGlow = isSelected || isActiveDrag ? 'rgba(17,24,39,0.10)' : 'rgba(17,24,39,0.07)';

          const labelX = clamp(xApex + 10, padding.l + 6, padding.l + innerW - 140);
          const labelY = clamp(padding.t + 10, 6, height - 24);

          return (
            <g
              key={p.id}
              onPointerEnter={() => setHoverPeakId(p.id)}
              onPointerLeave={() => setHoverPeakId((cur) => (cur === p.id ? null : cur))}
              onPointerDown={() => {
                if (editPeaks) setSelectedPeakId(p.id);
              }}
            >
              <line x1={xStart} x2={xStart} y1={yTop} y2={yBot} stroke={lineStrokeEdge} strokeWidth={1.6} strokeDasharray="4 3" pointerEvents="none" />
              <line x1={xApex} x2={xApex} y1={yTop} y2={yBot} stroke={lineStrokeApex} strokeWidth={1.8} pointerEvents="none" />
              <line x1={xEnd} x2={xEnd} y1={yTop} y2={yBot} stroke={lineStrokeEdge} strokeWidth={1.6} strokeDasharray="4 3" pointerEvents="none" />

              {/* draggable span band (moves entire peak) */}
              <rect
                x={spanLeft}
                y={padding.t}
                width={spanW}
                height={height - padding.t - padding.b}
                rx={10}
                fill={isSelected ? 'rgba(17,24,39,0.06)' : 'rgba(17,24,39,0.03)'}
                stroke={isSelected ? 'rgba(17,24,39,0.18)' : 'rgba(17,24,39,0.10)'}
                strokeWidth={1}
                opacity={editPeaks ? 1 : 0}
                pointerEvents={editPeaks ? 'auto' : 'none'}
                style={{ cursor: editPeaks ? 'move' : 'default' }}
                onPointerDown={(e) => {
                  if (!editPeaks) return;
                  e.stopPropagation();
                  e.preventDefault();

                  (e.currentTarget as SVGGraphicsElement).setPointerCapture(e.pointerId);

                  const svg = e.currentTarget.ownerSVGElement as SVGSVGElement;
                  const rect = svg.getBoundingClientRect();
                  const px = e.clientX - rect.left;

                  peakDragRef.current = {
                    mode: 'move',
                    peakId: p.id,
                    pointerId:
                    e.pointerId,
                    lastPx: px,
                  };
                  setSelectedPeakId(p.id);
                  onLogEvent?.({ type: 'peak_move_start', peakId: p.id, t: performance.now() });
                }}
              />

              {/* top rail */}
              <rect
                x={Math.min(xStart, xEnd)}
                y={railY - 1}
                width={Math.max(6, Math.abs(xEnd - xStart))}
                height={2}
                rx={1}
                fill={railFill}
                pointerEvents={editPeaks ? 'auto' : 'none'}
              />

              {/* handles */}
              <circle cx={xStart} cy={railY} r={10} fill={handleGlow} pointerEvents={editPeaks ? 'auto' : 'none'} />
              <polygon
                points={`${xStart - 7},${railY - 7} ${xStart - 7},${railY + 7} ${xStart + 7},${railY}`}
                fill={handleFill}
                opacity={editPeaks ? 1 : 0.55}
                style={{ cursor: editPeaks ? 'ew-resize' : 'default' }}
                onPointerDown={onHandleDown(p, 'start')}
              />

              <circle cx={xApex} cy={railY} r={11} fill={handleGlow} pointerEvents={editPeaks ? 'auto' : 'none'} />
              <circle
                cx={xApex}
                cy={railY}
                r={6}
                fill={handleFill}
                opacity={editPeaks ? 1 : 0.55}
                style={{ cursor: editPeaks ? 'ew-resize' : 'default' }}
                onPointerDown={onHandleDown(p, 'apex')}
              />

              <circle cx={xEnd} cy={railY} r={10} fill={handleGlow} pointerEvents={editPeaks ? 'auto' : 'none'} />
              <polygon
                points={`${xEnd + 7},${railY - 7} ${xEnd + 7},${railY + 7} ${xEnd - 7},${railY}`}
                fill={handleFill}
                opacity={editPeaks ? 1 : 0.55}
                style={{ cursor: editPeaks ? 'ew-resize' : 'default' }}
                onPointerDown={onHandleDown(p, 'end')}
              />

              {/* label chip */}
              <g pointerEvents={editPeaks ? 'auto' : 'none'}>
                <rect
                  x={labelX}
                  y={labelY}
                  width={120}
                  height={22}
                  rx={999}
                  fill={isSelected ? 'rgba(17,24,39,0.08)' : 'rgba(17,24,39,0.05)'}
                  stroke={isSelected ? 'rgba(17,24,39,0.18)' : 'rgba(17,24,39,0.12)'}
                />
                <text x={labelX + 10} y={labelY + 30} fontSize={12} fill="rgba(17,24,39,0.82)">
                  {p.label}
                </text>
              </g>

              {/* delete 'x' on hover (edit mode only) */}
              {editPeaks && (isHover || isSelected) && (
                <g
                  transform={`translate(${labelX + 120 + 6}, ${labelY + 11})`}
                  style={{ cursor: 'pointer' }}
                  onPointerDown={(e) => {
                    if (!editPeaks) return;
                    e.stopPropagation();
                    e.preventDefault();
                    deletePeak(p.id);
                  }}
                >
                  <circle r={9} fill="rgba(17,24,39,0.10)" stroke="rgba(17,24,39,0.18)" />
                  <line x1={-3.5} y1={-3.5} x2={3.5} y2={3.5} stroke="rgba(17,24,39,0.70)" strokeWidth={1.6} strokeLinecap="round" />
                  <line x1={-3.5} y1={3.5} x2={3.5} y2={-3.5} stroke="rgba(17,24,39,0.70)" strokeWidth={1.6} strokeLinecap="round" />
                </g>
              )}
            </g>
          );
        })}
      </svg>
    );
  }, [
    activeDragPeakId,
    deletePeak,
    editPeaks,
    focusXScale,
    height,
    hoverPeakId,
    hoverPoint,
    hoverPx,
    lensPx,
    onOverlayPointerMove,
    onOverlayPointerUp,
    padding.b,
    padding.l,
    padding.r,
    padding.t,
    peaks,
    placingPeak,
    selectedPeakId,
    width,
    xLabel,
    yLabel,
    zoom.domainX,
    zoomMode,
  ]);

  const selectedPeak = selectedPeakId ? peaks.find((p) => p.id === selectedPeakId) : null;

  // ----------------------------
  // Render
  // ----------------------------
  const pillStyle: React.CSSProperties = {
    fontSize: 12,
    padding: '6px 10px',
    borderRadius: 999,
    border: '1px solid rgba(17,24,39,0.12)',
    background: 'rgba(17,24,39,0.03)',
    color: 'rgba(17,24,39,0.72)',
    whiteSpace: 'nowrap',
  };

  const buttonStyle: React.CSSProperties = {
    padding: '8px 12px',
    borderRadius: 12,
    border: '1px solid rgba(17,24,39,0.14)',
    background: 'white',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    boxShadow: '0 1px 0 rgba(17,24,39,0.04)',
  };

  return (
    <div
      style={{
        width,
        userSelect: 'none',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        color: 'rgb(17,24,39)',
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
          padding: '10px 12px',
          border: '1px solid rgba(17,24,39,0.10)',
          borderRadius: 14,
          background: 'rgba(255,255,255,0.92)',
          boxShadow: '0 1px 0 rgba(17,24,39,0.03)',
          gap: 10,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            minWidth: 240,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 650, letterSpacing: 0.2 }}>{title}</div>
          {subtitle ? (
            <div style={{ fontSize: 12, color: 'rgba(17,24,39,0.55)' }}>{subtitle}</div>
          ) : (
            <div style={{ fontSize: 12, color: 'rgba(17,24,39,0.55)' }}>
              {isLoading ? 'Loading data…' : `View: ${fmt(zoom.domainX[0])} – ${fmt(zoom.domainX[1])}`}
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
          }}
        >
          <div style={pillStyle} title="Zoom interaction mode">
            {modeLabel(zoomMode)}
          </div>

          <label
            style={{
              ...pillStyle,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={editPeaks}
              onChange={(e) => {
                setEditPeaks(e.target.checked);
                onLogEvent?.({ type: 'peaks_edit_toggle', value: e.target.checked, t: performance.now() });
              }}
            />
            Peak Editing Mode (Turn off to explore)
          </label>

          <button
            type="button"
            onClick={() => {
              zoom.reset({ source: 'reset_button', zoomMode });
              requestDraw();
            }}
            style={buttonStyle}
          >
            Reset
          </button>
        </div>
      </div>

      {/* Secondary peak controls: select + rename + delete */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          marginBottom: 10,
          padding: '10px 12px',
          border: '1px solid rgba(17,24,39,0.08)',
          borderRadius: 14,
          background: 'rgba(17,24,39,0.02)',
        }}
      >

        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'rgba(17,24,39,0.55)' }}>
          {editPeaks ? 'Editing enabled: drag ▸ ● ◂ and click × to delete.' : 'Editing disabled: peaks locked.'}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div style={{ fontSize: 12, color: 'rgba(17,24,39,0.70)', fontWeight: 650 }}>Peaks</div>

          <select
            value={selectedPeakId ?? ''}
            onChange={(e) => setSelectedPeakId(e.target.value || null)}
            style={{
              padding: '8px 10px',
              borderRadius: 12,
              border: '1px solid rgba(17,24,39,0.12)',
              background: 'white',
              fontSize: 12,
              minWidth: 180,
            }}
          >
            <option value="">(none)</option>
            {peaks.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>

          <input
            value={selectedPeak?.label ?? ''}
            placeholder="Rename selected peak…"
            onChange={(e) => {
              if (!selectedPeakId) return;
              updatePeakLabel(selectedPeakId, e.target.value);
            }}
            disabled={!selectedPeakId}
            style={{
              padding: '8px 10px',
              borderRadius: 12,
              border: '1px solid rgba(17,24,39,0.12)',
              background: selectedPeakId ? 'white' : 'rgba(255,255,255,0.5)',
              fontSize: 12,
              minWidth: 220,
            }}
          />

          <button
            type="button"
            disabled={!selectedPeakId}
            onClick={() => selectedPeakId && deletePeak(selectedPeakId)}
            style={{
              padding: '8px 12px',
              borderRadius: 12,
              border: '1px solid rgba(17,24,39,0.12)',
              background: 'rgba(17,24,39,0.03)',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              color: 'rgba(17,24,39,0.75)',
              opacity: selectedPeakId ? 1 : 0.5,
              cursor: selectedPeakId ? 'pointer' : 'not-allowed',
            }}
          >
            Delete selected
          </button>

          <button type="button" onClick={addPeak} style={buttonStyle}>
            Add peak
          </button>
        </div>
      </div>

      {placingPeak?.isActive && (
        <div style={{ fontSize: 12, color: 'rgba(17,24,39,0.60)' }}>
          Placing peak: drag to set start/end, or click to place apex. (Esc cancels)
        </div>
      )}

      {error && (
        <div
          style={{
            marginBottom: 10,
            padding: '10px 12px',
            borderRadius: 12,
            border: '1px solid rgba(220,38,38,0.22)',
            background: 'rgba(220,38,38,0.06)',
            color: 'rgb(185,28,28)',
            fontSize: 12,
            whiteSpace: 'pre-wrap',
          }}
        >
          {error}
        </div>
      )}

      {/* Focus */}
      <div
        style={{
          position: 'relative',
          width,
          height,
          border: '1px solid rgba(17,24,39,0.10)',
          borderRadius: 16,
          overflow: 'hidden',
          background: 'white',
          boxShadow: '0 1px 0 rgba(17,24,39,0.03)',
        }}
      >
        <canvas ref={focusCanvasRef} />
        {focusOverlay}

        {/* Interaction layer (kept separate from peak handles) */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            cursor: editPeaks ? 'default' : zoomMode === 'boxZoom' ? 'crosshair' : 'grab',
            touchAction: 'none',
            pointerEvents: 'auto',
          }}
          onPointerMove={onFocusPointerMove}
          onPointerDown={onFocusPointerDown}
          onPointerUp={onFocusPointerUp}
          onWheel={onFocusWheel}
          onClick={onFocusClick}
          // onDoubleClick={onFocusDoubleClick}
          onPointerLeave={() => {
            if (lensPx) {
              setLensPx(null);
              requestDraw();
            }
          }}
        />
      </div>

      <div style={{ height: gap }} />

      {/* Context */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 6,
          alignItems: 'baseline',
        }}
      >
        <div style={{ fontSize: 12, color: 'rgba(17,24,39,0.80)' }}>
          <strong>Context</strong>
          {' '}
          <span style={{ color: 'rgba(17,24,39,0.55)' }}>
            (
            full range
            {fmt(zoom.fullDomainX[0])}
            –
            {fmt(zoom.fullDomainX[1])}
            )
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'rgba(17,24,39,0.55)' }}>
          View:
          {fmt(zoom.domainX[0])}
          –
          {fmt(zoom.domainX[1])}
        </div>
      </div>

      <div
        style={{
          position: 'relative',
          width,
          height: contextH,
          border: '1px solid rgba(17,24,39,0.10)',
          borderRadius: 16,
          overflow: 'hidden',
          background: 'white',
          boxShadow: '0 1px 0 rgba(17,24,39,0.03)',
        }}
      >
        <canvas ref={contextCanvasRef} />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            cursor: editPeaks ? 'default' : zoomMode === 'rangeBrush' ? 'ew-resize' : 'default',
            touchAction: 'none',
          }}
          onPointerDown={onContextPointerDown}
          onPointerMove={onContextPointerMove}
          onPointerUp={onContextPointerUp}
        />
      </div>

      <div style={{ marginTop: 8, fontSize: 12, color: 'rgba(17,24,39,0.55)' }}>
        Focus+context: the mini view shows the full chromatogram; the shaded window indicates your current zoomed region.
      </div>
    </div>
  );
}
