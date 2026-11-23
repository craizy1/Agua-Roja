# Aguja Roja — Plataforma de Portafolio y Comparador A/B de Audio (.WAV)

Portafolio interactivo de audio con estética analógica vintage (nogal, latón cepillado, tornamesa giratorio con aguja roja, medidores VU analógicos y librería de cassettes), diseñado para **productores de beats/producciones**, **ingenieros de mezcla** e **ingenieros de máster**.

> **Estado actual:** Prototipo público v1 (100% cliente con Web Audio API + IndexedDB, listo para probar en GitHub Pages o localmente sin instalar dependencias ni Node.js).

---

## Características Implementadas

- **3 Modos de Pista para Creadores:**
  - **Mastering (`Mix ↔ Máster`)** y **Mezcla (`Original ↔ Mix`)**: 2 archivos `.wav`, alternancia A/B instantánea sin clics (crossfade 15 ms, tecla `T`) e igualación automática **ITU-R BS.1770-4 (LUFS)** (tecla `L`).
  - **Beat / Producción (1 archivo `.wav`):** vitrina directa sin pérdida con etiquetas de **BPM** y **Tonalidad (Key)**.
- **Arquitectura Híbrida (Local IndexedDB ↔ Nube Pública Supabase):**
  - Funciona de inmediato en **Modo Local (IndexedDB v3)** con **catálogo de pistas aislado por cuenta (`ownerAccountId`)**.
  - Al pegar tus credenciales públicas en `js/config.js` y ejecutar [`supabase/schema.sql`](supabase/schema.sql) (guía de 5 minutos en [`supabase/SETUP_SUPABASE.md`](supabase/SETUP_SUPABASE.md)), activa cuentas reales en la nube, Storage de `.wav` y enlaces compartibles `?u=usuario`.
- **Panel Pro estilo MiniMeters (Tecla `P`):**
  - **Espectrograma logarítmico 20 Hz – 20,000 Hz** (FFT 4096) con marcadores visuales al alternar A ↔ B.
  - **Correlación Estéreo (`-1` a `+1`)** para auditar compatibilidad mono y corte en vinilo.
  - **Vectorscopio Lissajous (`L / R / M / S`)**, **Osciloscopio de Transientes** y barras **Mid / Side / Crest Factor / Balance**.
  - **Matriz de Monitoreo Pro (`Estéreo` / `Mono` / `Mid` / `Side`)**.
- **Cuentas locales de Productor y Perfil Público:** Crea múltiples perfiles (con foto circular personalizada en IndexedDB y PIN opcional SHA-256), edita bio, especialidades y redes sociales, y alterna entre **Modo Editor** y **Modo Cliente**.
- **Portadas automáticas gratuitas (Hugging Face + Arte Vintage local):** Compatible con `FLUX.1-schnell`, `SDXL 1.0` y `FLUX.1-dev` vía Hugging Face Inference Router (con token gratuito del usuario guardado solo en su navegador), más generador offline estilo vinilo mid-century.
- **Demo `.WAV` lossless integrada:** Sintetiza un par Mix/Máster al abrir por primera vez para probar todas las funciones al instante.

---

## Cómo probarlo (Local o en GitHub Pages)

### Opción 1: En vivo con GitHub Pages (ideal para compartir con amigos)
Este repositorio incluye [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml):
1. Sube el proyecto a un repositorio público de GitHub en la rama `main`.
2. Ve a **Settings → Pages → Build and deployment → Source** y elige **GitHub Actions**.
3. En ~30 segundos tendrás tu enlace público `https://<tu-usuario>.github.io/<nombre-del-repo>/`.

### Opción 2: En tu computadora (Windows / Mac / Linux)
- **Windows:** Haz doble clic en `abrir-portafolio.bat`.
- **Terminal (cualquier sistema con Python 3):**
  ```bash
  python -m http.server 8080 --bind 127.0.0.1
  ```
  Abre `http://127.0.0.1:8080`.

---

## Estructura del Proyecto

```text
├── index.html              # Interfaz principal, SEO (Open Graph + JSON-LD) y consola A/B
├── 404.html                # Página 404 tematizada ("Surco vacío")
├── PRODUCT.md              # Verdad de producto y alcance (Impeccable)
├── robots.txt / sitemap.xml# Fundamentos de indexación SEO
├── assets/favicon.svg      # Ícono SVG Aguja Roja
├── css/
│   ├── tokens.css          # Paleta madera/latón/pergamino y variables CSS
│   ├── layout.css          # Navegación y secciones de portafolio
│   ├── console.css         # Consola vintage, tornamesa, switch A/B y cassettes
│   ├── pro-meters.css      # Rack Panel Pro (MiniMeters) y matriz de monitoreo
│   └── editor.css          # Subida de .WAV, perfiles de productor y cuentas
└── js/
    ├── db.js               # Persistencia IndexedDB v2 (Blobs .WAV + cuentas)
    ├── audio-engine.js     # Motor Web Audio A/B, LUFS BS.1770-4 y matriz M/S
    ├── visualizer.js       # Waveform interactivo, VU analógicos y espectro
    ├── pro-meters.js       # Espectrograma 20Hz-20kHz, correlación y vectorscopio
    ├── cover-art.js        # API Hugging Face + generador Canvas vintage offline
    ├── accounts.js         # Gestión de cuentas locales, avatares y perfil público
    ├── demo-synth.js       # Generador lossless .WAV de demostración
    └── app.js              # Controlador principal y atajos de teclado
```

## Atajos de Teclado

| Tecla | Acción |
| --- | --- |
| `Espacio` | Reproducir / Pausar |
| `T` o `M` | Alternar instantáneamente **A ↔ B** |
| `L` | Activar / desactivar **Loudness Match (LUFS)** |
| `P` | Mostrar / ocultar **Panel Pro (MiniMeters)** |
| `[` / `]` | Marcar punto A / punto B del Loop |

## Licencia

Distribuido bajo licencia [MIT](LICENSE).
