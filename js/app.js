/* ==========================================================================
   MAIN APPLICATION CONTROLLER — AGUJA ROJA
   Account-scoped track isolation (IndexedDB v3 / Supabase Cloud),
   3 creator track modes (Beat 1-WAV, Mix A/B, Master A/B) & MiniMeters Pro.
   ========================================================================== */

import { saveSetting, getSetting, getStorageInfo } from './db.js';
import {
  isCloudMode,
  listTracksForOwner,
  updateTrackMetaHybrid,
  deleteTrackHybrid,
  getTrackAudioSourcesHybrid,
} from './store.js';
import { MasteringAudioEngine } from './audio-engine.js';
import {
  HF_FREE_COVER_MODELS,
  generateProceduralVintageCover,
  blobToCompressedDataUrl,
} from './cover-art.js';
import { drawWaveform, drawAnalogVuMeters, drawSpectrum } from './visualizer.js';
import { ProMetersRenderer } from './pro-meters.js';
import { initAccounts } from './accounts.js';
import {
  TRACK_MODES,
  refreshPendingProceduralCover,
  wireDropzone,
  handleSaveUploadedTrack,
  loadDemoTrack,
  triggerHuggingFaceCover,
} from './uploader.js';

const engine = new MasteringAudioEngine();
const proMeters = new ProMetersRenderer();

const state = {
  tracks: [],
  currentTrackId: null,
  currentTrack: null,
  mode: localStorage.getItem('portfolioMode') || 'editor',
  proPanelOpen: localStorage.getItem('proPanelOpen') !== 'false',
  uploadMode: 'master', // 'master' | 'mix' | 'beat'
  accounts: [],
  activeAccount: null,
  cloudUser: null,
  hfToken: localStorage.getItem('hfToken') || '',
  hfModel: localStorage.getItem('hfModel') || HF_FREE_COVER_MODELS[0].id,

  pendingMixFile: null,
  pendingMasterFile: null,
  pendingCoverDataUrl: null,
  pendingCoverIsCustom: false,
  pendingCoverVariant: 0,

  isScrubbing: false,
  isBusy: false,
};

const $ = (id) => document.getElementById(id);

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '00:00.0';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const tenths = Math.floor((sec % 1) * 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`;
}

function showToast(message, type = 'info') {
  const region = $('toastRegion');
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'is-error' : type === 'success' ? 'is-success' : ''}`;
  el.textContent = message;
  region.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 220ms';
    setTimeout(() => el.remove(), 240);
  }, 4000);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ==========================================================================
   MODES & UPLOAD TRACK TYPE UI
   ========================================================================== */
function applyMode(mode) {
  state.mode = mode === 'client' ? 'client' : 'editor';
  localStorage.setItem('portfolioMode', state.mode);
  document.body.classList.toggle('mode-client', state.mode === 'client');
  $('modeEditorBtn').classList.toggle('is-active', state.mode === 'editor');
  $('modeClientBtn').classList.toggle('is-active', state.mode === 'client');
  $('modeEditorBtn').setAttribute('aria-pressed', String(state.mode === 'editor'));
  $('modeClientBtn').setAttribute('aria-pressed', String(state.mode === 'client'));
}

function applyProPanel(open) {
  state.proPanelOpen = Boolean(open);
  localStorage.setItem('proPanelOpen', String(state.proPanelOpen));
  $('proMetersRack').hidden = !state.proPanelOpen;
  $('proPanelToggleBtn').classList.toggle('is-active', state.proPanelOpen);
  $('proPanelToggleBtn').setAttribute('aria-expanded', String(state.proPanelOpen));
}

function applyUploadMode(mode) {
  state.uploadMode = TRACK_MODES[mode] ? mode : 'master';
  const cfg = TRACK_MODES[state.uploadMode];
  const isBeat = state.uploadMode === 'beat';

  document.querySelectorAll('[data-upload-mode]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.uploadMode === state.uploadMode);
  });

  $('mixDropzone').hidden = isBeat;
  $('uploadDropGrid').classList.toggle('is-single', isBeat);
  if (!isBeat) {
    $('dropBadgeA').textContent = cfg.badgeA;
    $('dropTitleA').textContent = cfg.titleA;
  }
  $('dropBadgeB').textContent = cfg.badgeB;
  $('dropTitleB').textContent = cfg.titleB;
}

