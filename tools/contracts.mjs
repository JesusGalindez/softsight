/**
 * La frontera pública, en JSON Schema, generada del esquema en ejecución.
 *
 * D15 del contrato con VideoMesh reparte así la autoridad: el esquema que valida
 * en ejecución —`src/soft/agent/schema.ts`— es el original, `contracts/*.schema.json`
 * es su traducción commiteada, y los modelos del otro lado se derivan de ahí. El
 * JSON Schema **nunca se escribe a mano**: escrito a mano es un segundo original
 * de la forma de los datos, y diverge en el primer campo que alguien añada.
 *
 * Se commitea aunque sea generado porque es lo que otro repositorio lee sin
 * ejecutar este: un fichero que solo existe tras un build no es una frontera.
 * Que el commiteado y el generado coincidan lo comprueba `--check`, igual que
 * `agents-md.mjs`.
 *
 *   node tools/contracts.mjs            reescribe contracts/*.schema.json
 *   node tools/contracts.mjs --check    sale 1 si alguno no está al día
 *
 * Necesita `dist-node/agent3d.mjs` construido.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PATCH_SCHEMA,
  SAMPLE_REFERENCE_SCHEMA,
  SCENE_SCHEMA,
  STAGING_SCHEMA,
  STORY_SCHEMA,
  toJsonSchema,
} from "../dist-node/agent3d.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const CONTRACTS = resolve(projectRoot, "contracts");

/**
 * Los cinco esquemas que hoy son frontera: los que un agente de fuera necesita
 * para escribir una entrada válida. Lo que no se publica aquí no es frontera, y
 * añadirlo a esta lista es la decisión de que pase a serlo.
 */
export const PUBLISHED = {
  scene: SCENE_SCHEMA,
  patch: PATCH_SCHEMA,
  story: STORY_SCHEMA,
  staging: STAGING_SCHEMA,
  "sample-reference": SAMPLE_REFERENCE_SCHEMA,
};

/** El documento tal y como se commitea: con salto final, para que `diff` no chille. */
function render(name) {
  return `${JSON.stringify(
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: `https://github.com/JesusGalindez/softsight/contracts/${name}.schema.json`,
      // Sin número de versión propio: el contrato está en DRAFT (D26) y una
      // versión aquí sería un tercer sitio donde llevar la cuenta. La identidad
      // del esquema la dará su hash cuando D16 se implemente.
      title: name,
      ...toJsonSchema(PUBLISHED[name]),
    },
    null,
    2,
  )}\n`;
}

const check = process.argv.includes("--check");
mkdirSync(CONTRACTS, { recursive: true });

const stale = [];
for (const name of Object.keys(PUBLISHED)) {
  const target = resolve(CONTRACTS, `${name}.schema.json`);
  const generated = render(name);
  let current = null;
  try {
    current = readFileSync(target, "utf8");
  } catch {
    current = null;
  }
  if (check) {
    if (current !== generated) stale.push(name);
  } else if (current !== generated) {
    writeFileSync(target, generated);
  }
}

// Un esquema que se deja de publicar tiene que desaparecer del directorio: si se
// queda, otro repositorio sigue leyendo una frontera que ya no existe.
const extra = readdirSync(CONTRACTS)
  .filter((file) => file.endsWith(".schema.json"))
  .map((file) => file.replace(".schema.json", ""))
  .filter((name) => PUBLISHED[name] === undefined);

if (check) {
  if (stale.length > 0 || extra.length > 0) {
    process.stderr.write(
      `contracts: no está al día — ${[...stale, ...extra.map((name) => `${name} sobra`)].join(", ")}; ` +
        "regenéralo con `node tools/contracts.mjs`.\n",
    );
    process.exit(1);
  }
  console.log(`contratos: ok (${Object.keys(PUBLISHED).length} esquemas publicados al día)`);
} else {
  console.log(
    `contratos: reescritos (${Object.keys(PUBLISHED).length} esquemas en contracts/)${
      extra.length > 0 ? `; sobran ${extra.join(", ")}` : ""
    }`,
  );
}
