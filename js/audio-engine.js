/* ==========================================================================
   MASTERING-GRADE WEB AUDIO A/B ENGINE — AGUJA ROJA
   - Sample-accurate dual synchronized BufferSourceNodes (Mix & Master)
   - Clickless 15ms crossfade switching (zero latency, zero phase drift)
   - ITU-R BS.1770-4 K-weighted Integrated LUFS & Sample Peak analyzer
   - Auto Loudness Matching (attenuates louder source to prevent clipping)
   - Monitor Matrix: Stereo / Mono / Solo Mid / Solo Side
   - Pro Telemetry: 4096-pt FFT (20Hz-20kHz), Stereo Correlation, M/S, Crest
   ========================================================================== */

export function parseWavHeader(arrayBuffer) {
  try {
    const view = new DataView(arrayBuffer);
    if (arrayBuffer.byteLength < 44) return null;

    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
    if (riff !== 'RIFF' || wave !== 'WAVE') return null;

    let offset = 12;
    while (offset + 8 <= arrayBuffer.byteLength) {
      const chunkId = String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3)
      );
      const chunkSize = view.getUint32(offset + 4, true);

      if (chunkId === 'fmt ') {
        const audioFormat = view.getUint16(offset + 8, true);
        const channels = view.getUint16(offset + 10, true);
        const sampleRate = view.getUint32(offset + 12, true);
        const bitDepth = view.getUint16(offset + 22, true);
        const isFloat = audioFormat === 3;
        return {
          format: 'WAV',
          channels,
          sampleRate,
          bitDepth,
          isFloat,
          label: `WAV · ${bitDepth}-bit${isFloat ? ' float' : ''} / ${(sampleRate / 1000).toFixed(1)} kHz`,
        };
      }
      offset += 8 + chunkSize + (chunkSize % 2);
    }
  } catch {
    return null;
  }
  return null;
}

function getKWeightingCoeffs(sampleRate) {
  const db = 3.999843853973347;
  const f0 = 1681.974450955533;
  const Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, db / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0_1 = 1 + K / Q + K * K;
  const stage1 = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0_1,
    b1: (2 * (K * K - Vh)) / a0_1,
    b2: (Vh - (Vb * K) / Q + K * K) / a0_1,
    a1: (2 * (K * K - 1)) / a0_1,
    a2: (1 - K / Q + K * K) / a0_1,
  };

  const f0_2 = 38.13547087602444;
  const Q_2 = 0.5003270373238773;
  const K2 = Math.tan((Math.PI * f0_2) / sampleRate);
  const a0_2 = 1 + K2 / Q_2 + K2 * K2;
  const stage2 = {
    b0: 1.0,
    b1: -2.0,
    b2: 1.0,
    a1: (2 * (K2 * K2 - 1)) / a0_2,
    a2: (1 - K2 / Q_2 + K2 * K2) / a0_2,
  };

  return { stage1, stage2 };
}

