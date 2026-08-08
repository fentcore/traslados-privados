# Traslados Privados — Contactos

Aplicación real (no un prototipo) para cargar los clientes de traslado: funciona como página web y como app instalable en el celular (PWA), y sincroniza los mismos contactos entre vos y tu asistente. Cuando tu asistente carga un cliente nuevo, te llega una notificación push aunque no tengas la app abierta.

Está construida con:
- **Backend**: Node.js + Express + PostgreSQL, con cuentas de usuario, notificaciones push (Web Push / VAPID) y una API REST.
- **Frontend**: una PWA (HTML/CSS/JS) instalable en Android, iPhone y escritorio, con el estilo del sistema de diseño "Industry" (esteel-blue, blueprint) que ya habías elegido.

No requiere ningún framework para compilar: es un servidor Node que sirve tanto la API como los archivos de la app.

## 1. Cómo funciona la cuenta compartida

- La primera persona (vos) crea una cuenta y con eso se crea un **espacio de trabajo** con un **código de invitación** (por ejemplo `TRASLADOS-8K3F`).
- Le pasás ese código a tu asistente. Cuando se registra con "Unirme con código", entra al mismo espacio de trabajo: ve y edita los mismos contactos que vos.
- Cada quien se loguea con su propio email y contraseña (no comparten una sola cuenta), pero los datos son compartidos.
- El código lo encontrás en cualquier momento tocando **"Cuenta"** arriba a la derecha.

## 2. Desplegar gratis (Neon + Render)

Vas a necesitar dos cuentas gratuitas (ninguna pide tarjeta): una base de datos en **Neon** y un servidor en **Render**.

### Paso 1 — Crear la base de datos (Neon)

1. Entrá a https://neon.tech y creá una cuenta gratis.
2. Creá un proyecto nuevo (cualquier nombre y región).
3. Andá a la sección **Connection string** / "Cadena de conexión" y copiala. Se ve algo así:
   `postgresql://usuario:contraseña@ep-xxxxx.neon.tech/neondb?sslmode=require`
4. Guardala, la vas a necesitar en el paso 3.

### Paso 2 — Subir el código a GitHub

1. Creá un repositorio nuevo en GitHub (puede ser privado).
2. Subí el contenido de la carpeta `app/` a ese repositorio (es la carpeta que tiene `package.json`, `server/` y `public/`).

### Paso 3 — Crear el servidor (Render)

1. Entrá a https://render.com y creá una cuenta gratis (podés entrar con GitHub).
2. **New +** → **Web Service** → elegí el repositorio que subiste.
3. Configurá:
   - **Root Directory**: `app` (si subiste todo el repo con `app/` adentro; dejalo vacío si `app/` es la raíz del repo).
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
4. En **Environment Variables**, agregá:
   - `DATABASE_URL` → la cadena de conexión de Neon del paso 1.
   - `PGSSL` → `true`
   - `JWT_SECRET` → cualquier texto largo y aleatorio (por ejemplo, generalo con `openssl rand -hex 32` en tu computadora, o cualquier frase larga que no compartas).
   - `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY` → ver el paso 4.
   - `VAPID_SUBJECT` → `mailto:tu-email@example.com` (poné tu email real).
5. Click en **Create Web Service**. Render va a instalar y arrancar el servidor. Cuando termine, te da una URL pública, por ejemplo `https://traslados-privados.onrender.com`.

> Nota sobre el plan gratuito de Render: el servidor "se duerme" tras ~15 minutos sin uso y tarda unos segundos en despertar con la primera visita. Es normal, no hace falta hacer nada.

### Paso 4 — Generar las claves de notificaciones push (VAPID)

Las notificaciones push necesitan un par de claves propias del proyecto (no son una API key de un tercero, las generás vos mismo):

1. En tu computadora, dentro de la carpeta `app/`, corré:
   ```
   npm install
   npm run generate-vapid
   ```
2. Te va a imprimir dos líneas `VAPID_PUBLIC_KEY=...` y `VAPID_PRIVATE_KEY=...`.
3. Copialas como variables de entorno en Render (paso 3.4) y volvé a desplegar (Render lo hace solo al guardar las variables).

### Paso 5 — Probarla

1. Abrí la URL de Render en el navegador de tu computadora.
2. Creá tu cuenta ("Crear cuenta"). Vas a ver el código de invitación en "Cuenta".
3. Desde el celular de tu asistente (o el tuyo), abrí la misma URL y "Unirme con código" con ese código.
4. Cargá un cliente de prueba desde un dispositivo y confirmá que aparece en el otro (se sincroniza solo cada 15 segundos, o recargando la página).
5. Tocá **"Activar"** en el aviso de notificaciones (en ambos dispositivos) para permitir avisos. Cargá otro cliente de prueba desde uno de los dos y confirmá que al otro le llega la notificación.

## 3. Instalar la app en el celular (sin Play Store)

1. Abrí la URL de la app en Chrome (Android) o Safari (iPhone).
2. **Android/Chrome**: tocá el menú (⋮) → **"Instalar app"** o **"Agregar a pantalla de inicio"**. También puede aparecer un botón **"Instalar app"** dentro de la pestaña Contactos.
3. **iPhone/Safari**: tocá el ícono de compartir (□↑) → **"Agregar a pantalla de inicio"**.
4. Va a quedar como un ícono más, en pantalla completa, sin la barra del navegador — como una app nativa.
5. Mantené presionado el ícono instalado para ver el acceso directo **"Tramos"**, que abre directo esa pantalla.

En la computadora funciona igual, sin instalar nada: solo abrís la URL en el navegador.

## 4. Notificaciones push — cómo funcionan

- Cuando activás notificaciones, el navegador genera una "suscripción" única para ese dispositivo y la guarda en el servidor.
- Cuando alguien del mismo espacio de trabajo carga un cliente nuevo, el servidor le manda un push a las suscripciones de **todos los demás integrantes** (no al que lo cargó).
- Te llega aunque la app esté cerrada, porque la entrega un "service worker" que corre en segundo plano — es la misma tecnología que usan Gmail o WhatsApp Web para notificar en el navegador.
- Si no ves notificaciones: revisá que no las hayas bloqueado para el sitio (ícono de candado en la barra de direcciones → Notificaciones → Permitir), y que hayas tocado "Activar" en cada dispositivo.

## 5. Desarrollo local

Requiere Node.js 18+ y PostgreSQL corriendo localmente.

```bash
cd app
npm install
cp .env.example .env   # completá DATABASE_URL, JWT_SECRET, VAPID_*
npm run generate-vapid # pega el resultado en .env
npm start
```

Abrí http://localhost:3000

## 6. Estructura del proyecto

```
app/
  server/
    index.js               servidor Express (API + sirve la app)
    db.js                  conexión a Postgres y esquema de tablas
    auth.js                JWT / autenticación
    push.js                envío de notificaciones push
    routes/
      auth.js              registro / login / unirse con código
      contacts.js          CRUD de contactos
      push.js              suscripción a notificaciones
    scripts/
      generate-vapid.js    genera las claves VAPID
  public/
    index.html             shell de la PWA
    app.js                 toda la lógica de la interfaz (sin frameworks)
    styles.css             sistema de diseño Industry (tokens y componentes)
    app.css                estilos propios de la app sobre esos tokens
    manifest.json          manifiesto PWA (instalación, ícono, accesos directos)
    service-worker.js      cache offline + recepción de notificaciones push
    icons/
```
