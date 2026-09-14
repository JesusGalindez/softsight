# Plan: reconstrucción y certificación de producción

SoftSight como capa de verdad geométrica, QA y certificación de VideoMesh.

**Estado: sin empezar.** El estado sigue llevándose en
[`mapa-del-proyecto.md`](mapa-del-proyecto.md) §5 y en ningún otro sitio.

**Objetivo:** evolucionar SoftSight para que encaje de forma nativa, estable y profesional con un futuro pipeline **Video → Reconstrucción 3D → Producción 3D completa**, sin convertir SoftSight en un motor de fotogrametría.

**Principio rector:** **VideoMesh reconstruye; SoftSight mide, verifica y certifica.**

## Procedencia y cómo se lee

Las secciones **0 a 83 las escribió el agente que va a construir VideoMesh**, del
otro lado de la frontera. Se conservan **sin tocar ni renumerar**: son la
propuesta del productor, y reescribirlas borraría de quién viene cada decisión.

Las secciones **84, 85 y 86 son la respuesta de SoftSight**, del 2026-08-12, tras
contrastar la propuesta línea a línea contra este repositorio. Contienen el hueco
de transporte, la decisión de un repositorio o dos, y doce correcciones con su
`fichero:línea`.

**Donde 0–83 y 84–86 se contradigan, manda 84–86**, que es lo que se comprobó
contra el código. La dirección del plan no cambia; cambian afirmaciones que el
código desmiente y huecos que el orden de trabajo no cubría.

Lo que se le devolvió al otro agente está en
`RESPUESTA_SOFTSIGHT_AL_PLAN_VIDEOMESH.md`, fuera de este repositorio porque su
destinatario está fuera.

**Tres decisiones bloquean R0** y hasta que no estén tomadas no se escribe código:

```text
la vía de transporte del paquete          §84
un repositorio o dos                      §85
el idioma de los códigos de aviso         §86.2 g
```

---

# 0. Objetivo de este documento

Este documento define todo lo que SoftSight debe incorporar para funcionar como la capa de:

- ingestión de artefactos de reconstrucción;
- normalización geométrica;
- inspección de point clouds y meshes;
- validación topológica;
- comparación geométrica;
- medición de cobertura;
- cálculo de confianza;
- trazabilidad/provenance;
- QA de reconstrucción;
- QA de producción;
- certificación de LODs;
- validación UV/PBR;
- validación de collision meshes;
- validación de GLB final;
- reporting determinista;
- integración estable con VideoMesh.

No se pretende que SoftSight implemente:

- decodificación de video;
- selección de frames;
- feature extraction;
- feature matching;
- SfM;
- bundle adjustment;
- MVS;
- PatchMatch;
- depth estimation;
- stereo fusion;
- retopología completa;
- UV unwrap automático;
- baking profesional;
- Blender;
- COLMAP;
- OpenMVS.

Todo eso pertenece a VideoMesh o a providers externos.

---

# 1. Arquitectura final deseada

```text
VIDEO / IMAGE SEQUENCE
        │
        ▼
┌─────────────────────────┐
│        VideoMesh        │
│                         │
│ ingest                  │
│ frame intelligence      │
│ SfM                     │
│ MVS                     │
│ dense fusion            │
│ mesh reconstruction     │
└────────────┬────────────┘
             │
             │ Reconstruction Package
             ▼
┌─────────────────────────┐
│        SoftSight        │
│                         │
│ ingest normalized data  │
│ geometry truth          │
│ topology QA             │
│ coverage                │
│ confidence              │
│ provenance              │
│ geometry diff           │
│ reconstruction contract │
└────────────┬────────────┘
             │
             │ PASS / FAIL + evidence
             ▼
┌─────────────────────────┐
│ Production Compiler     │
│                         │
│ repair provider         │
│ retopology              │
│ UV                      │
│ baking                  │
│ PBR                     │
│ LOD                     │
│ collision               │
│ GLB                     │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│        SoftSight        │
│                         │
│ production QA           │
│ LOD fidelity            │
│ UV QA                   │
│ tangent QA              │
│ PBR QA                  │
│ collision QA            │
│ final geometry QA       │
│ production contract     │
└────────────┬────────────┘
             │
             ▼
      PRODUCTION READY
```

---

# 2. Regla de ownership

Debe existir un único dueño claro por responsabilidad.

| Responsabilidad | Dueño |
|---|---|
| video source | VideoMesh |
| frame extraction | VideoMesh |
| frame scoring | VideoMesh |
| feature extraction | VideoMesh/backend |
| feature matching | VideoMesh/backend |
| SfM | VideoMesh/backend |
| camera solving | VideoMesh/backend |
| MVS | VideoMesh/backend |
| depth generation | VideoMesh/backend |
| dense point cloud | VideoMesh/backend |
| raw mesh | VideoMesh/backend |
| canonical reconstruction schema | contrato compartido |
| PLY/GLB/glTF/OBJ ingest | SoftSight |
| camera normalization | SoftSight |
| topology metrics | SoftSight |
| surface distance | SoftSight |
| mesh comparison | SoftSight |
| camera visibility | SoftSight |
| surface coverage | SoftSight |
| geometry confidence | SoftSight |
| provenance schema | SoftSight |
| repair suggestion classification | SoftSight |
| repair execution | Production Provider |
| retopology | Production Provider |
| UV creation | Production Provider |
| PBR baking | Production Provider |
| LOD generation | Production Provider |
| collision generation | Production Provider |
| LOD fidelity | SoftSight |
| UV validation | SoftSight |
| PBR validation | SoftSight |
| collision validation | SoftSight |
| GLB spec validation | Khronos validator/provider |
| final geometry certification | SoftSight |
| final pipeline orchestration | VideoMesh |

---

# 3. Formatos que SoftSight debe soportar

## 3.1 P0 — requeridos para integración real

### Import

```text
.glb
.gltf
.obj
.ply
.json
.png
.jpg
.jpeg
```

### Export

```text
.glb
.gltf
.ply
.json
.png
```

## 3.2 P1 — producción avanzada

```text
.exr
```

Usos:

- depth;
- normals;
- confidence;
- residuals;
- mapas diagnósticos de alta precisión.

## 3.3 P2 — opcionales

```text
.usd
.usdz
.stl
.las
.laz
.pcd
```

## 3.4 No requeridos para V1

```text
.fbx
```

FBX no debe bloquear la arquitectura.

---

# 4. Formatos canónicos del pipeline

La arquitectura debe distinguir tres categorías.

## A. Evidence

```text
JPEG
PNG
EXR
```

Representa:

```text
lo observado por cámaras
```

## B. Reconstruction

```text
PLY
+
JSON
+
EXR opcional
```

Representa:

```text
lo reconstruido
```

## C. Production

```text
GLB
+
glTF opcional
```

Representa:

```text
lo entregado
```

Regla:

> El formato externo nunca define el modelo interno de SoftSight.

---

# 5. Canonical internal model

SoftSight debe tener tipos internos independientes de cada formato.

```text
SoftSightModel

Geometry
├── PointCloud
├── TriangleMesh
└── ProductionMesh

CameraSet
├── ReconstructionCamera
├── CameraObservation
└── CameraGroup

Evidence
├── ImageReference
├── MaskReference
├── DepthMapReference
└── NormalMapReference

Reconstruction
├── Geometry
├── Cameras
├── Observations
├── Coverage
├── Confidence
├── Provenance
└── Residuals

ProductionAsset
├── Nodes
├── Meshes
├── Materials
├── Textures
├── LODs
└── Collision
```

Adapters:

```text
PlyAdapter
GlbAdapter
GltfAdapter
ObjAdapter
ExrAdapter
ColmapAdapter
OpenMvsAdapter
```

---

# 6. Reconstruction Package V1

VideoMesh debe entregar a SoftSight un paquete canónico.

Ejemplo:

```text
turret.vmesh/
│
├── manifest.json
│
├── source/
│   ├── frames.json
│   └── masks/
│
├── cameras/
│   └── cameras.json
│
├── reconstruction/
│   ├── sparse.ply
│   ├── dense.ply
│   ├── mesh_raw.ply
│   └── mesh_refined.ply
│
├── evidence/
│   ├── depth/
│   │   └── *.exr
│   ├── normals/
│   │   └── *.exr
│   └── masks/
│       └── *.png
│
├── metadata/
│   ├── observations.json
│   ├── provenance.json
│   └── confidence.json
│
└── production/
    ├── master.glb
    ├── lod0.glb
    ├── lod1.glb
    ├── lod2.glb
    └── collision.glb
```

---

# 7. Reconstruction Manifest V1

Crear un schema explícito y versionado.

```json
{
  "reconstructionContractVersion": 1,

  "projectId": "turret-001",

  "coordinateSystem": {
    "handedness": "right",
    "up": "Y",
    "forward": "-Z",
    "unit": "meter"
  },

  "scale": {
    "status": "ABSOLUTE"
  },

  "artifacts": {
    "sparsePointCloud": "reconstruction/sparse.ply",
    "densePointCloud": "reconstruction/dense.ply",
    "rawMesh": "reconstruction/mesh_raw.ply",
    "refinedMesh": "reconstruction/mesh_refined.ply",
    "cameras": "cameras/cameras.json"
  },

  "source": {
    "type": "video",
    "frameCount": 241,
    "registeredFrames": 233
  }
}
```

SoftSight debe:

- validar versión;
- validar paths;
- validar coordinate system;
- validar units;
- rechazar manifests incompatibles;
- no adivinar propiedades omitidas importantes.

---

# 8. Camera Contract V1

SoftSight debe normalizar cámaras reconstruidas.

```ts
interface ReconstructionCamera {
  id: string;
  sourceFrame?: string;

  width: number;
  height: number;

  model:
    | "PINHOLE"
    | "SIMPLE_PINHOLE"
    | "RADIAL"
    | "OPENCV";

  intrinsics: {
    fx: number;
    fy: number;
    cx: number;
    cy: number;
    distortion?: number[];
  };

  worldFromCamera: Float64Array;
}
```

Internamente debe existir una sola convención.

Todo adapter convierte:

```text
COLMAP
OpenMVS
VGGT
otros
```

a:

```text
ReconstructionCamera
```

---

# 9. Observation Contract V1

Necesitamos representar observaciones sin acoplar SoftSight a COLMAP.

```ts
interface ReconstructionObservation {
  cameraId: string;
  pointId?: number;

  x?: number;
  y?: number;

  reprojectionError?: number;
  confidence?: number;
}
```

Para V1 puede existir:

```text
observations.json
```

Para datasets grandes:

```text
observations.bin
```

pero el esquema lógico debe mantenerse.

---

# 10. PointCloud V1

```ts
interface PointCloud {
  positions: Float32Array;
  normals?: Float32Array;
  colors?: Uint8Array;
  confidence?: Float32Array;
}
```

Debe soportar:

- bounds;
- centroid;
- density;
- nearest-neighbor statistics;
- isolated-point detection;
- deterministic sampling;
- preview;
- serialization PLY.

---

# 11. TriangleMesh V2

No usar objetos JS por vértice para high-poly.

```ts
interface TriangleMesh {
  positions: Float32Array;
  indices: Uint32Array;

  normals?: Float32Array;
  tangents?: Float32Array;
  texcoord0?: Float32Array;

  colors?: Uint8Array;
}
```

Metadata aparte.

---

# 12. I/O architecture

Estructura recomendada:

```text
src/soft/io/

geometry/
├── glb.ts
├── gltf.ts
├── obj.ts
└── ply.ts

reconstruction/
├── reconstructionManifest.ts
├── cameras.ts
├── observations.ts
├── colmapAdapter.ts
└── openMvsAdapter.ts

images/
├── png.ts
├── jpeg.ts
└── exr.ts

production/
├── glbExporter.ts
├── gltfExporter.ts
├── plyExporter.ts
└── reportExporter.ts
```

---

# 13. PLY implementation

## P0

Soportar:

```text
ASCII
binary_little_endian
```

No bloquear V1 por:

```text
binary_big_endian
```

## Propiedades reconocidas

```text
x
y
z

nx
ny
nz

red
green
blue
alpha

confidence
quality

face.vertex_indices
```

## Casos

```text
point-cloud PLY
triangle-mesh PLY
```

## Errores claros

```text
PLY_UNSUPPORTED_FORMAT
PLY_INVALID_HEADER
PLY_MISSING_POSITION
PLY_FACE_INDEX_OUT_OF_RANGE
PLY_UNSUPPORTED_FACE_SIZE
```

---

# 14. GLB / glTF

GLB debe ser el formato de producción principal.

SoftSight debe poder inspeccionar:

```text
nodes
meshes
primitives
positions
indices
normals
tangents
UVs
materials
textures
animations
extensions
bounds
scale
```

Export:

```text
master.glb
lod0.glb
lod1.glb
lod2.glb
collision.glb
```

glTF separado debe conservarse para debugging:

```text
asset.gltf
asset.bin
textures/
```

---

# 15. OBJ

Mantener compatibilidad.

Uso:

```text
debug
manual inspection
legacy interchange
```

No usar como formato canónico de reconstrucción ni de producción.

---

# 16. PNG / JPEG

## JPEG

Principalmente import:

```text
source frames
```

## PNG

Import/export:

```text
masks
silhouettes
contact sheets
diagnostics
geometry diff
coverage
confidence
provenance
```

---

# 17. EXR

P1.

Debe soportar, como mínimo:

```text
float16
float32
single-channel
multi-channel
```

Canales semánticos posibles:

```text
Z

NX
NY
NZ

CONFIDENCE

RESIDUAL
```

Nunca convertir depth float a 8-bit PNG como formato canónico.

---

# 18. COLMAP Adapter

Debe ser opcional.

SoftSight no debe depender de COLMAP internamente.

Adapter:

```text
COLMAP native
      ↓
ColmapAdapter
      ↓
ReconstructionManifest
CameraSet
Observations
PointCloud
```

Compatibilidad útil:

```text
cameras.bin
images.bin
points3D.bin

or

cameras.txt
images.txt
points3D.txt
```

El adapter existe para:

- debugging;
- import directo;
- testing;
- troubleshooting.

VideoMesh seguirá normalizando preferentemente antes del handoff.

