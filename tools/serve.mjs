/**
 * Modo residente: el CLI que no se muere.
 *
 * El 43 % de una llamada barata era arranque —0,10 s de los 0,23 s son Node y la
 * importación del módulo—, y el puente pagaba además un proceso por petición. En
 * un bucle de veinte turnos de consulta eso son dos segundos de nada.
 *
 * Aquí se lee NDJSON por stdin y se escribe NDJSON por stdout, **con el contrato
 * del puente sin tocar ni un campo**: la misma petición, la misma respuesta, el
 * mismo sandbox. No es un tercer contrato, es un transporte, y por eso el
 * contrato lo sigue definiendo `bridge.mjs` —de donde se importa `handleRequest`—
 * y lo único que cambia es `execute`: en vez de lanzar un proceso, llama al CLI
 * dentro de este.
 *
 * Una respuesta por línea y sin sangrar, que es lo que hace NDJSON legible por
 * máquina; el puente de un disparo sigue escribiendo su JSON con sangría porque
 * ahí lo lee una persona tanto como un programa.
 *
 * Riesgo declarado: un proceso residente acumula estado, y el estado es enemigo
 * del determinismo. La puerta que lo cierra manda veinte peticiones idénticas
 * seguidas al mismo proceso y comprueba que las veinte respuestas son idénticas.
 */

import { createInterface } from "node:readline";

import { BridgeError, errorResponse, handleRequest } from "./bridge.mjs";

/**
 * Lee peticiones hasta que se cierre stdin. **En serie**, a propósito: las
 * peticiones comparten el directorio de trabajo temporal, la caché del modelo y
 * el módulo, y atenderlas a la vez es la forma más corta de que dos se pisen. El
 * ahorro que persigue esta fase es el arranque, no la concurrencia.
 *
 * `runAgent` entra por parámetro y no por `import`: `agent3d.mjs` importa este
 * fichero cuando arranca en modo residente, y volver a importarlo desde aquí
 * cerraría un ciclo que en ESM con `await` de nivel superior es un bloqueo, no un
 * aviso.
 */
export async function serve(runAgent) {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === "") continue;
    let response;
    try {
      let request;
      try {
        request = JSON.parse(line);
      } catch {
        throw new BridgeError("invalid-request", "la petición no es JSON válido");
      }
      response = await handleRequest(request, runAgent);
    } catch (error) {
      response = errorResponse(error);
    }
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}
