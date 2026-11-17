import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../api/supabase";
import { cargarPerfil as leerPerfil } from "../api/db";


const AuthContext = createContext(undefined);

export function AuthProvider({ children }) {
  const [sesion, setSesion] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [cargandoSesion, setCargandoSesion] = useState(true);

  const cargarPerfil = async (usuario) => {
    if (!usuario) {
      setPerfil(null);
      return;
    }
    try {
      // usuarios + roles + direcciones + clientes + proveedores (ver src/api/db.js)
      setPerfil(await leerPerfil(usuario));
    } catch (error) {
      // No tumbamos la sesión si falla la lectura del perfil: el usuario
      // sigue autenticado, solo no conocemos aún su rol.
      console.error("No se pudo cargar el perfil del usuario:", error.message);
      setPerfil(null);
    }
  };

  useEffect(() => {
    let activo = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!activo) return;
      setSesion(data.session);
      cargarPerfil(data.session?.user).finally(() => setCargandoSesion(false));
    });

    const { data: suscripcion } = supabase.auth.onAuthStateChange(
      (_evento, nuevaSesion) => {
        setSesion(nuevaSesion);
        cargarPerfil(nuevaSesion?.user);
      }
    );

    return () => {
      activo = false;
      suscripcion.subscription.unsubscribe();
    };
  }, []);

  const iniciarSesion = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    await cargarPerfil(data.user);
    return data;
  };

  /**
   * Registro público (siempre rol Cliente). Los datos viajan en
   * signUp(options.data) y un trigger de la base de datos
   * (kronos_handle_new_auth_user) crea, en una sola transacción:
   * direcciones -> usuarios (rol Cliente) -> clientes.
   * Así funciona aunque Supabase pida confirmar el correo (aún sin sesión).
   */
  const registrarse = async ({ email, password, identificacion, nombre, apellido, telefono, localidad, barrio, direccion, ciudad }) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { identificacion, nombre, apellido, telefono, localidad, barrio, direccion, ciudad: ciudad || "Bogotá" },
      },
    });
    if (error) throw error;
    return data;
  };

  const cerrarSesion = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setSesion(null);
    setPerfil(null);
  };

  // Refresca el perfil en memoria (p. ej. después de editarlo desde el
  // modal "Mi perfil"), sin tener que cerrar y volver a iniciar sesión
  // para ver el nombre actualizado en el navbar.
  const recargarPerfil = async () => {
    await cargarPerfil(sesion?.user);
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

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const contexto = useContext(AuthContext);
  if (contexto === undefined) {
    throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  }
  return contexto;
}
