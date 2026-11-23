/* ==========================================================================
   LOCAL .WAV UPLOADER (3 MODES: BEAT / MIX / MASTER), DEMO LOADER
   & HUGGING FACE COVER ART CONTROLLER — AGUJA ROJA
   ========================================================================== */

import { isCloudMode, listTracksForOwner, saveTrackHybrid, updateTrackMetaHybrid } from './store.js';
import { analyzeAudioBuffer, parseWavHeader } from './audio-engine.js';
import { generateDemoWavPair } from './demo-synth.js';
import {
  buildVintageCoverPrompt,
  generateHuggingFaceCover,
  generateProceduralVintageCover,
} from './cover-art.js';

export const TRACK_MODES = {
  master: {
    tag: 'MÁSTER',
    labelA: 'MIX (Antes)',
    labelB: 'MÁSTER (Después)',
    badgeA: 'VERSIÓN A · MIX',
    titleA: 'Archivo de Mezcla Original (.wav)',
    badgeB: 'VERSIÓN B · MÁSTER',
    titleB: 'Archivo de Máster Final (.wav)',
  },
  mix: {
    tag: 'MEZCLA',
    labelA: 'ORIGINAL (Antes)',
    labelB: 'MIX (Después)',
    badgeA: 'VERSIÓN A · ORIGINAL',
    titleA: 'Grabación Original / Rough (.wav)',
    badgeB: 'VERSIÓN B · MIX FINAL',
    titleB: 'Mezcla Final Terminada (.wav)',
  },
  beat: {
    tag: 'BEAT',
    labelA: '',
    labelB: 'BEAT / PRODUCCIÓN',
    badgeA: '',
    titleA: '',
    badgeB: 'PISTA ÚNICA · BEAT / PRODUCCIÓN',
    titleB: 'Archivo de Beat o Producción (.wav)',
  },
};

const $ = (id) => document.getElementById(id);

export function refreshPendingProceduralCover(state) {
  if (state.pendingCoverDataUrl && state.pendingCoverIsCustom) return;
  const seed = $('uploadTitle').value.trim() || $('uploadArtist').value.trim() || 'Aguja Roja';
  state.pendingCoverDataUrl = generateProceduralVintageCover(seed, state.pendingCoverVariant);
  state.pendingCoverIsCustom = false;
  $('uploadCoverPreview').src = state.pendingCoverDataUrl;
}

export function wireDropzone(state, zoneId, inputId, fileLabelId, keyName) {
  const zone = $(zoneId);
  const input = $(inputId);
  const labelEl = $(fileLabelId);

  const acceptFile = (file) => {
    if (!file) return;
    state[keyName] = file;
    zone.classList.add('has-file');
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    labelEl.textContent = `${file.name} (${sizeMB} MB)`;

    if (!$('uploadTitle').value.trim()) {
      const cleanName = file.name
        .replace(/\.[^.]+$/, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\b(mix|master|mastered|raw|rough|premaster|beat|v\d+)\b/gi, '')
        .trim();
      if (cleanName) {
        $('uploadTitle').value = cleanName;
        refreshPendingProceduralCover(state);
      }
    }
  };

  input.addEventListener('change', () => acceptFile(input.files[0]));
  ['dragenter', 'dragover'].forEach((ev) => {
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.add('is-dragover');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.remove('is-dragover');
    });
  });
  zone.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) acceptFile(file);
  });
}

