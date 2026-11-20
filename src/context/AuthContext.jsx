import { createContext, useContext, useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import {
  borrarToken,
  guardarToken,
  obtenerToken,
  registrarAlSesionInvalida,
} from "../api/client";
import { loginApi, logoutApi, perfilApi } from "../api/authApi";
import { rolDesdeId } from "../api/roles";
import { fijarUsuarioActual } from "../api/db/compat";

const AuthContext = createContext(undefined);

/**
 * Convierte la respuesta de GET /auth/me en los objetos que ya consume el
 * resto de la app (`usuario` y `perfil`), para no tener que tocar los
 * componentes que leen perfil.nombre, perfil.telefono, usuario.email, etc.
 */
function construirSesion(me) {
  const rol = rolDesdeId(me.rol);
  if (!rol) {
    throw new Error("Tu usuario no tiene un rol válido asignado.");
  }

  return {
    usuario: {
      id: me.identificacion,
      identificacion: me.identificacion,
      email: me.correoElectronico,
    },
    perfil: {
      id: me.identificacion,
      nombre: me.nombre,
      apellido: me.apellidos,
      telefono: me.telefono,
      direccion: me.direccion?.direccionCompleta || "",
      localidad: me.direccion?.localidad || "",
      barrio: me.direccion?.barrio || "",
      ciudad: me.direccion?.ciudad || "",
      rol,
    },
  };
}

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [cargandoSesion, setCargandoSesion] = useState(true);

  const limpiarSesion = () => {
    fijarUsuarioActual(null);
    borrarToken();
    setUsuario(null);
    setPerfil(null);
  };

  const aplicarPerfil = (me) => {
    const sesionConstruida = construirSesion(me);
    // Supabase ya no sabe quién inició sesión (la sesión vive en FastAPI): se lo informamos.
    fijarUsuarioActual(sesionConstruida.usuario.identificacion);
    setUsuario(sesionConstruida.usuario);
    setPerfil(sesionConstruida.perfil);
    return sesionConstruida;
  };

  useEffect(() => {
    let activo = true;

    // Si la API responde 401 (token vencido, revocado o 30 min sin actividad),
    // limpiamos la sesión: ProtectedRoute se encarga de mandar a "/".
    registrarAlSesionInvalida(() => {
      if (!activo) return;
      fijarUsuarioActual(null);
      setUsuario(null);
      setPerfil(null);
      Swal.fire({
        title: "Sesión finalizada",
        text: "Tu sesión expiró o se cerró. Inicia sesión nuevamente.",
        icon: "info",
        confirmButtonColor: "#E8600C",
        confirmButtonText: "Entendido",
      });
    });

    // Al cargar la página: si hay un token guardado, lo validamos con /auth/me.
    const restaurar = async () => {
      if (!obtenerToken()) {
        setCargandoSesion(false);
        return;
      }
      try {
        const me = await perfilApi();
        if (activo) aplicarPerfil(me);
      } catch {
        if (activo) limpiarSesion();
      } finally {
        if (activo) setCargandoSesion(false);
      }
    };
    restaurar();

    return () => {
      activo = false;
      registrarAlSesionInvalida(null);
    };
  }, []);

  /**
   * Inicia sesión contra FastAPI. Devuelve { user, rol, perfil } para que
   * login.jsx pueda redirigir de inmediato según el rol.
   */
  const iniciarSesion = async (email, password) => {
    const { access_token } = await loginApi(email.trim().toLowerCase(), password);
    guardarToken(access_token);

    try {
      const me = await perfilApi();
      const { usuario: u, perfil: p } = aplicarPerfil(me);
      return { user: u, rol: p.rol, perfil: p };
    } catch (error) {
      // Si no pudimos leer el perfil o el rol no es válido, no dejamos una
      // sesión abierta a medias.
      try {
        await logoutApi();
      } catch {
        /* ignoramos: igual limpiamos localmente */
      }
      limpiarSesion();
      throw error;
    }
  };

  // El registro de clientes todavía no existe en el backend (siguiente fase).
  const registrarse = async () => {
    throw new Error(
      "El registro de nuevos clientes aún no está disponible con el nuevo servidor. Estará en la siguiente fase."
    );
  };

  const cerrarSesion = async () => {
    try {
      await logoutApi(); // revoca en MySQL la sesión de este token
    } catch (error) {
      // Aunque falle (ej. servidor apagado o token ya vencido), cerramos local.
      console.error("No se pudo revocar la sesión en el servidor:", error.message);
    } finally {
      limpiarSesion();
    }
  };

  // Refresca el perfil en memoria (p. ej. tras editarlo en "Mi perfil").
  const recargarPerfil = async () => {
    if (!obtenerToken()) return;
    try {
      aplicarPerfil(await perfilApi());
    } catch (error) {
      console.error("No se pudo recargar el perfil:", error.message);
    }
  };

  const valor = useMemo(
    () => ({
      sesion: usuario ? { token: obtenerToken() } : null,
      usuario,
      perfil,
      rol: perfil?.rol || null,
      cargandoSesion,
      iniciarSesion,
      registrarse,
      cerrarSesion,
      recargarPerfil,
    }),
    [usuario, perfil, cargandoSesion]
  );

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const contexto = useContext(AuthContext);
  if (contexto === undefined) {
    throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  }
  return contexto;
}
