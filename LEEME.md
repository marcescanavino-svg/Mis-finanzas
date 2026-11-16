# Mis Finanzas: cómo ponerla en marcha

Son tres partes: **Firebase** (dónde se guardan tus datos), **GitHub Pages** (dónde vive la app) e **instalarla** en el celular y la compu. Se hace una sola vez y lleva unos 20 minutos.

---

## 1. Crear la base de datos en Firebase

1. Entrá a <https://console.firebase.google.com> con tu cuenta de Google y tocá **Crear un proyecto**.
   Nombre: `mis-finanzas`. Google Analytics: **desactivalo** (no hace falta).
2. En el menú de la izquierda: **Compilación → Firestore Database → Crear base de datos**.
   - Ubicación: `southamerica-east1 (São Paulo)`, la más cercana.
   - Elegí **modo de producción**.
3. Dentro de Firestore, pestaña **Reglas**: borrá lo que hay, pegá el contenido del archivo `firestore.rules` y tocá **Publicar**.
   Esto hace que solo vos puedas leer y escribir tus datos.
4. Menú **Compilación → Authentication → Comenzar → Método de acceso**. Activá:
   - **Google** (elegí tu email como correo de asistencia).
   - **Correo electrónico/contraseña**.
5. Tocá el engranaje ⚙ arriba a la izquierda → **Configuración del proyecto**. Abajo, en **Tus apps**, tocá el ícono **`</>`** (Web).
   Nombre: `Mis Finanzas`. **No** marques Firebase Hosting. Tocá **Registrar app**.
6. Te muestra un bloque `const firebaseConfig = { apiKey: "...", ... }`. Copiá esos valores en el archivo **`firebase-config.js`**, reemplazando cada `PEGAR_AQUI`.
   Estos datos no son secretos: solo identifican tu proyecto. La seguridad la dan las reglas del paso 3.

## 2. Publicar la app en GitHub Pages

1. Creá una cuenta en <https://github.com> si no tenés.
2. Tocá **New repository**. Nombre: `mis-finanzas`. Visibilidad: **Public** (GitHub Pages gratis lo pide).
   El código queda público, pero **tus datos no**: están en Firebase, protegidos por tu usuario.
3. En el repositorio nuevo: **Add file → Upload files** y arrastrá **todo el contenido** de esta carpeta (incluida la carpeta `icons`). Tocá **Commit changes**.
4. **Settings → Pages**. En *Source* elegí **Deploy from a branch**, rama **main**, carpeta **/ (root)** y **Save**.
   En uno o dos minutos la app queda en `https://TU-USUARIO.github.io/mis-finanzas/`.
5. Volvé a Firebase: **Authentication → Configuración → Dominios autorizados → Agregar dominio** y poné `TU-USUARIO.github.io`.
   Sin este paso, el botón "Entrar con Google" da error.

## 3. Entrar y traer tus datos

1. Abrí `https://TU-USUARIO.github.io/mis-finanzas/` en la **compu** y entrá con Google (o creá una cuenta con email).
2. Abrí la **versión anterior** (la de Claude) → **Más → Ajustes → Copiar mis datos**.
3. En la app nueva: **Más → Ajustes y respaldo → Importar datos**, pegá con Ctrl+V y tocá **Importar**.
   Si lo hacés dos veces no se duplica nada.

## 4. Instalarla

- **Android (Chrome):** abrí el link → menú ⋮ → **Instalar app** (o "Agregar a la pantalla principal").
- **iPhone (Safari):** abrí el link → botón Compartir → **Agregar a inicio**.
- **Compu (Chrome o Edge):** abrí el link → ícono de instalar (un monitor con flecha) a la derecha de la barra de direcciones → **Instalar**.

Entrá una vez **con internet** en cada equipo. Después abre y carga sin conexión.

## Cómo funciona sin internet

- Lo que cargás se guarda en el equipo al instante y aparece marcado **"sin subir"**.
- Arriba a la derecha ves el estado: **Sincronizado**, **Sincronizando…** o **Sin conexión · N sin subir**.
- Cuando vuelve la conexión, se sube solo y aparece en tus otros equipos.
- Si cargás lo mismo en dos equipos sin conexión, quedan los dos (no se pisan).

## Respaldo

**Ajustes y respaldo → Movimientos (Excel/CSV)** descarga un archivo que se abre en Excel.
**Copia completa** descarga todo en un archivo que después podés volver a importar.

## Para actualizar la app

Al subir archivos nuevos a GitHub, cambiá también el número de `VERSION` en `sw.js` (por ejemplo `mf-v1.0.1`).
Los equipos muestran el aviso **"Hay una versión nueva → Actualizar"**.
