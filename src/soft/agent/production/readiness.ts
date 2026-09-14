/**
 * R15 — `PRODUCTION_READY`, y por qué una sola palabra aquí sí vale.
 *
 * ## La contradicción aparente
 *
 * Este repositorio lleva doce escalones negándose a resumir: la confianza no sale
 * como un número entre cero y uno, la comparación de candidatos no da una nota,
 * la cobertura no dice si es suficiente. Y ahora un veredicto de una palabra.
 *
 * No es lo mismo, y la diferencia es todo:
 *
 * ```text
 * una NOTA        pesa cosas incomparables — ¿cuánto vale un punto de cobertura
 *                 contra mil aristas de borde?— y los pesos los pone quien mide
 * una CONJUNCIÓN  dice «todo lo que declaraste como necesario, pasó». Los
 *                 criterios los puso quien publica; aquí solo se comprueban
 * ```
 *
 * `PRODUCTION_READY` es lo segundo. No mide calidad: dice que no queda ninguna
 * comprobación declarada sin pasar.
 *
 * ## La regla que lo sostiene: no se gana con silencio
 *
 * Si una comprobación **no se pudo hacer** —no hay cámaras, el proxy está
 * abierto, el término no se entiende, el validador externo no corrió—, el
 * veredicto es `UNKNOWN`, nunca `PRODUCTION_READY`. Sin esto, **el asset más
 * vacío sería el más listo para producción**: sin LOD no hay desviación que
 * medir, sin proxy no hay contención, sin textura no hay tamaño que exceder.
 *
 * Y va más lejos: **tampoco se gana no declarando nada**. Un destino que no dice
 * qué exige deja todos los topes en `NO_JUZGADO`, y un asset entero sin juzgar no
 * puede estar listo. Qué declaraciones hacen falta lo decide **el propio asset**:
 * quien no trae niveles de detalle no tiene que declarar su tolerancia, y quien
 * los trae, sí.
 *
 * ## El validador externo, que no ejecutamos
 *
 * El validador de Khronos es la autoridad sobre si un GLB es un GLB, y no vamos a
 * reimplementarlo ni a envolverlo: se **ingiere su informe**. Lo que este módulo
 * aporta es la ranura —quién validó, con qué versión, y qué encontró— y la regla
 * de que sin ella no hay `PRODUCTION_READY`. Decir «válido» sin que nadie lo haya
 * validado sería exactamente el sobreanuncio que D31 impide.
 */

export type CheckState = "PASS" | "FAIL" | "NOT_RUN" | "NOT_DECLARED";

export interface ReadinessCheck {
  /** Qué se comprobó, con un identificador estable para parsear. */
  id: string;
  state: CheckState;
  /** Por qué, cuando no es `PASS`. Nunca hay que recalcular nada para saberlo. */
  reason?: string;
}

export type Readiness = "PRODUCTION_READY" | "NOT_PRODUCTION_READY" | "UNKNOWN";

export interface ReadinessReport {
  verdict: Readiness;
  /** Todas, en orden fijo. Las que pasan también: el informe no solo se queja. */
  checks: ReadinessCheck[];
  /** Cuántas de cada estado, para no obligar a contarlas. */
  byState: Record<CheckState, number>;
  /** El primer motivo que impide la aprobación, cuando la impide. */
  reason?: string;
}

/** Lo que un validador externo devolvió. No lo ejecutamos: lo ingerimos. */
export interface ExternalValidation {
  provider: string;
  version?: string;
  /** Errores y avisos que el validador contó. Cero errores no es «sin avisos». */
  errors: number;
  warnings: number;
}

export interface ReadinessInputs {
  /** Qué trae el asset: decide qué declaraciones le hacen falta. */
  has: { lods: boolean; collision: boolean; textures: boolean; uvCapableMeshes: boolean };
  /** Qué declaró el destino. */
  declared: {
    lodSilhouetteMax?: number;
    collisionSlackMax?: number;
    textureMaxSize?: number;
    uvRequired?: boolean;
  };
  /** Los veredictos que las capas anteriores ya produjeron. */
  results: {
    /** El veredicto del informe de producción entero. */
    certification: "PASS" | "FAIL" | "INCONCLUSIVE";
    certificationReason?: string;
    /** Si la contención se pudo comprobar, y qué dio. */
    collision?: { ran: boolean; verdict?: "PASS" | "FAIL"; reason?: string; reasonDetail?: string };
    /** Si algún presupuesto se quedó sin evaluar por falta de medida. */
    budgetsUnevaluated: string[];
  };
  external?: ExternalValidation;
}

