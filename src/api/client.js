/**
 * Cliente HTTP único hacia el backend FastAPI de Kronos.
 *
 * Reemplaza a supabase.js para todo lo que ya migró al backend propio.
 * Se encarga de:
 *   1. La URL base (VITE_API_URL en el .env.local).
 *   2. Enviar el JWT en la cabecera "Authorization: Bearer <token>".
 *   3. Convertir los errores del backend en mensajes legibles (ApiError).
 *   4. Avisar a la app cuando el token ya no sirve (401): venció, la sesión
 *      se revocó con logout o pasaron 30 minutos de inactividad.
 *
 * El token se guarda en sessionStorage: sobrevive a recargar la página y se
 * borra al cerrar la pestaña.
 */

export const API_URL = (
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000/api/v1"
).replace(/\/$/, "");

const TOKEN_KEY = "kronos_access_token";

// ---------------------------------------------------------------
// Token
// ---------------------------------------------------------------

export function obtenerToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function guardarToken(token) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* sessionStorage no disponible: la sesión durará solo en memoria de la página */
  }
}

export function borrarToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nada que borrar */
  }
}

// ---------------------------------------------------------------
// Aviso de sesión inválida (lo registra AuthContext)
// ---------------------------------------------------------------

let alSesionInvalida = null;

export function registrarAlSesionInvalida(funcion) {
  alSesionInvalida = funcion;
}

// ---------------------------------------------------------------
// Errores
// ---------------------------------------------------------------

export class ApiError extends Error {
  constructor(mensaje, estado = 0) {
    super(mensaje);
    this.name = "ApiError";
    this.estado = estado;
  }
}

function extraerMensaje(estado, cuerpo) {
  if (estado === 422) {
    return "Los datos enviados no son válidos. Revisa el formato del correo y la contraseña.";
  }
  if (cuerpo && typeof cuerpo.detail === "string") {
    return cuerpo.detail;
  }
  if (estado >= 500) {
    return "El servidor tuvo un problema. Inténtalo de nuevo en unos minutos.";
  }
  return "No se pudo completar la solicitud.";
}

// ---------------------------------------------------------------
// Petición base
// ---------------------------------------------------------------

/**
 * @param {string} ruta - ruta relativa a API_URL, ej. "/auth/login".
 * @param {object} [opciones]
 * @param {string} [opciones.metodo="GET"]
 * @param {object} [opciones.cuerpo] - se envía como JSON.
 * @param {boolean} [opciones.autenticada=true] - si false, no envía el token.
 */
export async function apiFetch(
  ruta,
  { metodo = "GET", cuerpo, autenticada = true } = {}
) {
  const cabeceras = { Accept: "application/json" };
  const token = autenticada ? obtenerToken() : null;

  if (cuerpo !== undefined) cabeceras["Content-Type"] = "application/json";
  if (token) cabeceras.Authorization = `Bearer ${token}`;

  let respuesta;
  try {
    respuesta = await fetch(`${API_URL}${ruta}`, {
      method: metodo,
      headers: cabeceras,
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    // fetch solo lanza error si no hubo respuesta: servidor apagado, URL
    // equivocada o bloqueo de CORS (el navegador descarta la respuesta).
    throw new ApiError(
      "No se pudo conectar con el servidor. Verifica que el backend esté encendido."
    );
  }

  if (respuesta.status === 204) return null;

  let datos = null;
  try {
    datos = await respuesta.json();
  } catch {
    datos = null;
  }

  if (!respuesta.ok) {
    // 401 con token enviado = la sesión ya no es válida.
    if (respuesta.status === 401 && token) {
      borrarToken();
      alSesionInvalida?.();
    }
    throw new ApiError(extraerMensaje(respuesta.status, datos), respuesta.status);
  }

  return datos;
}