---

# 19. OpenMVS Adapter

También opcional.

```text
OpenMVS
   ↓
OpenMvsAdapter
   ↓
canonical SoftSight model
```

El pipeline normal debe preferir:

```text
OpenMVS
   ↓
PLY + JSON
   ↓
SoftSight
```

---

# 20. High-poly scalability

Fotogrametría puede generar:

```text
1M
5M
10M
20M+
triangles
```

SoftSight debe prepararse.

## Requerimientos

```text
typed arrays
chunked algorithms
deterministic sampling
BVH
spatial hash
lazy derived data
disk cache
preview proxy
```

Evitar:

```text
O(n²)
```

en rutas principales.

---

# 21. BVH

Crear un Triangle BVH determinista.

Usos:

```text
ray intersection
nearest triangle
surface distance
camera visibility
occlusion
geometry diff
self-intersection candidates
```

API conceptual:

```ts
buildTriangleBvh(mesh)
raycast(bvh, ray)
nearestPoint(bvh, point)
queryAabb(bvh, bounds)
```

Criterio:

```text
same mesh
same algorithm version
=
same BVH ordering
```

---

# 22. Spatial Hash

Complemento para posiciones.

Usos:

```text
duplicate vertices
position welding analysis
point density
local neighborhoods
point-cloud noise
```

---

# 23. Geometry Audit V2

Extender auditoría actual.

## Exact metrics

```text
vertices
triangles
edges
boundary edges
boundary loops
non-manifold edges
non-manifold vertices
degenerate faces
duplicate faces
duplicate vertices
connected components
```

## Distribution metrics

```text
edge length:
  min
  median
  p95
  max

triangle area:
  min
  median
  p95
  max

triangle aspect ratio:
  median
  p95
  max
```

## Surface metrics

```text
surface area
signed volume
absolute volume
normal consistency
orientation consistency
```

## Fragmentation

```text
main component ratio
micro component count
floating surface area
```

---

# 24. Boundary Loop Intelligence

Convertir:

```text
boundary edges
```

en:

```text
boundary loops
```

Cada loop:

```ts
interface BoundaryLoop {
  id: string;
  edgeCount: number;
  perimeter: number;
  areaEstimate?: number;
  centroid: Vec3;
  normalEstimate?: Vec3;
  bounds: Bounds3;
}
```

Clasificación:

```text
MICRO_BOUNDARY
SMALL_BOUNDARY
LARGE_BOUNDARY
OPEN_SURFACE
UNKNOWN
```

No inferir:

```text
missing capture
```

sin evidencia de cobertura.

---

# 25. Self-intersection

Dos niveles:

```text
SELF_INTERSECTION_CANDIDATE
SELF_INTERSECTION_CONFIRMED
```

Broad phase:

```text
BVH overlap
```

Narrow phase:

```text
triangle/triangle test
```

SoftSight nunca debe reportar un candidato como hecho confirmado.

---

# 26. Geometry Diff Engine

Necesario para validar:

```text
raw
vs
repaired
```

```text
master
vs
LOD
```

```text
baseline
vs
new reconstruction
```

## Métricas

```text
A → B surface distance
B → A surface distance

mean
median
p95
p99
max
```

Normal deviation:

```text
mean
median
p95
max
```

Topology delta:

```text
triangle delta
component delta
boundary delta
non-manifold delta
```

Volume delta cuando sea válido.

---

# 27. Exactness classes

Toda métrica debe declarar su naturaleza:

```text
EXACT
DETERMINISTIC_APPROXIMATION
HEURISTIC_CANDIDATE
EXTERNAL_MEASUREMENT
```

Ejemplos:

```text
triangle count
→ EXACT

sampled symmetric surface distance
→ DETERMINISTIC_APPROXIMATION

likely missing capture
→ HEURISTIC_CANDIDATE

COLMAP reprojection error
→ EXTERNAL_MEASUREMENT
```

---

# 28. Camera Visibility Engine

Input:

```text
mesh
+
camera set
```

Por muestra o triángulo:

```text
inside frustum?
front facing?
occluded?
view distance?
incidence angle?
```

Resultado:

```text
visible
not visible
```

No confundir:

```text
inside frustum
```

con:

```text
actually observed
```

---

# 29. Coverage Engine

Por superficie:

```text
camera support count
view angle distribution
azimuth diversity
elevation diversity
distance distribution
```

Output:

```ts
interface SurfaceCoverage {
  observedAreaRatio: number;
  unobservedAreaRatio: number;
  weakAreaRatio: number;
}
```

Por región:

```text
coverage score
support count
directional support
```

---

# 30. Confidence Engine

Nunca usar un score opaco.

Modelo V1:

```text
supportScore
angleScore
diversityScore
neighborhoodScore
```

VideoMesh puede aportar:

```text
depthScore
mvsScore
reprojectionScore
```

Resultado:

```ts
interface SurfaceConfidence {
  supportScore: number;
  angleScore: number;
  diversityScore: number;
  neighborhoodScore: number;

  external?: {
    depthScore?: number;
    mvsScore?: number;
    reprojectionScore?: number;
  };

  combined: number;
}
```

Siempre:

```text
confidenceModelVersion
```

---

# 31. Provenance

Estados:

```text
OBSERVED
RECONSTRUCTED
REPAIRED
SIMPLIFIED
BAKED
INFERRED
AUTHORED
```

Regla:

```text
RECONSTRUCTED != INFERRED
```

No mezclar silenciosamente geometría observada con geometría inventada.

Ejemplo:

```json
{
  "provenanceVersion": 1,
  "regions": [
    {
      "origin": "RECONSTRUCTED",
      "backend": "openmvs"
    },
    {
      "origin": "REPAIRED",
      "operation": "small_hole_fill"
    }
  ]
}
```

---

# 32. Surface Region Model

Fotogrametría puede entregar un único mesh gigante.

SoftSight necesita regiones.

```ts
interface SurfaceRegion {
  id: string;
  triangleRanges: Array<[number, number]>;
  area: number;
  bounds: Bounds3;
  centroid: Vec3;
}
```

Una región puede surgir por:

```text
connected component
low-confidence cluster
boundary neighborhood
provenance
manual selection
future semantic segmentation
```

---

# 33. Region selectors

Extender selección actual.

Ejemplos:

```text
coverage < 0.4
confidence < 0.5
provenance = REPAIRED
boundaryLoop = 4
component = 12
```

Esto será especialmente útil para agentes.

---

# 34. Reconstruction Report

Añadir bloque versionado.

```json
{
  "reconstruction": {
    "contractVersion": 1,
    "geometry": {},
    "cameras": {},
    "coverage": {},
    "confidence": {},
    "provenance": {},
    "residuals": {}
  }
}
```

Ejemplo humano:

```text
RECONSTRUCTION QUALITY

Cameras
233 / 241 registered

Geometry
5,688,422 triangles

Topology
boundary loops       12
non-manifold          0

Surface coverage
94.3%

Low-confidence area
4.8%

Unobserved area
0.9%

Largest weak region
lower rear pedestal

STATUS
REQUIRES_RESCAN
```

---

# 35. Diagnostic rendering

Reutilizar rasterizador actual.

Modos:

```text
MATERIAL
NORMAL
COMPONENT
BOUNDARY
COVERAGE
CONFIDENCE
PROVENANCE
SURFACE_ERROR
LOD_ERROR
```

El renderer solo visualiza valores calculados.

No debe alterar las métricas.

---

# 36. Reconstruction contact sheet

Nuevo preset:

```text
reconstruction
```

Vistas:

```text
front
front-right iso
right
rear-right iso
back
rear-left iso
left
front-left iso
top
bottom
```

Modos:

```text
material
coverage
confidence
provenance
boundary
components
```

---

# 37. Reprojection QA

SoftSight recibe:

```text
mesh
camera
source image
mask optional
```

Genera:

```text
mesh silhouette
```

Comparar:

```text
rendered silhouette
vs
source mask
```

Métricas:

```text
IoU
false positive ratio
false negative ratio
boundary distance
```

No depender de color bruto para V1.

---

# 38. Depth residual

Si VideoMesh entrega depth EXR:

```text
source depth
vs
mesh-rendered depth
```

Métricas:

```text
mean absolute error
median
p95
relative error
invalid ratio
```

Debe declararse como:

```text
EXTERNAL_MEASUREMENT + SoftSight comparison
```

---

# 39. Normal residual

```text
MVS normal
vs
mesh normal
```

Métricas:

```text
angular median
angular p95
angular max
```

---

# 40. Reconstruction Candidate Comparison

VideoMesh puede producir múltiples candidatos.

```text
Candidate A
COLMAP incremental + COLMAP MVS

Candidate B
COLMAP global + COLMAP MVS

Candidate C
COLMAP incremental + OpenMVS

Candidate D
COLMAP global + OpenMVS
```

SoftSight evalúa todos bajo el mismo contrato.

SoftSight no elige backend.

VideoMesh decide.

---

# 41. Reconstruction Contract

Ejemplo:

```json
{
  "reconstructionBudget": {
    "minObservedAreaRatio": 0.92,
    "maxLowConfidenceAreaRatio": 0.05,
    "maxBoundaryLoops": 10,
    "maxNonManifoldEdges": 0,
    "maxLargestWeakRegionAreaRatio": 0.01
  }
}
```

Output:

```text
PASS
```

o:

```text
FAIL

RECON_LOW_COVERAGE
RECON_LOW_CONFIDENCE_REGION
RECON_LARGE_BOUNDARY_LOOP
```

---

# 42. Capture Advisor primitives

SoftSight no genera instrucciones de grabación completas.

SoftSight produce:

```text
weak region centroid
weak region normal
missing view direction
occluded directions
current camera support
```

VideoMesh transforma esto en:

```text
azimuth
elevation
distance
number of frames
```

---

# 43. Repair classification

SoftSight debe clasificar, no modelar agresivamente.

Estados:

```text
SAFE
REVIEW
UNSAFE
```

## SAFE

```text
remove tiny isolated component
remove degenerate face
weld exact duplicate vertices
normalize provably inverted normals
```

## REVIEW

```text
small hole
ambiguous local fragment
minor boundary closure
```

## UNSAFE

```text
large missing surface
mechanical gap
unknown underside
major occlusion
```

---

# 44. Production Asset Manifest

```json
{
  "productionAssetContractVersion": 1,

  "master": "master.glb",

  "lods": [
    {"level": 0, "file": "lod0.glb"},
    {"level": 1, "file": "lod1.glb"},
    {"level": 2, "file": "lod2.glb"}
  ],

  "collision": "collision.glb",

  "target": "web"
}
```

---

# 45. LOD Certification

Cada LOD debe medirse contra master.

```text
triangle count
surface distance
normal deviation
silhouette deviation
bounds delta
material preservation
```

Ejemplo:

```text
LOD0
300k tris
p95 surface error 0.18 mm

LOD1
100k tris
p95 surface error 0.76 mm

LOD2
30k tris
p95 surface error 2.4 mm
```

No considerar LOD correcto solo porque tiene menos triángulos.

---

# 46. UV Audit

Medir:

```text
TEXCOORD_0 present
out-of-range UV
degenerate UV triangle
zero-area UV island
UV coverage
overlap ratio
texel-density distribution
```

Importante:

```text
UV overlap
```

es un hecho.

No siempre un error.

El contrato decide.

---

# 47. Tangent Audit

Si existe normal map:

```text
NORMAL
TANGENT
TEXCOORD_0
```

deben ser coherentes.

Medir:

```text
missing tangents
NaN
zero length
orthogonality error
invalid handedness
```

Warning:

```text
NORMAL_MAP_WITHOUT_VALID_TANGENT_BASIS
```

---

# 48. PBR Audit

SoftSight no crea texturas.

Certifica.

Medir:

```text
base color present
normal present
roughness present
metallic present
AO present
emissive present
texture size
texture dimensions
material assignments
unused texture
missing image
```

Provenance:

```text
captured
baked
estimated
authored
```

---

# 49. Collision QA

Medir:

```text
triangle count
component count
watertight
bounds
master containment
collision outside visual mesh
complexity
```

No exigir que collision sea visualmente idéntico al master.

---

# 50. Final GLB Production Gate

SoftSight valida:

```text
node count
mesh count
primitive count
triangles
materials
textures
animations
LODs
collision metadata
scale
bounds
geometry QA
production constraints
```

Khronos glTF Validator valida:

```text
spec compliance
```

Ambos deben pasar.

---

# 51. Quality scores

No producir un score opaco.

SoftSight reporta:

```text
Topology
Geometry
Coverage
Confidence
Production
```

Ejemplo:

```text
Topology        98
Geometry        96
Coverage        91
Confidence      89
Production      94
```

Siempre:

```text
qualityScoreVersion
```

VideoMesh compone el score global.

---

# 52. Warning registry

Nuevos códigos:

```text
RECON_LOW_COVERAGE
RECON_UNOBSERVED_REGION
RECON_LOW_CONFIDENCE_REGION
RECON_CAMERA_SUPPORT_LOW
RECON_LARGE_BOUNDARY_LOOP
RECON_DEPTH_RESIDUAL_HIGH
RECON_NORMAL_RESIDUAL_HIGH
RECON_FRAGMENTED_SURFACE

GEOMETRY_SELF_INTERSECTION
GEOMETRY_DUPLICATE_FACE
GEOMETRY_DUPLICATE_VERTEX
GEOMETRY_ASPECT_RATIO_EXTREME

LOD_SURFACE_ERROR
LOD_SILHOUETTE_ERROR

UV_DEGENERATE
UV_COVERAGE_LOW
UV_OVERLAP_HIGH

PBR_TEXTURE_MISSING
PBR_TANGENT_INVALID

COLLISION_OUTSIDE_VISUAL
COLLISION_TOO_COMPLEX
```

---

# 53. Evidence-first warnings

Todo warning importante debe llevar evidencia.

```json
{
  "code": "RECON_LOW_CONFIDENCE_REGION",

  "region": "region-17",

  "severity": "warning",

  "evidence": {
    "areaRatio": 0.024,
    "medianCameraSupport": 1,
    "confidence": 0.31
  }
}
```

No obligar a un agente a parsear texto.

