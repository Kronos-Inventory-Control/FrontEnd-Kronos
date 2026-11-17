import { createClient } from "@supabase/supabase-js";

/**
 * Cliente único de Supabase para todo el proyecto.
 *
 * Soporta tanto el nombre de variable "clásico" (VITE_SUPABASE_ANON_KEY)
 * como el nuevo esquema de claves "publishable" de Supabase
 * (VITE_SUPABASE_PUBLISHABLE_KEY), ya que distintas partes del equipo
 * han usado uno u otro nombre en su .env.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  // eslint-disable-next-line no-console
  console.error(
    "Faltan las variables de entorno VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY / VITE_SUPABASE_PUBLISHABLE_KEY en el archivo .env"
  );
}

export const supabase = createClient(supabaseUrl || "", supabaseKey || "");

/**
 * Roles reconocidos por la aplicación. Salen de la tabla `roles`
 * (Administrador, Empleado, Cliente, Proveedor), en minúsculas, a través de
 * usuarios.rol_idRol (ver src/api/db.js > cargarPerfil).
 * Empleado y Administrador tienen el mismo acceso (panel del jefe).
 */
export const ROLES = {
  ADMINISTRADOR: "administrador",
  EMPLEADO: "empleado",
  CLIENTE: "cliente",
  PROVEEDOR: "proveedor", 
};

/** Roles que entran al panel del jefe. */
export const ROLES_STAFF = [ROLES.ADMINISTRADOR, ROLES.EMPLEADO];