function updateMonitorMatrixUI(mode) {
  document.querySelectorAll('[data-monitor-mode]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.monitorMode === mode);
  });
}

/* ==========================================================================
   ACCOUNT-SCOPED CATALOG RELOAD (P0 #1 ISOLATION)
   ========================================================================== */
async function reloadCatalogForActiveAccount() {
  engine.stop();
  updatePlayButtonUI();
  proMeters.clearSpectrogram();
  state.currentTrackId = null;
  state.currentTrack = null;

  const ownerId = state.activeAccount?.id;
  state.tracks = ownerId ? await listTracksForOwner(ownerId) : [];
  renderTrackList();
  await refreshStorageBadge();

  if (state.tracks.length > 0) {
    await selectTrack(state.tracks[0].id, false);
  } else {
    renderCurrentTrackMeta();
    updateActiveVersionUI();
  }
}

/* ==========================================================================
   TRACK LOADING & CONSOLE UI SYNC
   ========================================================================== */
async function selectTrack(trackId, autoPlay = false) {
  const track = state.tracks.find((t) => t.id === trackId);
  if (!track) return;

  state.currentTrackId = track.id;
  state.currentTrack = track;
  proMeters.clearSpectrogram();
  renderTrackList();
  renderCurrentTrackMeta();

  $('trackLoadingStatus').textContent = isCloudMode() ? 'Descargando .WAV...' : 'Decodificando .WAV...';
  try {
    const { sourceA, sourceB } = await getTrackAudioSourcesHybrid(track);
    if (!sourceB) {
      throw new Error('No se encontró el archivo principal (.wav) para esta pista.');
    }
    await engine.loadTrack(sourceA, sourceB, track.mixLufs, track.masterLufs);
    $('trackLoadingStatus').textContent = track.masterFormat || 'WAV Lossless';
    updateLoopButtonsUI();
    updateActiveVersionUI();
    updatePlayButtonUI();
    if (autoPlay) {
      await engine.play(0);
      updatePlayButtonUI();
    }
  } catch (err) {
    console.error(err);
    $('trackLoadingStatus').textContent = 'Error de audio';
    showToast(`No se pudo cargar la pista: ${err.message}`, 'error');
  }
}

function renderCurrentTrackMeta() {
  const t = state.currentTrack;
  const isBeat = t?.trackMode === 'beat';

  $('abSwitchGroup').hidden = Boolean(isBeat);
  $('singleTrackBanner').hidden = !isBeat;
  $('loudnessMatchBtn').disabled = Boolean(isBeat);

  if (!t) {
    $('turntableTitle').textContent = 'Sin pista cargada en esta cuenta';
    $('turntableArtist').textContent = 'Sube un Beat (.WAV) o comparativa A/B desde el panel inferior';
    $('turntableNotes').textContent = '';
    $('vinylCoverImg').src = generateProceduralVintageCover(state.activeAccount?.displayName || 'Aguja Roja', 0);
    $('specFormatChip').textContent = 'WAV · Sin señal';
    $('specLufsDeltaChip').textContent = 'Delta: -- dB';
    $('specPlrChip').textContent = 'PLR Dinámico: -- dB';
    $('timeTotal').textContent = '00:00.0';
    return;
  }

  const modeCfg = TRACK_MODES[t.trackMode] || TRACK_MODES.master;
  $('switchALabel').textContent = t.labelA || modeCfg.labelA;
  $('switchBLabel').textContent = t.labelB || modeCfg.labelB;

  if (isBeat) {
    const extras = [t.bpm ? `${t.bpm} BPM` : '', t.musicalKey || ''].filter(Boolean).join(' · ');
    $('singleTrackLabel').textContent = extras ? `BEAT / PRODUCCIÓN · ${extras}` : 'BEAT / PRODUCCIÓN · WAV LOSSLESS';
  }

  $('turntableTitle').textContent = t.title;
  const subParts = [t.artist, t.genre, t.bpm ? `${t.bpm} BPM` : '', t.musicalKey].filter(Boolean);
  $('turntableArtist').textContent = subParts.join(' · ');
  $('turntableNotes').textContent =
    t.notes || (isBeat ? 'Reproducción directa sin compresión de streaming.' : 'Comparación A/B lossless en tiempo real.');
  $('vinylCoverImg').src = t.coverDataUrl || generateProceduralVintageCover(t.title, 0);

  const activeFmt = engine.activeVersion === 'master' || isBeat ? t.masterFormat : t.mixFormat;
  $('specFormatChip').textContent = activeFmt || 'WAV Lossless';

  if (isBeat || !Number.isFinite(t.mixLufs)) {
    $('specLufsDeltaChip').textContent = `Integrado: ${t.masterLufs.toFixed(1)} LUFS`;
  } else {
    const delta = (t.masterLufs - t.mixLufs).toFixed(1);
    const sign = Number(delta) >= 0 ? '+' : '';
    $('specLufsDeltaChip').textContent = `B vs A: ${sign}${delta} LU`;
  }

  const activePlr = engine.activeVersion === 'master' || isBeat ? t.masterPlr : t.mixPlr;
  $('specPlrChip').textContent = `PLR Dinámico: ${activePlr ?? '--'} dB`;
  $('timeTotal').textContent = formatTime(t.duration);
}

