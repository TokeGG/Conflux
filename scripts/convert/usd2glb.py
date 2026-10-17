# USD (crate) -> GLB for static meshes with preview-surface textures. Used for the Pumpkin Reaper. Not part of any repo.
import sys, os, numpy as np, trimesh
from PIL import Image
from pxr import Usd, UsdGeom, UsdShade, Sdf
src, out = sys.argv[1], sys.argv[2]
root = os.path.dirname(src)
st = Usd.Stage.Open(src)
mpu = UsdGeom.GetStageMetersPerUnit(st) or 1.0
cache = UsdGeom.XformCache(0)
def tex_for(mesh):
    rel = mesh.GetPrim().GetRelationship('material:binding')
    tg = rel.GetTargets() if rel else []
    mat = UsdShade.Material(st.GetPrimAtPath(tg[0])) if tg else None
    if not mat or not mat.GetPrim().IsValid():
        mat = UsdShade.MaterialBindingAPI(mesh.GetPrim()).ComputeBoundMaterial()[0]
    if not mat: return None, None
    surf = mat.ComputeSurfaceSource()[0] if hasattr(mat, 'ComputeSurfaceSource') else None
    paths = {}
    for sh in [UsdShade.Shader(p) for p in Usd.PrimRange(mat.GetPrim()) if p.IsA(UsdShade.Shader)]:
        if sh.GetShaderId() == 'UsdUVTexture':
            f = sh.GetInput('file').Get()
            if f: paths[sh.GetPath().name] = str(f.path if hasattr(f, 'path') else f).lstrip('./')
    # decide which texture is the diffuse one by the name of the shader prim / file
    diff = next((v for k, v in paths.items() if 'diffuse' in v.lower() or 'basecolor' in v.lower() or 'albedo' in v.lower()), None)
    norm = next((v for v in paths.values() if 'normal' in v.lower()), None)
    return diff, norm
scene = trimesh.Scene(); total = 0
for p in st.Traverse():
    if not p.IsA(UsdGeom.Mesh): continue
    m = UsdGeom.Mesh(p)
    pts = np.array(m.GetPointsAttr().Get(), dtype=np.float64)
    counts = np.array(m.GetFaceVertexCountsAttr().Get()); idx = np.array(m.GetFaceVertexIndicesAttr().Get())
    xf = np.array(cache.GetLocalToWorldTransform(p)).T  # USD row-vector convention
    pts = (np.c_[pts, np.ones(len(pts))] @ np.array(cache.GetLocalToWorldTransform(p)))[:, :3] * mpu
    # fan triangulate, remembering the corner index of every triangle vertex
    tri_vi, tri_corner = [], []; c0 = 0
    for c in counts:
        for k in range(1, c - 1):
            tri_vi += [idx[c0], idx[c0 + k], idx[c0 + k + 1]]; tri_corner += [c0, c0 + k, c0 + k + 1]
        c0 += c
    tri_vi = np.array(tri_vi); tri_corner = np.array(tri_corner)
    uv = None
    pv = next((x for x in (UsdGeom.PrimvarsAPI(p).GetPrimvar(n) for n in ('st','st0','UVMap')) if x and x.Get() is not None), None)
    if pv and pv.Get() is not None:
        a = np.array(pv.Get(), dtype=np.float64); interp = pv.GetInterpolation(); ind = pv.GetIndices()
        if ind is not None and len(ind): a = a[np.array(ind)]
        uv = a[tri_corner] if interp == 'faceVarying' else a[tri_vi]
    verts = pts[tri_vi]; faces = np.arange(len(verts)).reshape(-1, 3)
    tm = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
    diff, norm = tex_for(m)
    if uv is not None:
        uv = uv.copy(); uv[:, 1] = 1 - uv[:, 1] if False else uv[:, 1]
        img = Image.open(os.path.join(root, diff)).convert('RGB') if diff and os.path.exists(os.path.join(root, diff)) else None
        mat = trimesh.visual.material.PBRMaterial(baseColorTexture=img, metallicFactor=0.0, roughnessFactor=0.9) if img else None
        tm.visual = trimesh.visual.TextureVisuals(uv=uv, material=mat) if mat else tm.visual
    tm.merge_vertices(merge_tex=True, merge_norm=True) if hasattr(tm, 'merge_vertices') else None
    scene.add_geometry(tm, node_name=p.GetName(), geom_name=p.GetName()); total += len(tm.faces)
scene.export(out)
print('wrote', out, os.path.getsize(out), 'bytes', 'meshes', len(scene.geometry), 'tris', total)
