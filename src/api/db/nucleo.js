/**
 * NÚCLEO DE ACCESO A TABLAS FÍSICAS DE SUPABASE
 * ------------------------------------------------------------------
 * Las tablas que ahora existen en Supabase son las del esquema MySQL
 * (inventarios, ordenesCompra, proveedores, garantias, ...). Este
 * archivo es la única pieza que "habla" directamente con ellas.
 *
 * Qué resuelve:
 *  1. Nombres de tabla/columna. En Postgres un nombre con mayúsculas solo
 *     existe si se creó entre comillas. Como no sabemos cómo se crearon
 *     tus tablas en Supabase, cada nombre se prueba en 3 variantes:
 *         camelCase  ->  ordenesCompra
 *         minúsculas ->  ordenescompra
 *         snake_case ->  ordenes_compra
 *     y se recuerda la primera que funcione.
 *  2. Columnas opcionales. Algunas columnas son extensiones nuestras
 *     (ubicacion, observacion, ...). Si no existen en tu base, se omiten
 *     sin romper la pantalla (a menos que la columna sea obligatoria para
 *     esa operación; entonces se explica qué parche SQL ejecutar).
 *  3. Llaves primarias sin autonumérico (en MySQL varias eran
 *     autoincrement=False): si el insert falla por "null value", se
 *     calcula max(id)+1 y se reintenta.
 *
 * Todas las filas que entrega/recibe este archivo usan nombres CANÓNICOS
 * (los del esquema MySQL), sin importar cómo se llamen en Postgres.
 */

let cliente = null;

/** Recibe el cliente REAL de supabase-js (lo llama src/api/supabase.js). */
export function fijarCliente(real) {
  cliente = real;
}

const real = () => {
  if (!cliente) throw new Error("El cliente de Supabase aún no fue inicializado.");
  return cliente;
};

/* ----------------------------- utilidades ------------------------------ */

export const norm = (texto) => String(texto).toLowerCase().replace(/_/g, "");

const aSnake = (texto) => texto.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

export const variantesDeNombre = (canonico) =>
  [...new Set([canonico, canonico.toLowerCase(), aSnake(canonico)])];

const MENSAJE_PARCHE =
  "Ejecuta el archivo SUPABASE_PARCHE_KRONOS.sql en el SQL Editor de Supabase.";

function tablaNoExiste(error) {
  if (!error) return false;
  return (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    /could not find the table|relation .* does not exist/i.test(error.message || "")
  );
}

/** Devuelve el nombre de columna que PostgREST dice que no existe (o null). */
function columnaFaltante(error) {
  if (!error) return null;
  const mensaje = error.message || "";
  const coincidencia =
    /Could not find the '([^']+)' column/i.exec(mensaje) ||
    /column "?([\w]+)"? of relation "?[\w]+"? does not exist/i.exec(mensaje) ||
    /column\s+(?:"?[\w]+"?\.)?"?([\w]+)"?\s+does not exist/i.exec(mensaje);
  return coincidencia ? coincidencia[1] : null;
}

