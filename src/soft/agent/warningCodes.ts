/**
 * Los códigos de aviso, en un solo sitio.
 *
 * Hasta aquí cada código vivía escrito a mano en el módulo que lo emite —siete
 * módulos— y no había ningún sitio que los listara. Un agente no podía saber qué
 * le puede pasar sin leerse el código o sin provocarlo, y eso es descubrimiento
 * por prueba y error, que es justo lo que este banco existe para evitar.
 *
 * Dos cosas hacen que la tabla no pueda mentir:
 *
 * 1. **`WarningCode` es el tipo del campo `code`.** Emitir un código que no esté
 *    aquí no compila: no es un aviso raro, es un error de programación. La tabla
 *    no describe la emisión, la define.
 * 2. **`test:codes` la compara contra `src/`** en las dos direcciones. Una tabla
 *    que se mantiene a mano diverge en el segundo código nuevo.
 *
 * ## Sobre `severity`
 *
 * Los valores no se inventan aquí: son el vocabulario que los propios avisos ya
 * usaban en su texto —«Es certeza, no candidato», «Candidato, no certeza»— y que
 * es la distinción que de verdad le importa a quien lee el informe.
 *
 * - **`certeza`**: sale de aritmética sobre lo declarado o lo medido, y no
 *   depende de qué pretendía el autor. 148 aristas de borde son 148 aristas.
 * - **`candidato`**: la medida es firme y la conclusión no. El solape de dos
 *   cajas es condición necesaria y no suficiente para que dos mallas se corten;
 *   una pieza asimétrica solo está mal si tenía que ser simétrica.
 *
 * Un agente que se lo salta y trata los dos igual acaba «arreglando» cosas que
 * estaban bien, y por eso la distinción se publica en vez de quedarse en la
 * redacción de cada mensaje.
 */

import type { Edit } from "./model";

export type WarningSeverity = "certeza" | "candidato";

export interface WarningCodeEntry {
  severity: WarningSeverity;
  /** Qué lo provoca, en una línea. */
  cause: string;
  /**
   * Si el aviso **puede** traer `fix`. No promete que lo traiga siempre: la
   * pieza flotante solo se puede alinear si hay una pieza próxima a la que
   * pegarse, y cuando no la hay el aviso sale sin arreglo antes que con uno
   * inventado.
   */
  fixOp?: Edit["op"];
}

/**
 * La tabla. El orden es el de los módulos que los emiten —topología por pieza,
 * conjunto, presupuesto, geometría declarativa, animación, guion, puesta en
 * escena—, que es el orden en el que un agente se los encuentra.
 */
