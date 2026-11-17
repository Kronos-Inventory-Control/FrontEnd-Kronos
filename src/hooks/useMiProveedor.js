import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { cargarProveedores } from "../api/db";

/**
 * Portal del proveedor · resuelve la ficha de `proveedores` (unida con su
 * fila de `usuarios` y `direcciones`) que corresponde a la cuenta logueada.
 *
 * El enlace es: auth.users.id -> usuarios.auth_id -> proveedores.usuario_identificacion
 * (lo resuelve AuthContext y deja `perfil.proveedor_id`).
 *
 * Uso típico:
 *   const { proveedor, cargando, error } = useMiProveedor();
 *   const { datos: misOrdenes } = useRealtimeTable("ordenes_compra", {
 *     filtroColumna: "proveedor_id",
 *     filtroValor: proveedor?.id,
 *   });
 *
 * Si la cuenta tiene rol "proveedor" pero no existe su ficha, `proveedor`
 * queda en null y `error` explica qué falta.
 */
export function useMiProveedor() {
  const { usuario, perfil, cargandoSesion } = useAuth();
  const [proveedor, setProveedor] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let activo = true;

    async function cargar() {
      if (cargandoSesion) return;
      if (!usuario || !perfil) {
        setProveedor(null);
        setCargando(false);
        return;
      }
      setCargando(true);
      setError(null);
      try {
        const fichas = await cargarProveedores();
        if (!activo) return;
        const mia = fichas.find((f) => f.id === perfil.proveedor_id) || null;
        setProveedor(mia);
        if (!mia) {
          setError(
            "Tu cuenta todavía no está vinculada a una ficha de proveedor. Pide al administrador que te registre en Proveedores con el mismo correo con el que iniciaste sesión."
          );
        }
      } catch (err) {
        if (!activo) return;
        console.error("No se pudo cargar la ficha de proveedor:", err.message);
        setError(err.message);
      } finally {
        if (activo) setCargando(false);
      }
    }

    cargar();
    return () => {
      activo = false;
    };
  }, [usuario, perfil, cargandoSesion]);

  return { proveedor, cargando, error };
}