---

# 54. High-poly preview proxy

SoftSight debe distinguir:

```text
AUDIT GEOMETRY
```

de:

```text
PREVIEW GEOMETRY
```

El full mesh se usa para métricas cuando sea necesario.

El preview proxy se usa para:

```text
viewport
contact sheet
diagnostics
```

Metadata:

```json
{
  "renderSource": {
    "type": "proxy",
    "sourceTriangles": 5688422,
    "renderTriangles": 250000
  }
}
```

---

# 55. Geometry cache

Añadir:

```text
.cache/
├── parsed/
├── bvh/
├── adjacency/
├── samples/
├── coverage/
├── confidence/
└── proxy/
```

Key:

```text
source content hash
+
algorithm version
+
parameters
```

No depender únicamente de:

```text
path
mtime
size
```

---

# 56. Dependency invalidation

Ejemplo:

```text
geometry changed
→ invalidate:
  BVH
  adjacency
  coverage
  confidence
  geometry diff

UV changed
→ invalidate:
  UV QA
  production report

camera changed
→ invalidate:
  visibility
  coverage
  confidence
  reprojection QA
```

No recalcular todo.

---

# 57. Determinism

Todas las nuevas rutas deben ser deterministas.

Cuando exista sampling:

```text
fixed seed
```

Cuando exista clustering:

```text
stable ordering
stable tie-break
```

Cuando exista BVH:

```text
stable build
```

Cuando exista nearest result con empate:

```text
stable index selection
```

Regla:

```text
same input
+
same version
+
same parameters
=
same report
```

---

# 58. Scale model

Estados:

```text
ABSOLUTE
REFERENCE_SCALED
UNKNOWN
```

Nunca asumir metros.

Ejemplo:

```json
{
  "scale": {
    "status": "REFERENCE_SCALED",
    "unit": "meter",
    "reference": {
      "type": "distance",
      "value": 0.5
    }
  }
}
```

---

# 59. Coordinate systems

Manifest declara:

```text
handedness
up
forward
unit
```

SoftSight normaliza internamente.

Debe reportar:

```text
source coordinate system
internal coordinate system
applied transform
```

Nunca transformar silenciosamente.

---

# 60. Camera normalization tests

Fixtures analíticos:

```text
identity camera
translated camera
rotated camera
worldFromCamera
cameraFromWorld
right-handed
left-handed
Y-up
Z-up
```

Un error de matrices aquí destruiría coverage/confidence.

Debe ser P0.

---

# 61. Performance targets

No fijar inicialmente promesas absolutas.

Sí crear benchmark matrix:

```text
100k triangles
1M triangles
5M triangles
10M triangles
```

Medir:

```text
parse time
audit time
BVH build time
coverage sample time
peak RSS
cache size
```

Reglas:

```text
no accidental O(n²)
deterministic results
5M triangles processable
```

---

# 62. Test fixtures

Crear:

```text
artifacts/reconstruction/
```

Fixtures:

```text
cube-perfect/
cube-hole/
cube-nonmanifold/
cube-noisy/
cube-fragmented/

pointcloud-small/
pointcloud-noisy/

camera-orbit-valid/
camera-orbit-invalid/

mechanical-simple/
mechanical-occluded/

turret-synthetic/
turret-low-coverage/
turret-good-coverage/

highpoly-100k/
highpoly-1m/
highpoly-5m/
highpoly-10m/
```

---

# 63. Ground-truth benchmark

Necesitamos:

```text
known mesh
     ↓
synthetic cameras
     ↓
candidate reconstruction
     ↓
SoftSight compare
```

Métricas:

```text
symmetric surface distance
normal deviation
coverage
volume delta
topology delta
```

---

# 64. CI gates

En cada commit:

```text
typecheck
lint
existing SoftSight tests
PLY tests
manifest tests
camera tests
geometry audit tests
geometry diff tests
small coverage test
production contract tests
determinism
```

Nightly:

```text
1M
5M
10M
```

No correr 10M en cada push.

---

# 65. CLI

No inflar un único comando.

Recomendación:

```bash
softsight reconstruction inspect manifest.json
```

```bash
softsight reconstruction coverage manifest.json
```

```bash
softsight reconstruction compare baseline.json candidate.json
```

```bash
softsight production validate asset.json
```

La lógica debe vivir en APIs.

CLI solo transporta opciones.

---

# 66. Public API

Consolidar:

```ts
inspectModel()
inspectPointCloud()
inspectReconstruction()
compareGeometry()
computeCoverage()
computeConfidence()
renderDiagnostic()
validateProductionAsset()
```

CLI, bridge y MCP deben usar estas APIs.

---

# 67. Bridge

Agregar comandos:

```text
reconstructionInspect
reconstructionCoverage
reconstructionCompare
productionValidate
```

El bridge:

```text
transport only
```

No business logic.

---

# 68. MCP

Herramientas:

```text
softsight_reconstruction_inspect
softsight_reconstruction_coverage
softsight_geometry_compare
softsight_production_validate
```

Recibir objetos tipados.

Evitar decenas de flags planos.

---

# 69. Report projection

Permitir:

```text
summary
fields
```

Ejemplos:

```text
reconstruction.coverage
reconstruction.confidence.summary
reconstruction.geometry.boundaries
production.lods
```

Sin recalcular.

---

# 70. Suggested source layout

```text
src/soft/

reconstruction/
├── types.ts
├── manifest.ts
├── camera.ts
├── cameraSet.ts
├── pointCloud.ts
├── plyLoader.ts
├── observation.ts
├── visibility.ts
├── coverage.ts
├── confidence.ts
├── provenance.ts
├── residuals.ts
├── geometryMetrics.ts
├── geometryDiff.ts
├── surfaceDistance.ts
├── boundaryLoops.ts
├── bvh.ts
├── spatialIndex.ts
├── reconstructionAudit.ts
└── reconstructionReport.ts

production/
├── productionManifest.ts
├── productionContract.ts
├── lodAudit.ts
├── uvAudit.ts
├── tangentAudit.ts
├── textureAudit.ts
├── collisionAudit.ts
├── materialAudit.ts
└── productionReport.ts

io/
├── geometry/
├── reconstruction/
├── images/
└── production/
```

---

# 71. Release roadmap

## R0 — Boundary + schemas

Implementar:

```text
VIDEOMESH_CONTRACT.md
ReconstructionManifest
CameraContract
ObservationContract
coordinate normalization
scale model
```

Gate:

```text
canonical package can be parsed and validated
```

---

## R1 — Core I/O

Implementar:

```text
PLY ASCII
PLY binary little-endian
PointCloud
TriangleMesh V2
JPEG/PNG source references
```

Gate:

```text
PLY point cloud and mesh load deterministically
```

---

## R1.5 — Rebanada vertical, y el contrato probado antes de construir encima

Insertada el 2026-09-13 por el §86.4 (p): el roadmap era horizontal y la
integración solo se demostraba en R9/R15, tras unos cincuenta items. Si el
contrato está mal, se descubre al final.

Implementar:

```text
cube-v1 generado aquí: malla, nube, cuatro imágenes renderizadas y su CameraSet
el recorrido entero: esquema → sandbox → hashes → PLY → CameraSet → escala
                     → FrameGraph → auditoría → informe
```

Gate:

```text
COMPLETE + PASS con salida 0, informe válido contra su esquema publicado
e idéntico byte a byte entre dos ejecuciones
```

**Hecha.** Es R0-A más lo que el bloque de decisiones le cerró encima: topes de
recurso, coherencia de escala, la cámara atada a sus píxeles y el FrameGraph
comprobado. Lo que queda del escalón no es código nuestro sino **el segundo
productor**: R0-B, con el `cube-v1` de VideoMesh. El contrato no se congela hasta
que dos productores distintos lo hayan llenado (§86.4 q y D26).

---

## R2 — High-poly substrate

Implementar:

```text
typed arrays
chunking
memory metrics
deterministic sampling
```

Gate:

```text
5M triangle fixture processable
```

---

## R3 — Spatial engine

Implementar:

```text
BVH
spatial hash
nearest point
raycast
```

Gate:

```text
analytic ray/nearest fixtures pass
```

---

## R4 — Geometry truth

Implementar:

```text
Geometry Audit V2
boundary loops
self-intersection candidate/exact
surface metrics
fragmentation
```

Gate:

```text
known geometry defects detected exactly
```

**Hecho el 2026-09-13 salvo la autointersección**, en
`reconstruction/meshTopology.ts` con puerta `test:mesh-topology`.

Lo que faltaba no era medir más, era **dar estructura a lo que ya se contaba**.
`auditMesh` decía cuántas aristas de borde hay, y con eso no se decide nada:

```text
148 aristas de borde   ¿un agujero grande, o treinta y siete pequeños?
84.000 triángulos      ¿una pieza, o doce islas flotando?
```

Las dos preguntas cambian la reparación entera. Ahora salen los **bucles** con su
perímetro y su extensión, y los **componentes** con su área. Y con ellos
`largestComponentAreaRatio`, que es el número que el recuento no da: una pieza con
una mota y una nube de siete trozos tienen 2 y 7 componentes, pero 0,99 y 0,14 de
ratio, y solo el segundo es una reconstrucción rota.

**Todo sobre posiciones soldadas**, y es lo que decide si el módulo sirve: un cubo
con los vértices partidos por cara —como viene cualquier malla con UVs o normales
duras— tiene 36 posiciones y *parece* doce triángulos sueltos. Sin soldar, casi
todo modelo real se reportaría hecho pedazos.

**Lo ambiguo se cuenta, no se reparte.** Cuando un vértice tiene más de dos aristas
de borde —dos agujeros que se tocan en un punto— el camino no es único, y elegir
uno sería inventar. Esas aristas van a `unresolvedBoundaryEdges`, y la puerta
comprueba sobre cuatro cubos que **bucles + irresolubles == `boundaryEdges`**: sin
esa igualdad, el módulo podría perder aristas por el camino sin que nadie lo
notara.

Medido sobre el dron real: **296 piezas, ninguna con más de un componente, 32 con
agujeros, 46 bucles en total, 0,16 s de CPU** para las 296.

**La autointersección entra el mismo día**, en `reconstruction/selfIntersection.ts`
con puerta `test:self-intersection`, y entra como el §86.3 (n) manda: **candidato
con su epsilon**, nunca confirmado. Tres decisiones la hacen utilizable:

- **Los vecinos no cuentan**, y se excluyen por **posición soldada**: dos
  triángulos que comparten un vértice se tocan por construcción, y por índice no
  se detecta —un cubo con vértices partidos por cara no comparte ninguno—. Sin
  esto, toda malla saldría autointersecada y nadie miraría el aviso, que es
  literalmente lo que le pasó a `segmentsCross` con el caso colineal.
- **Lo coplanar se cuenta, no se afirma.** Ahí el signo vale cero y decide el
  redondeo. Va en `coplanarPairs`.
- **El epsilon es relativo, y su origen es `Float32`.** Medido: sobre puntos
  resueltos para caer exactamente en el plano, con las posiciones en `Float32`
  como vienen en una malla, la distancia se aleja hasta **2,3e-8 de la magnitud de
  la coordenada**, estable entre 1 y 10⁶. No es redondeo de doble: es la rejilla
  en la que viven las posiciones, y ningún test sobre ellas puede resolver por
  debajo por mucha precisión que se use después.

**Escribir la puerta destapó un error de libro.** La versión que busca «qué
vértice queda solo de su lado» **divide por cero** con los signos `(0, +, +)` —un
vértice justo en el plano y los otros dos del mismo lado—, y con eso **un cubo
cerrado salía con cuatro autointersecciones**: pares de caras que solo se tocan en
una esquina. El intervalo se calcula ahora recorriendo aristas, donde ese caso no
es especial.

Sobre el dron real: 296 piezas, 37.950 triángulos, **71.556 pares probados en 0,59
s de CPU**, 3 piezas con candidatos y 13.727 pares coplanares que se cuentan sin
afirmarse.

---

## R5 — Geometry diff

Implementar:

```text
A → B
B → A
surface distance
normal deviation
topology delta
```

Gate:

```text
repair can be quantitatively compared with raw mesh
```

**Hecho el 2026-09-13**, en `reconstruction/meshDiff.ts` con puerta
`test:mesh-diff`. Lo desbloqueaba R3 sin que nadie lo hubiera anotado: el
`nearestPoint` del árbol, ya juzgado contra la fuerza bruta, es exactamente la
primitiva que un diff de superficie necesita.

**Vértice contra vértice no sirve** —soldar, simplificar y tapar los cambian
todos—, así que se muestrea la superficie, ponderando por área y con semilla fija.

**Las dos direcciones no son la misma medida, y es la razón de que sean dos.**
Muestrear A y buscar en B no ve lo que B tiene de más: si la reparación rellenó un
agujero con una cúpula inventada, cada punto de A sigue teniendo el suyo en B y el
informe diría que son idénticas. Medido en la puerta con un cubo al que se le
añade otro aparte: **A → B se queda en el ruido y B → A da 2,700**. Por eso se
publican separadas y **no se promedian**: 1,35 no describiría nada.

Es `APPROXIMATE` y `BITWISE_EXACT` a la vez, que son los dos ejes de D28 y la
razón de que sean dos: el muestreo no visita toda la superficie, pero visita
siempre los mismos puntos. Publica sus `samples`, que es lo que el §86.3 (k)
exige.

**Y publica su suelo de ruido**, relativo a la diagonal: una malla contra sí misma
da 2,0e-16 sobre el cubo unidad y 3,2e-13 sobre uno de lado 1000. No es cero **y
no puede serlo** —el punto de muestra se construye con baricéntricas en doble y el
árbol busca sobre posiciones en `Float32`—, así que afirmar cero exacto sería
afirmar más de lo que la aritmética sostiene. La misma lección que
`aproximacion-determinista`.

Contra un presupuesto **no compara**: eso es R9 y necesita la escala (D9).

**Alcanzable desde fuera desde el 2026-09-13**: `--model a --diff b` en el CLI y
el comando `diff` en el puente. Cada lado se aplana a **una sola malla en espacio
de mundo** —de mundo porque cada pieza trae su matriz, y aplanado porque entre dos
versiones las piezas se parten, se funden y cambian de nombre, así que
emparejarlas por nombre daría un diff que se cae en cuanto un pase renombre algo—.
Lo que sí se publica es el recuento de piezas de cada lado.

