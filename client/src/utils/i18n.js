// Spanish for the weighing bench.
//
// No library and no key names: the DICTIONARY IS KEYED ON THE ENGLISH STRING,
// so a phrase nobody has translated yet renders in English rather than showing
// "weigh.stop.title" to someone holding a box. That also keeps the JSX readable
// — t("Stop session") still says what it puts on screen.
//
// Scoped to the outgoing weighing window on purpose. The rest of the app stays
// English until someone asks for it.

const ES = {
  // ── The window, and starting a session ────────────────────────────────────
  "Weigh finished boxes": "Pesar cajas terminadas",
  "Weighing out of {lot}": "Pesando salida del lote {lot}",
  "Pick the lot these finished boxes came out of. Everything else about the product is taken from the lot.":
    "Elija el lote del que salieron estas cajas terminadas. Todo lo demás del producto se toma del lote.",
  "These boxes go on the load for {lot}. The session is tied to it when you close.":
    "Estas cajas van en la carga del lote {lot}. La sesión se une a ella al cerrar.",
  "Lot": "Lote",
  "Item": "Producto",
  "(optional)": "(opcional)",
  "What is in the boxes. Left blank it is taken from the lot's incoming session, which is the raw product rather than this one.":
    "Lo que va en las cajas. Si se deja en blanco se toma de la sesión de entrada del lote, que es el producto crudo y no éste.",
  "Going to": "Destino",
  "Boxes expected": "Cajas esperadas",
  "Only used to show progress. Going over is not blocked.":
    "Solo se usa para mostrar el avance. Pasarse no está bloqueado.",
  "Start weighing": "Empezar a pesar",
  "Stop session": "Terminar sesión",
  "Undo last": "Deshacer la última",

  // ── While weighing ────────────────────────────────────────────────────────
  "Use the scale": "Usar la báscula",
  "Type weights instead": "Escribir los pesos",
  "item not recorded": "producto sin registrar",
  "to {shipTo}": "a {shipTo}",
  "Recorded": "Registrado",
  "Nothing yet.": "Nada todavía.",
  "{n} not yet sent": "{n} sin enviar",
  "all saved": "todo guardado",
  "{n} box": "{n} caja",
  "{n} boxes": "{n} cajas",

  // ── Warnings that stay on screen ──────────────────────────────────────────
  "This browser will not keep weights through a refresh. Finish the lot in one go.":
    "Este navegador no conserva los pesos si se recarga la página. Termine el lote de una sola vez.",
  "{error} — weights are held on this device and will be sent when it reconnects.":
    "{error} — los pesos quedan guardados en este dispositivo y se enviarán cuando vuelva la conexión.",

  // ── An unfinished session ─────────────────────────────────────────────────
  "An unfinished session is still on this device.":
    "Todavía hay una sesión sin terminar en este dispositivo.",
  "Batch {id} ({lot}) has {n} weight(s) that never reached the server.":
    "El lote de pesaje {id} ({lot}) tiene {n} peso(s) que nunca llegaron al servidor.",
  "Carry on with it": "Continuar con ella",
  "Discard it": "Descartarla",
  "It is an incoming session. Finish or close it on the box weighing screen first — starting here would throw its weights away.":
    "Es una sesión de entrada. Termínela o ciérrela primero en la pantalla de pesaje de cajas — empezar aquí desecharía sus pesos.",
  "Throw this unfinished session away?": "¿Desechar esta sesión sin terminar?",
  "{n} weight(s) on this device never reached the server. Discarding loses them for good — those boxes would have to be weighed again.":
    "{n} peso(s) de este dispositivo nunca llegaron al servidor. Al descartarlos se pierden definitivamente — esas cajas tendrían que pesarse de nuevo.",
  "Nothing is waiting to be sent, so nothing is lost.":
    "No hay nada pendiente de enviar, así que no se pierde nada.",
  "Use this when the session cannot be carried on with — deleted on the server, or belonging to a lot that is long gone.":
    "Use esto cuando la sesión ya no se pueda continuar — borrada en el servidor, o de un lote que ya no existe.",
  "Keep it": "Conservarla",

  // ── Stopping ──────────────────────────────────────────────────────────────
  "Stop this weighing session?": "¿Terminar esta sesión de pesaje?",
  "This closes this session, not the lot.": "Esto cierra esta sesión, no el lote.",
  "{lot} stays open — weigh more boxes into it whenever the next run comes off the line. To pick this same session back up, leave it open and use Carry on weighing on the Outgoing tab.":
    "El lote {lot} sigue abierto — puede pesar más cajas en él cuando salga la siguiente corrida. Para retomar esta misma sesión, déjela abierta y use Continuar pesando en la pestaña de Salidas.",
  "Nothing has been recorded yet, so this would close an empty session. Leave it open instead if you are coming back to it.":
    "Todavía no se ha registrado nada, así que esto cerraría una sesión vacía. Déjela abierta si va a volver a ella.",
  "{n} still to send. Stopping sends them first; leaving it open keeps them on this device until it reconnects.":
    "Faltan {n} por enviar. Al terminar se envían primero; si la deja abierta se quedan en este dispositivo hasta que vuelva la conexión.",
  "Remarks (optional)": "Observaciones (opcional)",
  // Input placeholders are deliberately absent: what goes IN a field is data —
  // lot numbers, product names, digits — and stays as typed.
  "Keep weighing": "Seguir pesando",
  "Leave it open": "Dejarla abierta",

  // ── The scale panel ───────────────────────────────────────────────────────
  "This browser cannot read the scale.": "Este navegador no puede leer la báscula.",
  "Web Serial is Chrome or Edge on the desktop. Type the weights instead.":
    "Web Serial solo funciona en Chrome o Edge de escritorio. Escriba los pesos.",
  "Weighing out of lot": "Pesando salida del lote",
  "Connect scale": "Conectar báscula",
  "connected": "conectada",
  "Disconnect": "Desconectar",
  "Reads the scale. BarTender keeps its own connection.":
    "Lee la báscula. BarTender mantiene su propia conexión.",
  "On the scale": "En la báscula",
  "Held — answer below": "En espera — responda abajo",
  "Recorded — take the box off": "Registrada — retire la caja",
  "Settling…": "Estabilizando…",
  "Place a box on the scale": "Ponga una caja en la báscula",
  "Box {n} recorded": "Caja {n} registrada",
  "Nothing recorded yet.": "Nada registrado todavía.",
  "Last recorded: {weight} lb": "Última registrada: {weight} lb",
  "Box {n} of {total}": "Caja {n} de {total}",
  "all expected boxes weighed": "todas las cajas esperadas pesadas",
  "{n} to go": "faltan {n}",
  "{n} boxes recorded": "{n} cajas registradas",
  "{n} box recorded": "{n} caja registrada",
  "lb — not recorded yet": "lb — todavía sin registrar",
  "Exactly the same as the box before. That usually means the same box came back — a torn label, or a re-weigh to reprint one. Recording it again would count one box as two.":
    "Exactamente igual que la caja anterior. Casi siempre significa que volvió la misma caja — una etiqueta rota, o un repesaje para reimprimirla. Registrarla otra vez contaría una caja como dos.",
  "About {ratio}× {direction} than the rest of this lot, which is running around {median} lb a box.":
    "Como {ratio}× más {direction} que el resto de este lote, que va alrededor de {median} lb por caja.",
  "heavier": "pesada",
  "lighter": "ligera",
  "Same box — skip it": "Misma caja — omitirla",
  "Skip it": "Omitirla",
  "Record {weight} lb": "Registrar {weight} lb",

  // ── Typing weights ────────────────────────────────────────────────────────
  "Type weights": "Escribir pesos",
  "Digits only — 4061 is 40.61. Enter records it.":
    "Solo dígitos — 4061 son 40.61. Enter la registra.",
  "scanning is off while typing": "el escáner está apagado mientras escribe",
  "One box": "Una caja",
  "Batch": "Por tanda",
  "How many boxes": "Cuántas cajas",
  "Comes to": "Suma",
  "Add": "Agregar",
  "Add {n} boxes": "Agregar {n} cajas",
  "Add {n} boxes?": "¿Agregar {n} cajas?",
  "{n} at a time is the limit.": "El máximo es {n} a la vez.",
  "= {total} lb on this lot": "= {total} lb en este lote",
  "Each one is recorded as its own box, so any of them can be corrected or voided on its own afterwards.":
    "Cada una se registra como su propia caja, así que después cualquiera se puede corregir o anular por separado.",
  "They are marked estimated: this is the figure on the label, and the boxes themselves vary.":
    "Se marcan como estimadas: éste es el número de la etiqueta, y las cajas varían entre sí.",
  "Go back": "Regresar",
  "waiting": "esperando",
  "Same weight as the last box": "Mismo peso que la caja anterior",
  "Is that weight right?": "¿Está bien ese peso?",
  "The box before this one weighed exactly the same. That usually means the same box came back — a torn label, or a re-weigh to reprint one.":
    "La caja anterior pesó exactamente lo mismo. Casi siempre significa que volvió la misma caja — una etiqueta rota, o un repesaje para reimprimirla.",
  "If it is the same box it is already on the manifest, and recording it again would count one box as two. Two different boxes landing on the same figure does happen — if that is what this is, add it.":
    "Si es la misma caja ya está en el manifiesto, y registrarla otra vez contaría una caja como dos. Sí llega a pasar que dos cajas distintas den el mismo número — si es eso, agréguela.",
  "That is about {ratio}× {direction} than the rest of this lot, which is running around {median} lb a box.":
    "Eso es como {ratio}× más {direction} que el resto de este lote, que va alrededor de {median} lb por caja.",
  "A misplaced decimal looks exactly like this. If the box really does weigh that, record it.":
    "Un punto decimal mal puesto se ve exactamente así. Si la caja de verdad pesa eso, regístrela.",
  "Same box — don't record": "Misma caja — no registrar",
  "Different box — record it": "Caja distinta — registrarla",
  "Let me retype it": "Déjeme escribirlo de nuevo",
  "Record {weight}": "Registrar {weight}",
  "{n} more than expected — not blocked, but worth a look.":
    "{n} más de lo esperado — no está bloqueado, pero vale la pena revisarlo.",

  // ── Toasts ────────────────────────────────────────────────────────────────
  "Could not start weighing": "No se pudo empezar a pesar",
  "That box was not recorded": "Esa caja no se registró",
  "{n} boxes added": "{n} cajas agregadas",
  "Marked estimated — the label figure, not a weighed one.":
    "Marcadas como estimadas — el número de la etiqueta, no uno pesado.",
  "Could not add those boxes": "No se pudieron agregar esas cajas",
  "Not stopped — weights still unsent": "No se terminó — todavía hay pesos sin enviar",
  "{n} weight(s) have not reached the server. Stay on this screen until they do.":
    "{n} peso(s) no han llegado al servidor. Quédese en esta pantalla hasta que lleguen.",
  "That session no longer exists": "Esa sesión ya no existe",
  "Could not stop the session": "No se pudo terminar la sesión",
  "Unfinished session discarded": "Sesión sin terminar descartada",
  "{n} weight(s) that never reached the server were thrown away.":
    "Se desecharon {n} peso(s) que nunca llegaron al servidor.",
  "Nothing was pending.": "No había nada pendiente.",
  "Could not discard it": "No se pudo descartar",
  "Another session on this device has unsent weights":
    "Otra sesión en este dispositivo tiene pesos sin enviar",
  "{n} weight(s) here have not reached the server yet. Carry on with that session and let it send, then come back to this one.":
    "{n} peso(s) de aquí todavía no llegan al servidor. Continúe con esa sesión y deje que se envíen, y luego vuelva a ésta.",
};

export const LANGS = [["en", "English"], ["es", "Español"]];

const STORAGE_KEY = "afdc.lang";

// Per device, not per user: the bench iPad should stay in Spanish for whoever
// picks it up next. Wrapped because storage throws in a private window.
export const getLang = () => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "es" ? "es" : "en";
  } catch {
    return "en";
  }
};

export const saveLang = (lang) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang === "es" ? "es" : "en");
  } catch {
    // A device that cannot remember the choice still honours it for this visit.
  }
};

/**
 * Builds the lookup for one language.
 *
 * `{name}` placeholders are filled from `vars`. A missing translation returns
 * the English it was given, which is why the keys are sentences.
 */
export const translator = (lang) => (text, vars) => {
  const out = (lang === "es" && ES[text]) || text;
  if (!vars) return out;
  return out.replace(/\{(\w+)\}/g, (whole, key) =>
    (vars[key] === undefined || vars[key] === null ? whole : String(vars[key])));
};

export default ES;