function updateActiveVersionUI() {
  const t = state.currentTrack;
  const isBeat = t?.trackMode === 'beat';
  const isB = engine.activeVersion === 'master' || isBeat;

  $('switchMixBtn').classList.toggle('is-active', !isB);
  $('switchMasterBtn').classList.toggle('is-active', isB);
  $('switchMixBtn').setAttribute('aria-pressed', String(!isB));
  $('switchMasterBtn').setAttribute('aria-pressed', String(isB));

  if (t) {
    const rawInt = isB ? t.masterLufs : t.mixLufs;
    const trim = engine.getActiveTrimDb();
    const effectiveLufs = (rawInt ?? -14) + trim;
    $('meterIntegrated').textContent = `${effectiveLufs.toFixed(1)} LUFS`;
    $('meterIntegratedSub').textContent = isBeat
      ? 'Producción nativa'
      : engine.loudnessMatch && Math.abs(trim) > 0.05
        ? `Raw ${rawInt.toFixed(1)} (${trim.toFixed(1)} dB match)`
        : isB
          ? 'Versión B nativa'
          : 'Versión A nativa';
    renderCurrentTrackMeta();
  } else {
    $('meterIntegrated').textContent = '--.- LUFS';
    $('meterIntegratedSub').textContent = 'BS.1770-4';
  }
}

function updateLoudnessMatchUI() {
  $('loudnessMatchBtn').classList.toggle('is-active', engine.loudnessMatch);
  $('loudnessMatchBtn').setAttribute('aria-pressed', String(engine.loudnessMatch));
  $('loudnessMatchLabel').textContent = engine.loudnessMatch ? 'Loudness Match: ON' : 'Loudness Match: OFF';
  updateActiveVersionUI();
}

function updatePlayButtonUI() {
  const playing = engine.isPlaying;
  $('playIcon').style.display = playing ? 'none' : 'block';
  $('pauseIcon').style.display = playing ? 'block' : 'none';
  $('playPauseBtn').setAttribute('aria-label', playing ? 'Pausar reproducción' : 'Reproducir pista');
  $('vinylDisc').classList.toggle('is-spinning', playing);
  $('turntableDeck').classList.toggle('is-playing', playing);
}

function updateLoopButtonsUI() {
  $('loopToggleBtn').classList.toggle('is-active', engine.loopEnabled);
  $('loopToggleBtn').setAttribute('aria-pressed', String(engine.loopEnabled));
  const hasRange =
    engine.duration > 0 &&
    engine.loopEnd > engine.loopStart + 0.25 &&
    (engine.loopStart > 0 || engine.loopEnd < engine.duration - 0.1);
  $('loopRangeLabel').textContent =
    engine.loopEnabled || hasRange
      ? `A ${formatTime(engine.loopStart)} → B ${formatTime(engine.loopEnd)}`
      : 'Loop A-B libre';
}

