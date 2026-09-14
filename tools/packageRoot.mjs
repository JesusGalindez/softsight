/**
 * Qué rutas puede leer el puente, y quién lo decide.
 *
 * Hasta R15 el puente recibía los ficheros **dentro del JSON**, en base64. Para
 * un GLB de dos megas eso es correcto y no tiene alternativa mejor: el navegador
 * no tiene rutas que ofrecer. Para un paquete de reconstrucción no funciona, y
 * no por poco:
 *
 * ```text
 * dense.ply           ~150 MB binario  →  ~200 MB en base64
 * evidence/depth/     233 EXR
 * evidence/normals/   233 EXR
 * ```
 *
 * El tope por fichero son 256 MB **ya en base64** y el timeout son 120 s. Subir
 * los números no arregla nada: base64 en memoria y un proceso por petición no
 * escalan por configuración. Lo que hace falta es no mover los bytes — el
 * paquete ya está en un disco que las dos partes ven, así que viaja **la ruta**.
 *
 * ## Y eso es un cambio del modelo de seguridad, no un parámetro
 *
 * El puente de v1 no podía leer nada que no le hubieran dado: su sandbox era un
 * directorio temporal por petición y los nombres eran planos y validados. Aceptar
 * una ruta es aceptar leer disco del anfitrión, y ahí una petición maliciosa pide
 * `/Users/alguien/.ssh/id_ed25519` y el puente se lo manda en la respuesta.
 *
 * Las cinco reglas que lo impiden, y la primera es la que sostiene a las otras
 * cuatro:
 *
 * ```text
 * 1  la raíz permitida la declara la CONFIGURACIÓN, nunca la petición
 * 2  resolución con realpath en los dos lados antes de comparar
 * 3  comprobación de prefijo por COMPONENTES, no por cadena
 * 4  ningún `..` en ningún componente de lo que pide el cliente
 * 5  lectura solamente
 * ```
 *
 * La 1 es la que importa: si la raíz viniera en la petición, las otras cuatro
 * serían decorado —cualquiera declararía `/` como su raíz y pasaría—. Sin
 * `SOFTSIGHT_PACKAGE_ROOTS` en el entorno del proceso, **ninguna ruta es
 * legible** y los comandos de paquete fallan con `package-root-not-configured`
 * en vez de con un fallo de lectura, que es lo que distingue «no está permitido»
 * de «no existe».
 *
 * La 3 no es pedantería. `/datos/paquetes` como prefijo de cadena deja pasar
 * `/datos/paquetes-de-otro`, que es un directorio distinto y ajeno. Comparar por
 * componentes no tiene ese agujero.
 *
 * La 2 va **después** de la 4 y no en su lugar: `..` se rechaza aunque realpath
 * fuera a resolverlo dentro de la raíz, porque una petición que lo trae está
 * navegando y eso se dice, no se corrige en silencio.
 */

import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

/** La variable es plural y va separada por `:`, como PATH. */
export const ROOTS_VARIABLE = "SOFTSIGHT_PACKAGE_ROOTS";

export class PackageRootError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Las raíces declaradas, ya resueltas. Se leen del entorno en cada llamada y no
 * se cachean en un módulo: un proceso residente (`--serve`) vive horas, y una
 * raíz que se retira del entorno tiene que dejar de valer sin reiniciarlo.
 *
 * Una raíz que no existe **se descarta con su motivo** en vez de hacer fallar
 * todas: quien declara tres discos y desmonta uno sigue pudiendo usar los otros.
 */
export function declaredRoots(environment = process.env) {
  const raw = environment[ROOTS_VARIABLE] ?? "";
  const roots = [];
  for (const entry of raw.split(":")) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    if (!isAbsolute(trimmed)) continue; // una raíz relativa depende del cwd del proceso: no es una declaración
    if (!existsSync(trimmed)) continue;
    roots.push(realpathSync(trimmed));
  }
  return roots;
}

/** `hijo` cae dentro de `raiz`, comparando **componentes** y no cadenas. */
function isInside(root, candidate) {
  if (candidate === root) return true;
  return candidate.startsWith(root.endsWith(sep) ? root : root + sep);
}

/**
 * Resuelve una ruta pedida por el cliente contra las raíces declaradas y
 * devuelve la ruta real. Lanza `PackageRootError` con un código que distingue
 * los cuatro motivos, porque quien llama necesita saber cuál de ellos fue:
 * configurar el servidor, arreglar la petición o dejar de intentarlo.
 */
export function resolveUnderRoots(requested, environment = process.env) {
  if (typeof requested !== "string" || requested.length === 0) {
    throw new PackageRootError("invalid-request", "la ruta del paquete debe ser una cadena no vacía");
  }
  // Regla 4, antes que nada: un `..` se rechaza aunque resolviera dentro.
  if (requested.split(/[/\\]/).includes("..")) {
    throw new PackageRootError("package-path-escapes", `la ruta no puede traer '..': ${requested}`);
  }
  const roots = declaredRoots(environment);
  if (roots.length === 0) {
    throw new PackageRootError(
      "package-root-not-configured",
      `no hay raíz declarada: define ${ROOTS_VARIABLE} con los directorios que este proceso puede leer`,
    );
  }
  const absolute = resolve(requested);
  if (!existsSync(absolute)) {
    throw new PackageRootError("package-not-found", `no existe: ${requested}`);
  }
  // Regla 2: realpath **después** de existir, para que un enlace simbólico que
  // apunta fuera se vea como lo que es en vez de como su nombre.
  const real = realpathSync(absolute);
  for (const root of roots) {
    if (isInside(root, real)) return real;
  }
  throw new PackageRootError(
    "package-path-escapes",
    `${requested} no cae bajo ninguna raíz declarada en ${ROOTS_VARIABLE}`,
  );
}
