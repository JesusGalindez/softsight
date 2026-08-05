# Plan de animación: de diapositivas a motion design

Hoy una capa de texto es **una frase entera pintada en un canvas** y movida como
un bloque, con fundidos. Eso es un pase de diapositivas. Este plan lo convierte
en tipografía animada de verdad, y —lo que importa más— hace que el movimiento
**salga de la historia** en vez de decorarla.

El proyecto ya sabe una cosa que casi nadie sabe: **medir**. Hay puertas que
comparan píxeles, contratos congelados y auditorías que dicen que no. Este plan
no las abandona: cada fase trae la suya, porque «se ve mejor» no es un criterio
que se pueda repetir mañana.

---

## 0. Cómo se trabaja aquí, para quien llegue sin contexto

Quien ejecute una fase de este plan —persona o agente— trabaja **solo**, así que
esto no es burocracia: es lo que evita rehacer el trabajo.

**Territorios.** El reparto manda y vive en [`plan-convergencia.md`](plan-convergencia.md) §0.
Este plan cruza la frontera del motor —el texto se dibuja ahí—, así que **cada
fase declara qué parte es de quién** y lo que sea del motor se pide por
[`coordinacion.md`](coordinacion.md), no se toca.

**Una fase, un commit por sub-item, y verde antes de commitear.** Prefijo
`[convergencia]` o `[motor]` en el asunto: en el editor las dos identidades de
git son la misma y el prefijo es lo único que da trazabilidad.

**Verificar incluye abrir el navegador.** Ya pasó una vez que 451 pruebas verdes
convivían con el visor roto. Para animación es peor: nada de esto se puede
certificar sin mirar frames.

**No ajustar un número hasta que encaje.** Si una medida no cuadra con lo
esperado, primero se averigua por qué. Los 2 px de la sonda de paridad eran una
convención legítima; los 5 px del rasterizador eran un fallo de meses. Se
distinguen investigando, no maquillando.

**Lo que no se sabe se escribe.** Un `TODO` con la pregunta abierta vale más que
una decisión inventada que otro dará por buena dentro de tres semanas.

---

## 1. Por qué lo de hoy parece casero

Cuatro carencias, y solo la última tiene que ver con «efectos»:

1. **No hay maquetación.** El texto no se parte en líneas, no tiene ancho máximo,
   no hay rejilla ni escala tipográfica. Por eso el primer uso real encontró una
   línea de 28 caracteres saliéndose del cuadro por 142 px. No es un bug: es que
   nadie está maquetando, se está estirando una textura.
2. **No se puede animar por unidad.** After Effects anima por **carácter, palabra
   o línea** con un desfase que recorre el texto. Aquí una capa es un sprite: solo
   se mueve entera. Ninguna entrada buena se puede construir así.
3. **No hay vocabulario de movimiento.** Duraciones y curvas son números sueltos
   dentro de `scene-roles.ts`. Sin escala compartida, cada escena inventa su ritmo
   y el conjunto suena desafinado.
4. **La calidad de render se queda corta.** Textura de resolución fija —blanda al
   escalar— y sin motion blur, que es el salto más barato de «casero» a
   «profesional» que existe.

---

## 2. La decisión que gobierna todo el plan

**¿El texto pasa a ser geometría dentro de la escena 3D, o se compone aparte en
2D y se mezcla al final?**

| | Texto como geometría (SDF) | Composición 2D aparte |
|---|---|---|
| Nitidez a cualquier escala | sí | sí |
| Animar por glifo | sí, cada glifo es geometría | sí |
| Convive con la cámara y la profundidad | sí, nativo | no, hay que fingirlo |
| Tipografía fina (ligaduras, guionado) | limitada | excelente |
| Entra en la puerta de paridad | **sí** | no, es otro camino de render |
| Coste en el motor | alto: cambia la ruta de dibujo | medio: un compositor nuevo |

**Recomendación: geometría SDF dentro de la escena.** Dos razones que pesan más
que la tipografía fina. La primera, que el texto pasaría a estar **certificado
como el resto**: hoy la puerta de paridad compara geometría, y un texto que es
geometría entra en ella sin inventar una puerta nueva. La segunda, que la pieza
que este producto hace es 3D: un texto que no puede pasar por detrás de un objeto
ni recibir la profundidad de la cámara obliga a fingir la mitad de los planos.

**Esta decisión necesita tu firma antes de la fase F.** Cambia el motor entero y
es cara de deshacer.

---

## 3. Fase F — Tipografía y maquetación

Sin esto, el resto es decorar un texto que no cabe.

**F1. Medida y maquetación real.** Una pasada que recibe texto, ancho máximo,
tamaño e interlínea, y devuelve **líneas ya partidas con su caja**. Determinista y
sin canvas: la misma entrada da la misma salida en el editor y en un script.
*Puerta: el mismo párrafo maquetado en el editor y fuera del navegador da las
mismas líneas y las mismas cajas, byte a byte.*

**F2. Texto SDF en el motor** (motor). Sustituir la textura de canvas por texto de
campo de distancia: nítido a cualquier escala, y cada glifo con su geometría.
*Puerta: la puerta de paridad acepta una escena con texto; el fixture entra en el
banco.*

**F3. Escala tipográfica por rol.** El guion deja de decir `fontSize: 120` y pasa
a decir `display`, `headline` o `body`; el tamaño en píxeles lo resuelve la
escala de la composición. *Puerta: la misma pieza a 1920×1080 y a 1080×1920
mantiene la jerarquía, y ningún texto se sale —lo que hoy es un aviso pasa a ser
imposible por construcción, porque la maquetación respeta el ancho—.*