/* ==========================================================================
   CASSETTE TRACKLIST (SCOPED TO ACTIVE ACCOUNT)
   ========================================================================== */
function renderTrackList() {
  const container = $('trackList');
  container.innerHTML = '';

  if (state.tracks.length === 0) {
    const ownerName = escapeHtml(state.activeAccount?.displayName || 'esta cuenta');
    container.innerHTML = `
      <div class="empty-bay">
        <p>El catálogo de <strong>${ownerName}</strong> aún no tiene cintas. Sube un <strong>Beat (.WAV)</strong> o una comparativa <strong>A/B</strong>, o carga una demo.</p>
        <button type="button" class="btn btn-brass btn-sm" id="emptyLoadDemoBtn">Cargar Demo Mix/Máster (.WAV)</button>
      </div>
    `;
    const btn = $('emptyLoadDemoBtn');
    if (btn) btn.addEventListener('click', runLoadDemo);
    return;
  }

  state.tracks.forEach((track, idx) => {
    const row = document.createElement('div');
    row.className = `cassette-row ${track.id === state.currentTrackId ? 'is-current' : ''}`;
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-label', `Seleccionar ${track.title} de ${track.artist}`);

    const catNum = `TAPE-${String(idx + 1).padStart(2, '0')}`;
    const modeKey = track.trackMode || 'master';
    const modeTag = TRACK_MODES[modeKey]?.tag || 'MÁSTER';
    const coverSrc = track.coverDataUrl || generateProceduralVintageCover(track.title, idx);
    const lufsText =
      modeKey === 'beat' || !Number.isFinite(track.mixLufs)
        ? `${track.masterLufs.toFixed(1)} LUFS${track.bpm ? ` · ${track.bpm} BPM` : ''}`
        : `${track.mixLufs.toFixed(1)} → ${track.masterLufs.toFixed(1)} LUFS`;

    row.innerHTML = `
      <div class="cassette-thumb">
        <img src="${coverSrc}" alt="Portada de ${escapeHtml(track.title)}" loading="lazy" />
      </div>
      <div class="cassette-meta">
        <div class="cassette-title-line">
          <span class="cassette-cat">${catNum}</span>
          <span class="cassette-mode-tag is-${modeKey}">${modeTag}</span>
          <span class="cassette-title">${escapeHtml(track.title)}</span>
        </div>
        <div class="cassette-sub">
          <span>${escapeHtml(track.artist)}</span>
          ${track.genre ? `<span>·</span><span>${escapeHtml(track.genre)}</span>` : ''}
          ${track.musicalKey ? `<span>·</span><span>${escapeHtml(track.musicalKey)}</span>` : ''}
          <span>·</span>
          <span class="tabular-nums">${formatTime(track.duration)}</span>
        </div>
      </div>
      <div class="cassette-lufs tabular-nums">${lufsText}</div>
      <div class="cassette-row-actions editor-only">
        <button type="button" class="icon-mini-btn" data-action="up" title="Subir orden" aria-label="Mover arriba" ${idx === 0 ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m18 15-6-6-6 6"/></svg>
        </button>
        <button type="button" class="icon-mini-btn" data-action="down" title="Bajar orden" aria-label="Mover abajo" ${idx === state.tracks.length - 1 ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <button type="button" class="icon-mini-btn is-danger" data-action="delete" title="Eliminar pista" aria-label="Eliminar pista">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/></svg>
        </button>
      </div>
    `;

    row.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        e.stopPropagation();
        const act = actionBtn.dataset.action;
        if (act === 'up') reorderTrack(idx, idx - 1);
        if (act === 'down') reorderTrack(idx, idx + 1);
        if (act === 'delete') handleDeleteTrack(track.id);
        return;
      }
      selectTrack(track.id, true);
    });

    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectTrack(track.id, true);
      }
    });

    container.appendChild(row);
  });
}