export async function handleSaveUploadedTrack(e, { state, engine, showToast, onTrackAdded }) {
  e.preventDefault();
  if (state.isBusy) return;

  const isBeat = state.uploadMode === 'beat';
  if (!isBeat && (!state.pendingMixFile || !state.pendingMasterFile)) {
    showToast('Selecciona ambos archivos .WAV (Versión A y Versión B) o cambia a modo "Beat / Producción (1 .WAV)".', 'error');
    return;
  }
  if (isBeat && !state.pendingMasterFile) {
    showToast('Selecciona el archivo .WAV de tu Beat o Producción.', 'error');
    return;
  }
  if (isCloudMode() && (!state.cloudUser || state.cloudUser.id !== state.activeAccount?.id)) {
    showToast('Inicia sesión en tu cuenta en la nube para subir pistas.', 'error');
    return;
  }

  const cfg = TRACK_MODES[state.uploadMode];
  const title = $('uploadTitle').value.trim() || 'Sin título';
  const artist = $('uploadArtist').value.trim() || state.activeAccount?.displayName || 'Productor';
  const genre = $('uploadGenre').value.trim() || '';
  const bpmVal = parseInt($('uploadBpm').value, 10);
  const musicalKey = $('uploadKey').value.trim();
  const notes = $('uploadNotes').value.trim();

  state.isBusy = true;
  $('saveTrackBtn').disabled = true;
  $('uploadProgress').textContent = '1/3 Decodificando audio .WAV...';

  try {
    const ctx = engine.ensureContext();
    const arrB = await state.pendingMasterFile.arrayBuffer();
    const headerB = parseWavHeader(arrB);
    const bufB = await ctx.decodeAudioData(arrB.slice(0));

    let headerA = null;
    let bufA = null;
    if (!isBeat && state.pendingMixFile) {
      const arrA = await state.pendingMixFile.arrayBuffer();
      headerA = parseWavHeader(arrA);
      bufA = await ctx.decodeAudioData(arrA.slice(0));
    }

    $('uploadProgress').textContent = '2/3 Midiendo LUFS (ITU-R BS.1770-4) y forma de onda...';
    await new Promise((r) => setTimeout(r, 30));

    const statsB = analyzeAudioBuffer(bufB, 240);
    const statsA = bufA ? analyzeAudioBuffer(bufA, 240) : null;

    $('uploadProgress').textContent = isCloudMode()
      ? '3/3 Subiendo archivos a Supabase Storage...'
      : '3/3 Guardando archivos sin pérdida en IndexedDB...';

    const coverUrl =
      state.pendingCoverDataUrl || generateProceduralVintageCover(title, state.tracks.length + 1);

    const trackMeta = {
      id: `trk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ownerAccountId: state.activeAccount.id,
      order: state.tracks.length,
      trackMode: state.uploadMode,
      labelA: cfg.labelA,
      labelB: cfg.labelB,
      title,
      artist,
      genre,
      bpm: Number.isFinite(bpmVal) ? bpmVal : null,
      musicalKey,
      notes,
      mixFileName: isBeat ? '' : state.pendingMixFile.name,
      masterFileName: state.pendingMasterFile.name,
      mixFormat: statsA
        ? headerA?.label || `AUDIO · ${(bufA.sampleRate / 1000).toFixed(1)} kHz (${bufA.numberOfChannels}ch)`
        : '',
      masterFormat:
        headerB?.label || `AUDIO · ${(bufB.sampleRate / 1000).toFixed(1)} kHz (${bufB.numberOfChannels}ch)`,
      duration: statsA ? Math.max(statsA.duration, statsB.duration) : statsB.duration,
      mixLufs: statsA ? statsA.integratedLufs : null,
      masterLufs: statsB.integratedLufs,
      mixPeak: statsA ? statsA.peakDbfs : null,
      masterPeak: statsB.peakDbfs,
      mixPlr: statsA ? statsA.plr : null,
      masterPlr: statsB.plr,
      waveformMix: statsA ? statsA.waveform : [],
      waveformMaster: statsB.waveform,
      coverDataUrl: coverUrl,
      createdAt: Date.now(),
    };

    const saved = await saveTrackHybrid(trackMeta, isBeat ? null : state.pendingMixFile, state.pendingMasterFile);

    $('uploadTrackForm').reset();
    state.pendingMixFile = null;
    state.pendingMasterFile = null;
    state.pendingCoverDataUrl = null;
    state.pendingCoverIsCustom = false;
    $('mixDropzone').classList.remove('has-file');
    $('masterDropzone').classList.remove('has-file');
    $('mixFileLabel').textContent = 'Arrastra tu archivo A .wav o haz clic para explorar';
    $('masterFileLabel').textContent = 'Arrastra tu archivo B .wav o haz clic para explorar';
    refreshPendingProceduralCover(state);

    state.tracks = await listTracksForOwner(state.activeAccount.id);
    await onTrackAdded(saved.id);
    $('uploadProgress').textContent = '';
    showToast(`"${title}" guardado en el catálogo de @${state.activeAccount.handle}.`, 'success');
  } catch (err) {
    console.error(err);
    $('uploadProgress').textContent = '';
    showToast(`Error al procesar: ${err.message}`, 'error');
  } finally {
    state.isBusy = false;
    $('saveTrackBtn').disabled = false;
  }
}

export async function loadDemoTrack({ state, engine, showToast, onTrackAdded }) {
  if (state.isBusy) return;
  if (isCloudMode() && (!state.cloudUser || state.cloudUser.id !== state.activeAccount?.id)) {
    showToast('Inicia sesión en tu cuenta en la nube para agregar la demo.', 'info');
    return;
  }
  state.isBusy = true;
  $('trackLoadingStatus').textContent = 'Generando sesión demo .WAV...';
  try {
    const demo = generateDemoWavPair();
    const ctx = engine.ensureContext();
    const [mixArr, masterArr] = await Promise.all([demo.mixBlob.arrayBuffer(), demo.masterBlob.arrayBuffer()]);
    const [mixBuf, masterBuf] = await Promise.all([
      ctx.decodeAudioData(mixArr.slice(0)),
      ctx.decodeAudioData(masterArr.slice(0)),
    ]);

    const mixStats = analyzeAudioBuffer(mixBuf, 240);
    const masterStats = analyzeAudioBuffer(masterBuf, 240);

    const trackMeta = {
      id: `demo_${Date.now()}`,
      ownerAccountId: state.activeAccount.id,
      order: state.tracks.length,
      trackMode: 'master',
      labelA: 'MIX (Antes)',
      labelB: 'MÁSTER (Después)',
      title: 'Sesión Aguja Roja (Demo .WAV)',
      artist: 'Trío Analógico de Prueba',
      genre: 'Neo-Soul / Vintage Rhodes',
      bpm: 120,
      musicalKey: 'Dm',
      notes: 'Cadena demo: Pultec Low-End + Air Shelf 10kHz, apertura M/S sutil y saturación de cinta.',
      mixFileName: demo.mixFileName,
      masterFileName: demo.masterFileName,
      mixFormat: 'WAV · 16-bit / 44.1 kHz',
      masterFormat: 'WAV · 16-bit / 44.1 kHz',
      duration: Math.max(mixStats.duration, masterStats.duration),
      mixLufs: mixStats.integratedLufs,
      masterLufs: masterStats.integratedLufs,
      mixPeak: mixStats.peakDbfs,
      masterPeak: masterStats.peakDbfs,
      mixPlr: mixStats.plr,
      masterPlr: masterStats.plr,
      waveformMix: mixStats.waveform,
      waveformMaster: masterStats.waveform,
      coverDataUrl: generateProceduralVintageCover('Aguja Roja Demo', 2),
      createdAt: Date.now(),
    };

    const mixFile = new File([demo.mixBlob], demo.mixFileName, { type: 'audio/wav' });
    const masterFile = new File([demo.masterBlob], demo.masterFileName, { type: 'audio/wav' });
    const saved = await saveTrackHybrid(trackMeta, mixFile, masterFile);

    state.tracks = await listTracksForOwner(state.activeAccount.id);
    await onTrackAdded(saved.id);
    showToast('Demo lossless .WAV cargada. Pulsa Play y alterna A ↔ B.', 'success');
  } catch (err) {
    console.error(err);
    showToast(`Error creando demo: ${err.message}`, 'error');
  } finally {
    state.isBusy = false;
  }
}

export async function triggerHuggingFaceCover({ state, forCurrentTrack, showToast, onCoverUpdated }) {
  const token = $('hfTokenInput').value.trim();
  const modelId = $('hfModelSelect').value;
  localStorage.setItem('hfToken', token);
  localStorage.setItem('hfModel', modelId);
  state.hfToken = token;
  state.hfModel = modelId;

  const targetTitle = forCurrentTrack
    ? state.currentTrack?.title || 'Aguja Roja Session'
    : $('uploadTitle').value.trim() || 'Aguja Roja Session';
  const targetArtist = forCurrentTrack ? state.currentTrack?.artist || '' : $('uploadArtist').value.trim();
  const targetGenre = forCurrentTrack ? state.currentTrack?.genre || 'Vintage Vinyl' : $('uploadGenre').value.trim();
  const prompt = buildVintageCoverPrompt({
    title: targetTitle,
    artist: targetArtist,
    genre: targetGenre,
    moodPrompt: $('hfMoodPrompt').value.trim(),
  });

  const statusEl = $('hfStatusLine');
  statusEl.textContent = `Generando portada en Hugging Face (${modelId.split('/')[1]})...`;
  $('hfGenerateBtn').disabled = true;
  $('regenActiveCoverHfBtn').disabled = true;

  try {
    const dataUrl = await generateHuggingFaceCover({ token, modelId, prompt });
    if (forCurrentTrack && state.currentTrack) {
      state.currentTrack.coverDataUrl = dataUrl;
      await updateTrackMetaHybrid(state.currentTrack);
      onCoverUpdated();
      showToast('Portada IA generada con Hugging Face y aplicada al vinilo.', 'success');
    } else {
      state.pendingCoverDataUrl = dataUrl;
      state.pendingCoverIsCustom = true;
      $('uploadCoverPreview').src = dataUrl;
      showToast('Portada IA lista para tu nueva pista.', 'success');
    }
    statusEl.textContent = 'Portada IA generada correctamente.';
  } catch (err) {
    statusEl.textContent = err.message;
    showToast(err.message, 'error');
  } finally {
    $('hfGenerateBtn').disabled = false;
    $('regenActiveCoverHfBtn').disabled = false;
  }
}
