/* ============================================================
 * parser.js — Convierte una frase natural en { importe, concepto }
 *
 * Ejemplos que entiende:
 *   "20 en gimnasio"          → 20,00 €  · "Gimnasio"
 *   "3€ en cafetería uni"     → 3,00 €   · "Cafetería uni"
 *   "12,50 en cena con amigos"→ 12,50 €  · "Cena con amigos"
 *   "gimnasio 20"             → 20,00 €  · "Gimnasio"
 *   "2 cafés 3 euros"         → 3,00 €   · "2 cafés"   (manda el número con "€"/"euros")
 *   "1.250,50 alquiler"       → 1250,50 €· "Alquiler"
 *
 * Además detecta otros tipos de movimiento por cómo EMPIEZA la frase:
 *   "+50 paga" / "ingreso 50 beca" / "nómina 900" → tipo "ingreso" (suma dinero)
 *   "retiro 40" / "cajero 40"                    → tipo "traspaso" (cuenta → efectivo)
 *   cualquier otra cosa                          → tipo "gasto"
 *
 * Reglas para elegir el importe cuando hay varios números:
 *   1º el que lleve "€", "euro(s)" o "eur" pegado;
 *   2º si no, el que esté al principio de la frase;
 *   3º si no, el que esté al final;
 *   4º si no, el primero.
 * ============================================================ */

/**
 * Convierte un texto numérico a CÉNTIMOS (entero, puede ser 0).
 * Devuelve null si el formato no es válido.
 * Acepta "12", "12,50", "12.50", "1.250,50", "1,250.50", "3 €", "3 euros".
 */
function aCentimos(texto) {
  const s = String(texto).replace(/€|euros?|eur/gi, '').replace(/\s/g, '');
  if (!/^\d+(?:[.,]\d+)*$/.test(s)) return null;

  const ultimaComa = s.lastIndexOf(',');
  const ultimoPunto = s.lastIndexOf('.');
  let posDecimal = -1; // posición del separador decimal (-1 = no hay decimales)

  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    // Hay coma y punto: el que aparece más a la derecha es el decimal ("1.250,50" / "1,250.50")
    posDecimal = Math.max(ultimaComa, ultimoPunto);
  } else if (ultimaComa >= 0) {
    // Solo comas: en español la coma es decimal, salvo "1,234,567" (varias → miles)
    if (s.split(',').length === 2) posDecimal = ultimaComa;
  } else if (ultimoPunto >= 0) {
    // Solo puntos: "12.5" / "12.50" son decimales; "1.250" / "1.250.000" son miles
    const grupos = s.split('.');
    const tras = s.length - ultimoPunto - 1;
    if (grupos.length === 2 && tras !== 3) posDecimal = ultimoPunto;
  }

  const entero = (posDecimal >= 0 ? s.slice(0, posDecimal) : s).replace(/[.,]/g, '');
  const decimales = posDecimal >= 0 ? s.slice(posDecimal + 1) : '';
  const cent = Math.round(parseFloat(`${entero || '0'}.${decimales || '0'}`) * 100);
  return Number.isFinite(cent) ? cent : null;
}

/** Importe de un gasto/ingreso: debe ser mayor que 0. Devuelve céntimos o null. */
export function parseImporte(texto) {
  const cent = aCentimos(texto);
  return cent !== null && cent > 0 ? cent : null;
}

/**
 * Saldo de una cuenta: admite 0, vacío (= 0) y negativos ("-20,50").
 * Devuelve céntimos o null si no es un número válido.
 */
export function parseSaldo(texto) {
  const t = String(texto).trim();
  if (t === '') return 0;
  const negativo = t.startsWith('-');
  const cent = aCentimos(negativo ? t.slice(1) : t);
  return cent === null ? null : negativo ? -cent : cent;
}

/** Marca de moneda justo antes ("€12") o después ("12€", "12 euros") del número. */
const ANTES_EUR = /€\s*$/;
const DESPUES_EUR = /^\s*(?:€|euros?\b|eur\b)/i;

