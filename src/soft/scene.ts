/**
 * Escena de demostración. Cada objeto está elegido para exhibir una propiedad
 * concreta del pipeline:
 *
 *   - suelo con 2 triángulos gigantes -> corrección de perspectiva
 *   - columnata en fuga hacia el horizonte -> punto de fuga y divide por w
 *   - esfera y toro -> interpolación de normales y sombreado por píxel
 *   - caja que atraviesa el plano cercano -> recortado homogéneo
 */

import { identity, mat4, multiply, rotationX, rotationY, scaling, translation, type Mat4 } from "./math";
import { createBox, createPlane, createSphere, createTorus, type Mesh } from "./mesh";
import type { Material, SceneNode } from "./renderer";

const meshes = {
  ground: createPlane(60, 1),
  box: createBox(1, 1, 1),
  sphere: createSphere(1, 40, 20),
  torus: createTorus(1, 0.32, 56, 28),
} satisfies Record<string, Mesh>;

/**
 * `checkerTileWorldSize` es el lado de una casilla en unidades de mundo, que el
 * sombreado necesita para saber cuándo la casilla cae por debajo de un píxel y
 * hay que fundirla hacia la media en vez de muestrearla (ver shading.ts). Se
 * deduce de la parametrización: casilla = (extensión en mundo del rango UV) /
 * checkerScale.
 */
function material(
  albedo: [number, number, number],
  specular = 0.35,
  shininess = 48,
  checker = false,
  checkerScale = 8,
  checkerTileWorldSize = 1,
): Material {
  return { albedo, specular, shininess, checker, checkerScale, checkerTileWorldSize };
}

export interface AnimatedNode extends SceneNode {
  update: (time: number, model: Mat4) => void;
}

// Matrices de trabajo compartidas: la escena se recompone cada frame y asignar
// aquí sería basura para el recolector en el bucle más caliente del programa.
const scratchA = mat4();
const scratchB = mat4();
const scratchC = mat4();

function composeTransform(
  out: Mat4,
  x: number,
  y: number,
  z: number,
  rotationYAngle: number,
  rotationXAngle: number,
  scale: number,
): void {
  multiply(rotationY(rotationYAngle, scratchA), rotationX(rotationXAngle, scratchB), out);
  multiply(out, scaling(scale, scale, scale, scratchA), scratchB);
  multiply(translation(x, y, z, scratchA), scratchB, out);
}

export function createScene(): AnimatedNode[] {
  const nodes: AnimatedNode[] = [];

  nodes.push({
    mesh: meshes.ground,
    model: identity(mat4()),
    material: material([0.32, 0.36, 0.42], 0.08, 12, true, 30, 2),
    // Recibe sombra pero no la proyecta: si entrara en el ajuste del volumen de la
    // luz, sus 60×60 unidades dejarían a los objetos en unos pocos téxeles.
    castsShadow: false,
    update: () => {},
  });

  nodes.push({
    mesh: meshes.torus,
    model: mat4(),
    material: material([0.95, 0.45, 0.2], 0.6, 96),
    update: (time, model) => {
      composeTransform(model, 0, 1.35, 0, time * 0.6, time * 0.35, 1);
    },
  });

  nodes.push({
    mesh: meshes.sphere,
    model: mat4(),
    material: material([0.25, 0.7, 0.95], 0.75, 140, true, 6, 0.6),
    update: (time, model) => {
      composeTransform(model, -2.8, 0.9 + Math.sin(time * 1.4) * 0.35, 1.2, time * 0.4, 0, 0.9);
    },
  });

  // Columnata: pares de cajas alejándose en Z. Las líneas de fuga convergen en
  // el punto principal de la imagen, no en "el centro de la pantalla" — solo
  // coinciden porque esta cámara mira a lo largo del eje de la columnata.
  for (let index = 0; index < 9; index += 1) {
    const distance = -2 - index * 3.4;
    const height = 1.6 + (index % 3) * 0.5;
    for (const side of [-1, 1] as const) {
      nodes.push({
        mesh: meshes.box,
        model: mat4(),
        material: material(
          side < 0 ? [0.8, 0.82, 0.86] : [0.55, 0.6, 0.68],
          0.25,
          32,
          index % 2 === 0,
          3,
          0.33,
        ),
        update: (_time, model) => {
          multiply(
            translation(side * 3.2, height / 2, distance, scratchA),
            scaling(0.7, height, 0.7, scratchC),
            model,
          );
        },
      });
    }
  }

  // Caja que orbita cruzando el plano de la cámara: sin recorte en espacio
  // homogéneo, este objeto es el que revienta la imagen.
  nodes.push({
    mesh: meshes.box,
    model: mat4(),
    material: material([0.9, 0.85, 0.3], 0.5, 64),
    update: (time, model) => {
      const angle = time * 0.5;
      composeTransform(
        model,
        Math.cos(angle) * 5.5,
        1.1,
        6.5 + Math.sin(angle) * 5.5,
        angle * 2,
        angle,
        0.85,
      );
    },
  });

  return nodes;
}

export function updateScene(nodes: readonly AnimatedNode[], time: number): void {
  for (const node of nodes) node.update(time, node.model);
}

export function countTriangles(nodes: readonly SceneNode[]): number {
  return nodes.reduce((total, node) => total + node.mesh.indices.length / 3, 0);
}