function applyBiquad(samples, c) {
  const out = new Float32Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const { b0, b1, b2, a1, a2 } = c;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

export function analyzeAudioBuffer(buffer, buckets = 240) {
  const sampleRate = buffer.sampleRate;
  const numChannels = Math.min(buffer.numberOfChannels, 2);
  const length = buffer.length;

  let maxSample = 0;
  const waveform = new Array(buckets).fill(0);
  const blockLen = Math.max(1, Math.floor(length / buckets));

  const channels = [];
  for (let ch = 0; ch < numChannels; ch++) channels.push(buffer.getChannelData(ch));

  for (let b = 0; b < buckets; b++) {
    const start = b * blockLen;
    const end = Math.min(length, start + blockLen);
    const stride = Math.max(1, Math.floor((end - start) / 600));
    let bucketPeak = 0;
    for (let i = start; i < end; i += stride) {
      let s = Math.abs(channels[0][i]);
      if (numChannels > 1) s = Math.max(s, Math.abs(channels[1][i]));
      if (s > bucketPeak) bucketPeak = s;
    }
    waveform[b] = Number(bucketPeak.toFixed(4));
    if (bucketPeak > maxSample) maxSample = bucketPeak;
  }

  for (let ch = 0; ch < numChannels; ch++) {
    const data = channels[ch];
    for (let i = 0; i < length; i++) {
      const a = Math.abs(data[i]);
      if (a > maxSample) maxSample = a;
    }
  }

  const peakDbfs = maxSample > 1e-7 ? 20 * Math.log10(maxSample) : -96.0;

  const { stage1, stage2 } = getKWeightingCoeffs(sampleRate);
  const filtered = [];
  for (let ch = 0; ch < numChannels; ch++) {
    filtered.push(applyBiquad(applyBiquad(channels[ch], stage1), stage2));
  }

  const winSamples = Math.max(1, Math.round(sampleRate * 0.4));
  const hopSamples = Math.max(1, Math.round(sampleRate * 0.1));
  const blockLoudnesses = [];
  const blockEnergies = [];

  for (let start = 0; start + winSamples <= length; start += hopSamples) {
    let meanSqSum = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      const data = filtered[ch];
      let sum = 0;
      for (let i = start; i < start + winSamples; i++) sum += data[i] * data[i];
      meanSqSum += sum / winSamples;
    }
    const lufs = meanSqSum > 1e-12 ? -0.691 + 10 * Math.log10(meanSqSum) : -120;
    if (lufs > -70.0) {
      blockLoudnesses.push(lufs);
      blockEnergies.push(meanSqSum);
    }
  }

  let integratedLufs = -70.0;
  if (blockEnergies.length > 0) {
    const avgAbs = blockEnergies.reduce((a, b) => a + b, 0) / blockEnergies.length;
    const relThreshold = -0.691 + 10 * Math.log10(avgAbs) - 10.0;

    let gatedSum = 0;
    let gatedCount = 0;
    for (let i = 0; i < blockLoudnesses.length; i++) {
      if (blockLoudnesses[i] >= relThreshold) {
        gatedSum += blockEnergies[i];
        gatedCount++;
      }
    }
    if (gatedCount > 0) integratedLufs = -0.691 + 10 * Math.log10(gatedSum / gatedCount);
  } else {
    let sum = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      const data = filtered[ch];
      for (let i = 0; i < length; i++) sum += data[i] * data[i];
    }
    const meanSq = sum / Math.max(1, length);
    integratedLufs = meanSq > 1e-12 ? -0.691 + 10 * Math.log10(meanSq) : -70.0;
  }

  const plr = Math.max(0, peakDbfs - integratedLufs);

  return {
    integratedLufs: Number(integratedLufs.toFixed(1)),
    peakDbfs: Number(peakDbfs.toFixed(1)),
    plr: Number(plr.toFixed(1)),
    duration: buffer.duration,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    waveform,
  };
}