export function assessReadiness(inputs: ReadinessInputs): ReadinessReport {
  const checks: ReadinessCheck[] = [];
  const añadir = (id: string, state: CheckState, reason?: string) =>
    checks.push({ id, state, ...(reason === undefined ? {} : { reason }) });

  // 1. Lo que las capas anteriores ya juzgaron, en un solo sitio.
  if (inputs.results.certification === "FAIL") {
    añadir("medidas-del-asset", "FAIL", inputs.results.certificationReason);
  } else if (inputs.results.certification === "INCONCLUSIVE") {
    añadir("medidas-del-asset", "NOT_RUN", inputs.results.certificationReason);
  } else {
    añadir("medidas-del-asset", "PASS");
  }

  // 2. La contención, aparte de lo anterior porque **no poder comprobarla no es
  //    aprobarla**: un proxy abierto deja «dentro» sin definir.
  if (!inputs.has.collision) {
    añadir("contencion", "NOT_DECLARED", "EL_ASSET_NO_TRAE_PROXY");
  } else if (inputs.results.collision?.ran !== true) {
    añadir("contencion", "NOT_RUN", inputs.results.collision?.reason ?? "NO_SE_PUDO_COMPROBAR");
  } else if (inputs.results.collision.verdict === "FAIL") {
    añadir("contencion", "FAIL", inputs.results.collision.reasonDetail);
  } else {
    añadir("contencion", "PASS");
  }

  // 3. **Las declaraciones que el propio asset exige.** Un destino que no dice qué
  //    quiere deja todo en NO_JUZGADO, y un asset sin juzgar no está listo.
  const exigencias: Array<[string, boolean, unknown]> = [
    ["tope-de-silueta", inputs.has.lods, inputs.declared.lodSilhouetteMax],
    ["tope-de-holgura", inputs.has.collision, inputs.declared.collisionSlackMax],
    ["tope-de-textura", inputs.has.textures, inputs.declared.textureMaxSize],
    ["exigencia-de-uv", inputs.has.uvCapableMeshes, inputs.declared.uvRequired],
  ];
  for (const [id, aplica, valor] of exigencias) {
    if (!aplica) {
      // No se le pide a quien no lo tiene: un asset sin niveles de detalle no
      // tiene que declarar su tolerancia para estar listo.
      añadir(id, "NOT_DECLARED", "NO_APLICA_A_ESTE_ASSET");
      continue;
    }
    if (valor === undefined) añadir(id, "NOT_RUN", "EL_DESTINO_NO_LO_DECLARA");
    else añadir(id, "PASS");
  }

  // 4. Presupuestos que se quedaron sin medida: se entendieron y no se pudieron
  //    evaluar, que es lo que deja el veredicto inconcluso y no intacto.
  if (inputs.results.budgetsUnevaluated.length > 0) {
    añadir(
      "presupuestos-evaluables",
      "NOT_RUN",
      `SIN_MEDIDA: ${inputs.results.budgetsUnevaluated.join(", ")}`,
    );
  } else {
    añadir("presupuestos-evaluables", "PASS");
  }

  // 5. El validador externo. Sin él no hay aprobación: decir «es un GLB válido»
  //    sin que nadie lo haya validado es afirmar lo que no se ha comprobado.
  if (inputs.external === undefined) {
    añadir("validador-externo", "NOT_RUN", "NINGUN_VALIDADOR_EXTERNO_APORTADO");
  } else if (inputs.external.errors > 0) {
    añadir(
      "validador-externo",
      "FAIL",
      `${inputs.external.provider} cuenta ${inputs.external.errors} errores`,
    );
  } else {
    añadir("validador-externo", "PASS");
  }

  const byState: Record<CheckState, number> = { PASS: 0, FAIL: 0, NOT_RUN: 0, NOT_DECLARED: 0 };
  for (const check of checks) byState[check.state] += 1;

  // Un fallo manda sobre un hueco: si algo está mal, decir «no se sabe» sería
  // más suave de lo que la evidencia sostiene.
  const fallo = checks.find((check) => check.state === "FAIL");
  const hueco = checks.find((check) => check.state === "NOT_RUN");
  const verdict: Readiness =
    fallo !== undefined
      ? "NOT_PRODUCTION_READY"
      : hueco !== undefined
        ? "UNKNOWN"
        : "PRODUCTION_READY";

  return {
    verdict,
    checks,
    byState,
    ...(fallo ?? hueco ? { reason: `${(fallo ?? hueco)!.id}: ${(fallo ?? hueco)!.reason ?? ""}`.trim() } : {}),
  };
}
