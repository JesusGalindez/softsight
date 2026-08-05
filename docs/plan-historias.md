# Plan: historias construidas por agentes

Cómo un agente escribe una pieza narrativa entera —guion, puesta en escena y
render— sin que nadie le corrija a mano, y cómo se sabe si lo que salió sirve.

Parte de una pieza real: el [artefacto del
Tawantinsuyu](https://claude.ai/code/artifact/3ea9d3e0-b9ba-4b83-bdf1-ddcdaf5ade54),
cuya historia entera cabe en una lista de escenas en JSON.

---

## 1. La decisión que hay que tomar primero

**¿Plantillas o desde cero?** Las dos fallan, y por motivos opuestos.

**Desde cero** —el agente escribe capas y keyframes— es un espacio sin fondo. El
agente puede producir cualquier cosa, incluida cualquier cosa mala, y nadie sabe
cuál es cuál hasta que un humano lo mira. Es exactamente el problema que este
proyecto existe para resolver, otra vez, en otro dominio.

**Plantillas rígidas** —rellenar huecos— resuelven eso y matan lo otro: todas las
piezas salen idénticas. No consistentes: idénticas. Y una plantilla no se puede
estirar, así que la primera historia que no encaje obliga a escribir una plantilla
nueva, y a los seis meses hay cuarenta plantillas y ninguna se parece a otra.

**Lo que sí funciona son tres cosas juntas**, y ninguna es una plantilla:

1. **Un vocabulario** que el agente compone libremente: escenas con un rol
   narrativo, no cajas con huecos.
2. **Puertas** que dicen con números si la pieza funciona. El agente es libre
   dentro de lo que pasa la puerta.
3. **Ejemplares**: piezas completas y buenas que el agente lee antes de escribir.
   No para rellenarlas — para saber a qué suena esto cuando está bien.

Es la misma arquitectura que el resto del proyecto: **la herramienta no decide,
verifica.** El agente compone; la puerta dice si sirve.

El tercer punto es el que no aparece en el trabajo de geometría, y hace falta
aquí: **el gusto no lo certifica un hash.** Una pieza puede pasar todas las
comprobaciones numéricas y ser aburrida. Los ejemplares son la única forma
honesta de transmitir criterio sin congelar la forma.

---

## 2. Las cuatro capas

```
brief del humano          "el imperio inka, 60 s, tono documental"
      ↓
guion (story.json)        el agente escribe escenas: rol, duración, datos
      ↓  ← puertas: legibilidad, ritmo, estructura, contraste
puesta en escena          los roles convierten datos en capas
      ↓  ← puertas: caja de texto, escena sin capa visible
render                    WebM determinista
```

Lo que cruza cada flecha es **JSON comprobable**, no una llamada de función. Por
eso el bucle puede correr solo: cada paso produce algo que la puerta siguiente
sabe juzgar.

---

## 3. El contrato del guion

El equivalente de `OM_SCENES`, con lo que le falta para poder auditarse:

```json
{
  "storyVersion": 1,
  "title": "Tawantinsuyu",
  "fps": 30,
  "scenes": [
    { "name": "origen", "role": "apertura", "durationFrames": 210,
      "data": { "headline": "h. 1200", "subject": "Manku Qhapaq",
                "line": "En el valle del Qosqo nace un señorío pequeño." } },
    { "name": "pachakutiq", "role": "giro", "durationFrames": 270,
      "data": { "headline": "1438", "subject": "Pachakutiq Inka Yupanki",
                "line": "Tras vencer a los chankas, el Qosqo empieza a conquistar." } }
  ]
}
```

Dos campos hacen el trabajo:

- **`role`** es el vocabulario narrativo: `apertura`, `desarrollo`, `giro`,
  `cierre`. Sin él la puerta solo puede contar frames; con él puede juzgar
  **estructura** —una pieza sin cierre, cuatro desarrollos seguidos sin giro—.
- **`data`** son los datos, no la maqueta. El agente dice *qué* cuenta esta
  escena; el rol decide *cómo* se ve.

La duración de la composición **se deriva** de la suma. Que el agente no tenga
que cuadrarla a mano elimina de un plumazo la clase de error más aburrida.

---

## 4. Roles de escena: pocos, y que crezcan por necesidad

Un rol sabe convertir `data` en capas. No es una plantilla porque no tiene huecos
fijos: es una función de los datos a una puesta en escena.

**Empieza con tres o cuatro.** La pieza del Tawantinsuyu usa esencialmente tres.
Veinte roles el primer día son veinte cosas que mantener y que el agente tiene
que elegir sin criterio. Se añade uno **cuando una pieza real lo pide**, nunca
antes.

Cada rol declara qué campos de `data` necesita. Eso convierte «al agente se le
olvidó un campo» en un error de validación, no en un hueco vacío en el render.

---

## 5. Las puertas — aquí está la ventaja

Si la historia es datos, se audita como se audita la geometría. Esto no lo tiene
ninguna otra herramienta y es la razón de construirlo aquí y no en otro sitio.

**Hechos exactos** —se calculan, no se opinan:

| Comprobación | Cómo |
|---|---|
| La suma de escenas no cabe en la composición | aritmética |
| Texto ilegible por tiempo | caracteres ÷ (duración × ritmo de lectura) |
| Escena sin ninguna capa visible en su rango | recorrer capas |
| Texto que se sale de su caja | medir la caja al maquetar |
| Contraste insuficiente sobre el fondo | ratio WCAG |
| Rol obligatorio ausente (sin cierre) | recorrer roles |
| Dos escenas consecutivas del mismo rol | recorrer roles |

El **ritmo de lectura** es una suposición declarada, no una ley —del orden de 15
caracteres por segundo en pantalla—, y el aviso lo dice, igual que el aviso de
escala absoluta dice de qué unidad parte.

De esa tabla, la auditoría del paso 4 mide tres: texto ilegible por tiempo, rol
obligatorio ausente y dos escenas consecutivas del mismo rol. Las otras tres
—escena sin capa visible, texto fuera de su caja y contraste— necesitan la
puesta en escena, así que son de una puerta posterior. Y la primera fila **ya no
puede fallar**: al derivarse la duración de la suma en los dos lados, el
descuadre dejó de ser posible; queda aquí como aviso de por qué no hay código
que la compruebe.

**Candidatos** —heurísticas que se declaran como tales, con el precedente de la
auditoría espacial:

- Ritmo monótono: todas las escenas duran casi lo mismo.
- Apertura demasiado larga antes del primer dato concreto.

Van marcadas como candidatos y jamás disfrazadas de medida. Esa distinción es lo
que hace que un agente pueda confiar en el resto.

---

## 6. El bucle autónomo

El mismo que ya funciona para geometría:

1. El agente lee los **ejemplares** y el brief.
2. Escribe `story.json`.
3. La puerta responde **hechos**, no opiniones.
4. El agente corrige lo que la puerta señaló.
5. Cuando la puerta calla, se maqueta y se renderiza.

Un agente sin el paso 3 no está construyendo: está adivinando. Ya vimos esto
funcionar con el muñeco —la auditoría rechazó el brazo que entraba en el torso en
el fotograma 9, se corrigió, quedó limpia—. Aquí es lo mismo con «esta escena no
se puede leer en ocho frames».

---

## 7. Dónde vive cada pieza

La frontera del [mapa](mapa-del-proyecto.md) no se mueve:

| Pieza | Repo | Por qué |
|---|---|---|
| Contrato del guion y su esquema | **softsight** | es la forma que valida la entrada |
| Auditoría de la historia | **softsight** | produce verdad medida |
| Comando `story` en el puente | **softsight** | la vía por la que llega el agente |
| Roles y puesta en escena | **editor** | convierte datos en capas y las dibuja |
| Render determinista | **editor** | ya lo hace |

softsight verifica, el editor consume. El agente entra por el puente, que desde
el comando `scene` ya sabe recibir una escena declarativa y devolver informe,
GLB y pliego.

---

## 8. Qué no hacer

- **No reimplementar el motor 2D del artefacto en Three.js.** Aquel es 2D y es
  excelente en 2D; el editor es 3D. Lo único que merece portarse es la
  secuenciación por escenas.
- **No dejar que el agente escriba keyframes directamente.** Si puede saltarse
  el guion, el guion deja de ser la fuente y las puertas dejan de significar
  nada.
- **No añadir un rol para cada pieza nueva.** Un rol que se usa una vez es una
  plantilla con otro nombre.
- **No convertir las heurísticas de ritmo en errores.** Son candidatos. El día
  que una pieza buena falle por una de ellas, el agente aprenderá a mentirle a
  la puerta.

---

## 9. Orden de construcción

Cada punto deja los dos repos verdes y se puede parar ahí.

1. **`activeScene` y `sceneProgress` en el evaluador del editor.** Dado el frame,
   qué escena está activa y su progreso local de 0 a 1. Unas pocas líneas, exacto
   y determinista, y de él se derivan entradas, salidas y transiciones sin
   keyframear nada. **Es el keystone: sin esto no hay nada más.**
2. **`scenes` en el documento del proyecto**, con la duración de la composición
   derivada de la suma.
3. **Contrato del guion y su esquema en softsight**, publicado por `--schema`
   como todo lo demás. Aquí se decide algo que el paso 2 dejó abierto: el
   documento del editor guarda escenas con `name` y `durationFrames`, y el
   contrato añade `role` y `data`. O lo del editor es una **proyección** —solo
   lo que el evaluador necesita para situar frames— o crece hasta el contrato
   entero. La proyección deja al evaluador sin saber qué es un rol, igual que el
   núcleo de render no sabe qué es un GLB. **Se tomó la proyección**: softsight
   valida el guion completo con `role` y `data`, y el documento del editor
   guarda solo nombre y duración. Dónde aterrizan `role` y `data` en el editor
   lo decide el paso 5, que es quien los usa.
4. **Auditoría de la historia**: primero los hechos exactos, sin heurísticas.
5. **Tres roles de escena** en el editor, sacados de una pieza real.
6. **Comando `story` en el puente**, para que el agente llegue por la vía con
   sandbox.
7. **Ejemplares**: dos piezas completas y buenas, versionadas, que el agente lee
   antes de escribir.

Los pasos 1 y 2 son útiles por sí solos aunque nunca llegue un agente: hacen que
una persona pueda montar una historia sin colocar keyframes a mano.
