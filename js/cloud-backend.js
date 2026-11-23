/* ==========================================================================
   AGUJA ROJA — ADAPTADOR DE NUBE PÚBLICA (SUPABASE AUTH + POSTGRES + STORAGE)
   Se carga dinámicamente vía ESM solo cuando js/config.js tiene credenciales,
   manteniendo Modo Local 100% libre de peticiones externas.
   ========================================================================== */

import { CLOUD_CONFIG, isCloudConfigured } from './config.js';

let clientPromise = null;

export async function getSupabase() {
  if (!isCloudConfigured()) return null;
  if (!clientPromise) {
    clientPromise = import('https://esm.sh/@supabase/supabase-js@2').then(({ createClient }) =>
      createClient(CLOUD_CONFIG.supabaseUrl, CLOUD_CONFIG.supabaseAnonKey)
    );
  }
  return clientPromise;
}

function mapProfileFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    handle: row.handle,
    studioName: row.studio_name,
    displayName: row.display_name,
    role: row.role,
    heroTitle: row.hero_title,
    heroLead: row.hero_lead,
    bio1: row.bio1,
    bio2: row.bio2,
    specialties: row.specialties,
    location: row.location,
    email: row.email,
    turnaround: row.turnaround,
    revisions: row.revisions,
    instagram: row.instagram,
    spotify: row.spotify,
    website: row.website,
    avatarDataUrl: row.avatar_url || '',
    isCloud: true,
    createdAt: new Date(row.created_at).getTime(),
  };
}

function mapTrackFromRow(row) {
  return {
    id: row.id,
    ownerAccountId: row.owner_id,
    order: row.order_index ?? 0,
    trackMode: row.track_mode || 'master',
    labelA: row.label_a || 'MIX (Antes)',
    labelB: row.label_b || 'MÁSTER (Después)',
    title: row.title,
    artist: row.artist,
    genre: row.genre || '',
    bpm: row.bpm || null,
    musicalKey: row.musical_key || '',
    notes: row.notes || '',
    mixFileName: row.mix_file_name || '',
    masterFileName: row.master_file_name || '',
    mixFormat: row.mix_format || '',
    masterFormat: row.master_format || '',
    duration: row.duration || 0,
    mixLufs: row.mix_lufs,
    masterLufs: row.master_lufs ?? -14.0,
    mixPeak: row.mix_peak,
    masterPeak: row.master_peak ?? -1.0,
    mixPlr: row.mix_plr,
    masterPlr: row.master_plr ?? 8.0,
    waveformMix: Array.isArray(row.waveform_mix) ? row.waveform_mix : [],
    waveformMaster: Array.isArray(row.waveform_master) ? row.waveform_master : [],
    coverDataUrl: row.cover_url || '',
    mixAudioUrl: row.mix_audio_url || '',
    masterAudioUrl: row.master_audio_url || '',
    createdAt: new Date(row.created_at).getTime(),
  };
}