/** Texto -> bytea hexadecimal de Postgres (para columnas BLOB del esquema MySQL). */
export function aBytea(texto) {
  const bytes = new TextEncoder().encode(String(texto ?? ""));
  return "\\x" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** bytea (o texto) -> texto legible. */
export function deBytea(valor) {
  if (typeof valor !== "string") return "";
  if (/^\\x[0-9a-fA-F]*$/.test(valor)) {
    const hex = valor.slice(2);
    const bytes = new Uint8Array((hex.match(/../g) || []).map((h) => parseInt(h, 16)));
    return new TextDecoder().decode(bytes);
  }
  return valor;
}

/** Convierte cualquier error en un objeto { message, code, ... } con pistas claras. */
export function normalizarError(error) {
  if (!error) return { message: "Error desconocido", code: null };
  const base = error.message || String(error);
  const codigo = error.code || null;
  let mensaje = base;

  if (codigo === "KRONOS_TABLA" || codigo === "KRONOS_COLUMNA" || codigo === "KRONOS") {
    mensaje = base;
  } else if (codigo === "23503" && /still referenced|update or delete/i.test(base)) {
    mensaje =
      "No se puede eliminar: hay registros relacionados (movimientos, órdenes, ventas o garantías) que dependen de este elemento.";
  } else if (codigo === "23503") {
    mensaje = `Referencia inválida: el registro relacionado no existe. (${base})`;
  } else if (codigo === "23502") {
    mensaje = `Falta un dato obligatorio en la base de datos (${base}). ${MENSAJE_PARCHE}`;
  } else if (codigo === "42501" || /row-level security|permission denied/i.test(base)) {
    mensaje = `Supabase negó el permiso (RLS). ${MENSAJE_PARCHE} (${base})`;
  }
  return { message: mensaje, code: codigo, details: error.details || null, hint: error.hint || null };
}

export function crearError(mensaje, codigo = "KRONOS") {
  const error = new Error(mensaje);
  error.code = codigo;
  return error;
}

/* --------------------------- tabla física ------------------------------ */

/**
 * @param {string} canonico   nombre de la tabla en el esquema MySQL (ej. "ordenesCompra")
 * @param {object} columnas   { columnaCanonica: { opcional?: true, soloEscritura?: true } }
 */
export class TablaFisica {
  constructor(canonico, columnas) {
    this.canonico = canonico;
    this.spec = columnas;
    this.nombre = null; // nombre real en Postgres, se descubre al primer uso
    this.cols = {}; // columnaCanonica -> { variantes, i, ausente }
    this._promesa = null;
  }

  /* ----- nombres de columna ----- */

  _estado(canon) {
    if (!this.cols[canon]) {
      this.cols[canon] = { variantes: variantesDeNombre(canon), i: 0, ausente: false };
    }
    return this.cols[canon];
  }

  /** Nombre real (según lo aprendido hasta ahora) o null si la columna no existe. */
  col(canon) {
    const estado = this._estado(canon);
    return estado.ausente ? null : estado.variantes[estado.i];
  }

  tieneColumna(canon) {
    return this.col(canon) !== null;
  }

  /**
   * Un intento falló por la columna `nombreError`. Prueba otra variante de
   * nombre o, si es opcional, la marca como inexistente.
   * @returns {boolean} true si hay algo nuevo que reintentar.
   */
  _corregir(nombreError, obligatorias = []) {
    const objetivo = norm(nombreError);
    const canon = Object.keys(this.spec).find(
      (c) => !this._estado(c).ausente && norm(this.col(c)) === objetivo
    );
    if (!canon) return false;
    const estado = this._estado(canon);
    if (estado.i < estado.variantes.length - 1) {
      estado.i += 1;
      return true;
    }
    if (this.spec[canon].opcional && !obligatorias.includes(canon)) {
      estado.ausente = true;
      return true;
    }
    return false;
  }

  _errorColumna(error, canonDeseado) {
    const nombre = columnaFaltante(error);
    const e = crearError(
      `La tabla "${this.nombre}" no tiene la columna "${nombre || canonDeseado}". ${MENSAJE_PARCHE}`,
      "KRONOS_COLUMNA"
    );
    return e;
  }

  /* ----- descubrimiento de la tabla ----- */

  async asegurarTabla() {
    if (this.nombre) return;
    if (!this._promesa) {
      this._promesa = this._descubrir().catch((error) => {
        this._promesa = null; // permite reintentar (por si el usuario ya corrigió Supabase)
        throw error;
      });
    }
    await this._promesa;
  }

  async _descubrir() {
    const candidatas = variantesDeNombre(this.canonico);
    for (const candidata of candidatas) {
      const { data, error } = await real().from(candidata).select("*").limit(1);
      if (error && tablaNoExiste(error)) continue;
      // Existe (aunque haya otro error, p. ej. de permisos): se usa este nombre.
      this.nombre = candidata;
      if (!error && data && data.length > 0) this._aprenderDeFila(data[0]);
      return;
    }
    throw crearError(
      `No se encontró la tabla "${this.canonico}" en Supabase (probé: ${candidatas.join(", ")}). ` +
        `Revisa que exista en el esquema public. ${MENSAJE_PARCHE}`,
      "KRONOS_TABLA"
    );
  }

  /** Si la tabla tiene al menos una fila, se aprenden los nombres reales exactos. */
  _aprenderDeFila(fila) {
    const llaves = Object.keys(fila);
    for (const canon of Object.keys(this.spec)) {
      const real_ = llaves.find((k) => norm(k) === norm(canon));
      const estado = this._estado(canon);
      if (real_) {
        estado.variantes = [real_];
        estado.i = 0;
        estado.ausente = false;
      } else if (this.spec[canon].opcional) {
        estado.ausente = true;
      }
    }
  }

  /* ----- lectura ----- */

  _columnasDeLectura() {
    return Object.keys(this.spec).filter((c) => !this.spec[c].soloEscritura);
  }

  _filaACanonica(fila, pares) {
    const salida = {};
    for (const [canon, nombre] of pares) salida[canon] = fila[nombre];
    return salida;
  }

  /**
   * @param {Array<[string, any]>} filtros  pares [columnaCanonica, valor] con igualdad
   */
  async leer(filtros = []) {
    await this.asegurarTabla();
    for (let intento = 0; intento < 25; intento++) {
      const pares = this._columnasDeLectura()
        .map((c) => [c, this.col(c)])
        .filter(([, nombre]) => nombre);
      let consulta = real().from(this.nombre).select(pares.map(([, n]) => n).join(","));
      for (const [canon, valor] of filtros) consulta = consulta.eq(this.col(canon), valor);
      const { data, error } = await consulta;
      if (!error) return (data || []).map((fila) => this._filaACanonica(fila, pares));
      const faltante = columnaFaltante(error);
      if (faltante && this._corregir(faltante)) continue;
      throw error;
    }
    throw crearError(`No se pudo leer la tabla "${this.nombre}".`);
  }

  /** Mayor valor de una columna numérica (para llaves sin autonumérico). */
  async maximo(canonPk) {
    await this.asegurarTabla();
    for (let intento = 0; intento < 6; intento++) {
      const { data, error } = await real()
        .from(this.nombre)
        .select(this.col(canonPk))
        .order(this.col(canonPk), { ascending: false })
        .limit(1);
      if (!error) {
        const valor = data && data[0] ? Number(data[0][this.col(canonPk)]) : 0;
        return Number.isFinite(valor) ? valor : 0;
      }
      const faltante = columnaFaltante(error);
      if (faltante && this._corregir(faltante)) continue;
      throw error;
    }
    return 0;
  }

  /* ----- escritura ----- */

  _payload(objeto) {
    const salida = {};
    for (const [canon, valor] of Object.entries(objeto)) {
      if (valor === undefined || !this.spec[canon]) continue;
      const nombre = this.col(canon);
      if (nombre) salida[nombre] = valor;
    }
    return salida;
  }

  /**
   * Inserta una fila.
   * @param {object} objeto  claves canónicas
   * @param {{devolver?: boolean, obligatorias?: string[]}} opciones
   */
  async insertar(objeto, { devolver = true, obligatorias = [] } = {}) {
    await this.asegurarTabla();
    for (let intento = 0; intento < 25; intento++) {
      const payload = this._payload(objeto);
      let consulta = real().from(this.nombre).insert(payload);
      let pares = [];
      if (devolver) {
        pares = this._columnasDeLectura()
          .map((c) => [c, this.col(c)])
          .filter(([, n]) => n);
        consulta = consulta.select(pares.map(([, n]) => n).join(",")).single();
      }
      const { data, error } = await consulta;
      if (!error) return devolver ? this._filaACanonica(data, pares) : null;

      const faltante = columnaFaltante(error);
      if (faltante) {
        if (this._corregir(faltante, obligatorias)) continue;
        throw this._errorColumna(error, faltante);
      }
      throw error;
    }
    throw crearError(`No se pudo insertar en "${this.nombre}".`);
  }

  /**
   * Inserta dejando que la base asigne la llave primaria; si la tabla no
   * tiene autonumérico, calcula max+1 y reintenta (también ante choques).
   */
  async insertarAuto(objeto, canonPk, opciones = {}) {
    await this.asegurarTabla();
    try {
      return await this.insertar(objeto, opciones);
    } catch (error) {
      const mensaje = error && error.message ? error.message : "";
      const coincidencia = /null value in column "?([\w]+)"?/i.exec(mensaje);
      const faltaPk = error && error.code === "23502" && coincidencia && norm(coincidencia[1]) === norm(canonPk);
      // 23505: el autonumérico de la base quedó atrás (típico al importar filas con id propio).
      if (!faltaPk && !(error && error.code === "23505")) throw error;
      if (faltaPk) {
        // El mensaje trae el nombre EXACTO de la columna: se aprende para los siguientes intentos.
        const estado = this._estado(canonPk);
        estado.variantes = [coincidencia[1]];
        estado.i = 0;
        estado.ausente = false;
      }
    }
    for (let intento = 0; intento < 6; intento++) {
      const siguiente = (await this.maximo(canonPk)) + 1;
      try {
        return await this.insertar({ ...objeto, [canonPk]: siguiente }, opciones);
      } catch (error) {
        if (error && error.code === "23505") continue; // otro usuario tomó ese id
        throw error;
      }
    }
    throw crearError(`No se pudo asignar un id nuevo en "${this.nombre}".`);
  }

  /**
   * Actualiza filas que cumplan `donde` (pares canónicos con igualdad).
   * @returns {Promise<object[]>} filas actualizadas
   */
  async actualizar(cambios, donde, { obligatorias = [] } = {}) {
    await this.asegurarTabla();
    for (let intento = 0; intento < 25; intento++) {
      const payload = this._payload(cambios);
      if (Object.keys(payload).length === 0) return [];
      const pares = this._columnasDeLectura()
        .map((c) => [c, this.col(c)])
        .filter(([, n]) => n);
      let consulta = real().from(this.nombre).update(payload);
      for (const [canon, valor] of Object.entries(donde)) consulta = consulta.eq(this.col(canon), valor);
      consulta = consulta.select(pares.map(([, n]) => n).join(","));
      const { data, error } = await consulta;
      if (!error) return (data || []).map((fila) => this._filaACanonica(fila, pares));
      const faltante = columnaFaltante(error);
      if (faltante) {
        if (this._corregir(faltante, obligatorias)) continue;
        throw this._errorColumna(error, faltante);
      }
      throw error;
    }
    throw crearError(`No se pudo actualizar "${this.nombre}".`);
  }

  /** Elimina filas que cumplan `donde`. Devuelve cuántas se borraron. */
  async eliminar(donde) {
    await this.asegurarTabla();
    for (let intento = 0; intento < 6; intento++) {
      const llavePrimera = Object.keys(donde)[0];
      let consulta = real().from(this.nombre).delete();
      for (const [canon, valor] of Object.entries(donde)) consulta = consulta.eq(this.col(canon), valor);
      consulta = consulta.select(this.col(llavePrimera));
      const { data, error } = await consulta;
      if (!error) return (data || []).length;
      const faltante = columnaFaltante(error);
      if (faltante && this._corregir(faltante)) continue;
      throw error;
    }
    return 0;
  }

  /** Para el diagnóstico en consola. */
  resumen() {
    const columnas = {};
    for (const canon of Object.keys(this.spec)) columnas[canon] = this.col(canon) ?? "(no existe)";
    return { tabla: this.canonico, nombreReal: this.nombre, columnas };
  }
}
