import { useCallback, useEffect, useState } from "react";
import { supabase } from "../api/supabase";
import { CONJUNTOS } from "../api/db";

let contadorCanales = 0;

/** Ordena filas ya mapeadas por una clave (texto, número o fecha). */
function ordenarFilas(filas, clave, ascendente) {
  const dir = ascendente ? 1 : -1;
  return [...filas].sort((a, b) => {
    const x = a[clave];
    const y = b[clave];
    if (x == null && y == null) return 0;
    if (x == null) return -dir;
    if (y == null) return dir;
    if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
    return String(x).localeCompare(String(y), "es", { numeric: true, sensitivity: "base" }) * dir;
  });
}

/**
 * Hook genérico de lectura + tiempo real para una tabla de Supabase.
 *
 * Se usa en todas las páginas del panel del jefe para no repetir 10
 * veces el mismo patrón "cargar + suscribirse a postgres_changes +
 * limpiar al desmontar". Cubre el requisito de la sección 2/3/4/5/6/7
 * del prompt: "Conexión en tiempo real (supabase.channel con
 * suscripción a postgres_changes)".
 *
 * @param {string} tabla - nombre de la tabla en Supabase.
 * @param {object} [opciones]
 * @param {string} [opciones.orderBy] - columna por la que ordenar.
 * @param {boolean} [opciones.ascending=false] - orden ascendente/descendente.
 * @param {string} [opciones.select="*"] - columnas a traer (para joins, etc).
 * @param {string} [opciones.filtroColumna] - columna para filtrar con `.eq()`
 *        (ej. "proveedor_id"). Útil para que un proveedor solo vea SUS
 *        propias filas. Si se pasa, la suscripción realtime también se
 *        limita a esa columna/valor (postgres_changes `filter`).
 * @param {string|number} [opciones.filtroValor] - valor a comparar con
 *        `filtroColumna`. Mientras sea `null`/`undefined` (ej. porque aún
 *        no se cargó el id del proveedor logueado), el hook NO consulta
 *        nada y deja `cargando en true` — evita traer datos de más.
 *
 * @returns {{
 *   datos: any[],
 *   cargando: boolean,
 *   error: string|null,
 *   recargar: () => Promise<void>,
 *   setDatos: Function,
 * }}
 *
 * Si `tabla` es uno de los CONJUNTOS de src/api/db.js (productos, movimientos,
 * proveedores, ordenes_compra, pedidos_cliente, historial_compras, garantias,
 * alertas, categorias, marcas, unidades) los datos se arman uniendo las tablas
 * reales del diagrama y se escucha el realtime de TODAS ellas.
 */
export function useRealtimeTable(tabla, opciones = {}) {
  const { orderBy, ascending = false, select = "*", filtroColumna, filtroValor } = opciones;
  const [datos, setDatos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  // Conjuntos "virtuales" (productos, movimientos, garantias, ...): se arman
  // en src/api/db.js uniendo varias tablas normalizadas del diagrama.
  const conjunto = CONJUNTOS[tabla];

  // Si se pidió filtrar por columna pero el valor todavía no está listo
  // (ej. esperando el id del proveedor logueado), no consultamos nada.
  const filtroPendiente = Boolean(filtroColumna) && (filtroValor === null || filtroValor === undefined);

  const recargar = useCallback(async () => {
    if (filtroPendiente) {
      setDatos([]);
      setCargando(false);
      return;
    }
    setCargando(true);
    setError(null);
    try {
      let filas;
      if (conjunto) {
        filas = await conjunto.cargar();
        if (filtroColumna) filas = filas.filter((f) => String(f[filtroColumna]) === String(filtroValor));
        if (orderBy) filas = ordenarFilas(filas, orderBy, ascending);
      } else {
        let consulta = supabase.from(tabla).select(select);
        if (filtroColumna) consulta = consulta.eq(filtroColumna, filtroValor);
        if (orderBy) consulta = consulta.order(orderBy, { ascending });
        const { data, error: errorConsulta } = await consulta;
        if (errorConsulta) throw errorConsulta;
        filas = data || [];
      }
      setDatos(filas);
    } catch (err) {
      console.error(`Error cargando "${tabla}":`, err.message);
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }, [tabla, conjunto, orderBy, ascending, select, filtroColumna, filtroValor, filtroPendiente]);

  useEffect(() => {
    let activo = true;
    recargar();

    if (filtroPendiente) return undefined;

    // Varias pantallas pueden usar el mismo conjunto a la vez: cada hook
    // abre SU canal (nombre único) para no pisarse entre sí.
    const tablasReales = conjunto ? conjunto.tablas : [tabla];
    let temporizador = null;
    const recargarSuave = () => {
      // Un solo recargo aunque cambien varias tablas a la vez (p. ej. una venta).
      clearTimeout(temporizador);
      temporizador = setTimeout(() => {
        if (activo) recargar();
      }, 250);
    };

    let canal = supabase.channel(`rt:${tabla}:${++contadorCanales}`);
    tablasReales.forEach((tablaReal) => {
      canal = canal.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: tablaReal,
          ...(!conjunto && filtroColumna ? { filter: `${filtroColumna}=eq.${filtroValor}` } : {}),
        },
        recargarSuave
      );
    });
    canal.subscribe();

    return () => {
      activo = false;
      clearTimeout(temporizador);
      supabase.removeChannel(canal);
    };
  }, [recargar, tabla, conjunto, filtroColumna, filtroValor, filtroPendiente]);

  return { datos, cargando, error, recargar, setDatos };
}

/** Envuelve una operación de escritura de Supabase con SweetAlert2 + try/catch,
 *  para no repetir el mismo bloque en cada botón "Guardar" / "Eliminar". */
export async function ejecutarOperacion(operacionAsync, { onExito, onError } = {}) {
  try {
    const resultado = await operacionAsync();
    if (onExito) onExito(resultado);
    return resultado;
  } catch (error) {
    console.error(error);
    if (onError) onError(error);
    else throw error;
  }
}