export const WARNING_CODES = {
  // Topología de una pieza: index.ts, sobre el informe de cada objeto.
  MALLA_VACIA: {
    severity: "certeza",
    cause: "la pieza no tiene ni un triángulo",
  },
  TRIANGULOS_DEGENERADOS: {
    severity: "certeza",
    cause: "hay triángulos de área nula: no pintan nada y cuestan preparación",
  },
  NO_MANIFOLD: {
    severity: "certeza",
    cause: "hay aristas compartidas por tres caras o más",
  },
  BORDE_ABIERTO: {
    severity: "certeza",
    cause: "hay aristas de borde: la malla no está cerrada",
  },
  NORMAL_INVERTIDA: {
    severity: "certeza",
    cause: "más del 2 % de las caras tienen la normal contraria a la de sus vértices",
  },
  MALLA_INVERTIDA: {
    severity: "certeza",
    cause: "la malla está cerrada y su volumen firmado es negativo: las caras miran hacia dentro",
  },
  PIVOTE_DESCENTRADO: {
    severity: "certeza",
    cause: "el centro de la caja está a más de medio radio del origen de la pieza",
    fixOp: "setPivot",
  },
  SIMETRIA_ROTA: {
    severity: "candidato",
    cause: "el error de simetría en X pasa del 2 % del radio; solo es un fallo si debía ser simétrica",
  },

  // El conjunto: escala, encuadre y relaciones entre piezas.
  ESCALA_INESPERADA: {
    severity: "certeza",
    cause: "el lado mayor se aparta más de 1,5× del tamaño declarado en --expect-size",
  },
  ESCALA_SOSPECHOSA: {
    severity: "candidato",
    cause: "sin tamaño declarado, el lado mayor cae fuera de 1 cm – 100 m suponiendo metros de glTF",
  },
  INTERPENETRACION: {
    severity: "candidato",
    cause: "dos cajas se cruzan sin que ninguna contenga a la otra; no se comprueba malla contra malla",
  },
  PIEZA_FLOTANTE: {
    severity: "certeza",
    cause: "la pieza no toca ninguna otra",
    fixOp: "align",
  },
  DUPLICADO_EXACTO: {
    severity: "certeza",
    cause: "varias piezas con la misma geometría en la misma posición",
    fixOp: "delete",
  },
  ESCALA_HERMANOS: {
    severity: "candidato",
    cause: "la diagonal se aparta de la mediana de sus hermanos; o sobra escala, o está en el grupo equivocado",
    fixOp: "scale",
  },
  SELECCION_VACIA: {
    severity: "certeza",
    cause: "los patrones de --select no coinciden con ninguna pieza",
  },
  ENCUADRE_DIMINUTO: {
    severity: "candidato",
    cause: "el objeto ocupa menos del 0,5 % del encuadre",
  },
  ENCUADRE_RECORTADO: {
    severity: "candidato",
    cause: "el objeto ocupa más del 90 % del encuadre y puede estar recortado",
  },

  // Presupuesto: contrato declarado contra número medido, así que siempre certeza.
  PRESUPUESTO_TRIANGULOS: {
    severity: "certeza",
    cause: "los triángulos pasan de budget.triangles",
  },
  PRESUPUESTO_PIEZAS: {
    severity: "certeza",
    cause: "las piezas pasan de budget.parts",
  },
  PRESUPUESTO_ESTANQUEIDAD: {
    severity: "certeza",
    cause: "budget.watertight exige mallas cerradas y alguna no lo está",
  },
  PRESUPUESTO_BORDES: {
    severity: "certeza",
    cause: "las aristas de borde pasan de budget.boundaryEdges",
  },
  PRESUPUESTO_DEGENERADOS: {
    severity: "certeza",
    cause: "los triángulos de área nula pasan de budget.degenerateTriangles",
  },
  PRESUPUESTO_SIMETRIA: {
    severity: "certeza",
    cause: "alguna pieza pasa de budget.symmetryError",
  },

  // Geometría declarativa: geometryAudit.ts, antes de generar la malla.
  PERFIL_AUTOINTERSECADO: {
    severity: "certeza",
    cause: "dos lados del perfil se cruzan, y el recorte de orejas supone un polígono simple",
  },
  BARRIDO_AUTOINTERSECADO: {
    severity: "certeza",
    cause: "el radio del perfil pasa del radio de curvatura del recorrido: el barrido se pliega sobre sí mismo",
  },
  SECCIONES_INCOMPATIBLES: {
    severity: "candidato",
    cause: "el emparejamiento entre dos secciones del loft gira más de un cuarto de vuelta; el giro puede ser deliberado",
  },

  // Animación: animationAudit.ts, sobre las claves declaradas.
  GIRO_AMBIGUO: {
    severity: "certeza",
    cause: "dos claves de rotación consecutivas saltan media vuelta o más, y glTF interpola por el arco corto",
  },

  // Guion: storyAudit.ts. No hay geometría, solo texto y tiempo.
  ROL_AUSENTE: {
    severity: "certeza",
    cause: "la pieza no tiene ninguna escena con un rol que se exige",
  },
  ROLES_CONSECUTIVOS: {
    severity: "certeza",
    cause: "dos escenas seguidas hacen el mismo papel",
  },
  TEXTO_ILEGIBLE: {
    severity: "candidato",
    cause: "el texto no cabe en la duración al ritmo de lectura declarado, que es una suposición y no una medida",
  },

  // Puesta en escena: stagingAudit.ts, sobre las medidas que trae el editor.
  ESCENA_VACIA: {
    severity: "certeza",
    cause: "ninguna capa de la escena está visible en el frame de muestra",
  },
  CAJA_FUERA_DE_CUADRO: {
    severity: "certeza",
    cause: "la caja de una capa se sale del cuadro",
  },
  CONTRASTE_INSUFICIENTE: {
    severity: "certeza",
    cause: "el texto no llega al contraste mínimo declarado contra su fondo",
  },
} as const satisfies Record<string, WarningCodeEntry>;

export type WarningCode = keyof typeof WARNING_CODES;

/**
 * La tabla en forma de lista, que es como la publica `--schema`. `hasFix` sale
 * de si hay `fixOp`, para que el consumidor no tenga que deducirlo y para que no
 * puedan contradecirse.
 */
export const WARNING_CODE_LIST: readonly (WarningCodeEntry & {
  code: WarningCode;
  hasFix: boolean;
})[] = (Object.keys(WARNING_CODES) as WarningCode[]).map((code) => ({
  code,
  ...WARNING_CODES[code],
  hasFix: "fixOp" in WARNING_CODES[code],
}));
