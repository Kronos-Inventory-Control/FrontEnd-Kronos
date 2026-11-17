
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  solicitar,
  guardarToken,
  eliminarToken,
  obtenerToken,
} from "../api/http";

const AuthContext = createContext(undefined);

// Convertimos los identificadores del backend
// en los nombres de roles que utiliza el frontend.
const nombresRoles = {
  1: "cliente",
  2: "proveedor",
  3: "jefe",
  4: "empleado",
  5: "administrador",
};

function adaptarPerfil(usuario) {
  if (!usuario) return null;

  return {
    ...usuario,
    rol:
      nombresRoles[usuario.rol] ||
      nombresRoles[Number(usuario.rol)] ||
      String(usuario.rol).toLowerCase(),
  };
}

export function AuthProvider({ children }) {
  const [sesion, setSesion] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [cargandoSesion, setCargandoSesion] = useState(true);

  // Consultar el perfil al backend
  const cargarPerfil = async () => {
    const usuario = await solicitar("/auth/me");

    const perfilAdaptado = adaptarPerfil(usuario);

    setPerfil(perfilAdaptado);

    setSesion({
      access_token: obtenerToken(),
      user: perfilAdaptado,
    });

    return perfilAdaptado;
  };

  // Recuperar la sesión cuando se actualiza la página
  useEffect(() => {
    const verificarSesion = async () => {
      if (!obtenerToken()) {
        setCargandoSesion(false);
        return;
      }

      try {
        await cargarPerfil();
      } catch (error) {
        eliminarToken();
        setSesion(null);
        setPerfil(null);
      } finally {
        setCargandoSesion(false);
      }
    };

    verificarSesion();
  }, []);

  // Iniciar sesión con FastAPI
  const iniciarSesion = async (email, password) => {
    const respuesta = await solicitar("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
      }),
    });

    guardarToken(respuesta.access_token);

    try {
      const usuario = await cargarPerfil();

      return {
        ...respuesta,
        user: usuario,
      };
    } catch (error) {
      eliminarToken();
      setSesion(null);
      setPerfil(null);
      throw error;
    }
  };

  // Registro pendiente de implementar en FastAPI
  const registrarse = async () => {
    throw new Error(
      "El registro de clientes todavía no está implementado en el backend."
    );
  };

  // Cerrar sesión en FastAPI
  const cerrarSesion = async () => {
    try {
      if (obtenerToken()) {
        await solicitar("/auth/logout", {
          method: "POST",
        });
      }
    } finally {
      eliminarToken();
      setSesion(null);
      setPerfil(null);
    }
  };

  // Actualizar perfil después de editarlo
  const recargarPerfil = async () => {
    if (!obtenerToken()) return;

    await cargarPerfil();
  };

  const valor = useMemo(
    () => ({
      sesion,
      usuario: sesion?.user || null,
      perfil,
      rol: perfil?.rol || null,
      cargandoSesion,
      iniciarSesion,
      registrarse,
      cerrarSesion,
      recargarPerfil,
    }),
    [sesion, perfil, cargandoSesion]
  );

  return (
    <AuthContext.Provider value={valor}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const contexto = useContext(AuthContext);

  if (contexto === undefined) {
    throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  }

  return contexto;
}
