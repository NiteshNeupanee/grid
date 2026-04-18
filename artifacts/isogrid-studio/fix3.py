import sys

def fix_file():
    with open(r'd:\Projecto_mastro\Grid-Designer-Pro\artifacts\isogrid-studio\src\pages\Studio.tsx', 'r', encoding='utf-8') as f:
        c = f.read()

    # Fix loadDemo translation logic
    bad_demo_logic = """    [-(40 / 2 + 10 / 2), 0, 40 / 2 + 10 / 2].slice(0, 2).forEach(zOff => {
      const fw = new THREE.BoxGeometry(baseW, wH, (baseD - 50) / 2); fw.translate(0, pH + wH / 2, zOff + 10); geos.push(fw);
    });"""
    good_demo_logic = """    const fw = new THREE.BoxGeometry(baseW, wH, (baseD - pD) / 2); fw.translate(0, pH + wH / 2, -(pD / 2 + (baseD - pD) / 4)); geos.push(fw);
    const bw = new THREE.BoxGeometry(baseW, wH, (baseD - pD) / 2); bw.translate(0, pH + wH / 2, (pD / 2 + (baseD - pD) / 4)); geos.push(bw);"""
    c = c.replace(bad_demo_logic, good_demo_logic)

    # Make sure STEP export button is in the dropdown!
    export_menu_old = """                {[
                  { id: "stl-bin", label: "STL (Binary)", desc: ".stl" },
                  { id: "obj", label: "OBJ", desc: ".obj" },
                  { id: "json", label: "Parameters", desc: ".json" },
                ].map(fmt => ("""
    export_menu_new = """                {[
                  { id: "step", label: "STEP (SolidWorks/CAD)", desc: ".step" },
                  { id: "stl-bin", label: "STL (Binary)", desc: ".stl" },
                  { id: "obj", label: "OBJ", desc: ".obj" },
                  { id: "json", label: "Parameters", desc: ".json" },
                ].map(fmt => ("""
    c = c.replace(export_menu_old, export_menu_new)

    with open(r'd:\Projecto_mastro\Grid-Designer-Pro\artifacts\isogrid-studio\src\pages\Studio.tsx', 'w', encoding='utf-8') as f:
        f.write(c)

fix_file()
