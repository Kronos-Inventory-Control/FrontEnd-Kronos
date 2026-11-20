/**
 * Llamadas de autenticación al backend FastAPI.
 *   POST /auth/login   -> { access_token, token_type, expires_in }
 *   GET  /auth/me      -> perfil del usuario autenticado
 *   POST /auth/logout  -> 204 (revoca solo la sesión de este token)
 */
import { apiFetch } from "./client";

export function loginApi(email, password) {
  return apiFetch("/auth/login", {
    metodo: "POST",
    cuerpo: { email, password },
    autenticada: false,
  });
}

export function perfilApi() {
  return apiFetch("/auth/me");
}

export function logoutApi() {
  return apiFetch("/auth/logout", { metodo: "POST" });
}
