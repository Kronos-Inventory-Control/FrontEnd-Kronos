import { createClient } from "@supabase/supabase-js";
import { crearClienteCompat } from "./db/compat";

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

/** Cliente REAL de supabase-js (sin traducción). Útil para auth y tablas sin equivalente. */
export const supabaseReal = createClient(supabaseUrl || "", supabaseKey || "");

/**
 * Cliente que usan las páginas. Traduce las entidades antiguas (productos,
 * ordenes_compra, proveedores, garantias, ...) al esquema MySQL que hoy
 * existe en Supabase (inventarios, ordenesCompra, ...). Ver src/api/db/.
 */
export const supabase = crearClienteCompat(supabaseReal);

/**
 * Entidad lógica "perfiles". Hoy se resuelve contra la tabla `usuarios`
 * (+ `direcciones`) del esquema MySQL; el rol real lo entrega FastAPI.
 * Forma que ven las páginas (ya no es una tabla física):
 *
 *   perfiles
 *     id          uuid  PK, references auth.users(id)
 *     nombre      text
 *     apellido    text
 *     telefono    text
 *     direccion   text
 *     localidad   text
 *     barrio      text
 *     rol         text  -> 'jefe' | 'administrador' | 'empleado' | 'cliente' | 'proveedor'
 *     creado_en   timestamptz default now()
 */
export const TABLA_PERFILES = "perfiles";

/** Roles válidos reconocidos por la aplicación. */
export const ROLES = {
  JEFE: "jefe",
  ADMINISTRADOR: "administrador",
  EMPLEADO: "empleado",
  CLIENTE: "cliente",
  PROVEEDOR: "proveedor",
};