export class MasteringAudioEngine {
  constructor() {
    this.ctx = null;
    this.mixBuffer = null;
    this.masterBuffer = null;
    this.mixLufs = -14.0;
    this.masterLufs = -14.0;

    this.activeVersion = 'master'; // 'mix' | 'master'
    this.isSingleTrack = false;    // true for Beat / single-WAV production showcase
    this.monitorMode = 'stereo';   // 'stereo' | 'mono' | 'mid' | 'side'
    this.loudnessMatch = true;
    this.volume = 0.88;

    this.isPlaying = false;
    this.duration = 0;
    this.offsetAtStart = 0;
    this.ctxTimeAtStart = 0;

    this.loopEnabled = false;
    this.loopStart = 0;
    this.loopEnd = 0;

    // Nodes
    this.mixSource = null;
    this.masterSource = null;
    this.mixTrimGain = null;
    this.masterTrimGain = null;
    this.mixSwitchGain = null;
    this.masterSwitchGain = null;
    this.masterBus = null;

    // Monitor Matrix (Stereo / Mono / Mid / Side)
    this.monSplitter = null;
    this.monMerger = null;
    this.gLL = null;
    this.gRL = null;
    this.gLR = null;
    this.gRR = null;
    this.outputGain = null;

    // Metering nodes
    this.splitter = null;
    this.analyserL = null;
    this.analyserR = null;
    this.spectrumAnalyser = null;
    this.proFftAnalyser = null;

    // Telemetry state
    this.timeDataL = null;
    this.timeDataR = null;
    this.freqData = null;
    this.proFreqData = null;
    this.vuNeedleL = -20;
    this.vuNeedleR = -20;
    this.smoothCorrelation = 0;
    this.smoothBalance = 0;
    this.smoothCrest = 0;
    this.peakHoldDbfs = -96;
    this.peakHoldDecayTs = 0;
    this.energyHistory = [];

    this.onEnded = null;
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();

      this.mixTrimGain = this.ctx.createGain();
      this.masterTrimGain = this.ctx.createGain();
      this.mixSwitchGain = this.ctx.createGain();
      this.masterSwitchGain = this.ctx.createGain();
      this.masterBus = this.ctx.createGain();
      // Force stereo speaker upmix so mono .WAV files feed both L/R meters & speakers cleanly
      this.masterBus.channelCount = 2;
      this.masterBus.channelCountMode = 'explicit';
      this.masterBus.channelInterpretation = 'speakers';
      this.outputGain = this.ctx.createGain();

      // Monitor Matrix 2x2
      this.monSplitter = this.ctx.createChannelSplitter(2);
      this.monMerger = this.ctx.createChannelMerger(2);
      this.gLL = this.ctx.createGain();
      this.gRL = this.ctx.createGain();
      this.gLR = this.ctx.createGain();
      this.gRR = this.ctx.createGain();

      // Metering chain (pre-fader & pre-monitor matrix)
      this.splitter = this.ctx.createChannelSplitter(2);
      this.analyserL = this.ctx.createAnalyser();
      this.analyserR = this.ctx.createAnalyser();
      this.spectrumAnalyser = this.ctx.createAnalyser();
      this.proFftAnalyser = this.ctx.createAnalyser();

      this.analyserL.fftSize = 2048;
      this.analyserR.fftSize = 2048;
      this.spectrumAnalyser.fftSize = 2048;
      this.spectrumAnalyser.smoothingTimeConstant = 0.78;

      // High-resolution 4096 FFT for accurate 20 Hz – 20 kHz Spectrogram
      this.proFftAnalyser.fftSize = 4096;
      this.proFftAnalyser.smoothingTimeConstant = 0.45;
      this.proFftAnalyser.minDecibels = -92;
      this.proFftAnalyser.maxDecibels = -4;

      this.timeDataL = new Float32Array(this.analyserL.fftSize);
      this.timeDataR = new Float32Array(this.analyserR.fftSize);
      this.freqData = new Uint8Array(this.spectrumAnalyser.frequencyBinCount);
      this.proFreqData = new Uint8Array(this.proFftAnalyser.frequencyBinCount);

      // Core A/B routing
      this.mixTrimGain.connect(this.mixSwitchGain);
      this.mixSwitchGain.connect(this.masterBus);

      this.masterTrimGain.connect(this.masterSwitchGain);
      this.masterSwitchGain.connect(this.masterBus);

      // Metering taps
      this.masterBus.connect(this.splitter);
      this.splitter.connect(this.analyserL, 0);
      this.splitter.connect(this.analyserR, 1);
      this.masterBus.connect(this.spectrumAnalyser);
      this.masterBus.connect(this.proFftAnalyser);

      // Monitor Matrix -> Output Fader -> Destination
      this.masterBus.connect(this.monSplitter);
      this.monSplitter.connect(this.gLL, 0);
      this.monSplitter.connect(this.gLR, 0);
      this.monSplitter.connect(this.gRL, 1);
      this.monSplitter.connect(this.gRR, 1);
      this.gLL.connect(this.monMerger, 0, 0);
      this.gRL.connect(this.monMerger, 0, 0);
      this.gLR.connect(this.monMerger, 0, 1);
      this.gRR.connect(this.monMerger, 0, 1);

      this.monMerger.connect(this.outputGain);
      this.outputGain.gain.value = this.volume;
      this.outputGain.connect(this.ctx.destination);

      this._applySwitchGains(true);
      this._applyLoudnessTrim(true);
      this._applyMonitorMatrix(true);
    }
    return this.ctx;
  }

  _applyMonitorMatrix(immediate = false) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const t = immediate ? 0.001 : 0.015;
    let ll = 1, rl = 0, lr = 0, rr = 1;

    if (this.monitorMode === 'mono' || this.monitorMode === 'mid') {
      ll = 0.5; rl = 0.5; lr = 0.5; rr = 0.5;
    } else if (this.monitorMode === 'side') {
      // Audition isolated Side (L - R)/2 cleanly centered in both ears
      ll = 0.5; rl = -0.5; lr = 0.5; rr = -0.5;
    }

    [
      [this.gLL.gain, ll],
      [this.gRL.gain, rl],
      [this.gLR.gain, lr],
      [this.gRR.gain, rr],
    ].forEach(([param, target]) => {
      param.cancelScheduledValues(now);
      if (immediate) param.setValueAtTime(target, now);
      else {
        param.setValueAtTime(param.value, now);
        param.linearRampToValueAtTime(target, now + t);
      }
    });
  }

  setMonitorMode(mode) {
    if (!['stereo', 'mono', 'mid', 'side'].includes(mode)) return;
    this.monitorMode = mode;
    this._applyMonitorMatrix(false);
  }

  async decodeSource(blobOrUrl) {
    const ctx = this.ensureContext();
    let arrayBuffer;
    if (typeof blobOrUrl === 'string') {
      const resp = await fetch(blobOrUrl);
      if (!resp.ok) throw new Error(`Error descargando audio desde la nube (${resp.status}).`);
      arrayBuffer = await resp.arrayBuffer();
    } else {
      arrayBuffer = await blobOrUrl.arrayBuffer();
    }
    const wavInfo = parseWavHeader(arrayBuffer);
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    return { audioBuffer, wavInfo };
  }

  async loadTrack(sourceA, sourceB, lufsA, lufsB) {
    this.stop();
    this.ensureContext();

    if (!sourceB) {
      throw new Error('No se encontró el archivo de audio principal (.WAV).');
    }

    this.isSingleTrack = !sourceA;

    if (this.isSingleTrack) {
      const decB = await this.decodeSource(sourceB);
      this.mixBuffer = null;
      this.masterBuffer = decB.audioBuffer;
      this.mixLufs = lufsB ?? -14.0;
      this.masterLufs = lufsB ?? -14.0;
      this.activeVersion = 'master';
      this.duration = this.masterBuffer.duration;
    } else {
      const [decA, decB] = await Promise.all([
        this.decodeSource(sourceA),
        this.decodeSource(sourceB),
      ]);
      this.mixBuffer = decA.audioBuffer;
      this.masterBuffer = decB.audioBuffer;
      this.mixLufs = lufsA ?? -14.0;
      this.masterLufs = lufsB ?? -14.0;
      this.duration = Math.max(this.mixBuffer.duration, this.masterBuffer.duration);
    }

    this.offsetAtStart = 0;
    this.loopEnabled = false;
    this.loopStart = 0;
    this.loopEnd = this.duration;
    this.peakHoldDbfs = -96;
    this.energyHistory = [];

    this._applySwitchGains(true);
    this._applyLoudnessTrim(true);
    this._applyMonitorMatrix(true);

    return { duration: this.duration, mixBuffer: this.mixBuffer, masterBuffer: this.masterBuffer };
  }

  _applySwitchGains(immediate = false) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const fade = immediate ? 0.001 : 0.015;
    const mixTarget = this.activeVersion === 'mix' ? 1.0 : 0.0;
    const masterTarget = this.activeVersion === 'master' ? 1.0 : 0.0;

    this.mixSwitchGain.gain.cancelScheduledValues(now);
    this.masterSwitchGain.gain.cancelScheduledValues(now);

    if (immediate) {
      this.mixSwitchGain.gain.setValueAtTime(mixTarget, now);
      this.masterSwitchGain.gain.setValueAtTime(masterTarget, now);
    } else {
      this.mixSwitchGain.gain.setValueAtTime(this.mixSwitchGain.gain.value, now);
      this.masterSwitchGain.gain.setValueAtTime(this.masterSwitchGain.gain.value, now);
      this.mixSwitchGain.gain.linearRampToValueAtTime(mixTarget, now + fade);
      this.masterSwitchGain.gain.linearRampToValueAtTime(masterTarget, now + fade);
    }
  }

  _applyLoudnessTrim(immediate = false) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const ramp = immediate ? 0.001 : 0.028;

    let mixGain = 1.0;
    let masterGain = 1.0;

    if (this.loudnessMatch && Number.isFinite(this.mixLufs) && Number.isFinite(this.masterLufs)) {
      const diff = this.masterLufs - this.mixLufs;
      if (diff > 0.05) masterGain = Math.pow(10, -diff / 20);
      else if (diff < -0.05) mixGain = Math.pow(10, diff / 20);
    }

    this.mixTrimGain.gain.cancelScheduledValues(now);
    this.masterTrimGain.gain.cancelScheduledValues(now);

    if (immediate) {
      this.mixTrimGain.gain.setValueAtTime(mixGain, now);
      this.masterTrimGain.gain.setValueAtTime(masterGain, now);
    } else {
      this.mixTrimGain.gain.setValueAtTime(this.mixTrimGain.gain.value, now);
      this.masterTrimGain.gain.setValueAtTime(this.masterTrimGain.gain.value, now);
      this.mixTrimGain.gain.linearRampToValueAtTime(mixGain, now + ramp);
      this.masterTrimGain.gain.linearRampToValueAtTime(masterGain, now + ramp);
    }
  }

  getActiveTrimDb() {
    if (this.isSingleTrack || !this.loudnessMatch) return 0;
    const diff = this.masterLufs - this.mixLufs;
    if (this.activeVersion === 'master' && diff > 0.05) return -diff;
    if (this.activeVersion === 'mix' && diff < -0.05) return diff;
    return 0;
  }

  setVersion(version) {
    if (this.isSingleTrack) {
      this.activeVersion = 'master';
      this._applySwitchGains(true);
      return;
    }
    if (version !== 'mix' && version !== 'master') return;
    this.activeVersion = version;
    this._applySwitchGains(false);
    this.peakHoldDbfs = -96;
  }

  toggleVersion() {
    this.setVersion(this.activeVersion === 'master' ? 'mix' : 'master');
    return this.activeVersion;
  }

  setLoudnessMatch(enabled) {
    this.loudnessMatch = Boolean(enabled);
    this._applyLoudnessTrim(false);
    this.peakHoldDbfs = -96;
  }

  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, val));
    if (this.outputGain && this.ctx) {
      this.outputGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.015);
    }
  }

  setLoop(enabled, startSec, endSec) {
    this.loopEnabled = Boolean(enabled);
    if (typeof startSec === 'number') this.loopStart = Math.max(0, Math.min(startSec, this.duration));
    if (typeof endSec === 'number') this.loopEnd = Math.max(this.loopStart + 0.25, Math.min(endSec, this.duration));
  }

  _stopSources() {
    if (this.mixSource) {
      try { this.mixSource.stop(); } catch { }
      try { this.mixSource.disconnect(); } catch { }
      this.mixSource = null;
    }
    if (this.masterSource) {
      try { this.masterSource.stop(); } catch { }
      try { this.masterSource.disconnect(); } catch { }
      this.masterSource = null;
    }
  }

  async play(fromOffset = null) {
    if (!this.masterBuffer) return;
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') await ctx.resume();

    this._stopSources();

    let offset = fromOffset !== null ? fromOffset : this.offsetAtStart;
    if (offset >= this.duration - 0.02) offset = 0;
    offset = Math.max(0, offset);

    const startAt = ctx.currentTime + 0.02;

    if (!this.isSingleTrack && this.mixBuffer && offset < this.mixBuffer.duration) {
      const mixSrc = ctx.createBufferSource();
      mixSrc.buffer = this.mixBuffer;
      mixSrc.connect(this.mixTrimGain);
      mixSrc.start(startAt, offset);
      this.mixSource = mixSrc;
    }

    if (offset < this.masterBuffer.duration) {
      const masterSrc = ctx.createBufferSource();
      masterSrc.buffer = this.masterBuffer;
      masterSrc.connect(this.masterTrimGain);
      masterSrc.start(startAt, offset);
      this.masterSource = masterSrc;
    }

    this.offsetAtStart = offset;
    this.ctxTimeAtStart = startAt;
    this.isPlaying = true;
  }

  pause() {
    if (!this.isPlaying) return;
    this.offsetAtStart = this.getCurrentTime();
    this._stopSources();
    this.isPlaying = false;
  }

  stop() {
    this._stopSources();
    this.isPlaying = false;
    this.offsetAtStart = 0;
  }

  seek(timeSec) {
    const clamped = Math.max(0, Math.min(timeSec, this.duration));
    this.offsetAtStart = clamped;
    if (this.isPlaying) this.play(clamped);
  }

  getCurrentTime() {
    if (!this.isPlaying || !this.ctx) {
      return Math.max(0, Math.min(this.offsetAtStart, this.duration));
    }
    const elapsed = Math.max(0, this.ctx.currentTime - this.ctxTimeAtStart);
    const pos = this.offsetAtStart + elapsed;

    if (this.loopEnabled && this.loopEnd > this.loopStart + 0.2 && pos >= this.loopEnd) {
      this.play(this.loopStart);
      return this.loopStart;
    }

    if (pos >= this.duration) {
      this.stop();
      if (typeof this.onEnded === 'function') this.onEnded();
      return this.duration;
    }

    return pos;
  }

  /**
   * Real-time metering snapshot for Standard Console + Pro MiniMeters Suite.
   */
  getRealtimeMeters() {
    if (!this.ctx || !this.isPlaying) {
      this.vuNeedleL += (-20 - this.vuNeedleL) * 0.16;
      this.vuNeedleR += (-20 - this.vuNeedleR) * 0.16;
      this.smoothCorrelation *= 0.88;
      this.smoothBalance *= 0.88;
      return {
        isPlaying: false,
        vuL: this.vuNeedleL,
        vuR: this.vuNeedleR,
        momentaryLufs: null,
        shortTermLufs: null,
        peakDbfs: this.peakHoldDbfs > -90 ? this.peakHoldDbfs : null,
        freqData: null,
        proFreqData: null,
        timeDataL: null,
        timeDataR: null,
        correlation: this.smoothCorrelation,
        balance: this.smoothBalance,
        midDb: -72,
        sideDb: -72,
        crestDb: 0,
        sampleRate: this.ctx?.sampleRate || 48000,
      };
    }

    this.analyserL.getFloatTimeDomainData(this.timeDataL);
    this.analyserR.getFloatTimeDomainData(this.timeDataR);
    this.spectrumAnalyser.getByteFrequencyData(this.freqData);
    this.proFftAnalyser.getByteFrequencyData(this.proFreqData);

    let sumSqL = 0;
    let sumSqR = 0;
    let sumLR = 0;
    let sumSqMid = 0;
    let sumSqSide = 0;
    let peak = 0;
    const len = this.timeDataL.length;

    for (let i = 0; i < len; i++) {
      const l = this.timeDataL[i];
      const r = this.timeDataR[i];
      sumSqL += l * l;
      sumSqR += r * r;
      sumLR += l * r;

      const mid = (l + r) * 0.70710678;
      const side = (l - r) * 0.70710678;
      sumSqMid += mid * mid;
      sumSqSide += side * side;

      const a = Math.max(Math.abs(l), Math.abs(r));
      if (a > peak) peak = a;
    }

    const rmsL = Math.sqrt(sumSqL / len);
    const rmsR = Math.sqrt(sumSqR / len);
    const rmsStereo = Math.sqrt((sumSqL + sumSqR) / (2 * len));
    const rmsMid = Math.sqrt(sumSqMid / len);
    const rmsSide = Math.sqrt(sumSqSide / len);

    // Pearson stereo phase correlation [-1 .. +1]
    const denom = Math.sqrt(sumSqL * sumSqR);
    const instCorr = denom > 1e-9 ? Math.max(-1, Math.min(1, sumLR / denom)) : 0;
    this.smoothCorrelation += (instCorr - this.smoothCorrelation) * 0.22;

    // Stereo L/R Balance [-1 (L) .. +1 (R)]
    const instBal = rmsL + rmsR > 1e-6 ? (rmsR - rmsL) / (rmsL + rmsR) : 0;
    this.smoothBalance += (instBal - this.smoothBalance) * 0.2;

    // Live Crest Factor (Peak dB - RMS dB)
    const instPeakDb = peak > 1e-6 ? 20 * Math.log10(peak) : -96;
    const instRmsDb = rmsStereo > 1e-6 ? 20 * Math.log10(rmsStereo) : -96;
    const instCrest = Math.max(0, Math.min(30, instPeakDb - instRmsDb));
    this.smoothCrest += (instCrest - this.smoothCrest) * 0.16;

    const midDb = rmsMid > 1e-6 ? 20 * Math.log10(rmsMid) : -72;
    const sideDb = rmsSide > 1e-6 ? 20 * Math.log10(rmsSide) : -72;

    // VU Ballistics (-14 dBFS RMS = 0 VU)
    const dbfsL = rmsL > 1e-6 ? 20 * Math.log10(rmsL) : -80;
    const dbfsR = rmsR > 1e-6 ? 20 * Math.log10(rmsR) : -80;
    const targetVuL = Math.max(-20, Math.min(3, dbfsL + 14));
    const targetVuR = Math.max(-20, Math.min(3, dbfsR + 14));
    this.vuNeedleL += (targetVuL - this.vuNeedleL) * (targetVuL > this.vuNeedleL ? 0.34 : 0.12);
    this.vuNeedleR += (targetVuR - this.vuNeedleR) * (targetVuR > this.vuNeedleR ? 0.34 : 0.12);

    const nowMs = performance.now();
    if (instPeakDb >= this.peakHoldDbfs || nowMs - this.peakHoldDecayTs > 2200) {
      this.peakHoldDbfs = instPeakDb;
      this.peakHoldDecayTs = nowMs;
    }

    const energy = sumSqL / len + sumSqR / len;
    this.energyHistory.push({ ts: nowMs, energy });
    while (this.energyHistory.length > 0 && nowMs - this.energyHistory[0].ts > 3000) {
      this.energyHistory.shift();
    }

    let mSum = 0, mCount = 0;
    let sSum = 0, sCount = 0;
    for (let i = 0; i < this.energyHistory.length; i++) {
      const item = this.energyHistory[i];
      sSum += item.energy;
      sCount++;
      if (nowMs - item.ts <= 400) {
        mSum += item.energy;
        mCount++;
      }
    }

    const mEnergy = mCount > 0 ? mSum / mCount : 0;
    const sEnergy = sCount > 0 ? sSum / sCount : 0;
    const momentaryLufs = mEnergy > 1e-9 ? -0.691 + 10 * Math.log10(mEnergy) : -70;
    const shortTermLufs = sEnergy > 1e-9 ? -0.691 + 10 * Math.log10(sEnergy) : -70;

    return {
      isPlaying: true,
      vuL: this.vuNeedleL,
      vuR: this.vuNeedleR,
      momentaryLufs,
      shortTermLufs,
      peakDbfs: this.peakHoldDbfs,
      freqData: this.freqData,
      proFreqData: this.proFreqData,
      timeDataL: this.timeDataL,
      timeDataR: this.timeDataR,
      correlation: this.smoothCorrelation,
      balance: this.smoothBalance,
      midDb,
      sideDb,
      crestDb: this.smoothCrest,
      sampleRate: this.ctx.sampleRate,
    };
  }
}
