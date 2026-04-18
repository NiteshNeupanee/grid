import sys

def fix_file():
    with open(r'd:\Projecto_mastro\Grid-Designer-Pro\artifacts\isogrid-studio\src\pages\Studio.tsx', 'r', encoding='utf-8') as f:
        c = f.read()

    # Add custom material state vars
    c = c.replace('const [customDensity, setCustomDensity] = useState(2700);', 
                  'const [customMatName, setCustomMatName] = useState("Custom");\n  const [customDensity, setCustomDensity] = useState(2700);\n  const [customYield, setCustomYield] = useState(276);\n  const [customE, setCustomE] = useState(70);')

    # Update dependencies for metrics updates
    c = c.replace('}, [customDensity]);', '}, [customDensity, customYield, customE]);')

    # Replace matInfo definition
    c = c.replace('const matInfo = MATS[mat];', 
                  'const matInfo = mat === "custom" ? { name: customMatName, density: customDensity, yield: customYield, E: customE } : MATS[mat];')

    # Replace custom material UI slider
    slider_str = '<SliderRow label="Density" unit="kg/m³" value={customDensity} min={100} max={25000} step={10} onChange={setCustomDensity} testId="dens" />'
    new_ui = '''<div className="flex flex-col gap-3 mt-4 pt-3 border-t" style={{ borderColor: 'var(--border-c)' }}>
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
              </div>'''
    c = c.replace(slider_str, new_ui)

    # Insert exportSTEP and generateSTEPData
    step_export_str = '''function exportSTEP() {
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
    return 'ISO-10303-21;\\nHEADER;\\n' +
      "FILE_DESCRIPTION(('GRIDER BY NITESH HSETIN v2 Export'),'2;1');\\n" +
      "FILE_NAME('isogrid_export.step','" + ts + "',('GRIDER'),(''),'',' ','');\\n" +
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 }'));\\n" +
      'ENDSEC;\\nDATA;\\n' + E.join('\\n') + '\\nENDSEC;\\nEND-ISO-10303-21;\\n';
  }'''

    c = c.replace('function dlBlob(...', 'function dlBlob(data: ArrayBuffer | string, fn: string, mime: string) { ... ') # dummy, skip
    c = c.replace('function exportSTLBin() {', step_export_str + '\n\n  function exportSTLBin() {')

    # Link exportSTEP to the formatter switch
    c = c.replace('if (fmt === "stl-bin") exportSTLBin();', 'if (fmt === "stl-bin") exportSTLBin();\n    else if (fmt === "step") exportSTEP();')

    with open(r'd:\Projecto_mastro\Grid-Designer-Pro\artifacts\isogrid-studio\src\pages\Studio.tsx', 'w', encoding='utf-8') as f:
        f.write(c)

fix_file()
