/**
 * CLIENTE "COMPATIBLE"
 * ------------------------------------------------------------------
 * Envuelve al cliente real de supabase-js. Cuando una página hace
 *     supabase.from("productos").select("*").eq("id", 3)
 * y "productos" es una entidad lógica (ver entidades.js), la consulta se
 * traduce a las tablas reales del esquema MySQL. Cualquier otra cosa
 * (auth, reportes_generados, ...) pasa directo al cliente real.
 *
 * Métodos soportados (los que usa el proyecto): select, insert, update,
 * delete, eq, in, order, limit, single, maybeSingle, rpc, channel.
 */

import { fijarCliente, normalizarError } from "./nucleo";
import { ENTIDADES, RPC_LOCALES, T, fijarUsuarioActual } from "./entidades";

export { fijarUsuarioActual };

let real = null;

const comparar = (a, b) => {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "es", { numeric: true, sensitivity: "base" });
};

class Consulta {
  constructor(logico) {
    this.logico = logico;
    this.entidad = ENTIDADES[logico];
    this.op = "select";
    this.filtros = [];
    this.orden = null;
    this.tope = null;
    this.datos = null;
    this.devolver = false;
    this.uno = null;
  }

  select() {
    if (this.op !== "select") this.devolver = true;
    return this;
  }
  insert(datos) {
    this.op = "insert";
    this.datos = datos;
    return this;
  }
  update(datos) {
    this.op = "update";
    this.datos = datos;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(columna, valor) {
    this.filtros.push((fila) => String(fila[columna]) === String(valor));
    return this;
  }
  in(columna, valores) {
    const set = new Set((valores || []).map(String));
    this.filtros.push((fila) => set.has(String(fila[columna])));
    return this;
  }
  order(columna, { ascending = true } = {}) {
    this.orden = { columna, ascending };
    return this;
  }
  limit(n) {
    this.tope = n;
    return this;
  }
  single() {
    this.uno = "single";
    return this;
  }
  maybeSingle() {
    this.uno = "maybe";
    return this;
  }

  _filtrar(filas) {
    let salida = filas.filter((f) => this.filtros.every((fn) => fn(f)));
    if (this.orden) {
      const { columna, ascending } = this.orden;
      salida = [...salida].sort((a, b) => (ascending ? 1 : -1) * comparar(a[columna], b[columna]));
    }
    if (this.tope !== null) salida = salida.slice(0, this.tope);
    return salida;
  }

  async _ejecutar() {
    const e = this.entidad;
    let filas;

    if (this.op === "select") {
      filas = this._filtrar(await e.leer());
    } else if (this.op === "insert") {
      const lista = Array.isArray(this.datos) ? this.datos : [this.datos];
      filas = [];
      for (const dato of lista) filas.push(await e.insertar(dato));
      if (!this.devolver) return { data: null, error: null };
    } else if (this.op === "update") {
      const objetivo = this._filtrar(await e.leer());
      filas = [];
      for (const fila of objetivo) filas.push(await e.actualizar(fila, this.datos));
      if (!this.devolver) return { data: null, error: null };
    } else {
      const objetivo = this._filtrar(await e.leer());
      for (const fila of objetivo) await e.eliminar(fila);
      filas = objetivo;
      if (!this.devolver) return { data: null, error: null };
    }

    filas = filas.filter(Boolean);
    if (this.uno === "single") {
      if (filas.length !== 1) {
        return {
          data: null,
          error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
        };
      }
      return { data: filas[0], error: null };
    }
    if (this.uno === "maybe") return { data: filas[0] ?? null, error: null };
    return { data: filas, error: null };
  }

  then(resolver, rechazar) {
    return this._ejecutar()
      .catch((error) => {
        console.error(`[Kronos] Error en "${this.logico}":`, error);
        return { data: null, error: normalizarError(error) };
      })
      .then(resolver, rechazar);
  }
}

/* ----------------------------- tiempo real ----------------------------- */

/**
 * Reemplaza a supabase.channel(): cada `.on("postgres_changes", {table})`
 * sobre una entidad lógica se convierte en suscripciones a las tablas
 * físicas que la componen (con sus nombres reales).
 */
class CanalCompat {
  constructor(nombre) {
    this.nombre = nombre;
    this.registros = [];
    this.canalReal = null;
    this.cerrado = false;
  }

  on(tipo, filtro, devolucion) {
    this.registros.push({ tipo, filtro, devolucion });
    return this;
  }

  subscribe() {
    this._iniciar().catch((error) => console.warn("[Kronos] Tiempo real no disponible:", error.message));
    return this;
  }

  async _iniciar() {
    const canal = real.channel(this.nombre);
    for (const { tipo, filtro, devolucion } of this.registros) {
      const entidad = ENTIDADES[filtro.table];
      if (!entidad) {
        canal.on(tipo, filtro, devolucion);
        continue;
      }
      for (const fisica of entidad.fisicas) {
        const tabla = T[fisica];
        await tabla.asegurarTabla();
        canal.on(tipo, { event: filtro.event || "*", schema: filtro.schema || "public", table: tabla.nombre }, devolucion);
      }
    }
    if (this.cerrado) return;
    this.canalReal = canal;
    canal.subscribe();
  }

  cerrar() {
    this.cerrado = true;
    return this.canalReal ? real.removeChannel(this.canalReal) : Promise.resolve("ok");
  }
}

/* ------------------------------ diagnóstico ----------------------------- */

/** En la consola del navegador:  await kronosDiagnostico()  */
export async function diagnostico() {
  const salida = [];
  for (const tabla of Object.values(T)) {
    try {
      await tabla.asegurarTabla();
      const filas = await tabla.leer();
      salida.push({ ...tabla.resumen(), filas: filas.length, error: null });
    } catch (error) {
      salida.push({ tabla: tabla.canonico, nombreReal: tabla.nombre, filas: null, error: error.message });
    }
  }
  console.table(salida.map(({ tabla, nombreReal, filas, error }) => ({ tabla, nombreReal, filas, error })));
  return salida;
}

/* ------------------------------ cliente final --------------------------- */

export function crearClienteCompat(clienteReal) {
  real = clienteReal;
  fijarCliente(clienteReal);

  if (typeof window !== "undefined") window.kronosDiagnostico = diagnostico;

  return new Proxy(clienteReal, {
    get(objetivo, propiedad) {
      if (propiedad === "from") {
        return (nombre) => (ENTIDADES[nombre] ? new Consulta(nombre) : objetivo.from(nombre));
      }
      if (propiedad === "rpc") {
        return async (nombre, argumentos) => {
          if (RPC_LOCALES[nombre]) {
            try {
              return { data: await RPC_LOCALES[nombre](argumentos || {}), error: null };
            } catch (error) {
              return { data: null, error: normalizarError(error) };
            }
          }
          return objetivo.rpc(nombre, argumentos);
        };
      }
      if (propiedad === "channel") return (nombre) => new CanalCompat(nombre);
      if (propiedad === "removeChannel") {
        return (canal) => (canal instanceof CanalCompat ? canal.cerrar() : objetivo.removeChannel(canal));
      }
      const valor = objetivo[propiedad];
      return typeof valor === "function" ? valor.bind(objetivo) : valor;
    },
  });
}
