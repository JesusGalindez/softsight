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

**g) Idioma de los códigos.**
`RECON_LOW_COVERAGE` junto a `BORDE_ABIERTO`, `PIVOTE_DESCENTRADO` y
`MALLA_INVERTIDA`. La tabla que `test:codes` compara contra `src/` se vuelve
ilegible en dos idiomas. **Decidirlo arriba del documento**, no código a código.
Afecta a VideoMesh, que es quien los va a leer.

**h) Nueve versiones de contrato y ninguna tabla de compatibilidad.**
Existen ya `contractVersion` (hoy 3), `bridgeContractVersion` (1),
`STORY_AUDIT_CONTRACT_VERSION` y `STAGING_AUDIT_CONTRACT_VERSION`. El plan añade
cinco. Regla que falta: **el informe declara en un solo bloque todas las
versiones que usó, y una puerta rechaza las combinaciones no declaradas.**

**i) El layout del §70 rompe las cuatro identidades.**
`src/soft/*.ts` sin `agent/` es el rasterizador puro, que «no sabe qué es un GLB
ni qué es un aviso». Todo lo que emite avisos es capa 2. Y `glbLoader.ts` y
`objLoader.ts` ya viven en `agent/`: moverlos a `src/soft/io/` no es aditivo, que
es lo que el §75 exige. **Todo bajo `src/soft/agent/reconstruction/` y
`agent/production/`.**

## 86.3 — Huecos técnicos

**j) Falta el veredicto «no se pudo evaluar».**
Los §41, §50 y §77 solo contemplan PASS y FAIL. Un paquete sin cámaras, sin
máscaras o sin depth **no puede dar PASS**. Hace falta `INSUFFICIENT_EVIDENCE`
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

**l) Escala y presupuestos se contradicen.**
El §58 dice «nunca asumir metros» y da tres estados. Los §45 y §80 dan
presupuestos en metros. Falta la regla: **con `scale != ABSOLUTE` los
presupuestos absolutos se rechazan**, y el fallback es relativo a la diagonal de
la caja envolvente. Nota adjunta: `auditMesh` ya redondea `signedVolume` con
`.toFixed(6)`; con escala desconocida eso puede ser el número entero.

**m) Determinismo con paralelo, sin resolver.**
El §57 pide semilla fija y orden estable, y no dice nada de la reducción. El
repositorio ya rasteriza por bandas (`src/soft/parallel.ts`) y comprueba
determinismo en dos sistemas. Sumar distancias sobre millones de muestras en
paralelo da un resultado distinto según el orden en que terminen los workers.
Regla que falta: **reducción en orden fijo por índice de bloque**, nunca sobre
resultados según llegan.

**n) `SELF_INTERSECTION_CONFIRMED` no existe en coma flotante.**
La lección ya está escrita en `src/soft/agent/geometryAudit.ts`: `segmentsCross`
es **estricto** a propósito, porque admitir el caso colineal convertiría en aviso
el borde de fuga de cualquier perfil aerodinámico. Un test triángulo/triángulo
con epsilon sigue siendo candidato. O predicados exactos, o el estado se llama
`LIKELY` y publica su epsilon.

**o) Sin límites de recurso en la ingesta.**
SoftSight va a leer ficheros producidos por terceros. El §13 lista errores de PLY
—bien— pero no hay `maxVertices`, `maxFileSize`, `maxElementCount` ni tope de
cabecera. Un PLY que declare `element vertex 4000000000` reserva memoria antes de
leer un solo dato.

## 86.4 — Orden de trabajo

**p) El §71 es horizontal; falta una rebanada vertical temprana.**
La integración con VideoMesh solo se demuestra en R9/R15, tras unos cincuenta
items. Si el contrato está mal, se descubre al final. **Insertar R1.5**: un cubo
PLY, cuatro cámaras sintéticas, informe mínimo y PASS/FAIL, recorriendo el camino
entero. Poco trabajo, y valida el contrato antes de construir encima.

**q) El §82 congela un contrato contra un productor que aún no existe.**
Congelar antes de que VideoMesh haya entregado un paquete real produce contratos
que nadie puede cumplir. **Subir `ColmapAdapter` (§18) de «opcional» a fuente de
fixtures de R0**: COLMAP produce datos reales hoy, gratis, sin esperar a nadie.
El contrato se congela cuando **dos productores distintos** lo han llenado.

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
