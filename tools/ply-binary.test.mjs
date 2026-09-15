/**
 * Puerta del lector de PLY binario — ítem 10 del §72.
 *
 * Lo que puede salir mal aquí no es que el binario falle: es que **funcione y
 * diga otra cosa**. Dos lectores del mismo formato son dos verdades sobre el
 * mismo fichero en cuanto discrepan en un bit, y el que discrepa se descubre
 * cuando una cobertura sale distinta y nadie sabe por qué.
 *
 * Así que el bloque 1 es el único que de verdad importa y se comprueba de la
 * forma más fuerte que hay: **byte a byte sobre los arrays**, no comparando
 * recuentos. Dos mallas con los mismos 5.016 vértices en otro orden tienen el
 * mismo recuento y no son la misma malla.
 *
 * Y el bloque 4 es el que impide que el ahorro se cobre en silencio: un fichero
 * de texto truncado se detecta contando filas, sin tocar memoria; uno binario
 * solo se nota al llegar al final. Sin comprobar cada lectura, un `dense.ply`
 * cortado por una copia a medias devolvería vértices en cero.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parsePly,
  parsePlyAscii,
  parsePlyBinary,
  serializePlyMesh,
  serializePlyMeshBinary,
} from "../dist-node/agent3d.mjs";
import { writeCubePackage } from "./cubeV1.mjs";
import { spherifiedCube } from "./productionAsset.mjs";

const sandbox = mkdtempSync(join(tmpdir(), "softsight-ply-"));
const raiz = join(sandbox, "cube-v1");
writeCubePackage(raiz);
const manifest = JSON.parse(readFileSync(join(raiz, "manifest.json"), "utf8"));
const artifactMalla = manifest.artifacts.find((artifact) => artifact.type === "TRIANGLE_MESH");
const texto = readFileSync(join(raiz, artifactMalla.path), "utf8");

// 1. Los dos caminos, la misma malla bit a bit.
{
  const desdeTexto = parsePlyAscii(texto).mesh;
  const binario = serializePlyMeshBinary(desdeTexto);
  const desdeBytes = parsePlyBinary(binario).mesh;

  const crudo = (array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  assert.equal(
    Buffer.compare(crudo(desdeTexto.positions), crudo(desdeBytes.positions)),
    0,
    "las posiciones tienen que salir idénticas, no parecidas",
  );
  assert.equal(Buffer.compare(crudo(desdeTexto.indices), crudo(desdeBytes.indices)), 0);

  // Que el recuento coincida no prueba nada por sí solo, y por eso va después:
  // está para que el fallo diga «hay 12 triángulos y salen 11» antes de que haya
  // que leerse un diff de bytes.
  assert.equal(desdeBytes.indices.length / 3, desdeTexto.indices.length / 3);

  console.log(
    `ply: ok (${desdeTexto.positions.length / 3} vértices y ${desdeTexto.indices.length / 3} triángulos ` +
      "idénticos byte a byte por los dos caminos: es lo único que impide que haya dos verdades sobre el " +
      "mismo fichero)",
  );
}

// 2. La puerta única elige por lo que el fichero declara, no por su nombre.
{
  const malla = parsePlyAscii(texto).mesh;
  const comoTexto = Buffer.from(serializePlyMesh(malla), "utf8");
  const comoBytes = serializePlyMeshBinary(malla);

  const uno = parsePly(comoTexto).mesh;
  const dos = parsePly(comoBytes).mesh;
  const crudo = (array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  assert.equal(Buffer.compare(crudo(uno.positions), crudo(dos.positions)), 0);
  assert.equal(Buffer.compare(crudo(uno.indices), crudo(dos.indices)), 0);

  // Ninguno de los dos ficheros tiene extensión ni nombre: lo único que los
  // distingue es la línea `format`, que es lo que se está comprobando.
  // `serializePlyMeshBinary` devuelve `Uint8Array`, no `Buffer`: sin envolverlo,
  // `toString` es el de `Array` y devuelve la lista de números separada por comas.
  assert.match(comoTexto.toString("utf8", 0, 32), /format ascii/);
  assert.match(Buffer.from(comoBytes).toString("latin1", 0, 48), /format binary_little_endian/);

  console.log(
    `ply: ok (parsePly da la misma malla con los dos, y elige por la línea 'format': un .ply no dice en ` +
      "su nombre cómo está escrito, y COLMAP escribe los dos)",
  );
}

// 3. El ahorro, y dónde **no** lo hay.
//
// El cubo de juguete sale más grande en binario, y no es un fallo: sus
// coordenadas son `-0.5`, que ocupa cuatro caracteres y cuatro bytes, y sus
// índices son de una cifra. El binario gana cuando los números tienen decimales,
// que es exactamente lo que produce una reconstrucción y nunca un fixture escrito
// a mano. Medir solo el cubo habría dado la conclusión contraria a la verdadera.
{
  const juguete = parsePlyAscii(texto).mesh;
  const juguetePlano = Buffer.from(serializePlyMesh(juguete), "utf8").length;
  const jugueteBinario = serializePlyMeshBinary(juguete).length;

  const real = spherifiedCube(16);
  const realPlano = Buffer.from(serializePlyMesh(real), "utf8").length;
  const realBinario = serializePlyMeshBinary(real).length;

  assert.ok(jugueteBinario > juguetePlano, "con `-0.5` y un dígito, el binario no tiene nada que ahorrar");
  assert.ok(
    realBinario < realPlano / 2,
    `con coordenadas de verdad tiene que bajar de la mitad: ${realBinario} contra ${realPlano}`,
  );

  // Y el ahorro no cuesta precisión: los dos caminos siguen dando lo mismo sobre
  // la malla que sí tiene decimales, que es donde un `float32` mal leído se vería.
  const crudo = (array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  const ida = parsePlyBinary(serializePlyMeshBinary(real)).mesh;
  assert.equal(Buffer.compare(crudo(real.positions), crudo(ida.positions)), 0);

  console.log(
    `ply: ok (el cubo de juguete **crece** en binario —${jugueteBinario} contra ${juguetePlano} bytes, ` +
      `porque '-0.5' ocupa lo mismo escrito que codificado—, y una malla con decimales de verdad baja a ` +
      `${realBinario} de ${realPlano}, el ${((100 * realBinario) / realPlano).toFixed(0)} %, sin perder un bit)`,
  );
}

// 4. Un binario truncado se dice, no se rellena con ceros.
{
  const malla = parsePlyAscii(texto).mesh;
  const completo = serializePlyMeshBinary(malla);

  // Cortado por la mitad del cuerpo: la cabecera sigue prometiendo todo.
  const cortado = completo.slice(0, completo.length - 40);
  assert.throws(
    () => parsePlyBinary(cortado),
    /PLY_TRUNCADO/,
    "un fichero a medias tiene que decirlo, no devolver vértices en cero",
  );

  // Y uno cortado justo después de la cabecera, que es el caso de una copia que
  // no llegó a empezar el cuerpo.
  const soloCabecera = completo.slice(0, Buffer.from(completo).indexOf("end_header\n") + 11);
  assert.throws(() => parsePlyBinary(soloCabecera), /PLY_TRUNCADO/);

  console.log(
    "ply: ok (un binario truncado sale por PLY_TRUNCADO y no con vértices en cero: el ASCII lo detecta " +
      "contando filas y el binario solo al llegar al final, así que cada lectura comprueba lo que le queda)",
  );
}

// 5. Lo que no se sabe leer se rechaza **por su nombre**.
{
  const malla = parsePlyAscii(texto).mesh;
  const bytes = serializePlyMeshBinary(malla);
  const grande = Buffer.from(bytes);  // copia: se le va a reescribir la cabecera
  // El mismo fichero declarándose big endian. Soportarlo cuesta un booleano y no
  // se hace: no hay ningún fichero así con el que comprobarlo, y código que nadie
  // ha ejecutado es peor que una ausencia declarada.
  const cabecera = grande.toString("latin1", 0, 64).replace("binary_little_endian", "binary_big_endian___");
  grande.write(cabecera, 0, "latin1");
  assert.throws(() => parsePly(grande), /FORMATO_PLY_NO_SOPORTADO/);

  // Y quien llame al lector equivocado se entera de que se equivocó de puerta,
  // no de que el fichero está roto.
  assert.throws(() => parsePlyAscii(Buffer.from(bytes).toString("latin1")), /FORMATO_PLY_NO_SOPORTADO/);
  assert.throws(() => parsePlyBinary(Buffer.from(serializePlyMesh(malla), "utf8")), /FORMATO_PLY_NO_SOPORTADO/);

  console.log(
    "ply: ok (big endian rechazado por su nombre, y llamar al lector equivocado dice «no lo entiendo» y " +
      "no «está roto»: quien lo recibe tiene que poder distinguirlos)",
  );
}

// 6. Una nube de puntos binaria sigue sin ser una malla.
{
  const puntos = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) };
  const sinCaras = serializePlyMeshBinary({ positions: puntos.positions, indices: new Uint32Array(0) });
  const leido = parsePlyBinary(sinCaras);
  // `element face 0` **no** es lo mismo que no declararlo: el primero dice «esto
  // es una malla y no tiene superficie», que es un paquete que se contradice.
  assert.notEqual(leido.mesh, null, "declarar cero caras es declarar una malla vacía");
  assert.equal(leido.mesh.indices.length, 0);
  assert.equal(leido.points.positions.length, 9);

  console.log(
    "ply: ok (un binario con `element face 0` devuelve malla vacía y no nube: declarar cero caras y no " +
      "declarar caras son dos afirmaciones distintas, como en el ASCII)",
  );
}

rmSync(sandbox, { recursive: true, force: true });

console.log(
  "ply: no ejecutada — sobre un binario **real** no se prueba: los dos productores de la casa escriben " +
    "ASCII, y el fixture de COLMAP trae `points3D.txt`, no un `dense.ply`. Lo que falta es el fichero, " +
    "no el camino",
);