**F4. Rejilla y márgenes de seguridad.** Posiciones derivadas de una rejilla, no
escritas a mano. *Puerta: ninguna caja invade el margen declarado.*

---

## 4. Fase G — Animadores por rango

El modelo de After Effects, y es más simple de lo que parece: **un efecto aplicado
sobre un rango de unidades, con una rampa de desfase**.

**G1. El selector.** Dado un texto maquetado, seleccionar por carácter, palabra o
línea, con inicio, fin y suavizado. Es aritmética pura.

**G2. Los efectos.** Opacidad, desplazamiento, escala, rotación, desenfoque y
color, aplicados sobre la selección. Cada uno es una función de
`(unidad, frame) → transformación`. **Pura y determinista**: eso es lo que
mantiene el scrub exacto y la exportación reproducible, que es la línea roja del
proyecto y no se negocia por un efecto bonito.

**G3. Familias de entrada y salida.** Un catálogo corto y bien hecho —cascada,
desenfoque de foco, deslizamiento con máscara, aparición por peso— antes que
veinte a medias.

*Puerta de la fase: una pieza con animadores exporta dos veces con el mismo hash;
saltar al frame 200 da lo mismo que llegar reproduciendo. Y un banco de imágenes
de referencia por familia, comparadas por píxel.*

---

## 5. Fase H — Que el movimiento cuente la historia

Esta es la fase que separa «tiene efectos» de «está dirigido», y la que permite
que un agente componga solo sin que salga un collage.

**H1. Intención de movimiento por rol.** El guion ya declara el rol de cada escena
—`apertura`, `desarrollo`, `cierre`—. De ahí sale una **intención**, no un efecto:

- **apertura**: *establecer*. Entradas amplias y lentas, desde el reposo. El
  espectador todavía no sabe dónde está; el movimiento le sitúa.
- **desarrollo**: *acumular*. Entradas cortas, encadenadas, que heredan la
  dirección de la anterior. Aquí el movimiento lleva el ritmo, no llama la
  atención.
- **cierre**: *asentar*. Un solo movimiento, que termina y se queda quieto. El
  silencio final es parte del cierre.

**H2. Continuidad entre escenas.** Dos reglas que evitan el collage: un corte
**hereda la dirección** del movimiento anterior salvo que la historia cambie de
tema, y **dos escenas seguidas no usan la misma familia de entrada**. Ambas son
comprobables, y por tanto auditables.

**H3. El ritmo sale del texto, no del gusto.** El tiempo de lectura ya se calcula
—`readingRate`, con su suposición declarada—. La entrada termina antes de que
empiece la lectura, y la salida no empieza hasta que ha terminado: **el texto
nunca se mueve mientras se lee.** Es la regla que más diferencia hay entre un
vídeo profesional y uno casero, y es aritmética pura.

**H4. Escala de duraciones.** Tres o cuatro valores para toda la pieza, no un
número por capa. Lo que hace que un montaje suene afinado es que las duraciones
rimen.

*Puerta de la fase, y es nueva en el proyecto: SoftSight aprende a auditar
movimiento. Avisos nuevos —`MOVIMIENTO_DURANTE_LECTURA`, `ENTRADA_REPETIDA`,
`RITMO_INCOHERENTE`— con la misma disciplina que los demás: se apoyan en datos
medibles, dicen qué harían falta, y son avisos, no errores, porque romper una
regla a propósito es una decisión legítima.*

---

## 6. Fase I — Calidad de render

**I1. Motion blur en la exportación.** Muestreo y acumulación por frame. Caro de
calcular, trivial de entender, y es lo que hace que un movimiento rápido deje de
parecer un salto.

**I2. Color del texto gestionado.** El texto entra en el mismo perfil de color que
el resto; hoy es el único elemento que se pinta por su cuenta.

*Puerta: el hash de exportación sigue siendo estable con motion blur activo —el
muestreo es determinista— y la puerta de paridad no se mueve.*

---

## 7. Lo que este plan declara fuera

- **Tipografía de nivel imprenta** —guionado por idioma, ligaduras contextuales,
  kerning óptico por par—. Con texto SDF se llega hasta el ajuste por par que
  publique la fuente; lo demás sería un motor de composición tipográfica, que es
  otro producto.
- **Efectos de partículas sobre el texto, simulaciones y físicas.** No es que sean
  difíciles: es que sin las fases F y H encima solo añaden ruido a un texto mal
  colocado.
- **Elegir la tipografía por el usuario.** Se resuelve la que se declare. Qué
  fuente cuenta bien una historia es criterio editorial y no se automatiza.

---

## 8. Cómo se sabe que esto está funcionando

Sin estas cinco, la fase no está hecha aunque se vea bien en una captura:

1. **Ningún texto se sale del cuadro**, y no porque un aviso lo cace: porque la
   maquetación respeta el ancho.
2. **La exportación sigue dando el mismo hash dos veces**, con animadores y con
   motion blur.
3. **Saltar a un frame da lo mismo que llegar reproduciendo.** Sin esto no hay
   edición posible.
4. **El texto no se mueve mientras se lee**, comprobado sobre el guion.
5. **El banco de imágenes de referencia no se mueve** salvo cuando se decide que
   se mueva, y entonces se regenera a propósito.
