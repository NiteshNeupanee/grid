import { useState, useEffect, useRef, useCallback, Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  Sun, Moon, Upload, Download, ChevronDown, ChevronRight, X,
  Layers, Grid3X3, Square, Triangle, Diamond, LayoutGrid, CheckSquare,
} from "lucide-react";

const OrthogridIcon = ({ size = 16, ...props }: any) => (<svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}><rect x="3" y="3" width="26" height="26"/><line x1="16" y1="3" x2="16" y2="29"/><line x1="3" y1="16" x2="29" y2="16"/><line x1="3" y1="3" x2="29" y2="29"/><line x1="29" y1="3" x2="3" y2="29"/></svg>);

// ── Types ────────────────────────────────────────────────
interface StudioState {
  shape: string; cs: number; rw: number; rd: number; st: number;
  rot: number; dm: string; ns: string; nd: number; mat: string;
  fileName: string; modelLoaded: boolean;
  selectedFaceIds: Set<number>;
  faceGroups: FaceGroup[]; faceGeos: Record<number, THREE.BufferGeometry>;
  triToFace: Int32Array | null;
  wireframe: boolean; gridVisible: boolean;
  lastSegs: Seg[]; lastBounds: Bounds;
}

interface FaceGroup {
  id: number; tris: number[]; normal: THREE.Vector3; centroid: THREE.Vector3; area: number;
}

interface Seg { x1: number; z1: number; x2: number; z2: number; }
interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number; }
interface Pt2D { x: number; z: number; }

// ── Constants ─────────────────────────────────────────────
const D2R = Math.PI / 180;
const MAX_SEGS = 12000;

const MATS: Record<string, { name: string; density: number; yield: number; E: number }> = {
  al6061:  { name: "Aluminum 6061-T6",    density: 2700,  yield: 276,  E: 68.9  },
  al7075:  { name: "Aluminum 7075-T6",    density: 2810,  yield: 503,  E: 71.7  },
  ti6al4v: { name: "Titanium Ti-6Al-4V",  density: 4430,  yield: 880,  E: 114   },
  ss316:   { name: "Stainless 316L",      density: 8000,  yield: 205,  E: 193   },
  inconel: { name: "Inconel 718",         density: 8190,  yield: 1035, E: 200   },
  pla:     { name: "PLA",                 density: 1240,  yield: 50,   E: 3.5   },
  petg:    { name: "PETG",                density: 1270,  yield: 50,   E: 2.0   },
  abs:     { name: "ABS",                 density: 1040,  yield: 40,   E: 2.3   },
  nylon:   { name: "Nylon PA12",          density: 1010,  yield: 48,   E: 1.7   },
  cf_nylon:{ name: "CF Nylon",            density: 1180,  yield: 85,   E: 7.5   },
  custom:  { name: "Custom",              density: 2700,  yield: 276,  E: 70    },
};

const PRESETS: Record<string, { cs: number; rw: number; rd: number; st: number; shape: string }> = {
  nasa:  { cs: 25, rw: 2,   rd: 8,  st: 1.5, shape: "isogrid" },
  light: { cs: 40, rw: 1.5, rd: 6,  st: 1,   shape: "isogrid" },
  stiff: { cs: 15, rw: 3,   rd: 10, st: 2.5, shape: "isogrid" },
};

const SHAPES = [
  { id: "isogrid",     label: "Isogrid",   icon: Triangle    },
  { id: "square",      label: "Square",    icon: Square      },
  { id: "hex",         label: "Hex",       icon: Grid3X3     },
  { id: "rhombus",     label: "Rhombus",   icon: Diamond     },
  { id: "rectangular", label: "Rect",      icon: LayoutGrid  },
  { id: "orthogrid",   label: "Orthogrid", icon: OrthogridIcon },
];

// ── Geometry helpers ──────────────────────────────────────
function clipLine(x1: number, z1: number, x2: number, z2: number, b: Bounds): Seg | null {
  const dx = x2 - x1, dz = z2 - z1;
  let tmin = 0, tmax = 1;
  const edges = [{ p: -dx, q: x1 - b.minX }, { p: dx, q: b.maxX - x1 }, { p: -dz, q: z1 - b.minZ }, { p: dz, q: b.maxZ - z1 }];
  for (const { p, q } of edges) {
    if (Math.abs(p) < 1e-10) { if (q < 0) return null; }
    else { const t = q / p; if (p < 0) tmin = Math.max(tmin, t); else tmax = Math.min(tmax, t); }
  }
  if (tmin > tmax) return null;
  return { x1: x1 + tmin * dx, z1: z1 + tmin * dz, x2: x1 + tmax * dx, z2: z1 + tmax * dz };
}

function pLines(angle: number, sp: number, bounds: Bounds): Seg[] {
  const ca = Math.cos(angle), sa = Math.sin(angle), nx = -sa, nz = ca;
  const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
  const w = bounds.maxX - bounds.minX, h = bounds.maxZ - bounds.minZ;
  const diag = Math.sqrt(w * w + h * h) / 2 + sp * 2, n = Math.ceil(diag / sp);
  const segs: Seg[] = [];
  for (let i = -n; i <= n; i++) {
    const px = cx + nx * i * sp, pz = cz + nz * i * sp;
    const c = clipLine(px - ca * diag, pz - sa * diag, px + ca * diag, pz + sa * diag, bounds);
    if (c) segs.push(c);
  }
  return segs;
}

function edgeKey(x1: number, z1: number, x2: number, z2: number): string {
  const P = 50;
  let ax = Math.round(x1 * P), az = Math.round(z1 * P), bx = Math.round(x2 * P), bz = Math.round(z2 * P);
  if (ax > bx || (ax === bx && az > bz)) { [ax, bx] = [bx, ax]; [az, bz] = [bz, az]; }
  return `${ax},${az}:${bx},${bz}`;
}

function genHex(L: number, bounds: Bounds, rot: number): Seg[] {
  const cr = Math.cos(rot), sr = Math.sin(rot), colSp = L * 1.5, rowSp = L * Math.sqrt(3);
  const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
  const diag = Math.sqrt(Math.pow(bounds.maxX - bounds.minX, 2) + Math.pow(bounds.maxZ - bounds.minZ, 2)) / 2 + L * 3;
  const nC = Math.ceil(diag / colSp) + 1, nR = Math.ceil(diag / rowSp) + 1;
  const es = new Set<string>(), segs: Seg[] = [];
  for (let col = -nC; col <= nC; col++) for (let row = -nR; row <= nR; row++) {
    const hx = col * colSp, hz = row * rowSp + (Math.abs(col) % 2 ? rowSp / 2 : 0);
    const rx = hx * cr - hz * sr + cx, rz = hx * sr + hz * cr + cz;
    for (let i = 0; i < 6; i++) {
      const a1 = Math.PI / 3 * i + rot, a2 = Math.PI / 3 * ((i + 1) % 6) + rot;
      const px1 = rx + L * Math.cos(a1), pz1 = rz + L * Math.sin(a1), px2 = rx + L * Math.cos(a2), pz2 = rz + L * Math.sin(a2);
      const k = edgeKey(px1, pz1, px2, pz2);
      if (!es.has(k)) { es.add(k); const c = clipLine(px1, pz1, px2, pz2, bounds); if (c) segs.push(c); }
    }
  }
  return segs;
}

function genSegs(shape: string, L: number, bounds: Bounds, rotDeg: number): Seg[] {
  const r = rotDeg * D2R, s32 = Math.sqrt(3) / 2;
  switch (shape) {
    case "isogrid":     return [...pLines(r, L * s32, bounds), ...pLines(Math.PI / 3 + r, L * s32, bounds), ...pLines(2 * Math.PI / 3 + r, L * s32, bounds)];
    case "square":      return [...pLines(r, L, bounds), ...pLines(Math.PI / 2 + r, L, bounds)];
    case "hex":         return genHex(L, bounds, r);
    case "rhombus":     return [...pLines(Math.PI / 4 + r, L * s32, bounds), ...pLines(3 * Math.PI / 4 + r, L * s32, bounds)];
    case "rectangular": return [...pLines(r, L * 0.6, bounds), ...pLines(Math.PI / 2 + r, L, bounds)];
    case "orthogrid":   return [...pLines(r, L, bounds), ...pLines(Math.PI / 2 + r, L, bounds), ...pLines(Math.PI / 4 + r, L / Math.sqrt(2), bounds), ...pLines(3 * Math.PI / 4 + r, L / Math.sqrt(2), bounds)];
    default: return [];
  }
}

// Find actual intersection points of rib segments — guaranteed to be at vertices
function findSegIntersections(segs: Seg[], bounds: Bounds): Pt2D[] {
  const pts: Pt2D[] = [];
  const seen = new Set<string>();
  // Also collect all segment endpoints as candidate nodes
  for (const s of segs) {
    for (const [x, z] of [[s.x1, s.z1], [s.x2, s.z2]]) {
      if (x >= bounds.minX - 0.1 && x <= bounds.maxX + 0.1 && z >= bounds.minZ - 0.1 && z <= bounds.maxZ + 0.1) {
        const key = `${Math.round(x * 10)},${Math.round(z * 10)}`;
        if (!seen.has(key)) { seen.add(key); pts.push({ x, z }); }
      }
    }
  }
  // Find pairwise intersections
  for (let i = 0; i < segs.length; i++) {
    const a = segs[i];
    for (let j = i + 1; j < segs.length; j++) {
      const b = segs[j];
      const d1x = a.x2 - a.x1, d1z = a.z2 - a.z1;
      const d2x = b.x2 - b.x1, d2z = b.z2 - b.z1;
      const cross = d1x * d2z - d1z * d2x;
      if (Math.abs(cross) < 1e-10) continue;
      const dx = b.x1 - a.x1, dz = b.z1 - a.z1;
      const t = (dx * d2z - dz * d2x) / cross;
      const u = (dx * d1z - dz * d1x) / cross;
      if (t < -0.01 || t > 1.01 || u < -0.01 || u > 1.01) continue;
      const x = a.x1 + t * d1x, z = a.z1 + t * d1z;
      if (x >= bounds.minX - 0.1 && x <= bounds.maxX + 0.1 && z >= bounds.minZ - 0.1 && z <= bounds.maxZ + 0.1) {
        const key = `${Math.round(x * 10)},${Math.round(z * 10)}`;
        if (!seen.has(key)) { seen.add(key); pts.push({ x, z }); }
      }
    }
  }
  return pts;
}

// Trim rib segments at node positions so holes appear clean
function trimSegsAtNodes(segs: Seg[], nodes: Pt2D[], trimR: number): Seg[] {
  if (trimR <= 0 || !nodes.length) return segs;
  const result: Seg[] = [];
  for (const s of segs) {
    let pieces: [number, number][] = [[0, 1]];
    const dx = s.x2 - s.x1, dz = s.z2 - s.z1;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.01) continue;
    for (const n of nodes) {
      const t = ((n.x - s.x1) * dx + (n.z - s.z1) * dz) / (len * len);
      if (t < -0.5 || t > 1.5) continue;
      const cx = s.x1 + Math.max(0, Math.min(1, t)) * dx;
      const cz = s.z1 + Math.max(0, Math.min(1, t)) * dz;
      const dist = Math.sqrt((n.x - cx) ** 2 + (n.z - cz) ** 2);
      if (dist > trimR * 1.1) continue;
      const halfChord = Math.sqrt(Math.max(0, trimR * trimR - dist * dist));
      const tMin = t - halfChord / len, tMax = t + halfChord / len;
      const newPieces: [number, number][] = [];
      for (const [a, b] of pieces) {
        if (tMax <= a || tMin >= b) { newPieces.push([a, b]); continue; }
        if (tMin > a) newPieces.push([a, Math.max(a, tMin)]);
        if (tMax < b) newPieces.push([Math.min(b, tMax), b]);
      }
      pieces = newPieces;
    }
    for (const [a, b] of pieces) {
      if ((b - a) * len < 0.5) continue;
      result.push({ x1: s.x1 + a * dx, z1: s.z1 + a * dz, x2: s.x1 + b * dx, z2: s.z1 + b * dz });
    }
  }
  return result;
}

function pointInTri2D(px: number, pz: number, ax: number, az: number, bx: number, bz: number, cx: number, cz: number): boolean {
  const v0x = cx - ax, v0z = cz - az, v1x = bx - ax, v1z = bz - az, v2x = px - ax, v2z = pz - az;
  const d00 = v0x * v0x + v0z * v0z, d01 = v0x * v1x + v0z * v1z, d02 = v0x * v2x + v0z * v2z;
  const d11 = v1x * v1x + v1z * v1z, d12 = v1x * v2x + v1z * v2z, inv = 1 / (d00 * d11 - d01 * d01);
  const u = (d11 * d02 - d01 * d12) * inv, v2 = (d00 * d12 - d01 * d02) * inv;
  return u >= 0 && v2 >= 0 && u + v2 <= 1;
}