`--diff-max` va en **fracción de la diagonal** y no en unidades, que es la unidad
del fallback de D9; sin la bandera no hay veredicto y la orden vale 0. El aviso
dice **qué lado** es el peor, que es lo que separa «le falta superficie» de «le
sobra».

Y quedó medido que el suelo de ruido publicado es el de una malla tal y como
llega, **no el de una escena**: el dron contra sí mismo por el CLI da entre 1e-14
y 1e-13 de la diagonal, y crece con el número de muestras porque más muestras
encuentran peores casos. Componer una matriz por pieza añade su redondeo. Por eso
el informe publica `worstRelative`: el consumidor compara contra lo que mide, no
contra una constante medida en otro sitio.

---

## R6 — Reconstruction intelligence

Implementar:

```text
camera visibility
coverage
confidence v1
provenance
surface regions
```

Gate:

```text
SoftSight can identify observed/weak/unobserved regions
```

**Hecha la cobertura el 2026-09-13**, en `reconstruction/coverage.ts` con puerta
`test:coverage`. Estaba bloqueada por D34 hasta que R0-B pasara, y R0-B lo cumple
`producers/colmap/` desde el mismo día.

Es **la pregunta para la que existe la capa de certificación**: una malla puede
estar impecable en topología y describir una trasera que nadie fotografió.
Ninguna imagen lo desmiente y ninguna métrica de geometría lo detecta, porque la
geometría está bien.

**Tres regiones, y la del medio es la que justifica que sean tres:**

```text
sin observar   ninguna cámara la ve        no hay evidencia
débil          la ve exactamente una       hay evidencia y no triangula
observada      la ven dos o más            hay evidencia suficiente
```

Meter lo débil en «observada» infla el número justo donde la reconstrucción es
más frágil. Medido sobre `cube-v1`: con las cuatro vistas sale **49,5 %
observada, 50,5 % sin ver y cero débil** —cada cara alcanzada cae en el campo de
dos cámaras—, y con una sola vista **el 16,7 % observado es todo débil**, que es
una cara de seis exacta.

**El §86.3 (k) está hecho prueba.** Se publica `samples`, se declara que va
ponderado por área, y se acompaña del error estándar con su intervalo.
`coverageVerdict` devuelve **INCONCLUSIVE cuando el umbral cae dentro del
intervalo**: ahí la medida no distingue, y decir PASS o FAIL sería echar una
moneda. El intervalo se estrecha con las muestras —0,0158 con mil, 0,0035 con
veinte mil—, que es lo que separa un error de muestreo de una constante
decorativa.

Y D21 se respeta: `provenanceAware: false`, y sobre malla que no es puramente
reconstruida el número **se reporta y no certifica**, con su motivo.

**`coverage` pasa a ser una capacidad declarada** en `SUPPORTED_CAPABILITIES`.
`confidence` sigue fuera y es ahora el caso vivo de la negociación de D31:
necesita los residuales multivista de R8, que piden profundidad y máscaras.

**Y la confianza geométrica, el mismo día**, en `reconstruction/confidence.ts` con
puerta `test:confidence`. Corrige de paso una afirmación que este documento tuvo
durante unas horas: **la confianza no necesita entera los residuales de R8**. Lo
que los necesita es la pregunta «¿la superficie coincide con lo que las fotos
muestran?». La pregunta «¿desde dónde se miró?» sale de la malla y del CameraSet.

**Por qué hace falta aparte de la cobertura**, y es el caso que la puerta ejerce:
dos cámaras separadas un 1 % de su distancia ven el mismo punto las dos, así que
la cobertura lo cuenta como triangulado y da un número espléndido. Medido: **16,7 %
triangulado según la cobertura, y el 100 % de eso es paralaje corto**, con una
mediana de 0,73°. Un paquete puede salir observado y estar sostenido por aire.

```text
SIN_EVIDENCIA     ninguna cámara
SIN_TRIANGULAR    una
PARALAJE_CORTO    dos o más, y el mayor ángulo no llega al suelo
SOSTENIDA         dos o más con ángulo suficiente
```

**No sale un número entre 0 y 1**, y es deliberado: emitir `confidence: 0.87`
invita a leerlo como una probabilidad que nadie aquí puede sostener — es el riesgo
R8 del contrato, «confianza tratada como exacta». Salen fracciones de área por
clase y los percentiles del ángulo, que son medidas.

El suelo de paralaje va **declarado y sustituible**: cinco grados es la frontera
práctica de la fotogrametría, pero una pieza pequeña de cerca y un edificio de
lejos no toleran lo mismo. Es criterio sobre la pieza, como el presupuesto de D9.

La capacidad se declara **`confidence-geometric` y no `confidence`**: quien pide
la segunda está pidiendo los residuales, y decir que sí sería el sobreanuncio que
D31 existe para impedir.

**El cruce sobre datos reales, cerrado el 2026-09-14.** Lo que faltaba no era
densidad sino **superficie**: `producers/superficie` la fabrica en CPU a partir de
la nube dispersa —normales por PCA orientadas hacia la cámara más cercana, campo
con signo y surface nets—, y con ella `south-building` mide 72,7 % observada,
27,4 % que nadie miró y 48,4 % sostenida con paralaje mediano de 36,2°, sobre
ocho vistas reales. La malla sale abierta donde no hubo evidencia, que es la
diferencia con Poisson y la respuesta honesta para esta pregunta.

**Y las siluetas, el mismo día.** Las tres condiciones de `seesPoint` son
geométricas y ninguna mira la foto, así que una muestra que proyecta sobre el
cielo salía observada — justo en el borde de la silueta, donde el mallador
extiende superficie más allá de la evidencia. Con máscara, el contorno recorta;
`coverage.maskedCameras` declara de cuántas cámaras se aplicó, porque un ratio
medido con siluetas y otro sin ellas **no son comparables**. Entran por
`org.softsight.mascaras`, el espacio experimental de D30, y no por el contrato.

**Lo que falta de R6**: la confianza por residuales (R8), provenance por región, y
siluetas sobre datos reales — segmentarlas pide SAM2, que exige Python 3.10 y
torch 2.3, y esta máquina tiene 3.9 y torch se quedó en 2.2.2 para macOS Intel.
Lo que falta ahí es el fichero, no el camino.

---

## R7 — Reconstruction report

Implementar:

```text
reconstruction report
diagnostic modes
contact sheets
warning registry
evidence-first warnings
```

Gate:

```text
machine + human report generated from one package
```

**Hecho el 2026-09-13 salvo pliegos y modos de diagnóstico**, con puerta
`test:report-r7`. Es lo que hace utilizable lo de R6: hasta ahora la cobertura y
la confianza eran funciones que nadie llamaba.

**La trampa del escalón está en el «de un solo».** Escribir el texto por su cuenta
sería un segundo original del veredicto, y el día que discrepen el que se lea será
el bonito. `renderHuman` deriva del JSON ya construido, y la puerta lo comprueba de
la única forma que vale: **cambiando el informe y viendo que el texto cambia con
él**, y borrando un bloque para ver que su línea desaparece en vez de inventarse.

**Los avisos llevan sus números** (§53). Uno que solo dijera «hay superficie sin
ver» obliga a recalcularlo para saber si es el 2 % o el 40 %, y a recalcularlo con
otro muestreo, que daría otro número. Cada uno trae su ratio, sus muestras y su
intervalo:

```text
SS-COV-001   superficie sin evidencia      ninguna cámara la ve
SS-COV-002   superficie sin triangular     la ve una sola
SS-CONF-001  paralaje corto                dos o más demasiado juntas
```

**Y no deciden el veredicto.** Media superficie sin ver avisa y no suspende: el
umbral lo pone quien conoce la pieza, igual que el presupuesto de D9. Si la falta
de cobertura suspendiera por su cuenta, softsight estaría decidiendo qué tiene que
fotografiar el productor.

El suelo del aviso es el **suelo del muestreo y no una tolerancia**: con ocho mil
muestras, un uno por mil son ocho puntos y su intervalo lo cruza entero, así que
avisar de eso sería avisar de ruido.

Los bloques de R6 se **omiten** cuando no hay malla o no hay cámaras, en vez de
salir a cero: sin superficie la pregunta no se puede hacer, y un cero diría que no
se ve nada. El paquete de `producers/colmap/` lo ejerce — es una nube de puntos y
sale sin ellos.

La evidencia de un aviso es el **cuarto objeto opaco** de la frontera, y su
opacidad es la decisión: darle forma fija obligaría a rellenar campos que no
aplican o a inventar un campo por aviso. Lo fijo es que esté.

**Lo que falta de R7**: los pliegos de contacto y los modos de diagnóstico. El
pliego existe para modelos —`renderContactSheet`— y atarlo a un paquete de
reconstrucción pide decidir qué vistas se rinden, que es criterio y no código.

---

## R8 — Multi-view residuals

Implementar:

```text
mask reprojection
EXR
depth residual
normal residual
```

Gate:

```text
mesh can be compared with source evidence
```

---

## R9 — Reconstruction contracts

Implementar:

```text
reconstruction budget
PASS/FAIL
candidate comparison
capture-advisor primitives
```

Gate:

```text
VideoMesh can send multiple candidates and receive comparable reports
```

**`capture-advisor`, el 2026-09-14.** Es la primera pieza de R9 y la primera que
produce **algo que se ejecuta**: hasta ahora el informe decía «el 27,4 % no lo vio
nadie» y ahí se acababa. Ahora contesta la pregunta siguiente, que es la única
accionable — **¿dónde me pongo?**.

Lo que lo hace valer algo es que la ganancia **no se estima: se mide**. Cada
sugerencia trae una cámara entera, y el número sale de meterla en el CameraSet y
volver a contar con la misma aritmética que juzgará el resultado. Una puerta lo
comprueba **en cada prefijo del plan**: aplicando las `k` primeras, el ratio tiene
que salir idéntico al que la `k`-ésima publicó. Un consejo que dijera «prueba por
aquí, seguramente mejore» no se puede verificar ni desmentir.

```text
SIN_EVIDENCIA     nadie la ve       una cámara sobre la normal de la región
SIN_TRIANGULAR    la ve una sola    una segunda, separada de la que hay
PARALAJE_CORTO    la ven juntas     una separada por la base que falta,
                                    derivada de b = 2·d·tan(θ/2)
```

**La lista es un plan y no un catálogo.** Varias vistas recuperan la misma cara,
así que dar la ganancia de cada una contra el estado de hoy invita a sumarlas — y
sumarlas cuenta esa cara dos veces. El reparto es codicioso: la mejor primero, y
cada número es lo que **esa foto añade sobre las anteriores**.

**Tres ganancias y no dos**, en orden de fuerza de la evidencia: que haya foto,
que triangule, y que triangule con ángulo suficiente. La tercera no estaba, y sin
ella una sugerencia de base no ganaba nunca nada — el consejo no sabía decir
«sepárate» aunque el paquete entero fuera paralaje corto. Lo encontró la puerta,
con un cubo visto por seis pares de cámaras a un grado.

Y **`capture-advice`, no `capture-plan`**: no sabe de obstáculos, alcance, batería
ni espacio aéreo. Dice «desde aquí verías esto»; decidir si se puede ir es de
quien conoce el sitio. La misma línea que R10 traza para la reparación.

Medido sobre `south-building`: ocho fotos llevan la cobertura del 72,7 % al
87,6 %, y cubren el 60,1 % de lo que falta. La primera sugerencia sale de una
región del 5,3 % y gana más que otra del 10,2 %, que es lo que prueba que el orden
lo pone la ganancia medida y no el tamaño de la carencia.

**Los presupuestos, el mismo día.** `budgets` estaba en el esquema desde R0 y
**nadie lo leía**: la ingesta comprobaba que fueran coherentes con la escala y ahí
se acababa, así que un paquete podía declarar `triangulos ≤ 5`, entregar doce y
salir PASS con salida 0. Es el tercer campo del contrato que se rellenaba por
educación, después del FrameGraph y de la provenance, y los tres se encontraron
con la misma pregunta: **¿quién lee esto?**

Ahora se evalúan contra lo medido y **uno excedido suspende**, con salida 1: el
límite lo puso el productor, y aprobar por encima de él es lo que convertía el
campo en decoración.

El vocabulario es **cerrado** —nueve términos: cinco recuentos, un volumen y tres
fracciones de R6—, porque `name` es texto libre y contra `suavidad` no se puede
evaluar nada. La alternativa a cerrarlo no era «evaluar cualquier cosa», era
callar y aprobar. Un nombre fuera se declara `NO_EVALUADO` con su motivo y **no
toca el veredicto**; un término que sí se entiende y cuya medida falta deja el
paquete **INCONCLUSIVE**, que no es ninguna de las dos cosas anteriores.

Y se afinó D9: la regla de la escala ata a lo que **lleva escala dentro**. Mil
triángulos son mil en cualquier escala, y exigir `scale.status` ABSOLUTE para
presupuestarlos dejaba sin presupuestos a todo paquete de SfM. Lo desconocido
sigue rechazándose, y no por prudencia abstracta: probarlo permisivo puso roja la
puerta de D9, que presupuesta `desviación` en metros sobre escala RELATIVE.

**La comparación de candidatos, el mismo día, y con ella R9 cierra.** El escalón
lo pedía así —«VideoMesh manda varios candidatos y recibe informes comparables»—
y la trampa está en **comparables**, que no es lo mismo que producidos con el
mismo binario:

```text
cobertura con siluetas contra cobertura sin ellas   SILUETAS_DISTINTAS
0,727 contra 0,731 con ocho mil muestras            INTERVALOS_SOLAPADOS
un paquete que no se pudo leer                      PAQUETE_NO_CONSUMIBLE
otra versión de contrato                            CONTRATO_DISTINTO
```

Los dos primeros son los que engañan. Un ratio medido con siluetas y otro sin
ellas contestan preguntas distintas y los dos son un número entre cero y uno con
el mismo nombre; ponerlos en dos columnas invita a restarlos. Y dos coberturas
cuyos intervalos se solapan no son dos números distintos — es el §86.3 (k), que se
escribió para un umbral y vale igual entre dos candidatos.

