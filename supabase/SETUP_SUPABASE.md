# Cómo activar la Nube Pública de Aguja Roja con Supabase (Gratis, 5 minutos)

Sin configurar nada, **Aguja Roja** funciona en **Modo Local (IndexedDB)** con aislamiento de pistas por cuenta. Cuando quieras que tus amigos y clientes puedan crear cuentas reales, subir sus pistas y compartir enlaces públicos (`?u=tu_usuario`), sigue estos 4 pasos:

1. **Crea un proyecto gratuito en Supabase**
   - Entra a [supabase.com](https://supabase.com), inicia sesión con GitHub y pulsa **New Project** (plan Free: \$0/mes).
2. **Ejecuta el esquema SQL**
   - En el menú izquierdo ve a **SQL Editor → New Query**.
   - Copia y pega todo el contenido de [`supabase/schema.sql`](schema.sql) y presiona **Run**.
   - Esto crea automáticamente las tablas `profiles` y `tracks`, las reglas de seguridad **Row-Level Security (RLS)** y los 3 buckets públicos de almacenamiento (`aguja-audio`, `aguja-covers`, `aguja-avatars`).
3. **Configura Autenticación rápida (opcional para beta con amigos)**
   - En **Authentication → Providers → Email**, si quieres que tus amigos puedan entrar al instante sin esperar correo de confirmación, desactiva temporalmente **Confirm email**.
4. **Conecta tu proyecto en `js/config.js`**
   - Ve a **Project Settings → API** en Supabase y copia:
     - **Project URL** (`https://xxxx.supabase.co`)
     - **anon / public key** *(es una llave pública diseñada para el frontend; la seguridad vive en las políticas RLS que ejecutaste en el paso 2)*.
   - Pégalas en [`js/config.js`](../js/config.js) y haz push a GitHub.

¡Listo! Desde ese momento:
- Cada productor tendrá su enlace público `https://tu-usuario.github.io/aguja-roja/?u=su_handle`.
- Cualquier persona con ese enlace escuchará sus beats, mezclas o másters directo desde la nube en **Modo Cliente**.
- *Límite del plan gratuito de Supabase Storage:* 1 GB total y hasta **50 MB por archivo** (suficiente para archivos `.WAV` de 16-bit/44.1 kHz o `.FLAC` lossless). Cuando el proyecto crezca, se puede conectar **Cloudflare R2** (10 GB gratis y \$0 en transferencia).