async function reorderTrack(fromIdx, toIdx) {
  if (toIdx < 0 || toIdx >= state.tracks.length) return;
  const [moved] = state.tracks.splice(fromIdx, 1);
  state.tracks.splice(toIdx, 0, moved);
  for (let i = 0; i < state.tracks.length; i++) {
    state.tracks[i].order = i;
    await updateTrackMetaHybrid(state.tracks[i]);
  }
  renderTrackList();
}

async function handleDeleteTrack(trackId) {
  const target = state.tracks.find((t) => t.id === trackId);
  if (!target) return;
  if (!confirm(`¿Eliminar "${target.title}" del catálogo?`)) return;

  if (state.currentTrackId === trackId) {
    engine.stop();
    updatePlayButtonUI();
    state.currentTrackId = null;
    state.currentTrack = null;
  }
  await deleteTrackHybrid(target);
  state.tracks = await listTracksForOwner(state.activeAccount.id);
  renderTrackList();
  await refreshStorageBadge();

  if (state.tracks.length > 0 && !state.currentTrackId) {
    await selectTrack(state.tracks[0].id, false);
  } else {
    renderCurrentTrackMeta();
  }
  showToast(`"${target.title}" eliminado.`, 'info');
}

async function onTrackAdded(trackId) {
  renderTrackList();
  await refreshStorageBadge();
  await selectTrack(trackId, false);
}

const runLoadDemo = () => loadDemoTrack({ state, engine, showToast, onTrackAdded });

/* ==========================================================================
   REAL-TIME 60FPS METER LOOP (CONSOLE + PANEL PRO)
   ========================================================================== */