**Y no sale una nota.** Lo que sale es dominancia: gana quien es mejor en todos
los criterios que se pudieron decidir. Si nadie domina, el informe lo dice y
enseña los criterios cruzados, porque los pesos que resolverían el compromiso
—¿cuánto vale un punto de cobertura contra mil aristas de borde?— no los conoce
quien mide. Medido sobre dos mallados de `south-building`, rejilla 128 contra 96:
el fino cubre más y sostiene más, el basto cierra mejor, y **nadie domina**.

`compare` entra en el CLI al lado de `inspect`, y **cada candidato se consume por
el mismo camino que si llegara solo**: si el cruce midiera aparte, sus informes
dejarían de ser los que el productor recibiría por separado.

**Lo que R9 no hace**: comparar **geometría**. Dos candidatos pueden ser dos
reconstrucciones de piezas distintas y el cruce los ordenaría igual. Lo contesta
el diff de R5, que existe; atarlo aquí pide decidir a partir de qué distancia dos
candidatos dejan de ser el mismo objeto, que es criterio y no código.

---

## R10 — Repair boundary

Implementar:

```text
SAFE
REVIEW
UNSAFE
```

Gate:

```text
SoftSight classifies correction risk without becoming a modeling engine
```

**Hecho el 2026-09-14.** El eje no es «difícil o fácil»: es **si la reparación
puede contradecir la evidencia**.

```text
SAFE     no mueve ninguna superficie — soldar, borrar un triángulo de área nula,
         voltear la malla entera. La pieza medida sigue siendo la misma
REVIEW   mueve o crea superficie donde alguien miró: hay fotos que pueden
         confirmarla o desmentirla, así que la decisión es revisable
UNSAFE   crea superficie donde nadie miró. No es que salga mal — es que salga
         como salga, nadie podrá saberlo
```

**Un agujero no es un defecto uniforme**, y esa es la razón de que R10 viva en
esta capa y no en una tabla fija. Taparlo entre puntos que tres cámaras vieron es
interpolar entre medidas; taparlo en la trasera que nadie fotografió es dibujar.
Los dos se llaman `MALLA_ABIERTA` con tantas aristas de borde, y distinguirlos
pide cruzar el contorno con el CameraSet — que es justo lo que ninguna herramienta
de malla puede hacer. La puerta lo ejerce con **la misma malla byte a byte** y dos
CameraSets: una cámara que mira el borde da REVIEW, una que no lo mira da UNSAFE.

Para preguntarlo hizo falta que `BoundaryLoop` publicara su **centroide** —media
de los puntos medios de sus aristas—, y que la vecindad en la que se busca
superficie observada llegue a media anchura del agujero y **no más**: con la
anchura entera, la vecindad de un agujero en una cara del cubo cruza la pieza y
recoge muestras de la cara de enfrente.

**La consecuencia es mecánica, no un consejo.** `breaksPurelyReconstructed` dice
qué pierde el paquete: con ella, D21 deja de certificar, porque la pregunta «¿lo
vio una cámara?» tiene respuesta trivial y falsa sobre geometría que alguien
inventó. Y sin cámaras cruzadas ningún agujero sale SAFE: **no saber no es estar
bien**, así que el veredicto es `REVISION_REQUERIDA_SIN_EVIDENCIA`.

Medido sobre `south-building`: **61 a revisar y 4 inseguras**. Los cuatro son
agujeros pequeños —de 6 a 12 aristas— en zonas que ninguna de las ocho cámaras
miró, y por eso el tope de la lista ordena **por riesgo y por lo que no se pudo
juzgar antes que por tamaño**: con el orden natural, los cuatro se habrían caído
detrás de agujeros de trescientas aristas e inofensivos.

La capacidad se declara **`repair-boundary` y no `repair`**: quien pide la segunda
está pidiendo que se repare, y eso cruzaría la línea de la puerta.

**Lo que R10 no hace**: reparar. En cuanto decidiera dónde va un vértice dejaría
de poder afirmar que sus números son exactos, que es lo único que aporta.

---

## R11 — Production manifest

Implementar:

```text
ProductionAssetManifest
master
LODs
collision
target preset
```

Gate:

```text
production package can be inspected
```

**Hecho el 2026-09-14.** Es **otro documento**, no el paquete de reconstrucción
con campos de más: un asset de producción no tiene cámaras, ni escala que
estimar, ni cobertura que medir. Lo que tiene son piezas **derivadas**, y la
pregunta que importa es si cada una sigue siendo fiel a su maestra.

```text
MASTER      la malla de la que sale todo. Exactamente una
LOD         un nivel de detalle, con su número. Cero o más
COLLISION   el proxy con el que el motor calcula choques. Cero o una
```

Las tres son mallas de triángulos: el tipo no las distingue, **el papel sí**, y el
papel decide qué se les mide.

**Un LOD tiene que diferir**, así que la desviación no es el defecto: lo es
pasarse del tope. Va en las dos direcciones y sin promediar, como en R5 — lo que
el LOD perdió y lo que añadió son dos problemas distintos.

**Y la colisión no se mide con una distancia.** Un proxy que envuelve con holgura
y otro que corta la pieza por la mitad pueden dar el mismo máximo. Lo que importa
es de qué lado queda la superficie, así que se cuenta **paridad de cruces** y se
publica qué fracción de la maestra queda fuera. Eso exige el proxy cerrado: con
una malla abierta «dentro» no está definido, y la comprobación se declara no
ejecutada en vez de devolver un número que parecería una respuesta.

**La asimetría de los dos topes está a propósito:**

```text
collisionTolerance   defecto CERO, y se defiende: un proxy que no contiene la
                     pieza deja que la atraviesen por ahí
lodDeviationMax      sin declarar NO SE JUZGA: lo que un nivel puede perder
                     depende de a qué distancia se mira, y eso no lo sabe quien
                     mide
```

Elegir un defecto para el LOD habría sido inventarse el criterio de otro; no
elegirlo para la colisión habría dejado pasar un proxy que se come la pieza.

El fixture es `esfera-v1`, un cubo esferificado: **todos sus vértices caen
exactamente a distancia uno del centro**, así que la desviación de un nivel es la
flecha de su cuerda y se calcula a mano. Medido: lod-1 desvía el 0,71 % de la
diagonal con el 25 % de los triángulos, lod-2 el 2,71 % con el 6,3 %, y la caja de
semilado 1,02 contiene la esfera al cien por cien; encogida a 0,8 asoma el 58,3 %
y suspende.

**Lo que no describe**: materiales, UV ni texturas. Eso es R12 y R13, y meterlo
aquí habría hecho un documento que describe mal las dos cosas.

---

## R12 — LOD QA

Implementar:

```text
surface fidelity
normal fidelity
silhouette fidelity
bounds delta
```

Gate:

```text
each LOD passes measurable error budgets
```

**Hecho el 2026-09-14.** Las cuatro medidas, y la tercera es la que justifica el
escalón:

```text
surface fidelity      la distancia de R5, en las dos direcciones
normal fidelity       desviación de normales, juzgada por la media
silhouette fidelity   qué contorno pierde y gana, en píxeles
bounds delta          cuánto se mueve la caja envolvente
```

**Un LOD que se desvía el 2 % dentro de una pared plana es invisible**: la
superficie se mueve hacia dentro de sí misma y ningún píxel cambia. El mismo 2 %
en un borde contra el cielo es un temblor que se ve desde lejos. La distancia de
superficie **mide el mismo número en los dos casos**, así que no puede ser el
único criterio — y medido sobre el fixture, lod-2 desvía el 2,71 % de superficie y
pierde el **12,1 % de silueta**, cuatro veces más.

La silueta se mide en **ortográfica y desde catorce vistas**. Ortográfica porque
un asset no declara desde dónde se le va a mirar, y elegir una distancia sería
inventarse el dato que falta; catorce porque un LOD puede estar impecable de
frente y roto de perfil — media esfera pierde el 50 % de silueta en la peor vista
y el 0 % en la mejor.

Lo que pierde y lo que gana van **separados y sin promediar**, como en R5: una
simplificación que se come una antena y otra que engorda un brazo tienen el mismo
error simétrico y se arreglan distinto. Medido: la esfera basta solo pierde
contorno; la misma esfera desplazada pierde y gana lo mismo, porque lo que se sale
por un lado entra por el otro.

El encuadre es **común a las dos mallas**, y sin eso la comparación mentiría: con
cajas propias, una esfera de radio 0,5 y otra de radio 1 llenarían la imagen igual
y sus siluetas saldrían idénticas. Con el encuadre común, la pequeña pierde el
75 %.

Y una caja en vez de una esfera **no pierde silueta y gana el 122 %**, con la
misma caja envolvente — justo lo que `bounds delta` no puede ver, y la razón de
que las cuatro medidas estén y no una.

Los cuatro topes son del destino y **ninguno tiene defecto**: `lodDeviationMax`,
`lodSilhouetteMax`, `lodNormalMaxDegrees`, `lodBoundsMax`. Sin declararlos se
publica y no se decide, porque lo que un nivel puede perder depende de a qué
distancia se mira. El motivo de un fallo **nombra el criterio**:
`LOD_FUERA_DE_TOLERANCIA_SILHOUETTE`.

---

## R13 — UV/PBR QA

Implementar:

```text
UV audit
tangent audit
texture audit
material audit
```

Gate:

```text
web/game-ready material constraints measurable
```

**La auditoría de UV, el 2026-09-14. El resto sigue abierto.**

Lo primero que hubo que resolver no era de diseño sino de formato: **un PLY no
puede expresar coordenadas de textura**, y el manifest de producción solo
referenciaba PLY. Así que el artifact gana `format` —`PLY` o `GLB`—, y el lector
de GLB que ya existía desde hace meses pasa a alimentar R13. No hace falta un
segundo documento: partirlo habría dejado la malla declarada en uno y su material
en el otro, y el día que discrepen nadie sabría cuál manda.

**Ausente no es cero, y aquí casi se pierde.** Los lectores rellenan `uvs` con
ceros cuando el atributo no viene, así que «esta malla no tiene UV» y «todas sus
UV están en el mismo punto» llegaban como el mismo array. El dato se recupera en
el lector —`hasUvs` en `ModelPart`, leído del atributo— porque adivinarlo mirando
los números habría acertado casi siempre y fallado en el único caso que importa:
sin él, **un asset en PLY salía con densidad cero, solape cero e impecable**.

```text
fuera del rango    una UV en 1,7 depende del modo de repetición del material
área nula          un triángulo con UV degeneradas no recibe textura
densidad de téxel  lo que importa es la DISPERSIÓN, no la mediana: dos partes a
                   escalas distintas se ven a resoluciones distintas
solape             cuánta área UV se pisa, sobre la que ocupan las islas
```

**El solape hubo que tirarlo y rehacerlo.** Se midió primero contando celdas
tocadas por dos o más triángulos, y daba **1,0000 sobre cualquier malla**: dos
triángulos vecinos comparten las celdas de su arista común, así que en una malla
densa todas salen repetidas. La adyacencia no es solape. Medido por área —la suma
de las áreas UV contra la unión— dos vecinos aportan cero, y dos caras sobre la
misma UV dan el 99 %.

Y sale un hallazgo real del fixture: la proyección esférica da **100 % de solape
con cero UV fuera del cuadrado**. Un despliegue puede estar entero dentro de rango
y pisarse consigo mismo — los triángulos de la costura cruzan de u≈1 a u≈0 y
barren la textura entera.

`uvRequired` es el único criterio con disparador defendible, y aun así lo declara
el destino; **no se le exige al proxy de colisión**, que no se pinta. Los otros
tres son topes sin defecto, como los de R12.

**Y el resto de R13, el mismo día.** El manifest gana artifacts con
`role: TEXTURE` y su `usage`, y un bloque `materials` que ata imagen a malla con
su modo de repetición.

**Eso cierra un hueco que quedó escrito.** La auditoría de UV publicaba vértices
fuera del cuadrado unidad y decía que no podía juzgarlos: «depende del modo de
repetición del material, que este documento todavía no describe». Ahora lo
describe, y con `wrap: CLAMP` una UV en 1,7 es una contradicción del manifest
consigo mismo — cazada **sin abrir una sola imagen**, como las de `SS-RECON`. Con
`REPEAT` las mismas UV son un mosaico, que es una técnica.

**El tamaño de la imagen desbloquea la densidad de verdad.** La de la auditoría de
UV es por unidad de mundo y solo compara la pieza consigo misma; multiplicada por
el lado de su textura sale en téxeles y ya significa algo fuera del asset: 63
téxeles por unidad con una textura de 256. Sin material que ate una textura, el
número está **ausente y no a cero**.

**La comprobación de normales se cayó y hubo que rehacerla.** Un mapa de color
enchufado en el canal de normales se lee sin error y el motor lo usa; lo que sale
es relieve absurdo. La primera medida fue azul medio y norma media, y **un damero
corriente las pasó** —0,51 y 0,98, las dos por los pelos—: promediar un canal que
salta entre dos extremos da justo el centro, que es donde estaba el umbral. Lo que
sí distingue es que una normal en espacio tangente **nunca apunta hacia dentro**,
así que su z es siempre positivo; el damero tiene el 50 % de sus píxeles por
debajo. Sigue sin ser una prueba —un degradado azul pasaría— y por eso el informe
publica los tres números y no solo el veredicto.

La auditoría de tangentes se reduce a lo único que se puede afirmar sin tangentes
declaradas: **cuánta superficie está espejada**. No es un defecto —espejar media
pieza para ahorrar atlas es corriente— pero obliga a que la tangente lleve signo,
y un pipeline que lo ignore pinta el relieve al revés en esa mitad.

**Lo que falta de R13**: nada de lo que el manifest declara. Queda medir contra
tangentes **escritas en el fichero** —comparar las declaradas con las derivadas—,
que pide leerlas del GLB, y la compresión de la imagen, que pide decodificar
formatos que no son PNG.

---

## R14 — Collision QA

Implementar:

```text
complexity
containment
bounds
topology
```

