/**
 * Traduce el rol numérico del backend (tabla `roles`) al texto que ya usan
 * ProtectedRoute, el login y las páginas del frontend.
 *
 *   1 CLIENTE      -> "cliente"
 *   2 PROVEEDOR    -> "proveedor"
 *   3 JEFE         -> "jefe"
 *   4 EMPLEADO     -> "empleado"
 *   5 SUPER_ADMIN  -> "administrador"  (entra al panel del jefe)
 */
export const ROL_POR_ID = {
  1: "cliente",
  2: "proveedor",
  3: "jefe",
  4: "empleado",
  5: "administrador",
};

export function rolDesdeId(idRol) {
  return ROL_POR_ID[idRol] || null;
}
