import { useMemo, useState } from "react";
import Swal from "sweetalert2";
import "../../assets/css/M_entradas.css";
import { actualizarProducto, crearProducto, registrarMovimiento } from "../../api/db";
import { useRealtimeTable } from "../../hooks/useRealtimeTable";
import { useCategorias } from "../../hooks/useCategorias";

/**
 * Movimientos · Registrar entrada de material (tablas `inventarios`,
 * `movimientos`, `categorias`, `marcas` y `unidadVentas`).
 *
 *   - Si el nombre escrito coincide con un material ya existente en
 *     `inventarios`, se registra un movimiento de ENTRADA y la base de datos
 *     suma el stock sola (trigger). Nunca se escribe el stock a mano.
 *   - Si no existe, se da de alta el material (con su categoría, marca y
 *     unidad de medida, que se crean si aún no existen) y la cantidad entra
 *     como movimiento de entrada.
 *   - Cada movimiento guarda fecha, cantidad, precio, subtotal y el usuario
 *     autenticado (usuario_identificacion).
 *   - Si el material ya existía y cambiaste precio / marca / modelo, se
 *     actualizan; si los dejas vacíos NO se borra lo que ya había.
 *   - Alertas: si tras la entrada el stock sigue bajo el umbral, la alerta
 *     queda pendiente; si lo supera, se resuelve sola.
 */

const ESTADO_INICIAL = {
  nombre: "",
  unidad: "Pieza",
  marca: "",
  cantidad: 0,
  precio: "",
  codigo: "",
  modelo: "",
  categoria: "",
};

