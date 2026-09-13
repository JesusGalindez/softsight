# Prompt de ejecución — encargo 01

Pegar tal cual como primer mensaje al agente auxiliar, en la raíz del repositorio
`softsight`. Está escrito para que el agente **empiece a trabajar**, no para que
pida permiso ni para que resuma lo que va a hacer.

---

```text
Trabajas en softsight, en /Users/albertogalindez/Documents/Dron/softsight, rama main.

Tu encargo entero está en docs/encargo-agente-01.md. Léelo antes que nada, y con
él lee lo que su sección 0 te manda leer. Ese documento manda sobre este mensaje
en todo lo que sea concreto; este mensaje solo dice cómo trabajar.

IDIOMA: español, en el código, en los comentarios, en los commits y conmigo.

ARRANQUE, en este orden y sin saltarte pasos:

  1. npm run verify
     Si sale rojo, PARA y dime qué falla con la línea exacta. No empieces nada.
     Si sale verde, apunta el recuento que imprime la suite: es tu línea base.
  2. Lee AGENTS.md, docs/mapa-del-proyecto.md §3 y §5, docs/contrato-videomesh.md §1,
     y docs/plan-reconstruccion.md §71 y §86.
  3. Empieza por A0. Es de prosa y cuesta minutos; hazla antes de tocar código.

CÓMO HACES CADA TAREA — el bucle, sin excepciones:

  a. Escribe PRIMERO la prueba que falla sin la tarea hecha. Ejecútala y
     COMPRUEBA QUE FALLA. Una prueba que pasa antes del cambio no prueba nada, y
     en este repositorio una tarea solo está hecha cuando existe una prueba que
     falla si se deshace.
  b. Haz el cambio mínimo que la pone en verde.
  c. npm run verify entero. No la puerta sola: entero.
  d. Actualiza los tres sitios que manda la sección 3 del encargo: el registro de
     decisiones, el mapa §5 y —si tocaste un esquema— coordinacion.md.
  e. Un commit, en español, con el estilo del git log actual.
  f. Dime en tres líneas: qué hiciste, qué prueba lo sujeta, qué te sorprendió.
     Luego sigue con la siguiente tarea sin preguntarme si puedes.

CUÁNDO ME PARAS. Solo estos casos. En todos los demás, construye y dime qué
supusiste:

  - npm run verify se pone rojo y no lo arregla tu propio cambio.
  - Un renderHash se mueve sin que la tarea lo pidiera. El pliego del dron es
    46228b7c y no se toca. Esto es un defecto, no un efecto secundario: para.
  - La tarea pide refijar un control congelado (artifacts/agent/*-poses.json,
    render-hashes.json, encuadre-control.json). Esos son puertas del otro
    repositorio: refijarlos sin avisar es justo lo que existen para impedir.
  - Dos lecturas del enunciado dan trabajos distintos y elegir mal tira el trabajo.
  - La decisión es de criterio y no de hecho. El idioma de los códigos nuevos es
    de ésas, y afecta a VideoMesh: anótala, no la decidas.
  - Una tarea del bloque B no se puede cerrar porque faltan los datos. Dilo y
    sigue con otra; no inventes un fixture "casi real".

  Una pregunta cada vez, con tu respuesta recomendada y por qué. Y si el dato se
  puede averiguar mirando el código, el git o el disco, MÍRALO: no me preguntes
  hechos comprobables.

LO QUE NO HACES, NUNCA:

  - Tocar el bloque C. Está bloqueado fuera de este repositorio.
  - Fijar los identificadores SS-PKG-010 a 014. Están en PROPUESTO a propósito.
  - Mover el orden del bloque A. A4 depende de A2 y A3; A7 depende de A6.
  - Escribir un recuento, un estado o un número a mano si ya lo genera una
    herramienta. tools/agents-md.mjs, tools/contracts.mjs y tools/run-tests.mjs
    los generan. Escribirlos a mano es el error que este repositorio ya cometió
    dos veces.
  - Mejorar redacción, formato o comentarios que la tarea no pide. Si ves código
    muerto no relacionado, MENCIÓNALO y no lo borres.
  - Afirmar una mejora de rendimiento sin medirla con /usr/bin/time -p sumando
    user + sys. Esta máquina se degrada por temperatura dentro de una misma
    sesión y el tiempo de pared miente entre medidas lejanas. Menos de un 30 %
    es ruido y no se afirma.
  - Encender SOFTSIGHT_TEST_JOBS. Está apagado por una medida, no por olvido.

CÓMO EMPIEZAS A RESPONDERME. No me cuentes el plan: ya lo escribí yo. Tu primer
mensaje es el resultado de npm run verify y la primera tarea ya empezada.
```

---

## Por qué el prompt está escrito así

Cuatro cosas que lo hacen funcionar, por si hay que reescribirlo:

**La prueba va primero, y hay que verla fallar.** Es la regla del repositorio
—una decisión es IMPLEMENTADA cuando existe una prueba que falla si se
incumple— convertida en orden de trabajo. Sin el «compruébalo fallando», un
agente escribe una prueba que pasa desde el principio y cree que ha cerrado algo.

**Las condiciones de parada son una lista cerrada.** Un agente al que le dices
«pregunta si tienes dudas» pregunta cada veinte minutos; uno al que no le dices
nada refija un control congelado y rompe una puerta del otro repositorio sin
enterarse. Las seis de la lista son las que de verdad cuestan caro aquí.

**El «no hagas» es concreto y trae su motivo.** «No escribas números a mano»
sin el «ya cometimos ese error dos veces» se olvida al tercer fichero.

**El primer mensaje no es un plan.** El plan ya está en
[`encargo-agente-01.md`](encargo-agente-01.md). Pedirle que lo resuma gasta un
turno entero en repetir lo que ya está escrito, que es exactamente lo que el plan
Ω atacaba.
