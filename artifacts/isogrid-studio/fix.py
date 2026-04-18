import sys

def fix_file():
    with open(r'd:\Projecto_mastro\Grid-Designer-Pro\artifacts\isogrid-studio\src\pages\Studio.tsx', 'r', encoding='utf-8') as f:
        c = f.read()

    # 1. Custom Icon
    c = c.replace('} from "lucide-react";\n\n// ── Types', '} from "lucide-react";\n\nconst OrthogridIcon = (props: any) => (<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><rect x="2" y="2" width="13" height="13"/><line x1="2" y1="2" x2="15" y2="15"/><line x1="15" y1="2" x2="2" y2="15"/><rect x="17" y="17" width="13" height="13"/><line x1="17" y1="17" x2="30" y2="30"/><line x1="30" y1="17" x2="17" y2="30"/></svg>);\n\n// ── Types')
    c = c.replace('label: "Orthogrid", icon: CheckSquare', 'label: "Orthogrid", icon: OrthogridIcon')
    
    # 2. Rename
    c = c.replace('Isogrid Studio', 'Grider by Nitesh Hsetin')
    c = c.replace('ISOGRID STUDIO', 'GRIDER BY NITESH HSETIN')
    
    # 3. Floor grid in dark mode
    c = c.replace('const floor = new THREE.GridHelper(400, 80, 0x252018, 0x1c1810);', 'const floor = new THREE.GridHelper(400, 80, 0x8a877a, 0x5d5a51);')
    c = c.replace('scene.add(new THREE.AmbientLight(0xfff5e0, 0.45));', 'scene.add(new THREE.AmbientLight(0xfff5e0, 1.0));\n    const bl = new THREE.DirectionalLight(0xfff5e0, 0.6); bl.position.set(0,-100,0); scene.add(bl);')
    c = c.replace('scene.add(new THREE.HemisphereLight(0xa08060, 0x302820, 0.35));', 'scene.add(new THREE.HemisphereLight(0xa08060, 0x706860, 0.55));')
    
    # 4. Buy me a Momo link
    # Header link
    c = c.replace('<button data-testid="btn-load"', '<a href="https://buymemomo.com/NiteshNeupane" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 h-8 rounded text-sm transition-colors hover:bg-black/10" style={{ ...S.border, ...S.muted, fontWeight: 500, textDecoration: "none", color: "var(--amber)", borderColor: "var(--amber)" }}>☕ Buy Me a Momo</a>\n          <button data-testid="btn-load"')
    
    # 5. Fix node genNodes logic 
    # Let's replace the whole genNodes function cleanly using a regex or hardcoded string slice.
    node_str_old = """function genNodes(shape: string, L: number, bounds: Bounds, rotDeg: number): Pt2D[] {
  const r = rotDeg * D2R, cr = Math.cos(r), sr = Math.sin(r);
  const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
  const diag = Math.sqrt(Math.pow(bounds.maxX - bounds.minX, 2) + Math.pow(bounds.maxZ - bounds.minZ, 2)) / 2 + L;
  const h = L * Math.sqrt(3) / 2, nR = Math.ceil(diag / h), nC = Math.ceil(diag / L);
  const nodes: Pt2D[] = [];
  for (let row = -nR; row <= nR; row++) for (let col = -nC; col <= nC; col++) {
    const x = col * L + (Math.abs(row) % 2 ? L / 2 : 0), z = row * h;
    const rx = x * cr - z * sr + cx, rz = x * sr + z * cr + cz;
    if (rx >= bounds.minX && rx <= bounds.maxX && rz >= bounds.minZ && rz <= bounds.maxZ) nodes.push({ x: rx, z: rz });
  }
  return nodes;
}"""

    node_str_new = """function genNodes(shape: string, L: number, bounds: Bounds, rotDeg: number): Pt2D[] {
  const r = rotDeg * D2R, cr = Math.cos(r), sr = Math.sin(r);
  const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
  const diag = Math.sqrt(Math.pow(bounds.maxX - bounds.minX, 2) + Math.pow(bounds.maxZ - bounds.minZ, 2)) / 2 + L;
  const nodes: Pt2D[] = [];
  if (shape === "isogrid" || shape === "hex") {
    const h = L * Math.sqrt(3) / 2, nR = Math.ceil(diag / h), nC = Math.ceil(diag / L);
    for (let row = -nR; row <= nR; row++) for (let col = -nC; col <= nC; col++) {
      const x = col * L + (Math.abs(row) % 2 ? L / 2 : 0), z = row * h;
      const rx = x * cr - z * sr + cx, rz = x * sr + z * cr + cz;
      if (rx >= bounds.minX && rx <= bounds.maxX && rz >= bounds.minZ && rz <= bounds.maxZ) nodes.push({ x: rx, z: rz });
    }
  } else if (shape === "square" || shape === "rectangular") {
    const rowSp = shape === "rectangular" ? L * 0.6 : L;
    const nR = Math.ceil(diag / rowSp), nC = Math.ceil(diag / L);
    for (let row = -nR; row <= nR; row++) for (let col = -nC; col <= nC; col++) {
      const x = col * L, z = row * rowSp;
      const rx = x * cr - z * sr + cx, rz = x * sr + z * cr + cz;
      if (rx >= bounds.minX && rx <= bounds.maxX && rz >= bounds.minZ && rz <= bounds.maxZ) nodes.push({ x: rx, z: rz });
    }
  } else if (shape === "orthogrid") {
    const n = Math.ceil(diag / (L / 2));
    for (let row = -n; row <= n; row++) for (let col = -n; col <= n; col++) {
      const x = col * (L / 2), z = row * (L / 2);
      const rx = x * cr - z * sr + cx, rz = x * sr + z * cr + cz;
      if (rx >= bounds.minX && rx <= bounds.maxX && rz >= bounds.minZ && rz <= bounds.maxZ) nodes.push({ x: rx, z: rz });
    }
  } else {
    const s32 = Math.sqrt(3) / 2, n = Math.ceil(diag / (L * s32));
    for (let row = -n; row <= n; row++) for (let col = -n; col <= n; col++) {
      const x = col * L * s32, z = row * L * s32;
      const rx = x * cr - z * sr + cx, rz = x * sr + z * cr + cz;
      if (rx >= bounds.minX && rx <= bounds.maxX && rz >= bounds.minZ && rz <= bounds.maxZ) nodes.push({ x: rx, z: rz });
    }
  }
  return nodes;
}"""
    c = c.replace(node_str_old, node_str_new)

    with open(r'd:\Projecto_mastro\Grid-Designer-Pro\artifacts\isogrid-studio\src\pages\Studio.tsx', 'w', encoding='utf-8') as f:
        f.write(c)

fix_file()
