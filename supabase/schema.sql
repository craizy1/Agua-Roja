-- ============================================================================
-- AGUJA ROJA — ESQUEMA SUPABASE (POSTGRES + ROW LEVEL SECURITY + STORAGE)
-- Pega y ejecuta este script una sola vez en Supabase -> SQL Editor -> New Query
-- ============================================================================

-- 1. TABLA DE PERFILES PÚBLICOS DE PRODUCTORES / INGENIEROS
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text unique not null check (handle ~ '^[a-z0-9_.-]{2,32}$'),
  studio_name text not null default 'Aguja Roja',
  display_name text not null,
  role text not null default 'Productor / Ingeniero de Audio',
  hero_title text not null default 'Calidez analógica justo antes del límite.',
  hero_lead text not null default 'Escucha producciones, mezclas y másters sin pérdida (.WAV) con igualación LUFS y medidores Pro.',
  bio1 text not null default '',
  bio2 text not null default '',
  specialties text not null default '',
  location text not null default '',
  email text not null default '',
  turnaround text not null default '24 – 48 horas hábiles',
  revisions text not null default 'Hasta 2 rondas de ajuste incluidas',
  instagram text not null default '',
  spotify text not null default '',
  website text not null default '',
  avatar_url text not null default '',
  created_at timestamptz not null default now()
);

-- 2. TABLA DE PISTAS (BEATS 1 ARCHIVO, MEZCLA A/B, MASTERING A/B)
create table if not exists public.tracks (
  id text primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  order_index integer not null default 0,
  track_mode text not null default 'master' check (track_mode in ('master', 'mix', 'beat')),
  label_a text not null default 'MIX (Antes)',
  label_b text not null default 'MÁSTER (Después)',
  title text not null,
  artist text not null,
  genre text not null default '',
  bpm integer,
  musical_key text not null default '',
  notes text not null default '',
  mix_file_name text not null default '',
  master_file_name text not null default '',
  mix_format text not null default '',
  master_format text not null default '',
  duration double precision not null default 0,
  mix_lufs double precision,
  master_lufs double precision not null default -14.0,
  mix_peak double precision,
  master_peak double precision not null default -1.0,
  mix_plr double precision,
  master_plr double precision not null default 8.0,
  waveform_mix jsonb not null default '[]'::jsonb,
  waveform_master jsonb not null default '[]'::jsonb,
  cover_url text not null default '',
  mix_audio_url text not null default '',
  master_audio_url text not null,
  created_at timestamptz not null default now()
);

create index if not exists tracks_owner_order_idx on public.tracks (owner_id, order_index);

-- 3. SEGURIDAD ROW-LEVEL SECURITY (RLS)
alter table public.profiles enable row level security;
alter table public.tracks enable row level security;

-- Perfiles: cualquiera puede ver perfiles públicos; solo el dueño edita el suyo
create policy "Perfiles públicos visibles para todos"
  on public.profiles for select using (true);

create policy "El usuario crea su propio perfil"
  on public.profiles for insert with check (auth.uid() = id);

create policy "El usuario edita su propio perfil"
  on public.profiles for update using (auth.uid() = id);

create policy "El usuario elimina su propio perfil"
  on public.profiles for delete using (auth.uid() = id);

-- Tracks: cualquiera puede escuchar pistas públicas; solo el dueño sube/edita/borra
create policy "Tracks públicos visibles para todos"
  on public.tracks for select using (true);

create policy "El dueño sube sus tracks"
  on public.tracks for insert with check (auth.uid() = owner_id);

create policy "El dueño actualiza sus tracks"
  on public.tracks for update using (auth.uid() = owner_id);

create policy "El dueño borra sus tracks"
  on public.tracks for delete using (auth.uid() = owner_id);

-- 4. BUCKETS DE STORAGE PÚBLICOS (AUDIO .WAV, PORTADAS, AVATARES)
insert into storage.buckets (id, name, public)
values
  ('aguja-audio', 'aguja-audio', true),
  ('aguja-covers', 'aguja-covers', true),
  ('aguja-avatars', 'aguja-avatars', true)
on conflict (id) do nothing;

-- Lectura pública de los 3 buckets
create policy "Lectura pública de audio, portadas y avatares"
  on storage.objects for select
  using (bucket_id in ('aguja-audio', 'aguja-covers', 'aguja-avatars'));

-- Escritura/borrado solo dentro de la carpeta del propio usuario: {auth.uid()}/archivo
create policy "Usuarios suben solo en su carpeta"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('aguja-audio', 'aguja-covers', 'aguja-avatars')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Usuarios actualizan solo en su carpeta"
  on storage.objects for update to authenticated
  using (
    bucket_id in ('aguja-audio', 'aguja-covers', 'aguja-avatars')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Usuarios borran solo en su carpeta"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('aguja-audio', 'aguja-covers', 'aguja-avatars')
    and (storage.foldername(name))[1] = auth.uid()::text
  );
