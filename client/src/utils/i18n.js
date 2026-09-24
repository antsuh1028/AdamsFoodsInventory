// Spanish for the weighing bench.
//
// No library and no key names: the DICTIONARY IS KEYED ON THE ENGLISH STRING,
// so a phrase nobody has translated yet renders in English rather than showing
// "weigh.stop.title" to someone holding a box. That also keeps the JSX readable
// — t("Stop session") still says what it puts on screen.
//
// Scoped to the outgoing side on purpose — the weighing window and the Outgoing
// tab. The rest of the app stays English until someone asks for it.

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
  "Choose port": "Elegir puerto",
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

  // ── The Outgoing tab ──────────────────────────────────────────────────────
  // A load is "carga" and the tab is "Salidas", matching the weighing window,
  // whose stop dialog already points people at "Continuar pesando" here.
  "Outgoing": "Salidas",
  "Weigh the boxes, then tie them to a load and ship it. Stock moves when a load ships.":
    "Pese las cajas, luego únalas a una carga y envíela. El inventario se mueve cuando sale la carga.",
  "Weigh the boxes going out. Reception ties them to a load.":
    "Pese las cajas que salen. Recepción las une a una carga.",
  "New shipment": "Nuevo envío",

  // Weighed sessions
  "Finished product weighed": "Producto terminado pesado",
  "Boxes weighed off the bench on their way out. Tie one to a load below, or leave it until there is a load for it.":
    "Cajas pesadas en la mesa antes de salir. Únalas a una carga abajo, o déjelas hasta que haya una carga para ellas.",
  "Double-click to see the boxes": "Doble clic para ver las cajas",
  "Open this lot — its figures, and whether it is finished":
    "Abrir este lote — sus cifras, y si ya terminó",
  // Not the bare "Batch" above: that is the batch-entry mode, this is a session.
  "Batch {id}": "Sesión {id}",
  "Open": "Abierta",
  "Closed": "Cerrada",
  "Added {when}": "Agregada {when}",
  "Weighed": "Pesado",
  "Weighed on": "Pesado el",
  "On {destination} ({status})": "En {destination} ({status})",
  "draft": "borrador",
  "shipped": "enviado",
  "cancelled": "cancelado",
  "Not on a load": "Sin carga",
  "Carry on weighing": "Continuar pesando",
  "Delete": "Borrar",
  "{n} weighed session not on a load": "{n} sesión pesada sin carga",
  "{n} weighed sessions not on a load": "{n} sesiones pesadas sin carga",

  // One session opened up
  "Vendor": "Proveedor",
  "BOL": "BOL",
  "Brand": "Marca",
  "EST": "EST",
  "Grade": "Grado",
  "Remarks": "Observaciones",
  "Expected": "Esperadas",
  "Added": "Agregada",
  "Edit details": "Editar datos",
  "Remarks: {remarks}": "Observaciones: {remarks}",
  "Boxes": "Cajas",
  "Print tag": "Imprimir etiqueta",
  "({n} voided, not in that total)": "({n} anuladas, no incluidas en ese total)",
  "No boxes were recorded in this session.": "No se registraron cajas en esta sesión.",
  "Voided: {reason}": "Anulada: {reason}",
  "no reason given": "sin motivo",
  "The rest of this heading is reception's to change.":
    "El resto de este encabezado lo cambia recepción.",
  "Save": "Guardar",
  "Cancel": "Cancelar",
  "Previous lot": "Lote anterior",
  "Next lot": "Lote siguiente",
  "Session updated": "Sesión actualizada",
  "Could not save": "No se pudo guardar",

  // ── Flagging a session as a mistake ───────────────────────────────────────
  // Raised at the bench, cleared by whoever sorts it out. It removes nothing,
  // and the Spanish has to be as clear about that as the English.
  "Flag": "Marcar",
  "Flagged": "Marcada",
  "Flag it": "Marcarla",
  "Flag this session?": "¿Marcar esta sesión?",
  "This session is flagged": "Esta sesión está marcada",
  "Flag this session as a mistake": "Marcar esta sesión como un error",
  "Flagged by {who}": "Marcada por {who}",
  "Raised by {who}.": "Marcada por {who}.",
  "Already flagged.": "Ya está marcada.",
  "Reason: {reason}": "Motivo: {reason}",
  "Session {id}": "Sesión {id}",
  "This removes nothing. The session keeps counting until an admin looks at it — it just shows up in red, and on the daily report, so somebody does.":
    "Esto no borra nada. La sesión sigue contando hasta que un administrador la revise — solo aparece en rojo, y en el reporte diario, para que alguien la vea.",
  "What is wrong with it?": "¿Qué tiene de malo?",
  "Weighed the wrong pallet, double-counted, wrong lot…":
    "Se pesó la tarima equivocada, se contó dos veces, lote equivocado…",
  "Clear the flag": "Quitar la marca",
  "Update the reason": "Actualizar el motivo",
  "Flag cleared": "Marca quitada",
  "The session is back to normal.": "La sesión vuelve a la normalidad.",
  "Nothing was removed — an admin decides what happens to it.":
    "No se borró nada — un administrador decide qué pasa con ella.",
  "Could not flag it": "No se pudo marcar",
  "Could not clear the flag": "No se pudo quitar la marca",

  // Loads
  "Loads": "Cargas",
  "Draft": "Borrador",
  "Shipped": "Enviado",
  "Cancelled": "Cancelado",
  "Nothing has shipped yet. Start a shipment, add the lots going on the truck, then ship it — that is the point stock comes out of inventory.":
    "Todavía no ha salido nada. Empiece un envío, agregue los lotes que van en el camión y luego envíelo — ahí es cuando el inventario se descuenta.",
  "BOL {bol}": "BOL {bol}",
  "{n} lot": "{n} lote",
  "{n} lots": "{n} lotes",
  "No lots on this load yet.": "Todavía no hay lotes en esta carga.",
  "Raw": "Crudo",
  "RAW": "CRUDO",
  "{boxes} boxes · {weight} lb weighed": "{boxes} cajas · {weight} lb pesadas",
  "Not weighed": "Sin pesar",
  "Weigh boxes": "Pesar cajas",
  "Remove": "Quitar",
  "Total": "Total",
  "Lot to ship": "Lote a enviar",
  "Weight (lbs)": "Peso (lb)",
  "Cases": "Cajas",
  "Add lot": "Agregar lote",
  "Could not load what is in stock — the list above may be incomplete. {error}":
    "No se pudo cargar lo que hay en inventario — la lista de arriba puede estar incompleta. {error}",
  "{lot} is not in the lot registry": "{lot} no está en el registro de lotes",
  ", so it cannot go on a load: every line is attributed to a lot, which is what makes a yield possible. Open its registration form and set the lot, then come back — it will be selectable here.":
    ", así que no puede ir en una carga: cada línea se asigna a un lote, y eso es lo que permite calcular el rendimiento. Abra su formulario de registro y asigne el lote, luego regrese — aquí se podrá seleccionar.",
  "{lot} has processing still open. You can ship it anyway.":
    "{lot} todavía tiene procesamiento abierto. Puede enviarlo de todos modos.",
  "{lot} is raw — it has not been processed. The {weight} lb is the weight registered on arrival, not a live figure: processing takes cases off a lot, not pounds. {cases} cases are left.":
    "{lot} está crudo — no se ha procesado. Las {weight} lb son el peso registrado a la llegada, no una cifra actual: el procesamiento descuenta cajas del lote, no libras. Quedan {cases} cajas.",
  "Weighed on the dock": "Pesado en el andén",
  "differs from the {weight} lb being shipped": "difiere de las {weight} lb que se envían",
  "Imported": "Importada",
  "Untie": "Separar",
  "{n} weighed lot is not on this load yet.": "{n} lote pesado todavía no está en esta carga.",
  "{n} weighed lots are not on this load yet.": "{n} lotes pesados todavía no están en esta carga.",
  "Boxes weighed here do not ship on their own — a lot has to be on the load for stock to move and for it to reach the packing list.":
    "Las cajas pesadas aquí no salen solas — el lote tiene que estar en la carga para que se mueva el inventario y aparezca en la lista de empaque.",
  "Add {n} weighed lot to the load": "Agregar {n} lote pesado a la carga",
  "Add {n} weighed lots to the load": "Agregar {n} lotes pesados a la carga",
  "Tie a weighing session (optional)": "Unir una sesión de pesaje (opcional)",
  "Tie sessions": "Unir sesiones",
  "Tie {n} session": "Unir {n} sesión",
  "Tie {n} sessions": "Unir {n} sesiones",
  "Packing list": "Lista de empaque",
  "Weighed boxes are tied to this load but no lot is on it yet. Add them as lines first.":
    "Hay cajas pesadas unidas a esta carga pero todavía no tiene lotes. Agréguelas primero como líneas.",
  "Add at least one lot to ship.": "Agregue al menos un lote para enviar.",
  "Ship": "Enviar",
  "Cancel shipment": "Cancelar envío",
  "Delete draft": "Borrar borrador",
  "Delete shipment": "Borrar envío",
  "Shipped {when}": "Enviado {when}",

  // Making or correcting a load
  "Edit shipment": "Editar envío",
  "Customer": "Cliente",
  "Ship date": "Fecha de envío",
  "Ship to": "Enviar a",
  "BOL #": "BOL #",
  "Carrier": "Transportista",
  "Driver": "Chofer",
  "Save changes": "Guardar cambios",
  "Create draft": "Crear borrador",

  // Shipping, cancelling, deleting
  "Ship this load?": "¿Enviar esta carga?",
  "This deducts every lot below from stock and closes the shipment to further changes. Cancelling afterwards puts the stock back.":
    "Esto descuenta del inventario todos los lotes de abajo y cierra el envío a más cambios. Si se cancela después, el inventario se restaura.",
  "{n} lot shipping unweighed — {lots}.": "{n} lote sale sin pesar — {lots}.",
  "{n} lots shipping unweighed — {lots}.": "{n} lotes salen sin pesar — {lots}.",
  "Nothing was weighed off the bench for it, so that lot will never have a yield. Weigh the boxes first if they are still here.":
    "No se pesó nada en la mesa para él, así que ese lote nunca tendrá rendimiento. Pese las cajas primero si todavía están aquí.",
  "Nothing was weighed off the bench for them, so those lots will never have a yield. Weigh the boxes first if they are still here.":
    "No se pesó nada en la mesa para ellos, así que esos lotes nunca tendrán rendimiento. Pese las cajas primero si todavía están aquí.",
  "{weight} lb total": "{weight} lb en total",
  "Ship it": "Enviarla",
  "Cancel this shipment?": "¿Cancelar este envío?",
  "Every lot on it goes back into stock. The shipment stays on the record marked cancelled — it is not deleted, so what left and came back is still visible.":
    "Todos sus lotes vuelven al inventario. El envío queda en el registro marcado como cancelado — no se borra, así que lo que salió y regresó sigue visible.",
  "Delete this draft?": "¿Borrar este borrador?",
  "Delete this shipment?": "¿Borrar este envío?",
  "The draft and its lines are gone for good. Nothing has shipped from it, so no stock moves and there is nothing to restore.":
    "El borrador y sus líneas se borran definitivamente. No ha salido nada de él, así que no se mueve inventario y no hay nada que restaurar.",
  "The shipment and its lines are gone for good — it will not appear on any record afterwards.":
    "El envío y sus líneas se borran definitivamente — no aparecerá en ningún registro después.",
  "This load has already shipped.": "Esta carga ya salió.",
  "Its weight goes back into stock first, so inventory stays right. But the load itself is destroyed — if you want what went out and came back to stay visible,":
    "Primero su peso vuelve al inventario, así que el inventario queda bien. Pero la carga en sí se destruye — si quiere que lo que salió y regresó siga visible,",
  "cancel it instead": "cancélela en su lugar",
  "Already cancelled, so its stock went back at that point. Nothing moves now — this only removes the record.":
    "Ya está cancelado, así que su inventario regresó en ese momento. Ahora no se mueve nada — esto solo quita el registro.",
  "{n} weighing session tied to it is released — the sessions and their boxes are untouched.":
    "Se libera {n} sesión de pesaje unida a él — las sesiones y sus cajas no se tocan.",
  "{n} weighing sessions tied to it are released — the sessions and their boxes are untouched.":
    "Se liberan {n} sesiones de pesaje unidas a él — las sesiones y sus cajas no se tocan.",

  // Toasts
  "Could not load shipments": "No se pudieron cargar los envíos",
  "Could not open that shipment": "No se pudo abrir ese envío",
  "Could not open that session": "No se pudo abrir esa sesión",
  "That did not work": "Eso no funcionó",
  "{lot}: asked {asked}, on hand {onHand}": "{lot}: se pidió {asked}, hay {onHand}",
  "Weighing sessions tied": "Sesiones de pesaje unidas",
  "Shipment updated": "Envío actualizado",
  "Draft created": "Borrador creado",
  "That stock row is no longer available — refresh and pick again.":
    "Esa fila de inventario ya no está disponible — actualice y vuelva a elegir.",
  "Lot added": "Lote agregado",
  "Boxes tied to this load": "Cajas unidas a esta carga",
  "Weights saved, but not tied to the load": "Pesos guardados, pero no unidos a la carga",
  "{error} — tie the session to the load by hand below.":
    "{error} — una la sesión a la carga a mano, abajo.",
  "Every weighed lot is already on this load.": "Todos los lotes pesados ya están en esta carga.",
  "Weighed lots added to this load": "Lotes pesados agregados a esta carga",
  "{n} line moved no stock": "{n} línea no movió inventario",
  "{n} lines moved no stock": "{n} líneas no movieron inventario",
  "{lines} — not in NTI inventory, so nothing was deducted.":
    "{lines} — no está en el inventario de NTI, así que no se descontó nada.",
  "Shipped — stock deducted": "Enviado — inventario descontado",
  "Cancelled — stock restored": "Cancelado — inventario restaurado",
  "Shipment deleted": "Envío borrado",
  "No weighed sessions match “{q}”.": "Ninguna sesión pesada coincide con “{q}”.",
  "Not shipped yet": "Todavía sin enviar",
  "Shipped loads": "Cargas enviadas",
  "Loads being built": "Cargas en preparación",
  "Cancelled loads": "Cargas canceladas",
  "Nothing is waiting for a load.": "No hay nada esperando una carga.",
  "No load is being built. Start one with New shipment.":
    "No hay ninguna carga en preparación. Empiece una con Nuevo envío.",
  "Nothing has shipped yet.": "Todavía no ha salido nada.",
  "Could not tie those sessions": "No se pudieron unir esas sesiones",
  "Could not untie that session": "No se pudo separar esa sesión",
  "Could not save the shipment": "No se pudo guardar el envío",
  "Could not create the draft": "No se pudo crear el borrador",
  "Could not add that lot": "No se pudo agregar ese lote",
  "Could not add the weighed lots": "No se pudieron agregar los lotes pesados",
  "Could not remove that lot": "No se pudo quitar ese lote",
  "Could not ship this load": "No se pudo enviar esta carga",
  "Could not cancel this shipment": "No se pudo cancelar este envío",
  "Could not delete this shipment": "No se pudo borrar este envío",
  "No loads match “{q}”.": "Ninguna carga coincide con “{q}”.",

  // ── A lot's timeline, opened from the Outgoing tab ────────────────────────
  // Translated only when opened from there: the Registration Forms tab opens
  // the same window and stays English.
  "Lot {lot}": "Lote {lot}",
  "Closed@lot": "Cerrado",
  "Received": "Recibido",
  "Registered": "Registrado",
  "Processing": "En proceso",
  "Processed": "Procesado",
  "Re-stocked": "Reabastecido",
  "Report filed": "Reporte entregado",
  "Rejected": "Rechazado",
  "On a load": "En una carga",
  "Load cancelled": "Carga cancelada",
  "Weighed out": "Pesado de salida",
  "Weighed in": "Pesado de entrada",
  "Boxes in": "Cajas de entrada",
  "Boxes out": "Cajas de salida",
  "Raw on hand": "Crudo disponible",
  "In processing": "En proceso",
  "Cases out": "Cajas procesadas",
  "Yield": "Rendimiento",
  "Yield not measured": "Rendimiento sin medir",
  "{in} lb came in. Nothing has been weighed out of this lot yet.":
    "Entraron {in} lb. Todavía no se ha pesado nada de salida de este lote.",
  "Nothing has been weighed on either side of this lot.":
    "No se ha pesado nada ni de entrada ni de salida en este lote.",
  "{out} lb weighed out, but nothing recorded coming in to divide it by.":
    "{out} lb pesadas de salida, pero no hay nada registrado de entrada para dividirlo.",
  "{out} out of {in} lb · {unaccounted} unaccounted":
    "{out} de {in} lb · {unaccounted} sin justificar",
  "against the form's original weight, not bench weights":
    "contra el peso original del formulario, no pesos de la mesa",
  " by {who}": " por {who}",
  " on {date}": " el {date}",
  " — frozen at {pct}% ({out} out of {in} lb)": " — congelado en {pct}% ({out} de {in} lb)",
  " — no yield was measured": " — no se midió el rendimiento",
  "Nothing has left this lot in {n} days.": "No ha salido nada de este lote en {n} días.",
  "{in} lb in, {out} lb out, {unaccounted} unaccounted":
    "{in} lb de entrada, {out} lb de salida, {unaccounted} sin justificar",
  "Close lot": "Cerrar lote",
  "Reopen lot": "Reabrir lote",
  "History": "Historial",
  "Nothing has happened to this lot yet beyond being issued.":
    "A este lote todavía no le ha pasado nada aparte de emitirse.",
  "Lot closed": "Lote cerrado",
  "Lot reopened": "Lote reabierto",
  "Could not close this lot": "No se pudo cerrar este lote",
  "Could not reopen this lot": "No se pudo reabrir este lote",
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
  // Spanish genders a word by what it describes and English does not, so
  // { _as: "lot" } tries "Closed@lot" before "Closed". English is unaffected.
  const as = vars && vars._as;
  const out = (lang === "es" && ((as && ES[`${text}@${as}`]) || ES[text])) || text;
  if (!vars) return out;
  return out.replace(/\{(\w+)\}/g, (whole, key) =>
    (vars[key] === undefined || vars[key] === null ? whole : String(vars[key])));
};

export default ES;