function pointInFace2D(px: number, pz: number, tris2D: number[][]): boolean {
  for (const t of tris2D) if (pointInTri2D(px, pz, t[0], t[1], t[2], t[3], t[4], t[5])) return true;
  return false;
}

function extendSeg(s: Seg, ext: number): Seg {
  const dx = s.x2 - s.x1, dz = s.z2 - s.z1, len = Math.sqrt(dx * dx + dz * dz);
  if (len < 0.001) return s;
  const ux = dx / len, uz = dz / len;
  return { x1: s.x1 - ux * ext, z1: s.z1 - uz * ext, x2: s.x2 + ux * ext, z2: s.z2 + uz * ext };
}

// ── Main Component ────────────────────────────────────────
export default function Studio() {
  const [isDark, setIsDark] = useState(true);
  const [shape, setShape] = useState("isogrid");
  const [cs, setCs] = useState(25);
  const [rw, setRw] = useState(2);
  const [rd, setRd] = useState(8);
  const [st, setSt] = useState(1.5);
  const [rot, setRot] = useState(0);
  const [dm, setDm] = useState("raised");
  const [ns, setNs] = useState("none");
  const [nd, setNd] = useState(6);
  const [mat, setMat] = useState("al6061");
  const [customMatName, setCustomMatName] = useState("Custom");
  const [customDensity, setCustomDensity] = useState(2700);
  const [customYield, setCustomYield] = useState(276);
  const [customE, setCustomE] = useState(70);
  const [nodeHole, setNodeHole] = useState(false);
  const [nodeHoleDia, setNodeHoleDia] = useState(3);
  const [wallEnabled, setWallEnabled] = useState(true);
  const [fileName, setFileName] = useState("");
  const [modelLoaded, setModelLoaded] = useState(false);
  const [selectedFaceIds, setSelectedFaceIds] = useState<Set<number>>(new Set());
  const [wireframe, setWireframe] = useState(false);
  const [gridVisible, setGridVisible] = useState(true);
  const [ribError, setRibError] = useState(false);
  const [statusTxt, setStatusTxt] = useState("Ready — load a model or adjust parameters");
  const [statusType, setStatusType] = useState<"ok" | "warn" | "err" | "idle">("idle");
  const [metrics, setMetrics] = useState({ mass: "—", open: "—", rib: "—", stiff: "—", stiffPct: 0 });
  const [vertCount, setVertCount] = useState(0);
  const [triCount, setTriCount] = useState(0);
  const [ribCount, setRibCount] = useState(0);
  const [faceInfo, setFaceInfo] = useState<{ text: string; visible: boolean }>({ text: "", visible: false });
  const [showFaceHint, setShowFaceHint] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("Loading…");
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showDonate, setShowDonate] = useState(false);
  const [pendingExportFmt, setPendingExportFmt] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ msg: string; type: string; visible: boolean }>({ msg: "", type: "", visible: false });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [adDismissed, setAdDismissed] = useState(false);
  const [adblockNotice, setAdblockNotice] = useState(false);
  const [adblockDismissed, setAdblockDismissed] = useState(false);

  // Three.js refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gizmoCanvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const gizmoRRef = useRef<THREE.WebGLRenderer | null>(null);
  const gizmoSRef = useRef<THREE.Scene | null>(null);
  const gizmoCRef = useRef<THREE.PerspectiveCamera | null>(null);
  const camLightRef = useRef<THREE.PointLight | null>(null);
  const modelMeshRef = useRef<THREE.Mesh | null>(null);
  const highlightMeshRef = useRef<THREE.Mesh | null>(null);
  const selHighlightsRef = useRef<THREE.Mesh[]>([]);
  const gridGroupRef = useRef<THREE.Group | null>(null);
  const floorGridRef = useRef<THREE.GridHelper | null>(null);
  const animFrameRef = useRef<number>(0);

  // Mutable state ref for Three.js callbacks
  const stRef = useRef<StudioState>({
    shape: "isogrid", cs: 25, rw: 2, rd: 8, st: 1.5, rot: 0, dm: "raised",
    ns: "none", nd: 6, mat: "al6061", fileName: "", modelLoaded: false,
    selectedFaceIds: new Set(), faceGroups: [], faceGeos: {}, triToFace: null,
    wireframe: false, gridVisible: true, lastSegs: [], lastBounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
  });

  const hoveredFaceRef = useRef(-1);
  const notifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const regenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const occtRef = useRef<unknown | null>(null);

  const ribMat = useRef(new THREE.MeshStandardMaterial({ color: 0xb0a090, roughness: 0.25, metalness: 0.75 }));
  const skinMat = useRef(new THREE.MeshStandardMaterial({ color: 0x8a7a6a, roughness: 0.2, metalness: 0.6, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
  const highlightMat = useRef(new THREE.MeshBasicMaterial({ color: 0xcc8822, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false }));
  const selHighlightMat = useRef(new THREE.MeshBasicMaterial({ color: 0xcc8822, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));

  // Theme
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) { root.removeAttribute("data-theme"); root.classList.add("dark"); }
    else { root.setAttribute("data-theme", "light"); root.classList.remove("dark"); }
    if (rendererRef.current) rendererRef.current.setClearColor(isDark ? 0x111009 : 0xe8e2d6);
  }, [isDark]);

  const notify = useCallback((msg: string, type = "", dur = 3000) => {
    setNotification({ msg, type, visible: true });
    if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
    notifTimerRef.current = setTimeout(() => setNotification(n => ({ ...n, visible: false })), dur);
  }, []);

  const setStatus = useCallback((type: "ok" | "warn" | "err" | "idle", txt: string) => {
    setStatusType(type); setStatusTxt(txt);
  }, []);

  const updateMetrics = useCallback((segs: Seg[], bounds: Bounds) => {
    const S = stRef.current, matData = MATS[S.mat] || MATS.al6061;
    const dens = S.mat === "custom" ? customDensity : matData.density;
    const skinA = (bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ);
    let totalLen = 0;
    for (const s of segs) { const dx = s.x2 - s.x1, dz = s.z2 - s.z1; totalLen += Math.sqrt(dx * dx + dz * dz); }
    const mass = (skinA * S.st + totalLen * S.rw * S.rd) * 1e-9 * dens;
    const openA = Math.max(0, Math.min(100, (1 - totalLen * S.rw / skinA) * 100));
    const ribDens = totalLen / (skinA / 100);
    const delta = S.shape === "isogrid" ? Math.sqrt(3) * S.rw * S.rd / (S.cs * S.st) : S.rw * S.rd / (S.cs * S.st);
    setMetrics({
      mass: mass < 1 ? (mass * 1000).toFixed(1) + " g" : mass.toFixed(2) + " kg",
      open: openA.toFixed(1) + "%", rib: ribDens.toFixed(1) + "/cm²",
      stiff: delta.toFixed(3), stiffPct: Math.min(100, delta * 20),
    });
  }, [customDensity, customYield, customE]);

  // Grid geometry builders
  function makeRibGeo(segs: Seg[], rw: number, rh: number): THREE.BufferGeometry | null {
    if (!segs.length) return null;
    const geos: THREE.BufferGeometry[] = [], tmp = new THREE.Object3D();
    for (const s of segs) {
      const dx = s.x2 - s.x1, dz = s.z2 - s.z1, len = Math.sqrt(dx * dx + dz * dz);
      if (len < 0.01) continue;
      const g = new THREE.BoxGeometry(len, rh, rw);
      tmp.position.set((s.x1 + s.x2) / 2, rh / 2, (s.z1 + s.z2) / 2);
      tmp.rotation.set(0, Math.atan2(-dz, dx), 0); tmp.scale.set(1, 1, 1); tmp.updateMatrix();
      g.applyMatrix4(tmp.matrix); geos.push(g);
    }
    if (!geos.length) return null;
    try { return mergeGeometries(geos); } catch { return geos[0]; }
  }

  function makeNodeGeo(nodes: Pt2D[], style: string, dia: number, rh: number, holeEnabled: boolean, holeDia: number, skinThick: number = 0): THREE.BufferGeometry | null {
    if (!nodes.length || style === "none") return null;
    const geos: THREE.BufferGeometry[] = [], r = dia / 2, sg = style === "hex" ? 6 : 20;
    const hr = Math.min(holeDia / 2, r * 0.9);
    for (const n of nodes) {
      if (holeEnabled && hr > 0.1) {
        // Through-hole that cuts through ribs AND skin
        const totalH = rh + skinThick + 0.2; // extra 0.2 to fully penetrate
        const yStart = -skinThick - 0.1;
        // Outer cylinder (only rib height, sits on top of skin)
        const outer = new THREE.CylinderGeometry(r, r, rh, sg, 1, true);
        outer.translate(n.x, rh / 2, n.z);
        geos.push(outer);
        // Inner hole cylinder - goes through everything
        const inner = new THREE.CylinderGeometry(hr, hr, totalH, sg, 1, true);
        inner.scale(-1, 1, 1); // flip normals inward
        inner.translate(n.x, yStart + totalH / 2, n.z);
        geos.push(inner);
        // Top annular ring
        const topRing = new THREE.RingGeometry(hr, r, sg);
        topRing.rotateX(-Math.PI / 2);
        topRing.translate(n.x, rh, n.z);
        geos.push(topRing);
        // Bottom annular ring (below skin)
        const botRing = new THREE.RingGeometry(hr, r, sg);
        botRing.rotateX(Math.PI / 2);
        botRing.translate(n.x, 0, n.z);
        geos.push(botRing);
      } else {
        const g = new THREE.CylinderGeometry(r, r, rh, sg);
        g.translate(n.x, rh / 2, n.z);
        geos.push(g);
      }
    }
    try { return mergeGeometries(geos); } catch { return geos[0]; }
  }

  function makeBoundingWall(bounds: Bounds, rw: number, rh: number): THREE.BufferGeometry | null {
    const geos: THREE.BufferGeometry[] = [];
    const w = bounds.maxX - bounds.minX, d = bounds.maxZ - bounds.minZ;
    const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
    const wallW = Math.max(rw, 2);
    const front = new THREE.BoxGeometry(w + wallW, rh, wallW);
    front.translate(cx, rh / 2, bounds.minZ - wallW / 2); geos.push(front);
    const back = new THREE.BoxGeometry(w + wallW, rh, wallW);
    back.translate(cx, rh / 2, bounds.maxZ + wallW / 2); geos.push(back);
    const left = new THREE.BoxGeometry(wallW, rh, d + wallW * 2);
    left.translate(bounds.minX - wallW / 2, rh / 2, cz); geos.push(left);
    const right = new THREE.BoxGeometry(wallW, rh, d + wallW * 2);
    right.translate(bounds.maxX + wallW / 2, rh / 2, cz); geos.push(right);
    try { return mergeGeometries(geos); } catch { return geos[0]; }
  }

  // Build wall by tracing actual face outline edges (works for any shape, not just rectangles)
  function makeFaceOutlineWall(tris2D: number[][], rw: number, rh: number): THREE.BufferGeometry | null {
    if (!tris2D.length) return null;
    const P = 100; // rounding precision
    const edgeMap = new Map<string, { x1: number; z1: number; x2: number; z2: number; count: number }>();
    for (const tri of tris2D) {
      const verts: [number, number][] = [[tri[0], tri[1]], [tri[2], tri[3]], [tri[4], tri[5]]];
      for (let i = 0; i < 3; i++) {
        const [x1, z1] = verts[i], [x2, z2] = verts[(i + 1) % 3];
        let ax = Math.round(x1 * P), az = Math.round(z1 * P);
        let bx = Math.round(x2 * P), bz = Math.round(z2 * P);
        if (ax > bx || (ax === bx && az > bz)) { [ax, bx] = [bx, ax]; [az, bz] = [bz, az]; }
        const key = `${ax},${az}:${bx},${bz}`;
        const existing = edgeMap.get(key);
        if (existing) existing.count++;
        else edgeMap.set(key, { x1, z1, x2, z2, count: 1 });
      }
    }
    // Boundary edges are shared by exactly 1 triangle
    const boundarySegs: Seg[] = [];
    for (const edge of edgeMap.values()) {
      if (edge.count === 1) boundarySegs.push({ x1: edge.x1, z1: edge.z1, x2: edge.x2, z2: edge.z2 });
    }
    if (!boundarySegs.length) return null;
    return makeRibGeo(boundarySegs, Math.max(rw, 2), rh);
  }

  // Face detection
  function detectFaces(geometry: THREE.BufferGeometry) {
    let geo = geometry; if (geo.index) geo = geo.toNonIndexed();
    const pos = geo.attributes.position.array as Float32Array, numTri = pos.length / 9;
    const triNormals: THREE.Vector3[] = [], triCentroids: THREE.Vector3[] = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < numTri; i++) {
      const o = i * 9;
      a.set(pos[o], pos[o + 1], pos[o + 2]); b.set(pos[o + 3], pos[o + 4], pos[o + 5]); c.set(pos[o + 6], pos[o + 7], pos[o + 8]);
      const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      triNormals.push(n); triCentroids.push(a.clone().add(b).add(c).divideScalar(3));
    }
    const PV = 100;
    function vKey(x: number, y: number, z: number) { return `${Math.round(x * PV)},${Math.round(y * PV)},${Math.round(z * PV)}`; }
    function eKey(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) { const ka = vKey(x1, y1, z1), kb = vKey(x2, y2, z2); return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`; }
    const edgeToTris: Record<string, number[]> = {};
    for (let i = 0; i < numTri; i++) {
      const o = i * 9;
      for (let e = 0; e < 3; e++) {
        const v1 = o + e * 3, v2 = o + ((e + 1) % 3) * 3;
        const key = eKey(pos[v1], pos[v1 + 1], pos[v1 + 2], pos[v2], pos[v2 + 1], pos[v2 + 2]);
        if (!edgeToTris[key]) edgeToTris[key] = [];
        edgeToTris[key].push(i);
      }
    }
    const adj: number[][] = new Array(numTri).fill(null).map(() => []);
    for (const key in edgeToTris) {
      const tris = edgeToTris[key];
      for (let i = 0; i < tris.length; i++) for (let j = i + 1; j < tris.length; j++) {
        if (triNormals[tris[i]].dot(triNormals[tris[j]]) > 0.95) { adj[tris[i]].push(tris[j]); adj[tris[j]].push(tris[i]); }
      }
    }
    const visited = new Uint8Array(numTri), triToFace = new Int32Array(numTri), faceGroups: FaceGroup[] = [];
    let gid = 0;
    for (let start = 0; start < numTri; start++) {
      if (visited[start]) continue;
      const component: number[] = [], queue = [start]; visited[start] = 1;
      while (queue.length) { const t = queue.shift()!; component.push(t); for (const nb of adj[t]) if (!visited[nb]) { visited[nb] = 1; queue.push(nb); } }
      const avgN = new THREE.Vector3(), cent = new THREE.Vector3(); let area = 0;
      for (const ti of component) {
        avgN.add(triNormals[ti]); cent.add(triCentroids[ti]);
        const o = ti * 9;
        a.set(pos[o], pos[o + 1], pos[o + 2]); b.set(pos[o + 3], pos[o + 4], pos[o + 5]); c.set(pos[o + 6], pos[o + 7], pos[o + 8]);
        area += b.clone().sub(a).cross(c.clone().sub(a)).length() * 0.5;
      }
      avgN.divideScalar(component.length).normalize(); cent.divideScalar(component.length);
      for (const ti of component) triToFace[ti] = gid;
      faceGroups.push({ id: gid, tris: component, normal: avgN, centroid: cent, area }); gid++;
    }
    faceGroups.sort((a, b) => b.area - a.area);
    for (let i = 0; i < faceGroups.length; i++) { for (const ti of faceGroups[i].tris) triToFace[ti] = i; faceGroups[i].id = i; }
    const faceGeos: Record<number, THREE.BufferGeometry> = {};
    for (const fg of faceGroups) {
      if (fg.area < 1) continue;
      const verts = new Float32Array(fg.tris.length * 9);
      for (let i = 0; i < fg.tris.length; i++) { const o = fg.tris[i] * 9; verts.set((pos as Float32Array).subarray(o, o + 9), i * 9); }
      const bg = new THREE.BufferGeometry(); bg.setAttribute("position", new THREE.BufferAttribute(verts, 3)); bg.computeVertexNormals();
      faceGeos[fg.id] = bg;
    }
    stRef.current.faceGroups = faceGroups; stRef.current.faceGeos = faceGeos; stRef.current.triToFace = triToFace;
    return { geo, faceGroups, triToFace };
  }

  function buildFrame(normal: THREE.Vector3, fg: FaceGroup, centroid: THREE.Vector3) {
    const N = normal.clone().normalize();
    let T0 = Math.abs(N.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(N).normalize() : new THREE.Vector3(1, 0, 0).cross(N).normalize();
    const B0 = N.clone().cross(T0).normalize();
    const pos = modelMeshRef.current?.geometry?.attributes?.position?.array as Float32Array | undefined;
    if (fg && pos) {
      const v = new THREE.Vector3(); let cxx = 0, cxz = 0, czz = 0, n = 0;
      for (const ti of fg.tris) for (let k = 0; k < 3; k++) {
        const o = ti * 9 + k * 3; v.set(pos[o] - centroid.x, pos[o + 1] - centroid.y, pos[o + 2] - centroid.z);
        const u = v.dot(T0), w = v.dot(B0); cxx += u * u; cxz += u * w; czz += w * w; n++;
      }
      if (n > 0) {
        cxx /= n; cxz /= n; czz /= n;
        const trace = cxx + czz, disc = Math.sqrt(Math.max(0, trace * trace / 4 - (cxx * czz - cxz * cxz))), lambda1 = trace / 2 + disc;
        let ex = Math.abs(cxz) > 1e-10 ? lambda1 - czz : (cxx >= czz ? 1 : 0);
        let ez = Math.abs(cxz) > 1e-10 ? cxz : (cxx >= czz ? 0 : 1);
        const len = Math.sqrt(ex * ex + ez * ez) || 1; ex /= len; ez /= len;
        const T = T0.clone().multiplyScalar(ex).add(B0.clone().multiplyScalar(ez)).normalize();
        return { T, B: N.clone().cross(T).normalize(), N };
      }
    }
    return { T: T0, B: B0, N };
  }

  function projectFace2D(fg: FaceGroup, centroid: THREE.Vector3, T: THREE.Vector3, B: THREE.Vector3): Bounds {
    const pos = modelMeshRef.current?.geometry?.attributes?.position?.array as Float32Array | undefined;
    if (!pos) return { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
    let mnX = Infinity, mxX = -Infinity, mnZ = Infinity, mxZ = -Infinity;
    const v = new THREE.Vector3();
    for (const ti of fg.tris) for (let k = 0; k < 3; k++) {
      const o = ti * 9 + k * 3; v.set(pos[o] - centroid.x, pos[o + 1] - centroid.y, pos[o + 2] - centroid.z);
      const u = v.dot(T), w = v.dot(B);
      if (u < mnX) mnX = u; if (u > mxX) mxX = u; if (w < mnZ) mnZ = w; if (w > mxZ) mxZ = w;
    }
    return { minX: mnX, maxX: mxX, minZ: mnZ, maxZ: mxZ };
  }

  function buildFaceTris2D(fg: FaceGroup, centroid: THREE.Vector3, T: THREE.Vector3, B: THREE.Vector3): number[][] {
    const pos = modelMeshRef.current?.geometry?.attributes?.position?.array as Float32Array | undefined;
    if (!pos) return [];
    const tris2D: number[][] = [], vv = new THREE.Vector3();
    for (const ti of fg.tris) {
      const tri: number[] = [];
      for (let k = 0; k < 3; k++) { const o = ti * 9 + k * 3; vv.set(pos[o] - centroid.x, pos[o + 1] - centroid.y, pos[o + 2] - centroid.z); tri.push(vv.dot(T), vv.dot(B)); }
      tris2D.push(tri);
    }
    return tris2D;
  }

  function clipSegToFaceMulti(s: Seg, tris2D: number[][], samples: number): Seg[] {
    const results: Seg[] = [];
    let inStart = -1;
    function refineEntry(lo: number, hi: number) { for (let i = 0; i < 10; i++) { const mid = (lo + hi) / 2; if (pointInFace2D(s.x1 + (s.x2 - s.x1) * mid, s.z1 + (s.z2 - s.z1) * mid, tris2D)) hi = mid; else lo = mid; } return hi; }
    function refineExit(lo: number, hi: number) { for (let i = 0; i < 10; i++) { const mid = (lo + hi) / 2; if (pointInFace2D(s.x1 + (s.x2 - s.x1) * mid, s.z1 + (s.z2 - s.z1) * mid, tris2D)) lo = mid; else hi = mid; } return lo; }
    for (let i = 0; i <= samples; i++) {
      const t = i / samples, inside = pointInFace2D(s.x1 + (s.x2 - s.x1) * t, s.z1 + (s.z2 - s.z1) * t, tris2D);
      if (inside && inStart < 0) inStart = i > 0 ? refineEntry(Math.max(0, (i - 1) / samples), t) : t;
      if (!inside && inStart >= 0) { const tEnd = refineExit((i - 1) / samples, t), dx = s.x2 - s.x1, dz = s.z2 - s.z1; results.push({ x1: s.x1 + dx * inStart, z1: s.z1 + dz * inStart, x2: s.x1 + dx * tEnd, z2: s.z1 + dz * tEnd }); inStart = -1; }
    }
    if (inStart >= 0) { const dx = s.x2 - s.x1, dz = s.z2 - s.z1; results.push({ x1: s.x1 + dx * inStart, z1: s.z1 + dz * inStart, x2: s.x2, z2: s.z2 }); }
    return results;
  }

  function groupFacesByNormal(faceIds: number[], threshold: number): number[][] {
    const S = stRef.current, groups: number[][] = [], assigned = new Set<number>();
    for (const fid of faceIds) {
      if (assigned.has(fid)) continue;
      const fg = S.faceGroups[fid], group = [fid]; assigned.add(fid);
      for (const otherId of faceIds) { if (assigned.has(otherId)) continue; if (fg.normal.dot(S.faceGroups[otherId].normal) > threshold) { group.push(otherId); assigned.add(otherId); } }
      groups.push(group);
    }
    return groups;
  }

  function buildMergedFaceGroup(faceIds: number[]): FaceGroup {
    const S = stRef.current;
    const merged: FaceGroup = { id: -1, tris: [], normal: new THREE.Vector3(), centroid: new THREE.Vector3(), area: 0 };
    for (const fid of faceIds) {
      const fg = S.faceGroups[fid];
      merged.tris.push(...fg.tris);
      merged.normal.add(fg.normal.clone().multiplyScalar(fg.area));
      merged.centroid.add(fg.centroid.clone().multiplyScalar(fg.area));
      merged.area += fg.area;
    }
    if (merged.area > 0) { merged.normal.divideScalar(merged.area).normalize(); merged.centroid.divideScalar(merged.area); }
    return merged;
  }

  function clearSelHighlights() {
    const scene = sceneRef.current; if (!scene) return;
    for (const m of selHighlightsRef.current) { scene.remove(m); m.geometry.dispose(); }
    selHighlightsRef.current = [];
  }

  function showHighlight(gid: number) {
    const scene = sceneRef.current, S = stRef.current; if (!scene) return;
    if (highlightMeshRef.current) { scene.remove(highlightMeshRef.current); highlightMeshRef.current.geometry.dispose(); highlightMeshRef.current = null; }
    if (gid < 0 || !S.faceGeos[gid]) return;
    const m = new THREE.Mesh(S.faceGeos[gid], highlightMat.current);
    highlightMeshRef.current = m; scene.add(m);
  }

  const doRegenerate = useCallback(() => {
    const S = stRef.current, scene = sceneRef.current; if (!scene) return;
    if (gridGroupRef.current) {
      scene.remove(gridGroupRef.current);
      gridGroupRef.current.traverse(ch => { if ((ch as THREE.Mesh).geometry) (ch as THREE.Mesh).geometry.dispose(); const m = (ch as THREE.Mesh).material; if (m) { if (Array.isArray(m)) m.forEach(x => x.dispose()); else (m as THREE.Material).dispose(); } });
      gridGroupRef.current = null;
    }
    const { cs, rw, rd, st, shape, rot, dm, ns, nd } = S;
    const _nodeHole = (S as any).nodeHole ?? false;
    const _nodeHoleDia = (S as any).nodeHoleDia ?? 3;
    const _wallEnabled = (S as any).wallEnabled ?? true;
    if (rw >= cs / 2) { setRibError(true); notify("Rib width exceeds cell size", "warn"); return; }
    setRibError(false);
    const selectedIds = Array.from(S.selectedFaceIds), isDemo = !S.modelLoaded || selectedIds.length === 0;
    const gridGroup = new THREE.Group();
    let allSegs: Seg[] = [], combinedBounds: Bounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
    const addGrid = (segs: Seg[], rh: number, isDemo: boolean, subGroup?: THREE.Group, tris2D?: number[][]) => {
      // Find intersection nodes from actual rib segments
      let nodeList: Pt2D[] = [];
      if (ns !== "none") {
        nodeList = findSegIntersections(segs, combinedBounds);
        if (tris2D && tris2D.length > 0) nodeList = nodeList.filter(n => pointInFace2D(n.x, n.z, tris2D));
        if (nodeList.length > 5000) nodeList = nodeList.slice(0, 5000);
      }
      // Trim ribs at node positions when holes are enabled for clean holes
      let finalSegs = segs;
      if (_nodeHole && ns !== "none" && nodeList.length > 0) {
        finalSegs = trimSegsAtNodes(segs, nodeList, _nodeHoleDia / 2);
      }
      const ribGeo = makeRibGeo(finalSegs, rw, rh);
      const nodeGeo = makeNodeGeo(nodeList, ns, nd, rh, _nodeHole, _nodeHoleDia, _nodeHole ? st : 0);
      // Merge rib + node geometry into a single mesh
      const allGeos: THREE.BufferGeometry[] = [];
      if (ribGeo) allGeos.push(ribGeo);
      if (nodeGeo) allGeos.push(nodeGeo);
      // Bounding wall only in demo mode (flat plate) — doesn't make sense on irregular model faces
      if (_wallEnabled && isDemo) {
        const wallGeo = makeBoundingWall(combinedBounds, rw, rh);
        if (wallGeo) allGeos.push(wallGeo);
      }
      if (allGeos.length > 0) {
        const g = subGroup || gridGroup;
        let merged: THREE.BufferGeometry;
        try { merged = allGeos.length > 1 ? mergeGeometries(allGeos) : allGeos[0]; } catch { merged = allGeos[0]; }
        const rm = new THREE.Mesh(merged, ribMat.current.clone());
        g.add(rm);
      }
    };
    if (isDemo) {
      const bounds: Bounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
      combinedBounds = bounds;
      const padded: Bounds = { minX: bounds.minX - cs, maxX: bounds.maxX + cs, minZ: bounds.minZ - cs, maxZ: bounds.maxZ + cs };
      let segs = genSegs(shape, cs, padded, rot);
      if (segs.length > MAX_SEGS) segs = segs.slice(0, MAX_SEGS);
      // Clip segments to INSET bounds (so rib boxes don't extend past skin plate)
      const inset = rw / 2;
      const clipBounds: Bounds = { minX: bounds.minX + inset, maxX: bounds.maxX - inset, minZ: bounds.minZ + inset, maxZ: bounds.maxZ - inset };
      segs = segs.map(s => clipLine(s.x1, s.z1, s.x2, s.z2, clipBounds)).filter((s): s is Seg => s !== null);
      allSegs = segs;
      const rh = rd;
      const skinG = new THREE.BoxGeometry(100, st, 100);
      const skinM = new THREE.Mesh(skinG, skinMat.current.clone());
      skinM.position.y = -st / 2;
      gridGroup.add(skinM);
      addGrid(segs, rh, true);
      // BOUNDING WALL — built directly here to guarantee it renders
      if (_wallEnabled) {
        const wallGeo = makeBoundingWall(bounds, rw, rh);
        if (wallGeo) {
          const wallMesh = new THREE.Mesh(wallGeo, ribMat.current.clone());
          gridGroup.add(wallMesh);
        }
      }
    } else {
      const groups = groupFacesByNormal(selectedIds, 0.985);
      for (const group of groups) {
        const merged = buildMergedFaceGroup(group), centroid = merged.centroid.clone();
        const frame = buildFrame(merged.normal, merged, centroid), { T, B, N } = frame;
        const bounds = projectFace2D(merged, centroid, T, B);
        const padded: Bounds = { minX: bounds.minX - cs, maxX: bounds.maxX + cs, minZ: bounds.minZ - cs, maxZ: bounds.maxZ + cs };
        let segs = genSegs(shape, cs, padded, rot);
        if (segs.length > MAX_SEGS) segs = segs.slice(0, MAX_SEGS);
        const tris2D = buildFaceTris2D(merged, centroid, T, B);
        if (tris2D.length > 0) {
          // Extend first, THEN clip to face — so ribs merge at intersections but don't escape
          segs = segs.map(s => extendSeg(s, Math.max(rw * 1.5, 3)));
          const clipped: Seg[] = []; for (const s of segs) clipped.push(...clipSegToFaceMulti(s, tris2D, 24)); segs = clipped;
        }
        allSegs.push(...segs);
        const rh = rd, subGroup = new THREE.Group();
        subGroup.matrixAutoUpdate = false;
        subGroup.matrix.set(T.x, N.x, B.x, centroid.x, T.y, N.y, B.y, centroid.y, T.z, N.z, B.z, centroid.z, 0, 0, 0, 1);
        addGrid(segs, rh, false, subGroup, tris2D);
        // BOUNDING WALL — traces actual face outline edges, not a rotated bounding box
        if (_wallEnabled && tris2D.length > 0) {
          const wallGeo = makeFaceOutlineWall(tris2D, rw, rh);
          if (wallGeo) {
            const wallMesh = new THREE.Mesh(wallGeo, ribMat.current.clone());
            subGroup.add(wallMesh);
          }
        }
        gridGroup.add(subGroup);
      }
      let totalArea = 0; for (const fid of selectedIds) totalArea += S.faceGroups[fid].area;
      const side = Math.sqrt(totalArea); combinedBounds = { minX: -side / 2, maxX: side / 2, minZ: -side / 2, maxZ: side / 2 };
    }
    stRef.current.lastSegs = allSegs; stRef.current.lastBounds = combinedBounds;
    if (S.wireframe) gridGroup.traverse(ch => { if ((ch as THREE.Mesh).material) ((ch as THREE.Mesh).material as THREE.MeshStandardMaterial).wireframe = true; });
    scene.add(gridGroup); gridGroupRef.current = gridGroup;
    updateMetrics(allSegs, combinedBounds);
    let tv = 0, tt = 0;
    gridGroup.traverse(ch => { if ((ch as THREE.Mesh).isMesh && (ch as THREE.Mesh).geometry) { tv += (ch as THREE.Mesh).geometry.attributes.position.count; tt += (ch as THREE.Mesh).geometry.attributes.position.count / 3; } });
    setVertCount(Math.round(tv)); setTriCount(Math.round(tt)); setRibCount(allSegs.length);
    setStatus("ok", S.fileName ? S.fileName : "Ready");
  }, [notify, setStatus, updateMetrics]);

  const regenerate = useCallback(() => {
    if (regenTimerRef.current) clearTimeout(regenTimerRef.current);
    regenTimerRef.current = setTimeout(doRegenerate, 16);
  }, [doRegenerate]);

  useEffect(() => {
    stRef.current.shape = shape; stRef.current.cs = cs; stRef.current.rw = rw;
    stRef.current.rd = rd; stRef.current.st = st; stRef.current.rot = rot;
    stRef.current.dm = dm; stRef.current.ns = ns; stRef.current.nd = nd; stRef.current.mat = mat;
    (stRef.current as any).nodeHole = nodeHole; (stRef.current as any).nodeHoleDia = nodeHoleDia;
    (stRef.current as any).wallEnabled = wallEnabled;
    regenerate();
  }, [shape, cs, rw, rd, st, rot, dm, ns, nd, mat, nodeHole, nodeHoleDia, wallEnabled, regenerate]);

  const loadModel = useCallback((geometry: THREE.BufferGeometry) => {
    const scene = sceneRef.current, camera = cameraRef.current, controls = controlsRef.current;
    if (!scene || !camera || !controls) return;
    if (modelMeshRef.current) { scene.remove(modelMeshRef.current); modelMeshRef.current.geometry.dispose(); modelMeshRef.current = null; }
    if (gridGroupRef.current) { scene.remove(gridGroupRef.current); gridGroupRef.current = null; }
    clearSelHighlights();
    if (highlightMeshRef.current) { scene.remove(highlightMeshRef.current); highlightMeshRef.current.geometry.dispose(); highlightMeshRef.current = null; }
    stRef.current.selectedFaceIds = new Set(); stRef.current.modelLoaded = true;
    setSelectedFaceIds(new Set()); setModelLoaded(true);
    geometry.computeBoundingBox();
    const center = new THREE.Vector3(); geometry.boundingBox!.getCenter(center);
    geometry.translate(-center.x, -center.y, -center.z); geometry.computeBoundingBox();
    let geo = geometry; if (geo.index) geo = geo.toNonIndexed(); geo.computeVertexNormals();
    const fd = detectFaces(geo);
    const mesh = new THREE.Mesh(fd.geo, new THREE.MeshStandardMaterial({ color: 0x8fa0b0, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide }));
    modelMeshRef.current = mesh; scene.add(mesh);
    const bb = fd.geo.boundingBox || geometry.boundingBox!;
    const sz = new THREE.Vector3(); bb.getSize(sz);
    const maxD = Math.max(sz.x, sz.y, sz.z), dist = maxD / (2 * Math.tan(camera.fov * D2R / 2)) * 1.8;
    const c2 = new THREE.Vector3(); bb.getCenter(c2);
    camera.position.set(c2.x + dist * 0.6, c2.y + dist * 0.5, c2.z + dist * 0.7);
    controls.target.copy(c2); controls.update();
    setShowFaceHint(true); setFaceInfo({ text: "", visible: false });
    if (fd.faceGroups.length > 0) {
      stRef.current.selectedFaceIds.add(0); setSelectedFaceIds(new Set([0]));
      clearSelHighlights();
      if (stRef.current.faceGeos[0]) { const m = new THREE.Mesh(stRef.current.faceGeos[0], selHighlightMat.current); selHighlightsRef.current.push(m); scene.add(m); }
      notify("Model loaded — click a face to apply grid", "ok", 4000);
    }
    regenerate();
  }, [notify, regenerate]);

  const handleFile = useCallback(async (file: File) => {
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    stRef.current.fileName = file.name; setFileName(file.name);
    setIsLoading(true); setLoadingText(`Parsing ${file.name}…`);
    setStatus("warn", `Parsing ${file.name}…`);
    try {
      let geometry: THREE.BufferGeometry | undefined;
      if (ext === "step" || ext === "stp") {
        geometry = await parseStepFile(new Uint8Array(await file.arrayBuffer()));
      } else if (ext === "stl") {
        geometry = new STLLoader().parse(await file.arrayBuffer());
      } else if (ext === "obj") {
        const obj = new OBJLoader().parse(await file.text());
        obj.traverse(ch => { if ((ch as THREE.Mesh).isMesh && (ch as THREE.Mesh).geometry && !geometry) geometry = (ch as THREE.Mesh).geometry; });
        if (!geometry) throw new Error("No mesh in OBJ");
      } else throw new Error("Use STEP, STL or OBJ format");
      if (!geometry) throw new Error("Failed to parse file");
      geometry.computeVertexNormals(); loadModel(geometry);
      setStatus("ok", `${file.name} loaded`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notify(`Parse error: ${msg}`, "err", 5000); setStatus("err", "Parse error");
    } finally { setIsLoading(false); }
  }, [loadModel, notify, setStatus]);

  async function parseStepFile(uint8Data: Uint8Array): Promise<THREE.BufferGeometry> {
    if (!occtRef.current) {
      notify("Loading STEP parser…", "warn", 15000); setLoadingText("Loading OpenCascade WASM…");
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/occt-import-js.js";
        s.onload = async () => { try { occtRef.current = await (window as unknown as Record<string, (opts: unknown) => Promise<unknown>>).occtimportjs({ locateFile: (n: string) => `https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/${n}` }); resolve(); } catch (e) { reject(e); } };
        s.onerror = () => reject(new Error("Failed to load STEP parser")); document.head.appendChild(s);
      });
    }
    setLoadingText("Parsing STEP geometry…");
    const result = (occtRef.current as { ReadStepFile: (d: Uint8Array, opts: null) => { success: boolean; meshes: Array<{ attributes: { position?: { array: number[] }; normal?: { array: number[] } }; index?: { array: number[] } }> } }).ReadStepFile(uint8Data, null);
    if (!result.success) throw new Error("STEP file parse failed");
    if (!result.meshes?.length) throw new Error("No geometry in STEP file");
    const geos: THREE.BufferGeometry[] = [];
    for (const md of result.meshes) {
      const geo = new THREE.BufferGeometry();
      if (md.attributes?.position) geo.setAttribute("position", new THREE.Float32BufferAttribute(md.attributes.position.array, 3));
      if (md.attributes?.normal) geo.setAttribute("normal", new THREE.Float32BufferAttribute(md.attributes.normal.array, 3));
      if (md.index) geo.setIndex(new THREE.BufferAttribute(new Uint32Array(md.index.array), 1));
      if (geo.attributes.position) geos.push(geo);
    }
    if (!geos.length) throw new Error("No valid meshes in STEP file");
    const nonIndexed = geos.map(g => g.index ? g.toNonIndexed() : g);
    if (nonIndexed.length === 1) return nonIndexed[0];
    try { return mergeGeometries(nonIndexed); } catch { return nonIndexed[0]; }
  }

  const raycaster = useRef(new THREE.Raycaster());
  const mouse = useRef(new THREE.Vector2());

  function onMouseMove(e: MouseEvent) {
    const cv = canvasRef.current, S = stRef.current;
    if (!modelMeshRef.current || !S.triToFace || !cv || !cameraRef.current) return;
    const rect = cv.getBoundingClientRect();
    mouse.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.current.setFromCamera(mouse.current, cameraRef.current);
    const hits = raycaster.current.intersectObject(modelMeshRef.current);
    if (hits.length > 0) {
      const gid = S.triToFace[hits[0].faceIndex!];
      if (gid !== hoveredFaceRef.current) { hoveredFaceRef.current = gid; showHighlight(gid); }
      cv.style.cursor = "crosshair";
    } else {
      if (hoveredFaceRef.current >= 0) { hoveredFaceRef.current = -1; showHighlight(-1); }
      cv.style.cursor = "default";
    }
  }

  const mouseDownPos = useRef<{ x: number; y: number } | null>(null);

  function onMouseDown(e: MouseEvent) {
    mouseDownPos.current = { x: e.clientX, y: e.clientY };
  }

  function onMouseClick(e: MouseEvent) {
    // Ignore if this was a drag (orbit rotation)
    if (mouseDownPos.current) {
      const dx = e.clientX - mouseDownPos.current.x;
      const dy = e.clientY - mouseDownPos.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > 5) return; // moved more than 5px = drag
    }
    const S = stRef.current;
    if (!modelMeshRef.current || !S.triToFace || !cameraRef.current) return;
    const cv = canvasRef.current!, rect = cv.getBoundingClientRect();
    mouse.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.current.setFromCamera(mouse.current, cameraRef.current);
    const hits = raycaster.current.intersectObject(modelMeshRef.current);
    if (hits.length > 0) {
      const gid = S.triToFace[hits[0].faceIndex!];
      if (e.ctrlKey || e.metaKey) toggleFace(gid); else selectFace(gid);
    }
  }

  function selectFace(gid: number) {
    const S = stRef.current;
    if (gid < 0 || gid >= S.faceGroups.length) return;
    S.selectedFaceIds = new Set([gid]); setSelectedFaceIds(new Set([gid]));
    updateFaceSelectionUI(new Set([gid]));
    notify(`Face #${gid} selected`, "ok", 2000);
  }

  function toggleFace(gid: number) {
    const S = stRef.current;
    if (gid < 0 || gid >= S.faceGroups.length) return;
    const ns = new Set(S.selectedFaceIds);
    if (ns.has(gid)) ns.delete(gid); else ns.add(gid);
    S.selectedFaceIds = ns; setSelectedFaceIds(new Set(ns));
    updateFaceSelectionUI(ns);
    notify(`${ns.size} face${ns.size !== 1 ? "s" : ""} selected`, "ok", 1500);
  }

  function updateFaceSelectionUI(ids: Set<number>) {
    const S = stRef.current, scene = sceneRef.current; if (!scene) return;
    clearSelHighlights();
    for (const fid of ids) if (S.faceGeos[fid]) { const m = new THREE.Mesh(S.faceGeos[fid], selHighlightMat.current); selHighlightsRef.current.push(m); scene.add(m); }
    const idArr = Array.from(ids);
    if (idArr.length === 0) { setShowFaceHint(true); setFaceInfo({ text: "", visible: false }); }
    else {
      setShowFaceHint(false);
      if (idArr.length === 1) { const fg = S.faceGroups[idArr[0]]; setFaceInfo({ visible: true, text: `Face #${idArr[0]}  ·  ${fg.area.toFixed(0)} mm²  ·  n(${fg.normal.x.toFixed(2)}, ${fg.normal.y.toFixed(2)}, ${fg.normal.z.toFixed(2)})` }); }
      else { let a = 0; for (const fid of idArr) a += S.faceGroups[fid].area; setFaceInfo({ visible: true, text: `${idArr.length} faces  ·  ${a.toFixed(0)} mm² total` }); }
    }
    regenerate();
  }

  function loadDemo() {
    // Demo: pocketed panel with pocket floor isolated as a separate face
    // The pocket floor is a thin standalone plane with small gaps from walls
    // so BFS face detection correctly identifies it as a distinct face.
    const baseW = 120, baseH = 10, baseD = 80;
    const pW = 80, pD = 50;
    const pH = 6; // pocket depth (base thickness)
    const wH = baseH - pH; // wall height above pocket floor
    const gap = 0.15; // gap between floor and walls for face separation

    const geos: THREE.BufferGeometry[] = [];

    // Bottom plate (full base, only below the pocket floor)
    const bottomT = 1;
    const bottom = new THREE.BoxGeometry(baseW, bottomT, baseD);
    bottom.translate(0, bottomT / 2, 0);
    geos.push(bottom);

    // Pocket floor — standalone thin plane, separated by gaps
    const floorT = 0.5;
    const floorY = bottomT + gap;
    const pocketFloor = new THREE.BoxGeometry(pW - gap * 2, floorT, pD - gap * 2);
    pocketFloor.translate(0, floorY + floorT / 2, 0);
    geos.push(pocketFloor);

    // Raised border / walls around pocket (sit on the bottom plate)
    const wallBase = bottomT + gap + floorT + gap;
    const wallH = baseH - wallBase;

    // Front wall
    const fw = new THREE.BoxGeometry(baseW, wallH + wallBase - bottomT - gap, (baseD - pD) / 2);
    fw.translate(0, bottomT + gap + (wallH + wallBase - bottomT - gap) / 2, -(pD / 2 + (baseD - pD) / 4));
    geos.push(fw);

    // Back wall
    const bw = new THREE.BoxGeometry(baseW, wallH + wallBase - bottomT - gap, (baseD - pD) / 2);
    bw.translate(0, bottomT + gap + (wallH + wallBase - bottomT - gap) / 2, (pD / 2 + (baseD - pD) / 4));
    geos.push(bw);

    // Left wall
    const lw = new THREE.BoxGeometry((baseW - pW) / 2, wallH + wallBase - bottomT - gap, pD);
    lw.translate(-(pW / 2 + (baseW - pW) / 4), bottomT + gap + (wallH + wallBase - bottomT - gap) / 2, 0);
    geos.push(lw);

    // Right wall
    const rw2 = new THREE.BoxGeometry((baseW - pW) / 2, wallH + wallBase - bottomT - gap, pD);
    rw2.translate((pW / 2 + (baseW - pW) / 4), bottomT + gap + (wallH + wallBase - bottomT - gap) / 2, 0);
    geos.push(rw2);

    let merged: THREE.BufferGeometry;
    try { merged = mergeGeometries(geos); } catch { merged = geos[0]; }
    loadModel(merged);

    // Auto-select the pocket floor face after loading
    // The pocket floor should be an upward-facing face with area close to pW*pD
    setTimeout(() => {
      const S = stRef.current;
      const targetArea = (pW - gap * 2) * (pD - gap * 2);
      let bestFace = 0, bestDiff = Infinity;
      for (const fg of S.faceGroups) {
        if (fg.normal.y > 0.9) { // upward-facing
          const diff = Math.abs(fg.area - targetArea);
          if (diff < bestDiff) { bestDiff = diff; bestFace = fg.id; }
        }
      }
      if (bestDiff < targetArea * 0.5) {
        selectFace(bestFace);
      }
    }, 100);
  }

  // Three.js init
  useEffect(() => {
    const cv = canvasRef.current, gc = gizmoCanvasRef.current;
    if (!cv || !gc) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, failIfMajorPerformanceCaveat: false }); }
    catch { console.warn("WebGL unavailable"); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x111009);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    rendererRef.current = renderer;
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xfff5e0, 1.0));
    const bl = new THREE.DirectionalLight(0xfff5e0, 0.6); bl.position.set(0,-100,0); scene.add(bl);
    const d1 = new THREE.DirectionalLight(0xfff5e0, 0.95); d1.position.set(80, 120, 60); scene.add(d1);
    const d2 = new THREE.DirectionalLight(0xffe0a0, 0.35); d2.position.set(-60, 80, -40); scene.add(d2);
    scene.add(new THREE.HemisphereLight(0xa08060, 0x706860, 0.55));
    const camLight = new THREE.PointLight(0xffe0a0, 0.2, 0); scene.add(camLight); camLightRef.current = camLight;
    const floor = new THREE.GridHelper(400, 80, 0x8a877a, 0x5d5a51);
    (floor.material as THREE.LineBasicMaterial).transparent = true;
    (floor.material as THREE.LineBasicMaterial).opacity = 0.35;
    scene.add(floor); floorGridRef.current = floor; sceneRef.current = scene;
    const vp = cv.parentElement!;
    const camera = new THREE.PerspectiveCamera(45, vp.clientWidth / vp.clientHeight || 1, 0.1, 5000);
    camera.position.set(100, 80, 100); cameraRef.current = camera;
    const controls = new OrbitControls(camera, cv);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controlsRef.current = controls;
    let gizmoR: THREE.WebGLRenderer;
    try { gizmoR = new THREE.WebGLRenderer({ canvas: gc, alpha: true, antialias: true }); }
    catch { renderer.dispose(); return; }
    gizmoR.setPixelRatio(Math.min(devicePixelRatio, 2)); gizmoR.setClearColor(0, 0); gizmoR.setSize(60, 60);
    const gizmoS = new THREE.Scene(), gizmoC = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    gizmoC.position.set(0, 0, 3);
    gizmoS.add(new THREE.AxesHelper(1));
    [0xe05050, 0x50b050, 0x4478cc].forEach((c, i) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshBasicMaterial({ color: c })); m.position.setComponent(i, 1.1); gizmoS.add(m); });
    gizmoRRef.current = gizmoR; gizmoSRef.current = gizmoS; gizmoCRef.current = gizmoC;
    const handleResize = () => { const w = vp.clientWidth, h = vp.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    handleResize(); window.addEventListener("resize", handleResize);
    cv.addEventListener("mousemove", onMouseMove); cv.addEventListener("mousedown", onMouseDown); cv.addEventListener("click", onMouseClick);
    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      controls.update();
      if (camLightRef.current) camLightRef.current.position.copy(camera.position);
      renderer.render(scene, camera);
      gizmoC.position.copy(camera.position).normalize().multiplyScalar(3);
      gizmoC.lookAt(0, 0, 0); gizmoC.up.copy(camera.up);
      gizmoR.render(gizmoS, gizmoC);
    };
    animate(); loadDemo();
    return () => {
      cancelAnimationFrame(animFrameRef.current); window.removeEventListener("resize", handleResize);
      cv.removeEventListener("mousemove", onMouseMove); cv.removeEventListener("mousedown", onMouseDown); cv.removeEventListener("click", onMouseClick);
      renderer.dispose(); gizmoR.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Export
  function mergeGridGeos(): THREE.BufferGeometry | null {
    const gg = gridGroupRef.current; if (!gg) return null;
    const geos: THREE.BufferGeometry[] = [];
    gg.updateMatrixWorld(true);
    gg.traverse(ch => { if ((ch as THREE.Mesh).isMesh && (ch as THREE.Mesh).geometry) { const g = (ch as THREE.Mesh).geometry.clone(); (ch as THREE.Mesh).updateWorldMatrix(true, false); g.applyMatrix4((ch as THREE.Mesh).matrixWorld); geos.push(g); } });
    if (!geos.length) return null;
    const stripped = geos.map(g => { const ng = g.index ? g.toNonIndexed() : g; const sg = new THREE.BufferGeometry(); sg.setAttribute("position", ng.attributes.position.clone()); return sg; });
    try { return mergeGeometries(stripped); } catch { return stripped[0]; }
  }

  function dlBlob(data: ArrayBuffer | string, fn: string, mime: string) {
    const blob = new Blob([data], { type: mime }), url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = fn; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  function exportSTEP() {
    const merged = mergeModelAndGrid();
    if (!merged) { notify("Nothing to export", "err"); return; }
    let geo = merged; if (geo.index) geo = geo.toNonIndexed();
    const pos = geo.attributes.position.array as Float32Array, numTri = pos.length / 9;
    notify(`Generating STEP (${numTri} faces)...`, "warn", 10000);
    setTimeout(() => {
      try {
        const step = generateSTEPData(pos, numTri);
        dlBlob(step, "isogrid_export.step", "application/step");
        notify(`STEP exported - ${numTri.toLocaleString()} faces`, "ok");
      } catch (e: any) { notify(`STEP export failed: ${e.message}`, "err"); }
    }, 50);
  }

  function mergeModelAndGrid(): THREE.BufferGeometry | null {
    const geos: THREE.BufferGeometry[] = [];
    if (modelMeshRef.current && modelMeshRef.current.geometry) {
      const g = modelMeshRef.current.geometry.clone();
      modelMeshRef.current.updateWorldMatrix(true, false);
      g.applyMatrix4(modelMeshRef.current.matrixWorld);
      geos.push(g);
    }
    if (gridGroupRef.current) {
      gridGroupRef.current.updateMatrixWorld(true);
      gridGroupRef.current.traverse(ch => { if ((ch as THREE.Mesh).isMesh && (ch as THREE.Mesh).geometry) { const g = (ch as THREE.Mesh).geometry.clone(); (ch as THREE.Mesh).updateWorldMatrix(true, false); g.applyMatrix4((ch as THREE.Mesh).matrixWorld); geos.push(g); } });
    }
    if (!geos.length) return null;
    const stripped = geos.map(g => { const ng = g.index ? g.toNonIndexed() : g; const sg = new THREE.BufferGeometry(); sg.setAttribute("position", ng.attributes.position.clone()); return sg; });
    try { return mergeGeometries(stripped); } catch { return stripped[0]; }
  }

  function generateSTEPData(pos: Float32Array, numTri: number) {
    let eid = 0; const ni = () => ++eid;
    const E: string[] = [];
    const f = (v: number) => { const s = v.toFixed(6); return s.indexOf('.') < 0 ? s + '.' : s; };
    const appCtx = ni(); E.push(`#${appCtx}=APPLICATION_CONTEXT('core data for automotive mechanical design process');`);
    const appProto = ni(); E.push(`#${appProto}=APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${appCtx});`);
    const prodCtx = ni(); E.push(`#${prodCtx}=PRODUCT_CONTEXT('',#${appCtx},'mechanical');`);
    const prod = ni(); E.push(`#${prod}=PRODUCT('isogrid','ISOGRID STUDIO Export','',(#${prodCtx}));`);
    const prodDefForm = ni(); E.push(`#${prodDefForm}=PRODUCT_DEFINITION_FORMATION('','',#${prod});`);
    const prodDefCtx = ni(); E.push(`#${prodDefCtx}=PRODUCT_DEFINITION_CONTEXT('design',#${appCtx},'');`);
    const prodDef = ni(); E.push(`#${prodDef}=PRODUCT_DEFINITION('','',#${prodDefForm},#${prodDefCtx});`);
    const prodDefShape = ni(); E.push(`#${prodDefShape}=PRODUCT_DEFINITION_SHAPE('','',#${prodDef});`);
    const origin = ni(); E.push(`#${origin}=CARTESIAN_POINT('',(0.,0.,0.));`);
    const dirZ = ni(); E.push(`#${dirZ}=DIRECTION('',(0.,0.,1.));`);
    const dirX = ni(); E.push(`#${dirX}=DIRECTION('',(1.,0.,0.));`);
    const axis = ni(); E.push(`#${axis}=AXIS2_PLACEMENT_3D('',#${origin},#${dirZ},#${dirX});`);
    const lenU = ni(); E.push(`#${lenU}=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));`);
    const angU = ni(); E.push(`#${angU}=(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.));`);
    const saU = ni(); E.push(`#${saU}=(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT());`);
    const uncVal = ni(); E.push(`#${uncVal}=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#${lenU},'distance_accuracy_value','confusion accuracy');`);
    const repCtx = ni(); E.push(`#${repCtx}=(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${uncVal}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lenU},#${angU},#${saU}))REPRESENTATION_CONTEXT('Context3D',''));`);
    const vtxMap = new Map();
    function getVtx(x: number, y: number, z: number) {
      const k = f(x) + ',' + f(y) + ',' + f(z);
      if (vtxMap.has(k)) return vtxMap.get(k);
      const cp = ni(); E.push(`#${cp}=CARTESIAN_POINT('',(${f(x)},${f(y)},${f(z)}));`);
      const vp = ni(); E.push(`#${vp}=VERTEX_POINT('',#${cp});`);
      vtxMap.set(k, vp); return vp;
    }
    const faceIds: number[] = [];
    for (let t = 0; t < numTri; t++) {
      const o = t * 9;
      const ax = pos[o], ay = pos[o + 1], az = pos[o + 2];
      const bx = pos[o + 3], by = pos[o + 4], bz = pos[o + 5];
      const cx = pos[o + 6], cy = pos[o + 7], cz = pos[o + 8];
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az, e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz); if (nl < 1e-10) continue;
      nx /= nl; ny /= nl; nz /= nl;
      const v1 = getVtx(ax, ay, az), v2 = getVtx(bx, by, bz), v3 = getVtx(cx, cy, cz);
      const pp = ni(); E.push(`#${pp}=CARTESIAN_POINT('',(${f(ax)},${f(ay)},${f(az)}));`);
      const pd = ni(); E.push(`#${pd}=DIRECTION('',(${f(nx)},${f(ny)},${f(nz)}));`);
      let rx, ry, rz; if (Math.abs(nx) < 0.9) { rx = 0; ry = -nz; rz = ny; } else { rx = -nz; ry = 0; rz = nx; }
      const rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1; rx /= rl; ry /= rl; rz /= rl;
      const rd2 = ni(); E.push(`#${rd2}=DIRECTION('',(${f(rx)},${f(ry)},${f(rz)}));`);
      const pa = ni(); E.push(`#${pa}=AXIS2_PLACEMENT_3D('',#${pp},#${pd},#${rd2});`);
      const pl = ni(); E.push(`#${pl}=PLANE('',#${pa});`);
      const verts = [[ax, ay, az, bx, by, bz, v1, v2], [bx, by, bz, cx, cy, cz, v2, v3], [cx, cy, cz, ax, ay, az, v3, v1]];
      const oeIds: number[] = [];
      for (const [x1, y1, z1, x2, y2, z2, va, vb] of verts) {
        const dx = (x2 as number) - (x1 as number), dy = (y2 as number) - (y1 as number), dz = (z2 as number) - (z1 as number);
        const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const ep = ni(); E.push(`#${ep}=CARTESIAN_POINT('',(${f(x1 as number)},${f(y1 as number)},${f(z1 as number)}));`);
        const ed = ni(); E.push(`#${ed}=DIRECTION('',(${f(dx / dl)},${f(dy / dl)},${f(dz / dl)}));`);
        const ev = ni(); E.push(`#${ev}=VECTOR('',#${ed},${f(dl)});`);
        const ln = ni(); E.push(`#${ln}=LINE('',#${ep},#${ev});`);
        const ec = ni(); E.push(`#${ec}=EDGE_CURVE('',#${va},#${vb},#${ln},.T.);`);
        const oe = ni(); E.push(`#${oe}=ORIENTED_EDGE('',*,*,#${ec},.T.);`);
        oeIds.push(oe);
      }
      const el = ni(); E.push(`#${el}=EDGE_LOOP('',(#${oeIds.join(',#')}));`);
      const fb = ni(); E.push(`#${fb}=FACE_OUTER_BOUND('',#${el},.T.);`);
      const af = ni(); E.push(`#${af}=ADVANCED_FACE('',(#${fb}),#${pl},.T.);`);
      faceIds.push(af);
    }
    const sh = ni(); E.push(`#${sh}=CLOSED_SHELL('',(#${faceIds.join(',#')}));`);
    const br = ni(); E.push(`#${br}=MANIFOLD_SOLID_BREP('',#${sh});`);
    const sr = ni(); E.push(`#${sr}=ADVANCED_BREP_SHAPE_REPRESENTATION('',(#${axis},#${br}),#${repCtx});`);
    const sdr = ni(); E.push(`#${sdr}=SHAPE_DEFINITION_REPRESENTATION(#${prodDefShape},#${sr});`);
    const ts = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
    return 'ISO-10303-21;\nHEADER;\n' +
      "FILE_DESCRIPTION(('GRIDER BY NITESH HSETIN v2 Export'),'2;1');\n" +
      "FILE_NAME('isogrid_export.step','" + ts + "',('GRIDER'),(''),'',' ','');\n" +
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 }'));\n" +
      'ENDSEC;\nDATA;\n' + E.join('\n') + '\nENDSEC;\nEND-ISO-10303-21;\n';
  }

  function exportSTLBin() {
    const merged = mergeGridGeos(); if (!merged) { notify("Nothing to export", "err"); return; }
    let geo = merged; if (geo.index) geo = geo.toNonIndexed();
    const pos = geo.attributes.position.array as Float32Array, numTri = pos.length / 9;
    const buf = new ArrayBuffer(80 + 4 + 50 * numTri), dv = new DataView(buf);
    const hdr = "GRIDER BY NITESH HSETIN"; for (let i = 0; i < 80; i++) dv.setUint8(i, i < hdr.length ? hdr.charCodeAt(i) : 0);
    dv.setUint32(80, numTri, true); let off = 84;
    for (let i = 0; i < numTri; i++) {
      const o = i * 9, ax = pos[o], ay = pos[o + 1], az = pos[o + 2], bx = pos[o + 3], by = pos[o + 4], bz = pos[o + 5], cx = pos[o + 6], cy = pos[o + 7], cz = pos[o + 8];
      let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay), ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az), nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      dv.setFloat32(off, nx, true); off += 4; dv.setFloat32(off, ny, true); off += 4; dv.setFloat32(off, nz, true); off += 4;
      dv.setFloat32(off, ax, true); off += 4; dv.setFloat32(off, ay, true); off += 4; dv.setFloat32(off, az, true); off += 4;
      dv.setFloat32(off, bx, true); off += 4; dv.setFloat32(off, by, true); off += 4; dv.setFloat32(off, bz, true); off += 4;
      dv.setFloat32(off, cx, true); off += 4; dv.setFloat32(off, cy, true); off += 4; dv.setFloat32(off, cz, true); off += 4;
      dv.setUint16(off, 0, true); off += 2;
    }
    dlBlob(buf, "isogrid_export.stl", "application/octet-stream");
    notify(`STL exported — ${numTri.toLocaleString()} triangles`, "ok");
  }

  function exportOBJ() {
    const merged = mergeGridGeos(); if (!merged) { notify("Nothing to export", "err"); return; }
    let geo = merged; if (geo.index) geo = geo.toNonIndexed();
    const pos = geo.attributes.position.array, nv = pos.length / 3;
    let s = "# Grider by Nitesh Hsetin\n";
    for (let i = 0; i < nv; i++) s += `v ${pos[i * 3]} ${pos[i * 3 + 1]} ${pos[i * 3 + 2]}\n`;
    for (let i = 0; i < nv; i += 3) s += `f ${i + 1} ${i + 2} ${i + 3}\n`;
    dlBlob(s, "isogrid_export.obj", "text/plain");
    notify("OBJ exported", "ok");
  }

  function exportJSON() {
    const S = stRef.current;
    const d = { shape: S.shape, cellSize: S.cs, ribWidth: S.rw, ribDepth: S.rd, skinThick: S.st, rotation: S.rot, depthMode: S.dm, nodeStyle: S.ns, nodeDia: S.nd, material: S.mat };
    navigator.clipboard.writeText(JSON.stringify(d, null, 2)).then(() => notify("Parameters copied to clipboard", "ok")).catch(() => notify("Clipboard access denied", "err"));
  }

  function doExportByFmt(fmt: string) {
    if (fmt === "stl-bin") exportSTLBin();
    else if (fmt === "step") exportSTEP();
    else if (fmt === "obj") exportOBJ();
    else if (fmt === "json") exportJSON();
  }

  function handleExport(fmt: string) {
    setShowExportMenu(false);
    if (fmt === "json") { doExportByFmt(fmt); return; }
    setPendingExportFmt(fmt); setShowDonate(true);
  }

  const [isDragging, setIsDragging] = useState(false);

  function toggleSec(id: string) {
    setCollapsed(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  const matInfo = mat === "custom" ? { name: customMatName, density: customDensity, yield: customYield, E: customE } : MATS[mat];

  // Styles
  const S = {
    header: { background: "var(--surface-2)", borderBottom: "1px solid var(--border-c)" } as React.CSSProperties,
    panel: { background: "var(--surface-2)", borderRight: "1px solid var(--border-c)" } as React.CSSProperties,
    card: { background: "var(--surface-3)" } as React.CSSProperties,
    label: { color: "var(--text-muted)", fontSize: 11 } as React.CSSProperties,
    labelSm: { color: "var(--text-muted)", fontSize: 10 } as React.CSSProperties,
    heading: { color: "var(--text-secondary)", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.04em" } as React.CSSProperties,
    value: { color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: 12 } as React.CSSProperties,
    amber: { color: "var(--amber)" } as React.CSSProperties,
    border: { border: "1px solid var(--border-c)" } as React.CSSProperties,
    borderSoft: { border: "1px solid var(--border-soft)" } as React.CSSProperties,
    divider: { borderBottom: "1px solid var(--border-soft)" } as React.CSSProperties,
    secDiv: { borderBottom: "1px solid var(--border-c)" } as React.CSSProperties,
    muted: { color: "var(--text-muted)" } as React.CSSProperties,
    dim: { color: "var(--text-dim)" } as React.CSSProperties,
    surface1: { background: "var(--surface-1)" } as React.CSSProperties,
    footer: { background: "var(--surface-2)", borderTop: "1px solid var(--border-c)" } as React.CSSProperties,
  };

  return (
    <div className={`flex flex-col h-screen overflow-hidden ${!adDismissed ? 'has-ad-sidebar' : ''}`} style={{ background: "var(--surface-1)", color: "var(--text-primary)" }}>

      {/* HEADER */}
      <header className="flex items-center justify-between px-4 shrink-0" style={{ ...S.header, height: 46 }}>
        <div className="flex items-center gap-3">
          {/* Logo mark */}
          <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
            <polygon points="16,2 28,9 28,23 16,30 4,23 4,9" stroke="var(--amber)" strokeWidth="2" fill="none" />
            <line x1="16" y1="2" x2="16" y2="30" stroke="var(--amber)" strokeWidth="1.2" />
            <line x1="4" y1="9" x2="28" y2="23" stroke="var(--amber)" strokeWidth="1.2" />
            <line x1="28" y1="9" x2="4" y2="23" stroke="var(--amber)" strokeWidth="1.2" />
          </svg>
          <span style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: 14, letterSpacing: ".01em" }}>Grider by Nitesh Hsetin</span>
          <span style={{ ...S.dim, fontSize: 11, marginLeft: 2 }}>·</span>
          <span style={{ ...S.dim, fontSize: 11 }}>Parametric rib-grid design</span>
        </div>
        <div className="flex items-center gap-2">
          <button data-testid="btn-theme" onClick={() => setIsDark(d => !d)} title="Toggle theme"
            className="flex items-center justify-center rounded transition-colors hover:bg-black/10"
            style={{ width: 30, height: 30, ...S.muted }}>
            {isDark ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <a href="https://buymemomo.com/NiteshNeupane" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 h-8 rounded text-sm transition-colors hover:bg-black/10" style={{ ...S.border, ...S.muted, fontWeight: 500, textDecoration: "none", color: "var(--amber)", borderColor: "var(--amber)" }}>☕ Buy Me a Momo</a>
          <button data-testid="btn-load" onClick={() => document.getElementById("file-input")?.click()}
            className="flex items-center gap-1.5 px-3 h-8 rounded text-sm transition-colors hover:bg-black/10"
            style={{ ...S.border, ...S.muted, fontWeight: 500 }}>
            <Upload size={13} /> Load model
          </button>
          <input id="file-input" type="file" accept=".step,.stp,.stl,.obj" hidden onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
          <div className="relative">
            <button data-testid="btn-export" onClick={() => setShowExportMenu(s => !s)}
              className="flex items-center gap-1.5 px-3 h-8 rounded text-sm font-medium transition-all"
              style={{ background: "var(--amber)", color: "var(--surface-1)", border: "none" }}>
              <Download size={13} /> Export <ChevronDown size={11} />
            </button>
            {showExportMenu && (
              <div className="absolute right-0 top-[calc(100%+4px)] rounded shadow-xl z-50 overflow-hidden min-w-[180px]"
                style={{ background: "var(--surface-3)", ...S.border }}>
                <p style={{ ...S.labelSm, padding: "8px 12px 4px", fontWeight: 600 }}>Export format</p>
                {[
                  { fmt: "step", label: "STEP (SolidWorks/CAD)" },
                  { fmt: "stl-bin", label: "Grid STL (binary)" },
                  { fmt: "obj", label: "Wavefront OBJ" },
                  { fmt: "json", label: "Copy parameters (JSON)" },
                ].map(({ fmt, label }) => (
                  <button key={fmt} data-testid={`export-${fmt}`} onClick={() => handleExport(fmt)}
                    className="block w-full text-left px-3 py-2 transition-colors hover:bg-black/10"
                    style={{ ...S.value, fontSize: 12 }}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* MAIN */}
      <div className="flex flex-1 overflow-hidden">

        {/* PANEL */}
        <div className="panel-scroll shrink-0 overflow-y-auto" style={{ width: 276, ...S.panel }}>

          {/* Grid Pattern */}
          <PanelSection id="shape" label="Grid pattern" collapsed={collapsed.has("shape")} onToggle={() => toggleSec("shape")}>
            <div className="grid grid-cols-3 gap-1 mb-1">
              {SHAPES.map(sh => {
                const Icon = sh.icon;
                const active = shape === sh.id;
                return (
                  <button key={sh.id} data-testid={`shape-${sh.id}`} onClick={() => setShape(sh.id)}
                    className="shape-btn flex flex-col items-center gap-1.5 py-2.5 rounded cursor-pointer"
                    style={{
                      background: active ? "var(--amber-dim)" : "var(--surface-1)",
                      border: `1.5px solid ${active ? "var(--amber)" : "var(--border-c)"}`,
                      color: active ? "var(--amber)" : "var(--text-muted)",
                    }}>
                    <Icon size={16} />
                    <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: ".02em" }}>{sh.label}</span>
                  </button>
                );
              })}
            </div>
          </PanelSection>

          {/* Geometry */}
          <PanelSection id="geo" label="Geometry" collapsed={collapsed.has("geo")} onToggle={() => toggleSec("geo")}>
            <SliderRow label="Cell size" unit="mm" value={cs} min={2} max={200} step={0.5} hasError={ribError} onChange={setCs} testId="cs" />
            <SliderRow label="Rib width" unit="mm" value={rw} min={0.5} max={30} step={0.1} hasError={ribError} onChange={setRw} testId="rw" />
            <SliderRow label="Rib depth" unit="mm" value={rd} min={0.5} max={50} step={0.1} onChange={setRd} testId="rd" />
            <SliderRow label="Skin thickness" unit="mm" value={st} min={0.5} max={20} step={0.1} onChange={setSt} testId="st" />
            <div className="mt-3">
              <label className="flex items-center gap-2 cursor-pointer text-xs" style={{ color: wallEnabled ? "var(--amber)" : "var(--text-muted)" }}>
                <input type="checkbox" checked={wallEnabled} onChange={e => setWallEnabled(e.target.checked)} style={{ accentColor: "var(--amber)", width: 12, height: 12 }} />
                Bounding wall
              </label>
            </div>
          </PanelSection>

          {/* Pattern */}
          <PanelSection id="pat" label="Pattern options" collapsed={collapsed.has("pat")} onToggle={() => toggleSec("pat")}>
            <SliderRow label="Rotation" unit="°" value={rot} min={0} max={360} step={1} onChange={setRot} testId="rot" />
            <div className="mt-3">
              <FieldLabel>Node style</FieldLabel>
              <RadioRow name="ns" options={[{ v: "none", l: "None" }, { v: "circle", l: "Circle" }, { v: "hex", l: "Hex" }]} value={ns} onChange={setNs} />
            </div>
            <div style={{ opacity: ns === "none" ? .4 : 1, pointerEvents: ns === "none" ? "none" : "auto", transition: "opacity .15s" }}>
              <SliderRow label="Node diameter" unit="mm" value={nd} min={1} max={30} step={0.5} onChange={setNd} testId="nd" />
              <div className="mt-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs" style={{ color: nodeHole ? "var(--amber)" : "var(--text-muted)" }}>
                  <input type="checkbox" checked={nodeHole} onChange={e => setNodeHole(e.target.checked)} style={{ accentColor: "var(--amber)", width: 12, height: 12 }} />
                  Blind hole
                </label>
              </div>
              {nodeHole && (
                <SliderRow label="Hole diameter" unit="mm" value={nodeHoleDia} min={0.5} max={nd - 0.5} step={0.1} onChange={setNodeHoleDia} testId="nhd" />
              )}
            </div>
          </PanelSection>

          {/* Material */}
          <PanelSection id="mat" label="Material" collapsed={collapsed.has("mat")} onToggle={() => toggleSec("mat")}>
            <select data-testid="mat-sel" value={mat} onChange={e => setMat(e.target.value)}
              className="w-full px-2 py-1.5 rounded mb-2 cursor-pointer focus:outline-none text-sm"
              style={{ background: "var(--surface-1)", border: "1px solid var(--border-c)", color: "var(--text-primary)" }}>
              <optgroup label="Metals">
                <option value="al6061">Aluminum 6061-T6</option>
                <option value="al7075">Aluminum 7075-T6</option>
                <option value="ti6al4v">Titanium Ti-6Al-4V</option>
                <option value="ss316">Stainless Steel 316L</option>
                <option value="inconel">Inconel 718</option>
              </optgroup>
              <optgroup label="Polymers">
                <option value="pla">PLA</option>
                <option value="petg">PETG</option>
                <option value="abs">ABS</option>
                <option value="nylon">Nylon PA12 (SLS)</option>
                <option value="cf_nylon">Carbon fiber nylon</option>
              </optgroup>
              <optgroup label="Custom">
                <option value="custom">Custom…</option>
              </optgroup>
            </select>
            <div className="flex gap-1.5 flex-wrap">
              {[`ρ ${matInfo.density} kg/m³`, `σy ${matInfo.yield} MPa`, `E ${matInfo.E} GPa`].map(t => (
                <span key={t} className="px-2 py-0.5 rounded text-[10px]"
                  style={{ background: "var(--surface-1)", border: "1px solid var(--border-c)", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{t}</span>
              ))}
            </div>
            {mat === "custom" && (
              <div className="mt-2.5">
                <div className="flex flex-col gap-3 mt-4 pt-3 border-t" style={{ borderColor: 'var(--border-c)' }}>
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 11, color: "var(--text-muted)", width: 80 }}>Name</span>
                  <input type="text" value={customMatName} onChange={e=>setCustomMatName(e.target.value)} style={{flex:1, background: 'var(--surface-1)', border: '1px solid var(--border-c)', color: 'var(--text-primary)', padding: '2px 6px', fontSize: 11, borderRadius: 2}} />
                </div>
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 11, color: "var(--text-muted)", width: 80 }}>Yield (MPa)</span>
                  <input type="number" value={customYield} onChange={e=>setCustomYield(Number(e.target.value))} style={{flex:1, background: 'var(--surface-1)', border: '1px solid var(--border-c)', color: 'var(--text-primary)', padding: '2px 6px', fontSize: 11, borderRadius: 2}} />
                </div>
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 11, color: "var(--text-muted)", width: 80 }}>Modulus (GPa)</span>
                  <input type="number" value={customE} onChange={e=>setCustomE(Number(e.target.value))} style={{flex:1, background: 'var(--surface-1)', border: '1px solid var(--border-c)', color: 'var(--text-primary)', padding: '2px 6px', fontSize: 11, borderRadius: 2}} />
                </div>
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 11, color: "var(--text-muted)", width: 80 }}>Density (kg/m³)</span>
                  <input type="number" value={customDensity} onChange={e=>setCustomDensity(Number(e.target.value))} style={{flex:1, background: 'var(--surface-1)', border: '1px solid var(--border-c)', color: 'var(--text-primary)', padding: '2px 6px', fontSize: 11, borderRadius: 2}} />
                </div>
              </div>
              </div>
            )}
          </PanelSection>

          {/* Presets */}
          <PanelSection id="pre" label="Presets" collapsed={collapsed.has("pre")} onToggle={() => toggleSec("pre")}>
            <div className="flex flex-col gap-1.5">
              {[
                { id: "nasa",  title: "NASA standard",  desc: "L 25 · b 2 · h 8 · t 1.5 mm" },
                { id: "light", title: "Lightweight",     desc: "L 40 · b 1.5 · h 6 · t 1 mm" },
                { id: "stiff", title: "Stiff panel",     desc: "L 15 · b 3 · h 10 · t 2.5 mm" },
              ].map(p => (
                <button key={p.id} data-testid={`preset-${p.id}`}
                  onClick={() => { const pr = PRESETS[p.id]; setCs(pr.cs); setRw(pr.rw); setRd(pr.rd); setSt(pr.st); setShape(pr.shape); notify("Preset applied", "ok", 1500); }}
                  className="text-left px-3 py-2 rounded transition-colors hover:border-amber-500"
                  style={{ background: "var(--surface-1)", border: "1px solid var(--border-c)" }}>
                  <div style={{ fontWeight: 500, fontSize: 12.5, color: "var(--text-primary)", marginBottom: 2 }}>{p.title}</div>
                  <div style={{ ...S.dim, fontSize: 10.5, fontFamily: "var(--font-mono)" }}>{p.desc}</div>
                </button>
              ))}
            </div>
          </PanelSection>

        </div>

        {/* VIEWPORT */}
        <div className="relative flex-1 overflow-hidden"
          style={{ background: "var(--vp-bg)" }}
          onDragEnter={e => { e.preventDefault(); setIsDragging(true); }}
          onDragOver={e => e.preventDefault()}
          onDragLeave={() => setIsDragging(false)}
          onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer?.files?.[0]; if (f) handleFile(f); }}>

          <canvas ref={canvasRef} className="vp-canvas" data-testid="main-canvas" />

          {/* Viewport label */}
          <div className="absolute top-3 left-3 pointer-events-none" style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)", letterSpacing: ".05em" }}>
            {fileName ? `${fileName}  ·  ${stRef.current.faceGroups.length} faces` : "Grider by Nitesh Hsetin"}
          </div>

          {/* Toolbar */}
          <div className="absolute top-3 right-3 flex gap-1.5 z-10">
            {selectedFaceIds.size > 0 && (
              <VpBtn testId="btn-clear" title="Clear selection" onClick={() => { stRef.current.selectedFaceIds = new Set(); setSelectedFaceIds(new Set()); updateFaceSelectionUI(new Set()); notify("Selection cleared", "ok", 1500); }}>
                <X size={12} />
              </VpBtn>
            )}
            <VpBtn testId="btn-wireframe" title="Wireframe" active={wireframe} onClick={() => {
              const wf = !wireframe; setWireframe(wf); stRef.current.wireframe = wf;
              if (modelMeshRef.current) (modelMeshRef.current.material as THREE.MeshStandardMaterial).wireframe = wf;
              if (gridGroupRef.current) gridGroupRef.current.traverse(ch => { if ((ch as THREE.Mesh).material) ((ch as THREE.Mesh).material as THREE.MeshStandardMaterial).wireframe = wf; });
            }}>
              <Layers size={12} />
            </VpBtn>
            <VpBtn testId="btn-grid" title="Floor grid" active={gridVisible} onClick={() => {
              const gv = !gridVisible; setGridVisible(gv); stRef.current.gridVisible = gv;
              if (floorGridRef.current) floorGridRef.current.visible = gv;
            }}>
              <Grid3X3 size={12} />
            </VpBtn>
          </div>

          {/* Drop zone */}
          {isDragging && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 pointer-events-none"
              style={{ background: "rgba(204,136,34,.07)", border: "2px dashed var(--amber)" }}>
              <Upload size={28} style={{ color: "var(--amber)", opacity: .7 }} />
              <span style={{ color: "var(--amber)", fontWeight: 500, fontSize: 13 }}>Drop to load model</span>
            </div>
          )}

          {/* Face hint */}
          {showFaceHint && !isLoading && modelLoaded && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none text-center px-4 py-3 rounded"
              style={{ background: "rgba(28,24,16,.88)", border: "1px solid var(--border-c)", backdropFilter: "blur(4px)" }}>
              <p style={{ color: "var(--amber)", fontWeight: 500, fontSize: 13, marginBottom: 4 }}>Click a face to apply the grid</p>
              <p style={{ ...S.muted, fontSize: 11 }}>Ctrl+click to add / remove faces</p>
            </div>
          )}

          {/* Face info */}
          {faceInfo.visible && (
            <div className="absolute top-10 left-3 pointer-events-none" style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>
              {faceInfo.text}
            </div>
          )}

          {/* Loading overlay */}
          {isLoading && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4"
              style={{ background: isDark ? "rgba(17,16,9,.92)" : "rgba(232,226,214,.92)" }}>
              <div className="studio-spinner" />
              <p style={{ ...S.muted, fontSize: 11, fontFamily: "var(--font-mono)" }}>{loadingText}</p>
            </div>
          )}

          {/* Metrics bar */}
          <div className="absolute bottom-0 left-0 right-0 flex z-10" style={S.footer}>
            {[
              { label: "Mass",        value: metrics.mass,  testId: "m-mass",  bar: false },
              { label: "Open area",   value: metrics.open,  testId: "m-open",  bar: false },
              { label: "Rib density", value: metrics.rib,   testId: "m-rib",   bar: false },
              { label: "Stiffness δ", value: metrics.stiff, testId: "m-stiff", bar: true, barPct: metrics.stiffPct },
            ].map(m => (
              <div key={m.label} className="flex-1 px-3 py-2 border-r last:border-r-0" style={{ borderColor: "var(--border-soft)" }} data-testid={m.testId}>
                <div style={{ ...S.labelSm, marginBottom: 2 }}>{m.label}</div>
                <div style={{ ...S.value, fontSize: 13, fontWeight: 500, color: "var(--amber-bright)" }}>{m.value}</div>
                {m.bar && <div className="stiff-bar"><div className="stiff-fill" style={{ width: `${m.barPct}%` }} /></div>}
              </div>
            ))}
          </div>

          {/* Gizmo */}
          <div className="absolute bottom-14 right-2 z-10 pointer-events-none" style={{ width: 60, height: 60, opacity: .6 }}>
            <canvas ref={gizmoCanvasRef} width={120} height={120} style={{ width: "100%", height: "100%" }} />
          </div>
        </div>
      </div>

      {/* STATUS BAR */}
      <footer className="flex items-center justify-between px-3 shrink-0" style={{ ...S.footer, height: 24 }}>
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: statusType === "ok" ? "var(--ok)" : statusType === "warn" ? "var(--warn)" : statusType === "err" ? "var(--err)" : "var(--text-dim)" }} data-testid="status-dot" />
          <span style={{ ...S.dim, fontSize: 10.5, fontFamily: "var(--font-mono)" }} data-testid="status-txt">{statusTxt}</span>
        </div>
        <div className="flex items-center gap-3">
          {[`V:${vertCount.toLocaleString()}`, `T:${triCount.toLocaleString()}`, `R:${ribCount}`].map(s => (
            <span key={s} style={{ ...S.dim, fontSize: 10, fontFamily: "var(--font-mono)" }}>{s}</span>
          ))}
        </div>
      </footer>

      {/* NOTIFICATION */}
      {notification.visible && (
        <div className="notif-enter fixed bottom-8 left-1/2 z-50 pointer-events-none" style={{ transform: "translateX(-50%)" }}>
          <div className="px-4 py-2 rounded text-sm"
            style={{
              background: "var(--surface-3)", borderLeft: `3px solid ${notification.type === "ok" ? "var(--ok)" : notification.type === "err" ? "var(--err)" : "var(--warn)"}`,
              border: "1px solid var(--border-c)", borderLeftWidth: 3, color: "var(--text-primary)", boxShadow: "0 4px 20px rgba(0,0,0,.4)", fontFamily: "var(--font-mono)", fontSize: 12,
            }}>
            {notification.msg}
          </div>
        </div>
      )}

      {/* DONATE MODAL */}
      {showDonate && (
        <div className="donate-backdrop fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,.65)", backdropFilter: "blur(6px)" }}
          onClick={e => { if (e.target === e.currentTarget) { setShowDonate(false); if (pendingExportFmt) { doExportByFmt(pendingExportFmt); setPendingExportFmt(null); } } }}>
          <div className="donate-modal-anim p-8 max-w-sm w-[90%] text-center relative rounded-xl"
            style={{ background: "var(--surface-3)", border: "1px solid var(--border-c)", boxShadow: "0 20px 60px rgba(0,0,0,.6)" }}>
            <span className="absolute top-3 right-4 text-[10px]" style={S.dim}>from Nepal with ♥</span>
            <div className="text-4xl mb-3">🥟</div>
            <h3 className="text-base font-semibold mb-2" style={{ color: "var(--text-primary)" }}>Enjoying Grider by Nitesh Hsetin?</h3>
            <p className="text-sm leading-relaxed mb-5 max-w-xs mx-auto" style={S.muted}>
              This tool is <strong style={S.amber}>100% free</strong>. If it saved you time, consider buying me a <strong style={S.amber}>momo</strong> (Nepali dumpling).
            </p>
            <div className="flex flex-col gap-2">
              <a href="https://buymemomo.com/NiteshNeupane" target="_blank" rel="noopener noreferrer"
                onClick={() => { setShowDonate(false); if (pendingExportFmt) { doExportByFmt(pendingExportFmt); setPendingExportFmt(null); } }}
                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-opacity hover:opacity-90"
                style={{ background: "var(--amber)", color: "var(--surface-1)" }}>
                🥟 Buy me a momo
              </a>
              <button onClick={() => { setShowDonate(false); if (pendingExportFmt) { doExportByFmt(pendingExportFmt); setPendingExportFmt(null); } }}
                className="px-5 py-2.5 rounded-lg text-sm border transition-colors hover:bg-black/5"
                style={{ border: "1px solid var(--border-c)", color: "var(--text-muted)" }}>
                Continue to download
              </button>
            </div>
          </div>
        </div>
      )}

      {showExportMenu && <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />}

      {/* AD SIDEBAR */}
      {!adDismissed && (
        <aside className="ad-sidebar" id="ad-sidebar">
          <span className="ad-label">Sponsored</span>
          <button className="ad-close" onClick={() => setAdDismissed(true)} title="Close ad">&times;</button>
          <div className="ad-slot" id="ad-slot">
            {/* Replace this placeholder with your Google AdSense / ad network code */}
            <div className="ad-slot-placeholder">Ad Space<br />160×600</div>
            {/* Example AdSense code (uncomment and replace with your actual ad unit):
            <ins className="adsbygoogle"
                 style={{ display: 'inline-block', width: 160, height: 600 }}
                 data-ad-client="ca-pub-XXXXXXXXXXXXXXXX"
                 data-ad-slot="XXXXXXXXXX" />
            */}
          </div>
        </aside>
      )}

      {/* ADBLOCKER NOTICE */}
      {adblockNotice && !adblockDismissed && (
        <div className="adblock-notice" id="adblock-notice">
          <button className="abn-close" onClick={() => setAdblockDismissed(true)} title="Dismiss">&times;</button>
          <div className="abn-title"><span>🛡️</span> Ad Blocker Detected</div>
          <p className="abn-msg">Hey! It looks like you're using an ad blocker. This tool is <strong>100% free</strong> and ads help keep it that way. Consider whitelisting this site to support development. 🙏</p>
          <button className="abn-dismiss" onClick={() => setAdblockDismissed(true)}>Got it, thanks!</button>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────

function PanelSection({ id, label, collapsed, onToggle, children }: { id: string; label: string; collapsed: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div style={{ borderBottom: "1px solid var(--border-c)" }}>
      <button data-testid={`section-${id}`} className="flex items-center justify-between w-full px-3.5 py-2.5 transition-colors hover:bg-black/[.03]" onClick={onToggle}>
        <span style={{ color: "var(--text-secondary)", fontSize: 11, fontWeight: 600, letterSpacing: ".03em" }}>{label}</span>
        {collapsed ? <ChevronRight size={12} style={{ color: "var(--text-dim)" }} /> : <ChevronDown size={12} style={{ color: "var(--text-dim)" }} />}
      </button>
      <div className={`sec-body px-3.5 pb-3 pt-0.5 ${collapsed ? "collapsed" : ""}`} style={{ maxHeight: collapsed ? 0 : 800 }}>
        {children}
      </div>
    </div>
  );
}

function SliderRow({ label, unit, value, min, max, step, onChange, hasError = false, testId }: {
  label: string; unit?: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; hasError?: boolean; testId?: string;
}) {
  return (
    <div className="mb-2.5">
      <div className="flex items-center justify-between mb-1">
        <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
          {label}{unit && <span style={{ color: "var(--text-dim)", fontSize: 10, marginLeft: 3 }}>{unit}</span>}
        </span>
        <input type="number" data-testid={`in-${testId}`} value={value} min={min} max={max} step={step}
          onChange={e => onChange(+e.target.value)}
          className="text-right text-xs px-1.5 py-0.5 rounded focus:outline-none transition-colors"
          style={{ width: 52, background: "var(--surface-1)", border: `1px solid ${hasError ? "var(--err)" : "var(--border-c)"}`, color: hasError ? "var(--err)" : "var(--text-primary)", fontFamily: "var(--font-mono)" }} />
      </div>
      <input type="range" className={`studio-slider ${hasError ? "slider-error" : ""}`} data-testid={`sl-${testId}`}
        min={min} max={max} step={step} value={value} onChange={e => onChange(+e.target.value)} />
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <p style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 6 }}>{children}</p>;
}

function RadioRow({ name, options, value, onChange }: { name: string; options: { v: string; l: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-3 mb-0.5">
      {options.map(o => (
        <label key={o.v} className="flex items-center gap-1.5 cursor-pointer text-xs transition-colors"
          style={{ color: value === o.v ? "var(--amber)" : "var(--text-muted)" }}>
          <input type="radio" name={name} value={o.v} checked={value === o.v} onChange={() => onChange(o.v)}
            style={{ accentColor: "var(--amber)", width: 11, height: 11 }} />
          {o.l}
        </label>
      ))}
    </div>
  );
}

function VpBtn({ testId, title, active = false, onClick, children }: { testId: string; title: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button data-testid={testId} title={title} onClick={onClick}
      className="flex items-center justify-center rounded transition-colors hover:bg-black/10"
      style={{ width: 28, height: 28, background: active ? "var(--amber-dim)" : "rgba(28,24,16,.75)", border: `1px solid ${active ? "var(--amber)" : "var(--border-c)"}`, color: active ? "var(--amber)" : "var(--text-muted)", backdropFilter: "blur(4px)" }}>
      {children}
    </button>
  );
}

class StudioErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(err: Error) { return { error: err.message }; }
  componentDidCatch(err: Error, info: ErrorInfo) { console.error(err, info); }
  render() {
    if (this.state.error) return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#151210", color: "#cc8822", fontFamily: "sans-serif", textAlign: "center" }}>
        <div>
          <svg width="32" height="32" viewBox="0 0 20 20" fill="none" style={{ margin: "0 auto 12px" }}>
            <polygon points="10,2 18,7 18,13 10,18 2,13 2,7" stroke="#cc8822" strokeWidth="1.5" fill="none" />
          </svg>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Grider by Nitesh Hsetin</div>
          <div style={{ fontSize: 12, opacity: .6, maxWidth: 300 }}>{this.state.error}</div>
          <button onClick={() => window.location.reload()} style={{ marginTop: 16, padding: "8px 20px", background: "#cc8822", color: "#151210", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}>Reload</button>
        </div>
      </div>
    );
    return this.props.children;
  }
}

export { StudioErrorBoundary };