Gate:

```text
collision asset certifiable
```

**Hecho el 2026-09-14.** R11 contestaba **una** pregunta —¿asoma la maestra del
proxy?— y medida sola **premia al peor proxy posible**: una caja enorme contiene
perfectamente, saca cero por ciento asomado y un veredicto impecable, y el jugador
choca con el aire a medio metro del objeto.

Medido sobre el fixture: la caja de semilado 1,02 alrededor de la esfera de radio
1 **contiene al cien por cien y tiene el 93 % del proxy lejos de la maestra**, con
el 204 % de su volumen. Las dos direcciones no se promedian y ni siquiera se
parecen: una dice «lo atraviesan» y la otra «choca con nada».

**Y la convexidad, que el recuento de triángulos no puede ver.** Un motor de
física trata un casco convexo con un algoritmo y una malla cóncava con otro, y la
diferencia es de orden. Una caja con una esquina hundida tiene **los mismos doce
triángulos** y se sale un 32 % de la diagonal.

Escribirlo dio un hallazgo que no se esperaba: **una esfera teselada no es convexa
como malla**. Es convexa como conjunto de puntos, pero los cuatro vértices de un
quad proyectados sobre la esfera no son coplanarios, así que al partirlo en dos
triángulos una diagonal queda de valle — cuatro milésimas de la diagonal en una
esfera de ocho divisiones, mil veces el redondeo. La medida lo dice en vez de
esconderlo, y la tolerancia se declara: suponerla habría dado por convexa una
herradura poco profunda.

Los cuatro criterios suspenden **con su nombre y en orden de daño**: atravesar la
pieza se ve y se sufre, ser cóncavo cuesta en cada fotograma y no se nota hasta
que el motor va lento, chocar con el aire se sufre y no se ve.

```text
LA_MAESTRA_ASOMA_DE_LA_COLISION   gana a todo
PROXY_NO_CONVEXO
PROXY_DEMASIADO_HOLGADO
PROXY_DEMASIADO_VOLUMINOSO
```

**Lo que R14 no hace**: proponer un proxy. Calcular un casco convexo o descomponer
una pieza en partes convexas es modelar, y la línea es la misma que la de R10.

---

## R15 — Final GLB gate

Implementar:

```text
SoftSight production contract
Khronos validator provider integration
final report
```

Gate:

```text
PRODUCTION_READY
```

**Hecho el 2026-09-14**, y lo primero que hay que contestar es la contradicción
aparente: doce escalones negándose a resumir —la confianza no sale como un número
entre cero y uno, la comparación de candidatos no da una nota— y ahora un
veredicto de una palabra.

```text
una NOTA        pesa cosas incomparables, y los pesos los pone quien mide
una CONJUNCIÓN  dice «todo lo que declaraste como necesario, pasó»
```

`PRODUCTION_READY` es lo segundo. **No mide calidad**: dice que no queda ninguna
comprobación declarada sin pasar.

**Y la regla que lo sostiene: no se gana con silencio.** Si algo no se pudo
comprobar —no hay cámaras, el proxy está abierto, el validador no corrió— el
veredicto es `UNKNOWN`, nunca aprobado. Sin eso, **el asset más vacío sería el más
listo para producción**: sin LOD no hay desviación que medir, sin proxy no hay
contención, sin textura no hay tamaño que exceder.

Va más lejos: **tampoco se gana no declarando nada**. Un destino que no dice qué
exige deja todos los topes en `NO_JUZGADO`, y un asset entero sin juzgar no puede
estar listo. Y qué declaraciones hacen falta **lo decide el propio asset**: a quien
no trae niveles de detalle no se le exige su tolerancia —eso es `NOT_DECLARED` y no
bloquea—, y a quien los trae y no la declara, sí.

Medido: el fixture con todo declarado y el informe de Khronos sin errores sale
`PRODUCTION_READY` con ocho comprobaciones pasadas; el mismo fixture sin destino
que exija nada sale `UNKNOWN` **con todas sus medidas en PASS**.

**El validador de Khronos no se ejecuta: se ingiere.** Es la autoridad sobre si un
GLB es un GLB, y envolverlo aquí sería reimplementar lo que ya existe. Lo que este
escalón aporta es la ranura —quién validó, con qué versión, cuántos errores y
cuántos avisos— y la regla de que sin ella no hay aprobación. Decir «válido» sin
que nadie lo haya validado es el sobreanuncio que D31 impide.

Un fallo manda sobre un hueco: con algo roto, el veredicto no se suaviza a «no se
sabe».

---

## R16 — Operational maturity

Implementar:

```text
high-poly proxy
cache
dependency invalidation
bridge
MCP
performance nightly
```

**Hecho el 2026-09-14**, y lo que lo ordena todo es una pregunta que quince
escalones habían aplazado: **cómo llega el paquete**. Trece escalones midiendo y
un consumidor —VideoMesh— que no tenía por dónde entregar lo que se mide.

### El transporte, que el §84 dejó decidido a medias

El puente recibía los ficheros en base64 dentro del JSON. Para un GLB de dos
megas es correcto y no hay alternativa: el navegador no tiene rutas que ofrecer.
Para un `turret.vmesh` no funciona, y no por poco: 150 MB de `dense.ply` son 200
en base64, el tope por fichero son 256 **ya codificados**, y el timeout son 120 s.

Así que el paquete viaja **por ruta** y sube `bridgeContractVersion` a 2. Eso no
es un parámetro: es abrir el puente a leer disco del anfitrión, y la regla que lo
sostiene es una sola —**la raíz permitida la declara la configuración, nunca la
petición**—. Si viniera en la petición, las otras cuatro serían decorado:
cualquiera declararía `/` como su raíz.

```text
1  raíz por SOFTSIGHT_PACKAGE_ROOTS, no por la petición
2  realpath en los dos lados antes de comparar
3  prefijo por COMPONENTES, no por cadena
4  ningún `..`, aunque resolviera dentro
5  lectura solamente
```

La 3 es la que un `startsWith` deja pasar: `/datos/paquetes` **no** es prefijo de
`/datos/paquetes-de-otro`, que es un directorio ajeno. La puerta la comprueba con
las cuatro salidas conocidas, incluida un enlace simbólico que cae dentro de la
raíz y apunta fuera.

La versión 1 sigue valiendo entera: el editor la habla y no cambia. La respuesta
**hace eco de la versión pedida**, no del máximo que el puente sabe.

### Los cuatro comandos, y las cuatro herramientas

`reconstructionInspect`, `reconstructionCoverage`, `reconstructionCompare` y
`productionValidate` en el puente (§67), y las mismas por MCP (§68). No lanzan
proceso ni escriben sandbox: llaman a la API pública, la misma que llama el CLI.
La cobertura es una **proyección** del informe y no otra medida — dos números
distintos para la misma pregunta es lo que D1 prohíbe, y la puerta lo comprueba
por igualdad exacta.

El §68 llamaba al tercero `softsight_geometry_compare`. Se queda en
`softsight_reconstruction_compare` por D31: no compara dos geometrías —eso es
`diff`— sino candidatos, criterio a criterio y sin nota.

### La caché, y la invalidación que no es una tabla

`computeVisibility` son 338 ms de los 439 que cuesta el informe de
`south-building`, y de ella cuelgan la cobertura, la confianza y el consejo de
captura. Se guarda, y la clave es **el contenido que la medida lee**: posiciones
e índices, el CameraSet campo a campo, las siluetas, muestras y semilla.

Nunca `path + mtime + size`. No por elegancia: dos paquetes distintos escritos en
la misma ruta, con el mismo tamaño y el mismo `mtime` —lo que hace un script que
regenera— habrían recibido el uno la cobertura del otro. **Eso no es lentitud, es
un informe equivocado con el sello del bueno.** La puerta construye ese caso
exacto.

Y el §56 pide una tabla de invalidación. Aquí no la hay, y es el punto: lo que
invalida cada cosa **es la lista de lo que entra en su clave**, así que la matriz
sale sola y no se puede desincronizar.

```text
cambia la geometría  →  cambia el hash de la malla     →  se recalcula
cambia una cámara    →  cambia el hash del CameraSet   →  se recalcula
cambia un UV         →  no entra en la clave           →  NO se recalcula
```

La versión del algoritmo tampoco es un número a mano: es la huella de
`dist-node/agent3d.mjs`. Un `ALGORITHM_VERSION = 3` que alguien olvide subir deja
una caché sirviendo números de la versión anterior y nada lo delata. El precio se
dice: es conservador de más, y tocar el lector de PLY invalida visibilidades que
el lector de PLY no afecta.

Escribirlo costó un rojo que vale la pena dejar escrito: `MaskSet` es un `Map`, y
con `Object.keys` sobre un `Map` salen cero claves. La máscara no entraba en la
huella y un paquete **con** siluetas recibía la visibilidad medida sin ellas. Lo
cazó `test:masks`, no esta puerta.

Medido: 439 ms → 279 ms de CPU por informe, mediana de nueve pases alternos.

### El proxy de vista (§54)

Dos geometrías, y el informe dice cuál se usó: la malla entera para **toda
medida**, y un proxy para el pliego cuando pasa del presupuesto de 250.000
triángulos. `renderSource` viaja **siempre**, también cuando no hubo proxy:
ausente no es «entera», ausente es «no se sabe».

El presupuesto es global y se reparte entre las piezas. Aplicar el mismo tope a
cada una no es un presupuesto: un dron de 296 piezas de 130 triángulos no baja de
37.950 ni pidiendo 2.000. Repartido, baja a 2.854 y ni el recuento ni el radio
del informe se mueven.

Los vértices se agrupan por celda con **representante**, no con promedio: el
promedio de tres vértices de una esquina cae dentro de la pieza, y un proxy de
promedios se encoge. Con representante, todo vértice del proxy está en la malla
original.

**Y no es un LOD.** R12 midió exactamente esta frontera. El proxy de la puerta
pierde hasta el 0,9 % de la silueta en la peor vista; vale para mirar y no para
entregar, y por eso `renderSource` existe.

### El banco de rendimiento (§61, §64)

`npm run bench`. El §61 dice que no se fijen promesas absolutas todavía, y tiene
razón: un «5M en menos de 30 s» escrito hoy es una promesa sobre una máquina de
2015 que mañana alguien leerá como requisito.

Lo que sí se afirma es **la pendiente**: el coste por triángulo entre dos
escalones. Un número suelto no distingue «esta máquina es lenta» de «este código
es cuadrático», y son problemas distintos — el primero se arregla con otra
máquina y el segundo no se arregla nunca. Con un solo escalón no hay veredicto, y
lo honrado es imprimir el número y callarse.

`--nightly` corre 1M, 5M y 10M, que es lo del §64 y lo que no cabe en una suite
de 147 s. Medido el 2026-09-14 en el i5-5350U, con `--heavy`:

```text
escalón   etapa         CPU        RSS pico
100k      auditoría     0,12 s      67 MiB
100k      árbol         0,17 s      72 MiB
100k      visibilidad   0,96 s      77 MiB
1M        auditoría     0,27 s     112 MiB
1M        árbol         0,57 s     155 MiB
1M        visibilidad   7,28 s     166 MiB
5M        auditoría     0,96 s     316 MiB
5M        árbol         2,53 s     511 MiB
5M        visibilidad  34,42 s     551 MiB
```

Las tres pendientes salen **por debajo de 1**, y eso no es magia: en el escalón
pequeño pesa lo que no depende del tamaño —arrancar, reservar, calentar el JIT— y
al multiplicar por cincuenta se reparte. Ninguna es cuadrática, que es lo que el
§61 pedía comprobar, y **el escalón de 5M se atraviesa** con 551 MiB.

**Lo que R16 no hace**: `parse` no está en la matriz, y no por olvido — el único
lector de PLY es el ASCII, y un PLY ASCII de 5M de triángulos son ~400 MB de
texto que no caben en una cadena de Node. El lector binario sigue siendo el ítem
10 del §72. Y la opción 1 del §84 queda abierta **solo para lectura**: los
artefactos siguen saliendo por el canal de siempre, así que un paquete que
produjera 150 MB de salida todavía no tiene por dónde devolverlos.

---

# 72. Exact implementation order

Ejecutar en este orden:

```text
01  docs/VIDEOMESH_CONTRACT.md
02  reconstruction manifest schema
03  camera contract
04  observation contract
05  scale + coordinate model
06  camera normalization tests
07  typed-array TriangleMesh V2
08  PointCloud
09  PLY ASCII
10  PLY binary little-endian
11  high-poly benchmark harness
12  BVH
13  spatial hash
14  Geometry Audit V2
15  boundary loop extraction
16  self-intersection candidate/exact
17  surface distance
18  geometry diff report
19  camera visibility
20  coverage engine
21  confidence model v1
22  provenance model
23  surface region model
24  reconstruction report
25  diagnostic render modes
26  reconstruction contact sheet
27  warning registry
28  evidence-first warnings
29  PNG/JPEG source-view QA
30  EXR support
31  depth residual
32  normal residual
33  reconstruction budget
34  candidate comparison
35  capture-advisor primitives
36  repair classification
37  production asset manifest
38  LOD audit
39  UV audit
40  tangent audit
41  PBR audit
42  collision audit
43  final production contract
44  GLB/glTF production export hardening
45  Khronos validator provider
46  preview proxy
47  geometry cache
48  dependency invalidation
49  public API
50  CLI
51  bridge
52  MCP
53  high-poly nightly CI
54  VideoMesh integration gate
```

---

# 73. First commits

## Commit 1

```text
docs(reconstruction): define VideoMesh integration boundary
```

## Commit 2

```text
feat(reconstruction): add versioned reconstruction manifest
```

## Commit 3

```text
feat(reconstruction): add canonical camera and observation contracts
```

## Commit 4

```text
feat(geometry): introduce typed-array high-poly mesh model
```

## Commit 5

```text
feat(ply): add point-cloud and mesh PLY loader
```

## Commit 6

```text
feat(spatial): add deterministic triangle BVH
```

## Commit 7

```text
feat(audit): extend geometry audit for reconstruction meshes
```

## Commit 8

```text
feat(diff): add symmetric surface-distance comparison
```

## Commit 9

