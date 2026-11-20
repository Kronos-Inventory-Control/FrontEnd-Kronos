import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Swal from "sweetalert2";

import logoImg from "../../assets/img/logo.png";
import { useAuth } from "../../context/AuthContext";

import "../../assets/css/M_index.css";

/**
 * ==========================================================
 * KRONOS — LOGIN
 * ==========================================================
 *
 * Inicio de sesión contra el backend FastAPI (JWT):
 *
 *   1. POST /auth/login  -> access_token
 *   2. GET  /auth/me     -> perfil + rol numérico
 *
 * AuthContext hace ambos pasos en iniciarSesion() y devuelve
 * el rol ya traducido a texto ('jefe' | 'administrador' |
 * 'empleado' | 'cliente' | 'proveedor'), de modo que aquí solo
 * hay que redirigir.
 *
 * Roles utilizados:
 *
 * jefe / administrador (SUPER_ADMIN) → /jefe/panel
 * cliente                            → /cliente/
 * proveedor                          → /proveedor
 *
 * ==========================================================
 */

export default function Login({ abierto = true, alCerrar }) {

  // ========================================================
  // HOOKS
  // ========================================================

  const { iniciarSesion } = useAuth();

  const navigate = useNavigate();

  // ========================================================
  // ESTADOS
  // ========================================================

  const [correo, setCorreo] = useState("");

  const [password, setPassword] = useState("");

  const [mostrarPassword, setMostrarPassword] = useState(false);

  const [cargando, setCargando] = useState(false);


  // ========================================================
  // SI EL MODAL ESTÁ CERRADO
  // ========================================================

  if (!abierto) {
    return null;
  }


  // ========================================================
  // CERRAR LOGIN
  // ========================================================

  const cerrar = () => {

    // Si Login está siendo utilizado como modal,
    // ejecutamos la función que recibió el componente padre.

    if (alCerrar) {

      alCerrar();

      return;
    }

    // Si estamos en la página /login,
    // regresamos a la página principal.

    navigate("/");
  };


  // ========================================================
  // REDIRECCIÓN SEGÚN EL ROL
  // ========================================================

  const redirigirSegunRol = (rol) => {

    // ------------------------------------------------------
    // JEFE / ADMINISTRADOR
    // ------------------------------------------------------

    if (rol === "jefe" || rol === "administrador") {

      navigate("/jefe/panel", {
        replace: true,
      });

      return;
    }


    // ------------------------------------------------------
    // CLIENTE
    // ------------------------------------------------------

    if (rol === "cliente") {

      navigate("/cliente/", {
        replace: true,
      });

      return;
    }


    // ------------------------------------------------------
    // PROVEEDOR
    // ------------------------------------------------------

    if (rol === "proveedor") {

      navigate("/proveedor", {
        replace: true,
      });

      return;
    }


    // ------------------------------------------------------
    // EMPLEADO
    // ------------------------------------------------------

    if (rol === "empleado") {

      navigate("/", {
        replace: true,
      });

      return;
    }


    // ------------------------------------------------------
    // SI NO EXISTE EL ROL
    // ------------------------------------------------------

    Swal.fire({
      title: "Rol no configurado",
      text: "Tu usuario no tiene un rol válido asignado.",
      icon: "warning",
      confirmButtonColor: "#E8600C",
      confirmButtonText: "Entendido",
    });

    navigate("/", {
      replace: true,
    });
  };


  // ========================================================
  // INICIAR SESIÓN
  // ========================================================

  const handleSubmit = async (evento) => {

    // Evita que el formulario recargue la página.

    evento.preventDefault();

    // Activamos el estado de carga.

    setCargando(true);

    try {

      // ----------------------------------------------------
      // AUTENTICACIÓN CON EL BACKEND (FastAPI + JWT)
      // ----------------------------------------------------
      //
      // iniciarSesion hace POST /auth/login y luego GET /auth/me.
      // Si algo falla lanza un error con un mensaje legible.
      //
      // ----------------------------------------------------

      const { rol } = await iniciarSesion(
        correo,
        password
      );


      // ----------------------------------------------------
      // VALIDAMOS QUE TENGA ROL
      // ----------------------------------------------------

      if (!rol) {

        throw new Error(
          "Este usuario no tiene un rol válido asignado."
        );
      }


      // ----------------------------------------------------
      // MENSAJE DE BIENVENIDA
      // ----------------------------------------------------

      await Swal.fire({

        title: "¡Bienvenido de nuevo!",

        text: "Has iniciado sesión correctamente.",

        icon: "success",

        confirmButtonColor: "#E8600C",

        timer: 1200,

        showConfirmButton: false,
      });


      // ----------------------------------------------------
      // CERRAR MODAL SI EXISTE
      // ----------------------------------------------------
      //
      // IMPORTANTE:
      //
      // NO llamamos cerrar() directamente porque cerrar()
      // cuando no existe alCerrar hace navigate("/");
      //
      // Eso podía interferir con la redirección del jefe.
      //
      // ----------------------------------------------------

      if (alCerrar) {

        alCerrar();
      }


      // ----------------------------------------------------
      // REDIRECCIÓN SEGÚN ROL
      // ----------------------------------------------------

      redirigirSegunRol(rol);


    } catch (error) {

      // ----------------------------------------------------
      // ERROR DE LOGIN
      // ----------------------------------------------------

      Swal.fire({

        title: "No se pudo iniciar sesión",

        text:
          error?.message ||
          "Revisa tu correo y contraseña e inténtalo de nuevo.",

        icon: "error",

        confirmButtonColor: "#E8600C",

        confirmButtonText: "Entendido",
      });


    } finally {

      // Quitamos el estado de carga.

      setCargando(false);
    }
  };


  // ========================================================
  // CONTENIDO DEL LOGIN
  // ========================================================

  const contenido = (

    <div
      className={`kr-modal modal--login ${
        abierto ? "activo" : ""
      }`}
    >

      {/* ==================================================
          BOTÓN CERRAR
          ================================================== */}

      <button
        className="btn-cerrar btn-cerrar--modal"
        type="button"
        onClick={cerrar}
        aria-label="Cerrar"
      >

        <IconX size={20} />

      </button>


      {/* ==================================================
          LOGO
          ================================================== */}

      <div className="acceso-brand">

        <img
          src={logoImg}
          alt="Kronos"
          className="acceso-brand__logo"
        />

      </div>


      {/* ==================================================
          ENCABEZADO
          ================================================== */}

      <div className="modal__encabezado">

        <h2>
          Inicia sesión
        </h2>

      </div>


      {/* ==================================================
          FORMULARIO
          ================================================== */}

      <form
        className="modal__form"
        onSubmit={handleSubmit}
        autoComplete="off"
      >


        {/* =================================================
            CORREO
            ================================================= */}

        <div className="campo">

          <label htmlFor="loginCorreo">
            Correo electrónico
          </label>


          <input
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            type="email"
            id="loginCorreo"
            placeholder="nombre@kronos.com"
            autoComplete="off"
            required
          />

        </div>


        {/* =================================================
            CONTRASEÑA
            ================================================= */}

        <div className="campo">

          <label htmlFor="loginContrasena">
            Contraseña
          </label>


          <div className="campo-password">

            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type={
                mostrarPassword
                  ? "text"
                  : "password"
              }
              id="loginContrasena"
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />


            {/* ---------------------------------------------
                MOSTRAR / OCULTAR CONTRASEÑA
                --------------------------------------------- */}

            <button
              type="button"
              className="btn-mostrar-password"
              onClick={() =>
                setMostrarPassword(
                  !mostrarPassword
                )
              }
              aria-label={
                mostrarPassword
                  ? "Ocultar contraseña"
                  : "Mostrar contraseña"
              }
            >

              <IconEye size={18} />

            </button>

          </div>

        </div>


        {/* =================================================
            BOTÓN INICIAR SESIÓN
            ================================================= */}

        <button
          type="submit"
          className="btn-primario btn-primario--full"
          disabled={cargando}
        >

          {cargando
            ? "Ingresando…"
            : "Inicia sesión"
          }

          <IconArrowRightToBracket size={16} />

        </button>


        {/* =================================================
            RECUPERAR CONTRASEÑA
            ================================================= */}

        <div className="modal__enlaces modal__enlaces--login">

          <Link to="/recuperar-contrasena">
            ¿Olvidaste tu contraseña?
          </Link>

        </div>

      </form>

    </div>
  );


  // ========================================================
  // MODO MODAL
  // ========================================================
  //
  // Si alCerrar existe significa que Login está siendo
  // utilizado dentro de otra página como modal.
  //
  // ========================================================

  if (alCerrar) {

    return contenido;
  }


  // ========================================================
  // MODO PÁGINA COMPLETA
  // ========================================================
  //
  // Cuando entramos directamente a:
  //
  // /login
  //
  // ========================================================

  return (

    <div
      style={{
        minHeight: "100vh",

        display: "flex",

        alignItems: "center",

        justifyContent: "center",

        background:
          "var(--bg, #15171B)",
      }}
    >

      {contenido}

    </div>

  );
}


// ==========================================================
// ICONO X
// ==========================================================

function IconX({ size = 16 }) {

  return (

    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >

      <path d="M18 6 6 18" />

      <path d="m6 6 12 12" />

    </svg>

  );
}


// ==========================================================
// ICONO OJO
// ==========================================================

function IconEye({ size = 16 }) {

  return (

    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >

      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />

      <circle
        cx="12"
        cy="12"
        r="3"
      />

    </svg>

  );
}


// ==========================================================
// ICONO ENTRAR
// ==========================================================

function IconArrowRightToBracket({ size = 16 }) {

  return (

    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >

      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />

      <polyline points="10 17 15 12 10 7" />

      <line
        x1="15"
        x2="3"
        y1="12"
        y2="12"
      />

    </svg>

  );
}