import { useCallback, useEffect, useState } from "react";

/**
 * Historial de reportes generados.
 *
 * El diagrama de base de datos (KronosDiagrama_v2) NO tiene una tabla de
 * reportes, así que el historial se guarda en este navegador (localStorage).
 * Los reportes se pueden volver a generar siempre desde los datos reales
 * (inventarios, movimientos), por lo que no se pierde información de negocio.
 */
const CLAVE = "kronos-reportes-generados";
const EVENTO = "kronos-reportes-cambio";

function leer() {
  try {
    const lista = JSON.parse(localStorage.getItem(CLAVE) || "[]");
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

function escribir(lista) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(lista.slice(0, 200)));
  } catch {
    /* almacenamiento lleno o bloqueado: el historial es opcional */
  }
  window.dispatchEvent(new Event(EVENTO));
}

export function guardarReporteLocal(reporte) {
  const id = globalThis.crypto?.randomUUID?.() || `rep-${Date.now()}`;
  escribir([{ id, fecha: new Date().toISOString(), ...reporte }, ...leer()]);
}

export function eliminarReporteLocal(id) {
  escribir(leer().filter((r) => r.id !== id));
}

/** Misma forma que useRealtimeTable: { datos, cargando }. */
export function useReportesLocales() {
  const [datos, setDatos] = useState(leer);
  const refrescar = useCallback(() => setDatos(leer()), []);

  useEffect(() => {
    window.addEventListener(EVENTO, refrescar);
    window.addEventListener("storage", refrescar);
    return () => {
      window.removeEventListener(EVENTO, refrescar);
      window.removeEventListener("storage", refrescar);
    };
  }, [refrescar]);

  return { datos, cargando: false };
}