function M_entrada() {
  const [form, setForm] = useState(ESTADO_INICIAL);
  const [guardando, setGuardando] = useState(false);
  const { datos: productos } = useRealtimeTable("productos");
  const { datos: unidades } = useRealtimeTable("unidades", { orderBy: "nombre", ascending: true });
  const { datos: marcas } = useRealtimeTable("marcas", { orderBy: "nombre", ascending: true });
  const { categorias } = useCategorias();

  const actualizarCampo = (campo) => (evento) => {
    setForm((actual) => ({ ...actual, [campo]: evento.target.value }));
  };

  const normalizar = (texto) => (texto || "").trim().toLowerCase();

  // Producto ya registrado que coincide con el nombre escrito (si existe).
  const productoExistente = useMemo(
    () => productos.find((p) => normalizar(p.nombre) === normalizar(form.nombre)),
    [productos, form.nombre]
  );

  // Al elegir/escribir un material que ya existe, se precarga su precio
  // actual para que el usuario solo lo corrija si cambió.
  const cambiarNombre = (evento) => {
    const valor = evento.target.value;
    const existente = productos.find((p) => normalizar(p.nombre) === normalizar(valor));
    setForm((actual) => ({
      ...actual,
      nombre: valor,
      ...(existente
        ? {
            precio: existente.precio != null ? String(existente.precio) : "",
          }
        : {}),
    }));
  };

  const registrarEntrada = async (evento) => {
    evento.preventDefault();

    const cantidad = Number(form.cantidad);
    if (!form.nombre.trim() || !cantidad || cantidad <= 0) {
      Swal.fire({
        title: "Datos incompletos",
        text: "Indica el nombre del material y una cantidad mayor a cero.",
        icon: "warning",
        confirmButtonColor: "#E8600C",
      });
      return;
    }

    const precio = form.precio === "" ? null : Number(form.precio);

    if (precio !== null && (Number.isNaN(precio) || precio < 0)) {
      Swal.fire({
        title: "Precio no válido",
        text: "El precio unitario debe ser un número igual o mayor a cero.",
        icon: "warning",
        confirmButtonColor: "#E8600C",
      });
      return;
    }

    // Un material nuevo nace con precio; si no, quedaría en "$0".
    if (!productoExistente && precio === null) {
      Swal.fire({
        title: "Faltan datos del material nuevo",
        text: "Para dar de alta un material nuevo indica su precio unitario.",
        icon: "warning",
        confirmButtonColor: "#E8600C",
      });
      return;
    }

    // Un material nuevo también necesita categoría (la lista viene de Supabase).
    if (!productoExistente && !form.categoria) {
      Swal.fire({
        title: "Falta la categoría",
        text: "Selecciona la categoría del material nuevo.",
        icon: "warning",
        confirmButtonColor: "#E8600C",
      });
      return;
    }

    setGuardando(true);
    try {
      let productoId = productoExistente?.id;

      if (productoExistente) {
        // Solo se actualiza lo que el usuario realmente indicó y cambió.
        const cambios = {};
        if (precio !== null && precio !== Number(productoExistente.precio)) cambios.precio = precio;
        if (form.marca.trim() && form.marca.trim() !== productoExistente.marca) cambios.marca = form.marca;
        if (form.modelo.trim() && form.modelo.trim() !== productoExistente.modelo) cambios.modelo = form.modelo;
        if (form.unidad && form.unidad !== productoExistente.unidad) cambios.unidad = form.unidad;
        if (Object.keys(cambios).length > 0) await actualizarProducto(productoExistente, cambios);
      } else {
        // Alta del material (stock en 0): la cantidad entra como movimiento.
        productoId = await crearProducto({
          nombre: form.nombre,
          codigo: form.codigo,
          categoria: form.categoria,
          marca: form.marca,
          unidad: form.unidad,
          modelo: form.modelo,
          precio,
          umbral: 5,
          stock: 0,
        });
      }

      await registrarMovimiento({
        productoId,
        tipo: "entrada",
        cantidad,
        precioUnitario: precio ?? productoExistente?.precio ?? 0,
      });

      Swal.fire({
        title: "¡Entrada registrada!",
        text: `Se registró la entrada de ${cantidad} unidad(es) de "${form.nombre}".`,
        icon: "success",
        confirmButtonColor: "#E8600C",
        confirmButtonText: "Entendido",
      });

      setForm(ESTADO_INICIAL);
    } catch (error) {
      Swal.fire({ title: "No se pudo registrar", text: error.message, icon: "error", confirmButtonColor: "#E8600C" });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="dashboard-main">
      <div className="titulo">
        <i className="fa-solid fa-box-open"></i> Registrar entrada de material
      </div>

      <div className="formulario">
        <form onSubmit={registrarEntrada}>
          <div className="row g-3">
            <div className="col-md-6">
              <label className="form-label" htmlFor="ent-nombre">Nombre del material</label>
              <input
                id="ent-nombre"
                type="text"
                className="form-control"
                placeholder="Ej. Tornillo M8x20"
                list="listaProductosEntrada"
                value={form.nombre}
                onChange={cambiarNombre}
              />
              <datalist id="listaProductosEntrada">
                {productos.map((p) => (
                  <option key={p.id} value={p.nombre} />
                ))}
              </datalist>
              <div className="form-text">
                {productoExistente
                  ? `Material existente (stock actual: ${productoExistente.stock_actual ?? 0}). Se sumará la cantidad; revisa que el precio siga vigente.`
                  : "Si el material ya existe, se sumará la cantidad a su stock actual; si no, se dará de alta como nuevo."}
              </div>
            </div>

            <div className="col-md-6">
              <label className="form-label" htmlFor="ent-unidad">Unidad de medida</label>
              <select
                id="ent-unidad"
                className="form-select"
                value={form.unidad}
                onChange={actualizarCampo("unidad")}
              >
                {(unidades.length > 0 ? unidades.map((u) => u.nombre) : ["Pieza", "Metros", "Kilogramos"]).map((nombre) => (
                  <option key={nombre}>{nombre}</option>
                ))}
              </select>
            </div>

            <div className="col-md-6">
              <label className="form-label" htmlFor="ent-marca">Marca</label>
              <input
                id="ent-marca"
                type="text"
                className="form-control"
                placeholder="Ej. Bosch"
                list="listaMarcasEntrada"
                value={form.marca}
                onChange={actualizarCampo("marca")}
              />
              <datalist id="listaMarcasEntrada">
                {marcas.map((m) => (
                  <option key={m.id} value={m.nombre} />
                ))}
              </datalist>
            </div>

            <div className="col-md-6">
              <label className="form-label" htmlFor="ent-cantidad">Cantidad a ingresar</label>
              <input
                id="ent-cantidad"
                type="number"
                className="form-control"
                min="0"
                value={form.cantidad}
                onChange={actualizarCampo("cantidad")}
              />
            </div>

            <div className="col-md-6">
              <label className="form-label" htmlFor="ent-precio">Precio unitario (COP)</label>
              <input
                id="ent-precio"
                type="number"
                className="form-control"
                placeholder="Ej. 15000"
                min="0"
                step="any"
                value={form.precio}
                onChange={actualizarCampo("precio")}
              />
            </div>

            <div className="col-md-6">
              <label className="form-label" htmlFor="ent-codigo">Código interno (opcional)</label>
              <input
                id="ent-codigo"
                type="text"
                className="form-control"
                placeholder="Ej. TOR-0020"
                disabled={Boolean(productoExistente)}
                value={form.codigo}
                onChange={actualizarCampo("codigo")}
              />
            </div>

            <div className="col-12">
              <label className="form-label" htmlFor="ent-modelo">Modelo o referencia</label>
              <input
                id="ent-modelo"
                type="text"
                className="form-control"
                placeholder="Ej. REF-1029"
                value={form.modelo}
                onChange={actualizarCampo("modelo")}
              />
            </div>

            <div className="col-12">
              <label className="form-label" htmlFor="ent-categoria">Categoría</label>
              <select
                id="ent-categoria"
                className="form-select"
                value={form.categoria}
                onChange={actualizarCampo("categoria")}
              >
                <option value="" disabled>Selecciona una categoría…</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.nombre}>{c.nombre}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="contenedor-acciones">
            <button type="submit" className="confirmarRegistro" disabled={guardando}>
              <i className="fa-solid fa-check"></i> {guardando ? "Registrando…" : "Registrar entrada"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default M_entrada;