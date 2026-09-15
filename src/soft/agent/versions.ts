/**
 * Todas las versiones de contrato del repositorio, en un sitio.
 *
 * Eran siete números repartidos por cinco ficheros —`REPORT_CONTRACT_VERSION` en
 * el CLI, `BRIDGE_CONTRACT_VERSION` en el puente, dos auditorías, la animación y
 * las dos del paquete de reconstrucción— **y ninguna tabla que dijera cuáles van
 * juntas**. D12 lo dice al revés de como estaba: «el consumidor comprueba el
 * bloque, no un campo».
 *
 * El problema de tenerlos sueltos no es la estética. Un consumidor que compruebe
 * `contractVersion === 3` no se entera de que la auditoría de puesta en escena
 * cambió debajo, porque esa lleva su propio número y nadie los relaciona. Con el
 * bloque, lo que se compara es **la combinación**, y una combinación que nadie ha
 * declarado no se acepta.
 *
 * ## Qué es y qué no es una versión de aquí
 *
 * Es la versión de **un documento o un protocolo que cruza una frontera**: lo que
 * otro repositorio lee y contra lo que escribe sus modelos. La versión del
 * paquete `npm` no es eso y no está aquí.
 *
 * ## Cómo se sube una
 *
 * Se cambia el número aquí y se regenera `contracts/versions.json`, que es la
 * lista de combinaciones admitidas. Si solo se cambia el número, la puerta se
 * pone roja: subir una versión sin declarar la combinación nueva es exactamente
 * lo que esto existe para impedir.
 */

export interface ContractVersion {
  /** El número. Texto en las de reconstrucción porque su contrato es `0.x` (D26). */
  value: number | string;
  /** Qué documento o protocolo versiona. */
  governs: string;
  /** Quién lo lee del otro lado, que es quien paga un cambio no declarado. */
  consumer: string;
}

export const CONTRACT_VERSIONS = {
  report: {
    value: 3,
    governs: "el informe de escena que produce agent3d",
    consumer: "softsight-motion-editor, que fija el commit y compara hashes",
  },
  bridge: {
    value: 2,
    governs: "la petición y la respuesta del puente local",
    consumer: "softsight-motion-editor, por softsight-adapter.ts",
  },
  animationAudit: {
    value: 1,
    governs: "la auditoría de animación publicada en el informe",
    consumer: "softsight-motion-editor",
  },
  storyAudit: {
    value: 1,
    governs: "la auditoría de guion",
    consumer: "softsight-motion-editor, por el contrato de roles",
  },
  stagingAudit: {
    value: 1,
    governs: "la auditoría de puesta en escena",
    consumer: "softsight-motion-editor",
  },
  reconstructionPackage: {
    value: "0.1",
    governs: "el paquete de reconstrucción que entra",
    consumer: "VideoMesh, que lo escribe",
  },
  reconstructionReport: {
    // 0.1 → 0.2 el 2026-09-14. **El documento cambió seis veces y el número se
    // había quedado quieto**, que es exactamente lo que D12 existe para impedir:
    // quien compara la combinación creía estar leyendo el informe de agosto.
    //
    // Lo que entró desde entonces: cinco bloques nuevos —`coverage`,
    // `confidence`, `captureAdvice`, `budgets`, `repairBoundary`—, un campo
    // requerido nuevo (`coverage.maskedCameras`) y un enum **estrechado**
    // (`measurementClass`, que en tres sitios aceptaba cualquier cadena). El
    // último es el que rompe de verdad: un consumidor que emitiera otro valor
    // validaba ayer y no valida hoy.
    //
    // El paquete de entrada **no sube**: su esquema no ha cambiado. Subirlo por
    // acompañar obligaría a VideoMesh a regenerar modelos que están bien.
    value: "0.2",
    governs: "el informe de reconstrucción que sale",
    consumer: "VideoMesh, que lo lee",
  },
} as const satisfies Record<string, ContractVersion>;

export type ContractVersionName = keyof typeof CONTRACT_VERSIONS;

/**
 * La combinación vigente: qué versión lleva cada contrato ahora mismo.
 *
 * Es lo que un informe declara y lo que la puerta compara contra las
 * combinaciones admitidas. Derivada de la tabla y no escrita al lado, por lo de
 * siempre: una copia diverge en el primer número que se suba.
 */
export const CURRENT_VERSION_PAIRS: ReadonlyArray<{ name: string; value: number | string }> =
  Object.entries(CONTRACT_VERSIONS)
    .map(([name, entry]) => ({ name, value: entry.value as number | string }))
    // Ordenada por nombre: el informe tiene que ser idéntico byte a byte entre
    // dos ejecuciones, y el orden de `Object.entries` es el de escritura de la
    // tabla, que cambia cuando alguien la reordena.
    .sort((a, b) => (a.name < b.name ? -1 : 1));

/** La tabla como lista, para publicarla con su porqué. */
export const CONTRACT_VERSION_LIST = Object.entries(CONTRACT_VERSIONS).map(([name, entry]) => ({
  name,
  ...entry,
}));

/**
 * Si una combinación es una de las admitidas.
 *
 * Compara el conjunto entero y no campo a campo: dos versiones que por separado
 * existen pueden no haberse visto nunca juntas, y es justo ahí donde un
 * consumidor se rompe sin que nadie sepa por qué.
 */
export function isDeclaredVersionSet(
  candidate: ReadonlyArray<{ name: string; value: number | string }>,
  declared: ReadonlyArray<ReadonlyArray<{ name: string; value: number | string }>>,
): boolean {
  const canonical = (set: ReadonlyArray<{ name: string; value: number | string }>): string =>
    JSON.stringify([...set].sort((a, b) => (a.name < b.name ? -1 : 1)).map((entry) => [entry.name, entry.value]));
  const wanted = canonical(candidate);
  return declared.some((set) => canonical(set) === wanted);
}
