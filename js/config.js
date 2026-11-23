/* ==========================================================================
   AGUJA ROJA — CONFIGURACIÓN DE NUBE PÚBLICA (SUPABASE)
   Deja vacíos supabaseUrl y supabaseAnonKey para usar Modo Local (IndexedDB).
   Al pegarlos (son llaves públicas protegidas por RLS en Postgres), la web
   activa automáticamente cuentas reales, almacenamiento en nube y links ?u=
   ========================================================================== */

export const CLOUD_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  maxUploadMB: 50,
  buckets: {
    audio: 'aguja-audio',
    covers: 'aguja-covers',
    avatars: 'aguja-avatars',
  },
};

export function isCloudConfigured() {
  return Boolean(
    CLOUD_CONFIG.supabaseUrl &&
      CLOUD_CONFIG.supabaseUrl.startsWith('https://') &&
      CLOUD_CONFIG.supabaseAnonKey &&
      CLOUD_CONFIG.supabaseAnonKey.length > 20
  );
}
