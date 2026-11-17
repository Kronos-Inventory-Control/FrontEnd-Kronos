
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1";

let token = localStorage.getItem("kronos_token");

export function obtenerToken() {
  return token;
}

export function guardarToken(nuevoToken) {
  token = nuevoToken;
  localStorage.setItem("kronos_token", nuevoToken);
}

export function eliminarToken() {
  token = null;
  localStorage.removeItem("kronos_token");
}

export async function solicitar(endpoint, opciones = {}) {
  const respuesta = await fetch(`${API_URL}${endpoint}`, {
    ...opciones,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opciones.headers,
    },
  });

  if (respuesta.status === 204) {
    return null;
  }

  const datos = await respuesta.json().catch(() => ({}));

  if (!respuesta.ok) {
    throw new Error(
      datos.detail || `Error del servidor: ${respuesta.status}`
    );
  }

  return datos;
}