function startMeterLoop() {
  const waveCanvas = $('waveformCanvas');
  const vuCanvas = $('vuCanvas');
  const specCanvas = $('spectrumCanvas');
  const spectrogramCanvas = $('spectrogramCanvas');
  const vectorscopeCanvas = $('vectorscopeCanvas');
  const correlationCanvas = $('correlationCanvas');
  const oscilloscopeCanvas = $('oscilloscopeCanvas');
  let lastTextUpdate = 0;

  function frame(now) {
    const curTime = engine.getCurrentTime();
    const dur = engine.duration || 1;
    const progress = engine.duration > 0 ? curTime / dur : 0;

    drawWaveform(waveCanvas, {
      mixWave: state.currentTrack?.waveformMix || [],
      masterWave: state.currentTrack?.waveformMaster || [],
      activeVersion: engine.activeVersion,
      progress,
      loopEnabled: engine.loopEnabled,
      loopStartRatio: engine.loopStart / dur,
      loopEndRatio: engine.loopEnd / dur,
    });

    const m = engine.getRealtimeMeters();
    drawAnalogVuMeters(vuCanvas, m.vuL, m.vuR);
    drawSpectrum(specCanvas, m.freqData, m.sampleRate, engine.activeVersion);

    if (state.proPanelOpen) {
      proMeters.drawSpectrogram(spectrogramCanvas, m.proFreqData, m.sampleRate, m.isPlaying);
      proMeters.drawVectorscope(vectorscopeCanvas, m.timeDataL, m.timeDataR, engine.activeVersion, m.isPlaying);
      proMeters.drawCorrelation(correlationCanvas, m.correlation);
      proMeters.drawOscilloscope(oscilloscopeCanvas, m.timeDataL, m.timeDataR, engine.activeVersion, m.isPlaying);
    }

    if (now - lastTextUpdate > 65) {
      lastTextUpdate = now;
      $('timeCurrent').textContent = formatTime(curTime);

      if (m.momentaryLufs !== null && m.isPlaying) {
        $('meterMomentary').textContent = `${m.momentaryLufs.toFixed(1)} LUFS`;
        $('meterShortTerm').textContent = `${m.shortTermLufs.toFixed(1)} LUFS`;
      } else {
        $('meterMomentary').textContent = '--.- LUFS';
        $('meterShortTerm').textContent = '--.- LUFS';
      }

      const peakEl = $('meterPeak');
      if (m.peakDbfs !== null) {
        peakEl.textContent = `${m.peakDbfs.toFixed(1)} dBFS`;
        peakEl.classList.toggle('is-clip', m.peakDbfs > -0.3);
      } else if (state.currentTrack) {
        const staticPeak =
          engine.activeVersion === 'master' || state.currentTrack.trackMode === 'beat'
            ? state.currentTrack.masterPeak
            : state.currentTrack.mixPeak;
        peakEl.textContent = `${(staticPeak ?? -1).toFixed(1)} dBFS`;
        peakEl.classList.toggle('is-clip', (staticPeak ?? -1) > -0.3);
      } else {
        peakEl.textContent = '--.- dBFS';
        peakEl.classList.remove('is-clip');
      }

      if (state.proPanelOpen) {
        const corr = m.correlation;
        $('proCorrValue').textContent = `${corr >= 0 ? '+' : ''}${corr.toFixed(2)}`;
        const badge = $('proCorrBadge');
        badge.classList.remove('is-warn', 'is-danger');
        if (!m.isPlaying) badge.textContent = 'Sin señal';
        else if (corr < 0) {
          badge.textContent = 'Alerta Fase (-)';
          badge.classList.add('is-danger');
        } else if (corr < 0.35) {
          badge.textContent = 'Estéreo Amplio';
          badge.classList.add('is-warn');
        } else badge.textContent = 'Fase Óptima';

        const midPct = Math.max(0, Math.min(100, ((m.midDb + 60) / 60) * 100));
        const sidePct = Math.max(0, Math.min(100, ((m.sideDb + 60) / 60) * 100));
        const crestPct = Math.max(0, Math.min(100, (m.crestDb / 22) * 100));
        $('proMidBar').style.width = `${m.isPlaying ? midPct : 0}%`;
        $('proSideBar').style.width = `${m.isPlaying ? sidePct : 0}%`;
        $('proCrestBar').style.width = `${m.isPlaying ? crestPct : 0}%`;
        $('proMidVal').textContent = m.isPlaying ? `${m.midDb.toFixed(1)} dB` : '-- dB';
        $('proSideVal').textContent = m.isPlaying ? `${m.sideDb.toFixed(1)} dB` : '-- dB';
        $('proCrestVal').textContent = m.isPlaying ? `${m.crestDb.toFixed(1)} dB` : '-- dB';

        if (!m.isPlaying || Math.abs(m.balance) < 0.04) $('proBalanceVal').textContent = 'Bal: Centro';
        else {
          const pct = Math.round(Math.abs(m.balance) * 100);
          $('proBalanceVal').textContent = m.balance < 0 ? `Bal: L +${pct}%` : `Bal: R +${pct}%`;
        }
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function wireWaveformInteraction() {
  const wrap = $('waveformWrap');
  const seekFromEvent = (e) => {
    if (!engine.duration) return;
    const rect = wrap.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    engine.seek(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * engine.duration);
  };
  wrap.addEventListener('pointerdown', (e) => {
    if (!engine.duration) return;
    state.isScrubbing = true;
    wrap.setPointerCapture(e.pointerId);
    seekFromEvent(e);
  });
  wrap.addEventListener('pointermove', (e) => { if (state.isScrubbing) seekFromEvent(e); });
  wrap.addEventListener('pointerup', () => { state.isScrubbing = false; });
}

async function refreshStorageBadge() {
  if (isCloudMode()) {
    $('storageUsageBadge').textContent = `Nube: ${state.tracks.length} pistas`;
    return;
  }
  const info = await getStorageInfo();
  if (info && $('storageUsageBadge')) {
    $('storageUsageBadge').textContent = `IndexedDB: ${info.usedMB} MB (${state.tracks.length} pistas)`;
  }
}

/* ==========================================================================
   INITIALIZATION
   ========================================================================== */
async function init() {
  const modelSel = $('hfModelSelect');
  HF_FREE_COVER_MODELS.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    modelSel.appendChild(opt);
  });
  modelSel.value = state.hfModel;
  $('hfTokenInput').value = state.hfToken;

  applyMode(state.mode);
  applyProPanel(state.proPanelOpen);
  applyUploadMode('master');

  await initAccounts(state, showToast, reloadCatalogForActiveAccount, applyMode);
  refreshPendingProceduralCover(state);

  engine.onEnded = () => updatePlayButtonUI();

  $('modeEditorBtn').addEventListener('click', () => applyMode('editor'));
  $('modeClientBtn').addEventListener('click', () => applyMode('client'));
  $('proPanelToggleBtn').addEventListener('click', () => applyProPanel(!state.proPanelOpen));
  $('clearSpectrogramBtn').addEventListener('click', () => proMeters.clearSpectrogram());

  document.querySelectorAll('[data-upload-mode]').forEach((btn) => {
    btn.addEventListener('click', () => applyUploadMode(btn.dataset.uploadMode));
  });

  document.querySelectorAll('[data-monitor-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      engine.setMonitorMode(btn.dataset.monitorMode);
      updateMonitorMatrixUI(btn.dataset.monitorMode);
    });
  });

  $('playPauseBtn').addEventListener('click', async () => {
    if (!state.currentTrack) return showToast('Primero selecciona o sube una pista .WAV.', 'info');
    if (engine.isPlaying) engine.pause();
    else await engine.play();
    updatePlayButtonUI();
  });

  $('rewindBtn').addEventListener('click', () => engine.seek(0));

  $('prevTrackBtn').addEventListener('click', () => {
    if (state.tracks.length < 2) return;
    const idx = state.tracks.findIndex((t) => t.id === state.currentTrackId);
    selectTrack(state.tracks[(idx - 1 + state.tracks.length) % state.tracks.length].id, engine.isPlaying);
  });

  $('nextTrackBtn').addEventListener('click', () => {
    if (state.tracks.length < 2) return;
    const idx = state.tracks.findIndex((t) => t.id === state.currentTrackId);
    selectTrack(state.tracks[(idx + 1) % state.tracks.length].id, engine.isPlaying);
  });

  $('switchMixBtn').addEventListener('click', () => {
    if (engine.isSingleTrack) return;
    engine.setVersion('mix');
    proMeters.markVersionSwitch('mix');
    updateActiveVersionUI();
  });

  $('switchMasterBtn').addEventListener('click', () => {
    engine.setVersion('master');
    proMeters.markVersionSwitch('master');
    updateActiveVersionUI();
  });

  $('loudnessMatchBtn').addEventListener('click', () => {
    if (engine.isSingleTrack) return;
    engine.setLoudnessMatch(!engine.loudnessMatch);
    updateLoudnessMatchUI();
  });

  $('volumeSlider').addEventListener('input', (e) => engine.setVolume(Number(e.target.value)));

  $('setLoopABtn').addEventListener('click', () => {
    if (!engine.duration) return;
    const now = engine.getCurrentTime();
    engine.setLoop(engine.loopEnabled, now, engine.loopEnd > now + 0.5 ? engine.loopEnd : Math.min(engine.duration, now + 8));
    updateLoopButtonsUI();
  });

  $('setLoopBBtn').addEventListener('click', () => {
    if (!engine.duration) return;
    const now = engine.getCurrentTime();
    engine.setLoop(true, engine.loopStart < now - 0.5 ? engine.loopStart : Math.max(0, now - 8), now);
    updateLoopButtonsUI();
  });

  $('loopToggleBtn').addEventListener('click', () => {
    if (!engine.duration) return;
    if (!engine.loopEnabled && engine.loopEnd - engine.loopStart < 0.5) {
      const cur = engine.getCurrentTime();
      engine.setLoop(true, cur, Math.min(engine.duration, cur + 8));
    } else engine.setLoop(!engine.loopEnabled);
    updateLoopButtonsUI();
  });

  $('clearLoopBtn').addEventListener('click', () => {
    engine.setLoop(false, 0, engine.duration);
    updateLoopButtonsUI();
  });

  wireDropzone(state, 'mixDropzone', 'mixFileInput', 'mixFileLabel', 'pendingMixFile');
  wireDropzone(state, 'masterDropzone', 'masterFileInput', 'masterFileLabel', 'pendingMasterFile');

  $('uploadTitle').addEventListener('input', () => refreshPendingProceduralCover(state));

  $('customCoverInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    state.pendingCoverDataUrl = await blobToCompressedDataUrl(file, 560);
    state.pendingCoverIsCustom = true;
    $('uploadCoverPreview').src = state.pendingCoverDataUrl;
    showToast('Carátula personalizada cargada.', 'success');
  });

  $('randomVintageCoverBtn').addEventListener('click', () => {
    state.pendingCoverVariant += 1;
    state.pendingCoverIsCustom = false;
    refreshPendingProceduralCover(state);
  });

  $('hfGenerateBtn').addEventListener('click', () =>
    triggerHuggingFaceCover({
      state,
      forCurrentTrack: false,
      showToast,
      onCoverUpdated: () => { renderCurrentTrackMeta(); renderTrackList(); },
    })
  );

  $('regenActiveCoverVintageBtn').addEventListener('click', async () => {
    if (!state.currentTrack) return;
    state.currentTrack.coverDataUrl = generateProceduralVintageCover(state.currentTrack.title, Math.floor(Math.random() * 999));
    await updateTrackMetaHybrid(state.currentTrack);
    renderCurrentTrackMeta();
    renderTrackList();
    showToast('Nueva estética vintage aplicada al vinilo.', 'success');
  });

  $('regenActiveCoverHfBtn').addEventListener('click', () => {
    if (!state.currentTrack) return;
    if (!$('hfTokenInput').value.trim()) {
      showToast('Ingresa tu token gratuito de Hugging Face en el panel de subida para usar IA.', 'info');
      $('uploadDrawer').scrollIntoView({ behavior: 'smooth' });
      $('hfTokenInput').focus();
      return;
    }
    triggerHuggingFaceCover({
      state,
      forCurrentTrack: true,
      showToast,
      onCoverUpdated: () => { renderCurrentTrackMeta(); renderTrackList(); },
    });
  });

  $('uploadTrackForm').addEventListener('submit', (e) =>
    handleSaveUploadedTrack(e, { state, engine, showToast, onTrackAdded })
  );
  $('loadDemoBtn').addEventListener('click', runLoadDemo);

  window.addEventListener('keydown', async (e) => {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.code === 'Space') {
      e.preventDefault();
      if (!state.currentTrack) return;
      if (engine.isPlaying) engine.pause();
      else await engine.play();
      updatePlayButtonUI();
    } else if ((e.key === 't' || e.key === 'T' || e.key === 'm' || e.key === 'M') && !engine.isSingleTrack) {
      e.preventDefault();
      const next = engine.toggleVersion();
      proMeters.markVersionSwitch(next);
      updateActiveVersionUI();
    } else if ((e.key === 'l' || e.key === 'L') && !engine.isSingleTrack) {
      e.preventDefault();
      engine.setLoudnessMatch(!engine.loudnessMatch);
      updateLoudnessMatchUI();
    } else if (e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      applyProPanel(!state.proPanelOpen);
    } else if (e.key === '[') $('setLoopABtn').click();
    else if (e.key === ']') $('setLoopBBtn').click();
  });

  wireWaveformInteraction();
  updateLoudnessMatchUI();
  updateActiveVersionUI();
  startMeterLoop();

  // Load tracks strictly scoped to the active account (seed demo once in Local Mode only)
  state.tracks = state.activeAccount?.id ? await listTracksForOwner(state.activeAccount.id) : [];
  const initialized = await getSetting('demoSeededOnce', false);
  if (!isCloudMode() && state.tracks.length === 0 && !initialized) {
    await saveSetting('demoSeededOnce', true);
    await runLoadDemo();
  } else {
    renderTrackList();
    await refreshStorageBadge();
    if (state.tracks.length > 0) await selectTrack(state.tracks[0].id, false);
    else renderCurrentTrackMeta();
  }
}

document.addEventListener('DOMContentLoaded', init);