/* Cómo empieza la frase para saber si NO es un gasto */
// OJO: no usamos \b porque en JavaScript no reconoce las letras con tilde ("ingresé").
// En su lugar: (?![\p{L}\d]) = "a continuación no hay otra letra o número".
const PREFIJO_INGRESO = /^\s*\+\s*/;                                                    // "+50 paga" (se quita el +)
const VERBO_INGRESO = /^\s*(?:ingresos?|ingresé|ingrese|cobro|cobré)(?![\p{L}\d])[\s:]*/iu; // "ingreso 50 beca" (se quita)
const CONCEPTO_INGRESO = /^\s*(?:nómina|nomina|paga|beca)(?![\p{L}\d])/iu;  // "beca 300" (se conserva)
const VERBO_RETIRADA = /^\s*(?:retiro|retiré|retire|saco|saqué|saque|cajero)(?![\p{L}\d])[\s:]*/iu; // "retiro 40"

/**
 * Interpreta una frase.
 * @returns {{ok:true, tipo:'gasto'|'ingreso'|'traspaso', importeCent:number, concepto:string} | {ok:false, error:string}}
 */
export function interpretarFrase(frase) {
  let t = String(frase).trim();
  if (!t) return { ok: false, error: 'Escribe algo como «3,50 en café».' };

  // 0. ¿Es un ingreso o una retirada de cajero? (por cómo empieza la frase)
  let tipo = 'gasto';
  if (PREFIJO_INGRESO.test(t)) { tipo = 'ingreso'; t = t.replace(PREFIJO_INGRESO, ''); }
  else if (VERBO_INGRESO.test(t)) { tipo = 'ingreso'; t = t.replace(VERBO_INGRESO, ''); }
  else if (CONCEPTO_INGRESO.test(t)) tipo = 'ingreso';
  else if (VERBO_RETIRADA.test(t)) { tipo = 'traspaso'; t = t.replace(VERBO_RETIRADA, ''); }

  // 1. Localizar todos los números del texto
  const candidatos = [];
  for (const m of t.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const ini = m.index;
    const fin = ini + m[0].length;
    const antes = t.slice(0, ini);
    const despues = t.slice(fin);
    const marcaAntes = ANTES_EUR.test(antes);
    const marcaDespues = despues.match(DESPUES_EUR);

    // Ignora números pegados a letras ("mp3", "2kg"), salvo "12euros"
    if (/\p{L}$/u.test(antes)) continue;
    if (/^\p{L}/u.test(despues) && !marcaDespues) continue;

    candidatos.push({
      texto: m[0],
      conMoneda: marcaAntes || Boolean(marcaDespues),
      // Zona a eliminar del texto para quedarnos con el concepto (número + "€")
      desde: marcaAntes ? antes.search(ANTES_EUR) : ini,
      hasta: marcaDespues ? fin + marcaDespues[0].length : fin,
      alPrincipio: antes.trim() === '' || /^\s*€\s*$/.test(antes),
      alFinal: despues.trim() === '' || marcaDespues !== null && despues.slice(marcaDespues[0].length).trim() === '',
    });
  }
  if (!candidatos.length) {
    return { ok: false, error: 'No encuentro el importe. Prueba con «3,50 en café».' };
  }

  // 2. Elegir cuál es el importe
  const elegido =
    candidatos.find((c) => c.conMoneda) ??
    (candidatos.length === 1 ? candidatos[0] : null) ??
    candidatos.find((c) => c.alPrincipio) ??
    candidatos.find((c) => c.alFinal) ??
    candidatos[0];

  const importeCent = parseImporte(elegido.texto);
  if (importeCent === null) {
    return { ok: false, error: 'El importe no es válido o es 0. Ejemplo: «12,50 en cena».' };
  }

  // 3. El concepto es lo que sobra, limpiando conectores ("en", "de", "para"...)
  let concepto = `${t.slice(0, elegido.desde)} ${t.slice(elegido.hasta)}`.replace(/\s+/g, ' ').trim();
  concepto = concepto.replace(/^[\s,.;:-]+/, '');
  let previo;
  do {
    previo = concepto;
    concepto = concepto.replace(/^(?:en|de|del|para|por|a|al|el|la|los|las)\s+/i, '');
  } while (concepto !== previo);
  concepto = concepto.replace(/[\s,.;:-]+$/, '').trim();

  if (!concepto) concepto = 'Sin concepto';
  concepto = concepto.charAt(0).toUpperCase() + concepto.slice(1);

  return { ok: true, tipo, importeCent, concepto };
}