function dataUrlToBlob(dataUrl) {
  const [header, b64] = dataUrl.split(',');
  const mime = (header.match(/:(.*?);/) || [])[1] || 'image/jpeg';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function uploadToBucket(sb, bucket, path, blobOrFile) {
  const maxBytes = CLOUD_CONFIG.maxUploadMB * 1024 * 1024;
  if (blobOrFile.size > maxBytes) {
    throw new Error(
      `El archivo supera el límite de ${CLOUD_CONFIG.maxUploadMB} MB del plan gratuito de Supabase Storage (${(blobOrFile.size / 1048576).toFixed(1)} MB).`
    );
  }
  const { error } = await sb.storage.from(bucket).upload(path, blobOrFile, {
    upsert: true,
    contentType: blobOrFile.type || 'application/octet-stream',
  });
  if (error) throw new Error(`Error subiendo archivo a nube: ${error.message}`);
  const { data } = sb.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/* ---- AUTH & PROFILES ---- */
export async function cloudGetSession() {
  const sb = await getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data?.session || null;
}

export async function cloudSignUp({ email, password, displayName, handle, studioName, role, avatarDataUrl }) {
  const sb = await getSupabase();
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  const user = data.user;
  if (!user) throw new Error('Revisa tu correo para confirmar tu cuenta antes de iniciar sesión.');

  let avatarUrl = '';
  if (avatarDataUrl && avatarDataUrl.startsWith('data:image/')) {
    avatarUrl = await uploadToBucket(sb, CLOUD_CONFIG.buckets.avatars, `${user.id}/avatar.jpg`, dataUrlToBlob(avatarDataUrl));
  }

  const profileRow = {
    id: user.id,
    handle,
    studio_name: studioName || 'Aguja Roja',
    display_name: displayName,
    role: role || 'Productor / Ingeniero de Audio',
    email,
    avatar_url: avatarUrl,
  };

  const { data: inserted, error: pErr } = await sb.from('profiles').upsert(profileRow).select().single();
  if (pErr) throw new Error(`Perfil no guardado: ${pErr.message}`);
  return mapProfileFromRow(inserted);
}

export async function cloudSignIn({ email, password }) {
  const sb = await getSupabase();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return cloudFetchProfileById(data.user.id);
}

export async function cloudSignOut() {
  const sb = await getSupabase();
  if (sb) await sb.auth.signOut();
}

export async function cloudFetchProfileById(id) {
  const sb = await getSupabase();
  const { data, error } = await sb.from('profiles').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return mapProfileFromRow(data);
}

export async function cloudFetchProfileByHandle(handle) {
  const sb = await getSupabase();
  const { data, error } = await sb.from('profiles').select('*').eq('handle', handle.toLowerCase()).maybeSingle();
  if (error) throw new Error(error.message);
  return mapProfileFromRow(data);
}

export async function cloudFetchAllProfiles() {
  const sb = await getSupabase();
  const { data, error } = await sb.from('profiles').select('*').order('created_at', { ascending: true }).limit(50);
  if (error) throw new Error(error.message);
  return (data || []).map(mapProfileFromRow);
}

export async function cloudUpdateProfile(profile, pendingAvatarDataUrl) {
  const sb = await getSupabase();
  let avatarUrl = profile.avatarDataUrl || '';
  if (pendingAvatarDataUrl === '') {
    avatarUrl = '';
  } else if (pendingAvatarDataUrl && pendingAvatarDataUrl.startsWith('data:image/')) {
    avatarUrl = await uploadToBucket(
      sb,
      CLOUD_CONFIG.buckets.avatars,
      `${profile.id}/avatar_${Date.now()}.jpg`,
      dataUrlToBlob(pendingAvatarDataUrl)
    );
  }

  const row = {
    handle: profile.handle,
    studio_name: profile.studioName,
    display_name: profile.displayName,
    role: profile.role,
    hero_title: profile.heroTitle,
    hero_lead: profile.heroLead,
    bio1: profile.bio1,
    bio2: profile.bio2,
    specialties: profile.specialties,
    location: profile.location,
    email: profile.email,
    turnaround: profile.turnaround,
    revisions: profile.revisions,
    instagram: profile.instagram,
    spotify: profile.spotify,
    website: profile.website,
    avatar_url: avatarUrl,
  };

  const { data, error } = await sb.from('profiles').update(row).eq('id', profile.id).select().single();
  if (error) throw new Error(error.message);
  return mapProfileFromRow(data);
}

/* ---- TRACKS ---- */
export async function cloudGetTracksByOwner(ownerId) {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from('tracks')
    .select('*')
    .eq('owner_id', ownerId)
    .order('order_index', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map(mapTrackFromRow);
}

export async function cloudSaveTrack(trackMeta, fileA, fileB) {
  const sb = await getSupabase();
  const uid = trackMeta.ownerAccountId;

  let mixAudioUrl = '';
  if (fileA) {
    const extA = (fileA.name.split('.').pop() || 'wav').toLowerCase();
    mixAudioUrl = await uploadToBucket(sb, CLOUD_CONFIG.buckets.audio, `${uid}/${trackMeta.id}_a.${extA}`, fileA);
  }

  const extB = (fileB.name.split('.').pop() || 'wav').toLowerCase();
  const masterAudioUrl = await uploadToBucket(sb, CLOUD_CONFIG.buckets.audio, `${uid}/${trackMeta.id}_b.${extB}`, fileB);

  let coverUrl = trackMeta.coverDataUrl || '';
  if (coverUrl.startsWith('data:image/')) {
    coverUrl = await uploadToBucket(sb, CLOUD_CONFIG.buckets.covers, `${uid}/${trackMeta.id}_cover.jpg`, dataUrlToBlob(coverUrl));
  }

  const row = {
    id: trackMeta.id,
    owner_id: uid,
    order_index: trackMeta.order ?? 0,
    track_mode: trackMeta.trackMode || 'master',
    label_a: trackMeta.labelA || '',
    label_b: trackMeta.labelB || '',
    title: trackMeta.title,
    artist: trackMeta.artist,
    genre: trackMeta.genre || '',
    bpm: trackMeta.bpm || null,
    musical_key: trackMeta.musicalKey || '',
    notes: trackMeta.notes || '',
    mix_file_name: trackMeta.mixFileName || '',
    master_file_name: trackMeta.masterFileName || '',
    mix_format: trackMeta.mixFormat || '',
    master_format: trackMeta.masterFormat || '',
    duration: trackMeta.duration || 0,
    mix_lufs: trackMeta.mixLufs ?? null,
    master_lufs: trackMeta.masterLufs ?? -14.0,
    mix_peak: trackMeta.mixPeak ?? null,
    master_peak: trackMeta.masterPeak ?? -1.0,
    mix_plr: trackMeta.mixPlr ?? null,
    master_plr: trackMeta.masterPlr ?? 8.0,
    waveform_mix: trackMeta.waveformMix || [],
    waveform_master: trackMeta.waveformMaster || [],
    cover_url: coverUrl,
    mix_audio_url: mixAudioUrl,
    master_audio_url: masterAudioUrl,
  };

  const { data, error } = await sb.from('tracks').upsert(row).select().single();
  if (error) throw new Error(error.message);
  return mapTrackFromRow(data);
}

export async function cloudUpdateTrackMeta(trackMeta) {
  const sb = await getSupabase();
  let coverUrl = trackMeta.coverDataUrl || '';
  if (coverUrl.startsWith('data:image/')) {
    coverUrl = await uploadToBucket(
      sb,
      CLOUD_CONFIG.buckets.covers,
      `${trackMeta.ownerAccountId}/${trackMeta.id}_cover_${Date.now()}.jpg`,
      dataUrlToBlob(coverUrl)
    );
  }
  const { data, error } = await sb
    .from('tracks')
    .update({ order_index: trackMeta.order ?? 0, cover_url: coverUrl })
    .eq('id', trackMeta.id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return mapTrackFromRow(data);
}

export async function cloudDeleteTrack(trackMeta) {
  const sb = await getSupabase();
  const { error } = await sb.from('tracks').delete().eq('id', trackMeta.id);
  if (error) throw new Error(error.message);
}