```text
feat(coverage): add camera visibility and surface coverage
```

## Commit 10

```text
feat(confidence): add versioned surface confidence model
```

Cada commit:

```text
existing gates green
+
new targeted gate green
```

---

# 74. Do not implement early

No empezar por:

```text
AI segmentation
automatic semantic hierarchy
automatic retopology
automatic large-hole completion
Gaussian Splatting
NeRF
rigging
desktop UI
cloud orchestration
FBX
USD
```

Primero cerrar:

```text
VideoMesh reconstruction
→
SoftSight measurable truth
→
production asset
→
SoftSight certification
```

---

# 75. Compatibility requirements

No romper:

```text
existing SoftSight CLI
renderHash semantics
current report fields
current warning meanings
current exit codes
softsight-motion-editor integration
```

Toda feature nueva debe ser:

```text
additive
```

hasta que exista una razón explícita para versionar.

Si se cambia contrato:

```text
contractVersion++
```

---

# 76. Risk register

## Risk A — high-poly memory explosion

Mitigación:

```text
typed arrays
chunking
sampling
BVH
proxy
cache
```

## Risk B — coverage too expensive

Mitigación:

```text
surface sampling first
BVH visibility
adaptive density
```

No calcular siempre:

```text
every camera × every triangle
```

## Risk C — confidence becomes opaque

Mitigación:

```text
versioned components
raw component values
no black-box score
```

## Risk D — SoftSight becomes Blender

Mitigación:

```text
inspect
measure
recommend
certify

not
model everything
```

## Risk E — SoftSight becomes COLMAP

Mitigación:

```text
canonical reconstruction contract
external adapters
```

## Risk F — duplicate responsibilities with VideoMesh

Mitigación:

```text
ownership table
public handoff contract
```

---

# 77. Definition of Done — SoftSight VideoMesh Integration V1

La integración estará lista cuando este flujo funcione:

```text
video.mp4
   ↓
VideoMesh
   ↓
reconstruction package
   ↓
SoftSight reconstruction gate
   ↓
Production Compiler
   ↓
SoftSight production gate
   ↓
asset.glb
```

Y produzca:

```text
Capture                       PASS
SfM                           PASS
MVS                           PASS

SoftSight Reconstruction
  Geometry                    PASS
  Topology                    PASS
  Coverage                    PASS
  Confidence                  PASS
  Provenance                  PASS

Production
  Repair                      PASS
  LOD                         PASS
  UV                          PASS
  Tangents                    PASS
  PBR                         PASS
  Collision                   PASS

SoftSight Final
  Geometry                    PASS
  Scale                       PASS
  GLB production contract     PASS
  Visual regression           PASS

Khronos glTF Validator        PASS

FINAL
PRODUCTION_READY
```

---

# 78. Example final package

```text
turret/
│
├── reconstruction/
│   ├── reconstruction.json
│   ├── cameras.json
│   ├── sparse.ply
│   ├── dense.ply
│   ├── mesh_raw.ply
│   └── mesh_refined.ply
│
├── evidence/
│   ├── masks/
│   ├── depth/
│   └── normals/
│
├── reports/
│   ├── reconstruction_report.json
│   ├── geometry_diff.json
│   ├── coverage_report.json
│   ├── confidence_report.json
│   └── production_report.json
│
├── diagnostics/
│   ├── coverage.png
│   ├── confidence.png
│   ├── boundaries.png
│   ├── provenance.png
│   └── lod_error.png
│
└── production/
    ├── master.glb
    ├── lod0.glb
    ├── lod1.glb
    ├── lod2.glb
    ├── collision.glb
    └── textures/
```

---

# 79. Example reconstruction report

```json
{
  "reconstruction": {
    "geometry": {
      "vertices": 2847201,
      "triangles": 5688422,
      "nonManifoldEdges": 0,
      "boundaryLoops": 4
    },

    "coverage": {
      "observedAreaRatio": 0.967,
      "weakAreaRatio": 0.021,
      "unobservedAreaRatio": 0.012
    },

    "confidence": {
      "modelVersion": 1,
      "mean": 0.94,
      "p10": 0.81
    },

    "status": "PASS"
  }
}
```

---

# 80. Example production report

```json
{
  "production": {
    "masterTriangles": 5688422,

    "lod0": {
      "triangles": 280412,
      "p95SurfaceErrorMeters": 0.00031,
      "status": "PASS"
    },

    "lod1": {
      "triangles": 94118,
      "p95SurfaceErrorMeters": 0.00112,
      "status": "PASS"
    },

    "uv": {
      "coverage": 0.987,
      "degenerateTriangles": 0,
      "status": "PASS"
    },

    "pbr": {
      "baseColor": true,
      "normal": true,
      "roughness": true,
      "metallic": true,
      "status": "PASS"
    },

    "collision": {
      "triangles": 1932,
      "status": "PASS"
    },

    "status": "PRODUCTION_READY"
  }
}
```

---

# 81. Final architecture principle

SoftSight debe evolucionar de:

```text
3D inspection tool
```

a:

```text
3D truth + reconstruction QA + production certification layer
```

sin perder su núcleo.

La arquitectura definitiva:

```text
           VideoMesh
        RECONSTRUCTS
              │
              ▼
          SoftSight
      MEASURES + PROVES
              │
              ▼
     Production Compiler
          TRANSFORMS
              │
              ▼
          SoftSight
         CERTIFIES
              │
              ▼
      PRODUCTION ASSET
```

---

# 82. Decisión técnica central

Para V1 debe quedar congelado:

```text
CANONICAL RECONSTRUCTION
=
PLY + JSON + EXR(optional)

CANONICAL PRODUCTION
=
GLB

DEBUG / INTERCHANGE
=
glTF + OBJ

SOURCE EVIDENCE
=
JPEG + PNG + EXR
```

En forma resumida:

```text
VIDEO
  ↓
VideoMesh
  ↓
PLY + JSON + EXR
  ↓
SoftSight
  ↓
Production Compiler
  ↓
GLB
  ↓
SoftSight
  ↓
PRODUCTION READY
```

Éste debe ser el contrato que guíe toda la implementación.

---

# 83. Resultado esperado

Cuando este roadmap esté completado:

SoftSight podrá recibir una reconstrucción proveniente de:

```text
COLMAP
OpenMVS
future SfM
future MVS
AI geometry providers
```

sin estar acoplado a ninguno de ellos.

Podrá responder con hechos verificables:

```text
qué geometría existe
qué tan limpia está
qué regiones están observadas
qué regiones están débiles
qué cambió después de reparación
qué LOD conserva la forma
qué UV/PBR cumple producción
qué collision mesh cumple contrato
si el GLB final está listo
```

Y VideoMesh podrá apoyarse en SoftSight como una capa profesional de verdad geométrica y certificación, sin duplicar lógica ni mezclar responsabilidades.

**Éste es el punto de integración correcto entre ambos proyectos.**

---

# 84. Transporte del paquete

Las secciones 6 y 67 dan por resuelto algo que no lo está: **cómo cruza
físicamente el paquete de reconstrucción de VideoMesh a SoftSight**.

## El problema

La vía sancionada de integración de SoftSight hoy es `tools/bridge.mjs`: JSON por
stdin, JSON por stdout, sandbox sin shell, un directorio de trabajo por petición.
Los ficheros viajan **en base64 dentro del JSON de la petición**.

Los límites vigentes:

```text
MAX_FILE_BYTES      = 256 MB   (por fichero, ya en base64)
MAX_ARTIFACT_BYTES  =  64 MB
TIMEOUT_MS          = 120 s
```

Un `turret.vmesh/` del §6 no cabe por ahí:

```text
dense.ply           ~150 MB binario  →  ~200 MB en base64
mesh_refined.ply    otro tanto
evidence/depth/     233 EXR
evidence/normals/   233 EXR
```

Y aunque un fichero suelto entrase justo por debajo del tope, auditar 5,7M
triángulos en 120 s con un techo de artefacto de 64 MB tampoco ocurre.

El §67 dice del puente «transport only, no business logic». Es el principio
correcto y a la vez el punto ciego: **el transporte es exactamente lo que no
existe para este tamaño de dato.**

Esto se descubre hoy o se descubre en R9, con cuarenta items ya construidos
encima de la suposición de que el handoff funciona.

## Las tres opciones

### Opción 1 — Paquete por referencia de ruta (recomendada)

VideoMesh escribe el paquete en disco y le pasa a SoftSight **la ruta del
directorio**, no el contenido.

```json
{
  "bridgeContractVersion": 2,
  "command": "reconstructionInspect",
  "package": { "root": "/ruta/declarada/turret.vmesh" }
}
```

Coste real: hay que **abrir el sandbox a una raíz declarada y validada**. Eso es
un cambio del modelo de seguridad del puente, no un parámetro. Hay que escribirlo
explícito:

```text
raíz permitida declarada por configuración, no por la petición
resolución de rutas con realpath y comprobación de prefijo
sin symlinks que escapen de la raíz
sin `..` en ningún componente
lectura solamente; los artefactos siguen saliendo por el canal actual
```

Sube `bridgeContractVersion` a 2.

### Opción 2 — VideoMesh llama al CLI directo

El puente se queda como está, para el editor. VideoMesh usa `agent3d` con rutas
de fichero, que es lo que el CLI ya hace de forma nativa.

Es lo más barato y lo más honesto: **dos consumidores con necesidades distintas y
dos vías**, en vez de forzar una vía universal que no lo es. El precio es admitir
que el puente no es la frontera única.

### Opción 3 — Subir los límites del puente

No arregla nada. 120 s y base64 en memoria no escalan por configuración.
Se documenta solo para que nadie la vuelva a proponer.

## Qué hay que decidir antes de R0

Cuál de las dos primeras. La decisión cambia:

```text
la forma de la petición
el modelo de seguridad del puente
si bridgeContractVersion sube
qué escribe VideoMesh: un paquete en disco o un flujo
```

**Recomendación: opción 2 para R0–R9 y opción 1 cuando exista una razón medida
para necesitarla.** Empezar por la 2 no cierra la puerta a la 1; empezar por la 1
obliga a tocar seguridad antes de haber leído un solo PLY.

---

# 85. Decisión previa a R0 — un repositorio o dos

El plan añade, según el §70, diecinueve módulos de `reconstruction/`, nueve de
`production/` y una reestructura de `io/`. A la densidad actual del repositorio
eso son entre 10.000 y 20.000 líneas nuevas sobre las 19.565 que hay hoy en
`src/soft/`. **El repositorio se dobla**, y con él las 104 comprobaciones
repartidas en 22 puertas.

Parte de lo que SoftSight vende es que **se puede leer entero**. Un repositorio
que promete «sin dependencias, todo aquí dentro» y pesa 40.000 líneas cumple la
promesa técnica y deja de cumplir la práctica.

La pregunta que hay que responder antes del primer commit:

```text
¿reconstruction/ y production/ viven dentro de softsight,
o son un segundo repositorio que consume su contrato público?
```

Ya existe el precedente: `softsight-motion-editor` consume SoftSight por CLI,
JSON, `--schema` y fixtures, y **pincha el commit** del productor. Nunca importa
módulos internos. Ese patrón funciona y está probado.

Argumentos por cada lado, sin resolverlos aquí:

**Dentro:** comparte `Mesh`, el rasterizador, la tabla de avisos y las puertas.
Sacarlo fuera obliga a publicar como contrato cosas que hoy son internas.

**Fuera:** el núcleo se queda legible; la reconstrucción puede tener sus propias
dependencias —EXR, validador de Khronos— sin tocar la promesa del núcleo; y la
frontera queda comprobada por una puerta en vez de por disciplina.

**No decidirlo es decidir «dentro» por omisión**, y después es una migración con
las puertas ya escritas.

---

# 86. Correcciones al plan tras contraste con el repositorio real

Lo que sigue son doce arreglos sobre este mismo documento, cada uno con la
evidencia que lo provoca. No cambian la dirección del plan: la dirección es
correcta. Cambian afirmaciones que el código desmiente y huecos que el orden de
trabajo no cubre.

## 86.1 — Errores de hecho

**a) El §11 parte de una premisa falsa.**
«No usar objetos JS por vértice» ya está hecho: `src/soft/mesh.ts` define `Mesh`
con `positions: Float32Array`, `indices: Uint32Array`, «layout de vértices
indexado, igual que un buffer de GPU». El item 07 del §72 no es una V2: es añadir
`tangents`, `colors` y `texcoord0` opcionales.

**b) El cuello de botella real no aparece en el plan.**
`auditMesh` no se menciona ni una vez, y es la función que el gate de R2 tiene que
hacer pasar. Dos estructuras la limitan:

```text
src/soft/agent/inspect.ts:69   weldPositions usa Map<string,number>
                               con clave por template literal, por vértice
src/soft/agent/inspect.ts:118  edgeUse es Map<number,number>
```

Con 5.688.422 triángulos son ~2,8M claves de texto y ~8,5M entradas de mapa:
cientos de MB solo en sobrecarga del motor, antes de construir un BVH. `edgeKey`
sí aguanta —empaqueta hasta 2²⁶ vértices, `inspect.ts:55`—; los mapas no.

El propio fichero ya sabe cómo se arregla: `buildPositionGrid` (`inspect.ts:216`)
es «rejilla uniforme en arrays tipados y sin `Map`», con el motivo escrito —el
orden de recorrido es contrato—.

**Reescribir `weldPositions` y `edgeUse` sin `Map` va antes que el BVH en el
§72**, y su gate es medir el techo actual, no elegir el objetivo.

> **Cerrado el 2026-08-12.** Las dos están reescritas y la puerta existe
> (`test:resources`). Esto es el diagnóstico, no el estado: las dos referencias a
> `inspect.ts:69` y `:118` son de la versión con `Map` y ya no señalan a nada. Los
> números y el recorrido están en D25 de
> [`contrato-videomesh.md`](contrato-videomesh.md); el estado, en el §5 punto 19
> del mapa.

**c) Colisión de nombre en el §21.**
`bvh.ts` ya existe con otro significado: `src/soft/agent/bvhLoader.ts` es
Biovision Hierarchy —captura de movimiento— con puerta `test:bvh` y fixture
versionado. Renombrar el nuevo a `boundsTree.ts`.

**d) El §35 rompe lo que el §75 promete.**
Los modos de diagnóstico entran en el rasterizador que tiene puerta de paridad
con el editor —hoy cero píxeles de diferencia en ocho vistas—. El plan debe
declarar: **los modos nuevos quedan fuera de los fixtures de paridad y fuera de
`artifacts/agent/render-hashes.json`.**

**e) Dos dependencias contra la promesa del núcleo.**
El validador de Khronos (§2, §50) y EXR (§17) chocan con «sin GPU y sin
dependencias». EXR no es un formato: son códecs wavelet completos. Regla que
falta: **proveedor externo, fuera de proceso, resultado marcado como medida
externa**; y EXR limitado a scanline sin comprimir y ZIP, con el resto rechazado
por código de error.

## 86.2 — Duplicación de vocabulario

**f) El §27 es un segundo original de algo que ya existe.**
`src/soft/agent/warningCodes.ts` define `WarningSeverity = "certeza" |
"candidato"`, con el motivo escrito, publicado por `--schema` y comprobado en las
dos direcciones contra `src/` por la puerta `test:codes`. Las «exactness classes»
son un eje paralelo que dice casi lo mismo, y dos ejes que casi coinciden
divergen al tercer código.

**Sustituir el §27 por: extender el enum existente** con `aproximacion-determinista`
y `externo`. Mismo campo, misma tabla, misma puerta.

**g) Idioma de los códigos. DECIDIDO el 2026-09-13: todo en español.**
`RECON_LOW_COVERAGE` junto a `BORDE_ABIERTO`, `PIVOTE_DESCENTRADO` y
`MALLA_INVERTIDA` volvía ilegible en dos idiomas la tabla que `test:codes` compara
contra `src/`. La decisión se toma arriba y no código a código, que es lo que esta
sección pedía.

**Qué entra y qué no**, porque «código» y «campo del esquema» no son lo mismo:

```text
entran    el `reason` de los 32 identificadores de frontera
          el `certificationReason` del informe
          los nombres internos de PACKAGE_CODES y las excepciones del lector PLY
no entran los nombres de campo del esquema —`artifacts`, `imageArtifactHash`—
          los valores de enum que VideoMesh escribe: SEALED, TRIANGLE_MESH,
          ABSOLUTE, PASS, COMPLETE, APPROXIMATE, los cuatro marcos
```

Lo segundo no son códigos: son **el vocabulario con el que se escribe un paquete**,
y traducirlo rompería todo manifest existente. Es otra decisión, con otro coste, y
si se quiere se toma aparte.

**No rompe a VideoMesh**, y por una razón escrita en D2 desde el principio: se
parsea el identificador, nunca el mensaje ni el motivo. `SS-CAM-001` sigue siendo
`SS-CAM-001`.

**h) Nueve versiones de contrato y ninguna tabla de compatibilidad. HECHO el
2026-09-13.**
Existían ya `contractVersion` (3), `bridgeContractVersion` (1),
`STORY_AUDIT_CONTRACT_VERSION` y `STAGING_AUDIT_CONTRACT_VERSION`, y el plan
añadía cinco. La regla que faltaba —**el informe declara en un solo bloque todas
las versiones que usó, y una puerta rechaza las combinaciones no declaradas**— es
ahora `src/soft/agent/versions.ts`, `versions.contracts` en el informe y
`contracts/versions.json` generado y commiteado. Eran siete números en cinco
ficheros; queda uno escrito fuera del registro, el del puente, y por un motivo
declarado: `agent3d --serve` importa de él, así que un import cerraría un ciclo.
La puerta lo compara. Ver D12.

**i) El layout del §70 rompe las cuatro identidades.**
`src/soft/*.ts` sin `agent/` es el rasterizador puro, que «no sabe qué es un GLB
ni qué es un aviso». Todo lo que emite avisos es capa 2. Y `glbLoader.ts` y
`objLoader.ts` ya viven en `agent/`: moverlos a `src/soft/io/` no es aditivo, que
es lo que el §75 exige. **Todo bajo `src/soft/agent/reconstruction/` y
`agent/production/`.**

## 86.3 — Huecos técnicos

**j) Falta el veredicto «no se pudo evaluar».**
Los §41, §50 y §77 solo contemplan PASS y FAIL. Un paquete sin cámaras, sin
máscaras o sin depth **no puede dar PASS**. Hace falta `EVIDENCIA_INSUFICIENTE`
como veredicto de primera clase, con su propio código de salida. Ausencia de
evidencia convertida en aprobado es el peor fallo posible de una capa de
certificación, y es el que sale por defecto si nadie lo escribe.

**k) Cobertura muestreada sin declarar el muestreo.**
`observedAreaRatio: 0.967` no significa nada sin número de muestras, sin decir si
está ponderada por área y sin varianza. El §41 pone el umbral en 0,92: un
PASS/FAIL contra un estimador de varianza desconocida es una moneda al aire cerca
del umbral. Falta:

```text
muestreo ponderado por área
N publicado en el informe
si el intervalo cruza el umbral, el veredicto es inconcluso
```

**l) Escala y presupuestos se contradicen. HECHO el 2026-09-13.**
El §58 decía «nunca asumir metros» y daba tres estados. Los §45 y §80 daban
presupuestos en metros. La regla que faltaba —**con `scale != ABSOLUTE` los
presupuestos absolutos se rechazan**, y el fallback es relativo a la diagonal de
la caja envolvente— es ahora `budgets` en el paquete, dos códigos del espacio
`SS-RECON` y `scale.boundingBoxDiagonal` publicado en el informe. Ver D9.

Y lo que faltaba para que la regla tuviera qué rechazar era **un sitio donde
declarar un presupuesto**: sin él la contradicción se colaba entera. R0 solo
comprueba la coherencia; evaluarlos es R9.

Nota adjunta, que sigue abierta: `auditMesh` redondea `signedVolume` con
`.toFixed(6)`, y con escala desconocida eso puede ser el número entero. El
informe ya dice si se permite hablar en absoluto —`claimsAbsolutePrecision`—,
pero el redondeo del volumen no lo mira todavía.

**m) Determinismo con paralelo. ACOTADO el 2026-09-13, con un hallazgo.**
El §57 pide semilla fija y orden estable y no decía nada de la reducción. La
regla —**reducción en orden fijo por índice de bloque**, nunca sobre resultados
según llegan— es ahora la puerta `test:bands`: la misma escena partida en 1, 2, 3
y 4 franjas tiene que dar **el mismo sha256**.

**Al escribirla se destapó que con el suavizado encendido no lo daba, y se
arregló el mismo día.** Medido antes: partir 240×180 en dos bandas cambiaba **15
píxeles, todos en las filas 89 y 90**, que es exactamente la costura. Sin
suavizado, cero diferencias.

**No era que se suavizaran mal: no se suavizaban.** El bucle de la pasada recorre
`y` de 1 a `height - 2` porque el píxel de la primera y la última fila no tiene
vecino arriba o abajo. Con una sola banda eso es correcto —son el borde de la
imagen—; partida en varias, el borde de una banda es el **interior** de la imagen,
y esas filas se caían del bucle.

Cerrado con `bandWithHalo`, en `postprocess.ts` al lado del bucle que lo obliga:
cada banda **renderiza una fila de más por cada lado que tenga vecino** y la
descarta al volcar. La puerta exige ahora igualdad byte a byte **con suavizado y
sin él**, y además que el recuento de píxeles suavizados no dependa del reparto
—1.017 en las cuatro particiones—: si una fila de cortesía se suavizara o se
volcara, se contaría dos veces. Ningún hash congelado se movió.

De paso quedó escrito que `trianglesRasterized` **no es invariante al reparto**
—1576, 1675, 1788 y 1675 con una, dos, tres y cuatro bandas— porque un triángulo
que cruza una costura lo rasterizan las dos. Cuenta envíos por banda, no
triángulos de la escena, y ni siquiera crece con el número de bandas: depende de
dónde caigan las costuras.

Lo que sigue sin existir es la reducción en coma flotante que el hueco teme
—sumar distancias de cobertura sobre millones de muestras—, bloqueada por D34. La
puerta lo declara NOT_RUN con su motivo, y está escrita ahora porque escribirla
después es escribirla sobre el código que ya se equivocó.

**n) `SELF_INTERSECTION_CONFIRMED` no existe en coma flotante. HECHO el 2026-09-13.**
La lección ya estaba escrita en `src/soft/agent/geometryAudit.ts`: `segmentsCross`
es **estricto** a propósito, porque admitir el caso colineal convertiría en aviso
el borde de fuga de cualquier perfil aerodinámico.

**Medido antes de decidir nada.** El determinante de orientación da un valor no
nulo en **884 de 2.200 puntos que están sobre la recta**, con magnitud peor
2,7e-16 respecto al cuadrado de la coordenada. Por debajo de ese suelo su signo
no distingue, así que llamar `certeza` a lo que sale de ahí era una afirmación
más fuerte que la aritmética que la sostiene.

La salida no es `LIKELY` sino la que manda el §86.2 (f): **extender el enum de
severidad**, no abrir un segundo eje. `PERFIL_AUTOINTERSECADO` y
`BARRIDO_AUTOINTERSECADO` pasan a `aproximacion-determinista`, y una entrada con
esa severidad **está obligada a declarar su epsilon** —con respecto a qué y cómo
se midió—; las otras dos lo tienen prohibido, porque un epsilon en un aviso
exacto invita a leerlo como tolerancia.

**Y sigue contando como defecto.** El eje del enum es *medida contra intención*,
no *exacto contra aproximado*: un perfil que se cruza consigo mismo rompe el
recorte de orejas tanto si el determinante se calculó exacto como si no.
Comprobado: el ejemplar de geometría sigue saliendo 0 y un perfil cruzado sigue
saliendo 1.

De paso salió que el criterio vivía como `severity === "certeza"` **dentro del
CLI**, así que añadir un valor al enum habría cambiado el código de salida en
silencio. Ahora es `isDefect`, en la tabla, con su puerta.

`externo`, que esa misma sección nombra, **no entra**: no hay un solo proveedor
externo y un valor que nadie emite es una promesa vacía.

**o) Sin límites de recurso en la ingesta. HECHO el 2026-09-13.**
SoftSight va a leer ficheros producidos por terceros. El §13 lista errores de PLY
—bien— pero no había `maxVertices`, `maxFileSize`, `maxElementCount` ni tope de
cabecera. Un PLY que declare `element vertex 4000000000` reservaba memoria antes
de leer un solo dato.

Los cinco topes viven en `src/soft/agent/reconstruction/limits.ts` con su unidad y
**por qué ese número**, el informe los publica, y el espacio `SS-IO` les da
identificador. El código de salida **23 —límite de recursos— lo reservaba D13 y no
lo devolvía nadie**; ahora lo devuelven los dos lados de la proyección.

Lo que de verdad ataja el caso no es el tope sino **contar filas**: un elemento no
puede declarar más entradas de las que el fichero trae, y eso se decide sin
reservar nada. Medido en la puerta: rechazar una cabecera que promete cinco
millones de vértices en un fichero de tres líneas **hace crecer la memoria de
arrays en 0 bytes**; sin la comprobación reservaba 60 MB y moría con
`TypeError: Cannot read properties of undefined (reading 'split')`, que no dice
nada de lo que pasó.

## 86.4 — Orden de trabajo

**p) El §71 es horizontal; falta una rebanada vertical temprana.**
La integración con VideoMesh solo se demuestra en R9/R15, tras unos cincuenta
items. Si el contrato está mal, se descubre al final. **Insertar R1.5**: un cubo
PLY, cuatro cámaras sintéticas, informe mínimo y PASS/FAIL, recorriendo el camino
entero. Poco trabajo, y valida el contrato antes de construir encima.

**q) El §82 congela un contrato contra un productor que aún no existe. HECHO en su
mitad barata, el 2026-09-13.**
Congelar antes de que VideoMesh haya entregado un paquete real produce contratos
que nadie puede cumplir. **Subir `ColmapAdapter` (§18) de «opcional» a fuente de
fixtures de R0**: COLMAP produce datos reales hoy, gratis, sin esperar a nadie.
El contrato se congela cuando **dos productores distintos** lo han llenado.

**Los datos reales ya están**, en `colmap-real-v1`: dos escenas, 228 imágenes,
104.702 puntos y el 77 % de las observaciones sin triangular, con el error de
reproyección que calculamos coincidiendo con el que COLMAP declara hasta la
quinta cifra. Ver D4.

Lo que **sigue faltando** para congelar el contrato es el segundo productor de
paquetes, que es otra cosa: COLMAP llena el CameraSet, no escribe un
`ReconstructionManifest`. Eso es R0-B.

**r) El editor no aparece en el plan.**
`softsight-motion-editor` pincha el commit de SoftSight y tiene dos puertas
cruzadas. Cada item que toque el informe o el rasterizador debe declarar si mueve
`contractVersion` y si obliga a subir el pin.

**s) Contradicción menor.** El §3.3 pone USD en P2 y el §74 lo pone en «no
implementar pronto». Un veredicto, no dos.

## 86.5 — Lo que no hay que tocar

Estas partes del plan son correctas y están alineadas con cómo piensa el
repositorio. No se renegocian:

```text
§2   la tabla de ownership y «SoftSight no reconstruye»
§31  RECONSTRUCTED != INFERRED
§43  clasificación de reparación SAFE/REVIEW/UNSAFE
§53  todo aviso importante lleva evidencia
§54  AUDIT GEOMETRY != PREVIEW GEOMETRY, con renderSource publicado
§55  caché por hash de contenido + versión + parámetros, nunca por mtime
§59  nunca transformar el sistema de coordenadas en silencio
§60  pruebas de normalización de cámara como P0
Riesgos D y E
```

El §43 y el Riesgo D son, además, **la misma frontera que el repositorio ya
aplica**: hoy `PIVOTE_DESCENTRADO` es `candidato` y no `certeza` porque la medida
es exacta pero la conclusión supone que la pieza va a rotar, y eso es intención.
El plan extiende esa disciplina en vez de contradecirla. Ésa es la razón por la
que la dirección es correcta.
