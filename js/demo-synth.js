/* ==========================================================================
   ON-DEMAND LOSSLESS DEMO WAV GENERATOR (RAW MIX vs ANALOG MASTER)
   Synthesizes a warm neo-soul / Rhodes + analog bass + brushed groove loop
   encoded as genuine 16-bit 44.1kHz stereo PCM .WAV Blobs so visitors can
   immediately experience the A/B toggle & LUFS Loudness Matching.
   ========================================================================== */

function encodeStereoWav16(left, right, sampleRate) {
  const numSamples = left.length;
  const buffer = new ArrayBuffer(44 + numSamples * 4);
  const view = new DataView(buffer);

  function writeStr(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 4, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 2, true); // Stereo
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true); // Byte rate
  view.setUint16(32, 4, true); // Block align
  view.setUint16(34, 16, true); // 16-bit
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 4, true);

  let pos = 44;
  for (let i = 0; i < numSamples; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    view.setInt16(pos, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    view.setInt16(pos + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
    pos += 4;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export function generateDemoWavPair() {
  const sr = 44100;
  const durationSec = 16; // 4 bars at 60 BPM (or 8 bars at 120 BPM)
  const total = sr * durationSec;

  const mixL = new Float32Array(total);
  const mixR = new Float32Array(total);

  // Chord progression: Dm9 -> G13 -> Cmaj9 -> A7alt (warm vintage Rhodes)
  const chords = [
    { start: 0, dur: 4, bass: 73.42, notes: [146.83, 174.61, 220.0, 261.63, 329.63] },
    { start: 4, dur: 4, bass: 98.0, notes: [146.83, 196.0, 246.94, 329.63, 392.0] },
    { start: 8, dur: 4, bass: 65.41, notes: [130.81, 164.81, 196.0, 246.94, 293.66] },
    { start: 12, dur: 4, bass: 55.0, notes: [130.81, 164.81, 207.65, 246.94, 311.13] },
  ];

  // 1. Render Raw Mix (un-mastered: conservative headroom, narrower stereo, slightly dull top end)
  for (const ch of chords) {
    const sStart = Math.floor(ch.start * sr);
    const sLen = Math.floor(ch.dur * sr);

    for (let i = 0; i < sLen && sStart + i < total; i++) {
      const t = i / sr;
      // Rhodes electric piano bell + tine warmth
      const env = Math.min(1, t / 0.018) * Math.exp(-t * 0.58);
      const tremolo = 1 + 0.08 * Math.sin(2 * Math.PI * 3.8 * t);
      let rhL = 0;
      let rhR = 0;

      for (let n = 0; n < ch.notes.length; n++) {
        const f = ch.notes[n];
        const pan = (n / (ch.notes.length - 1)) * 0.45 - 0.225; // Narrow raw mix pan
        const tone =
          Math.sin(2 * Math.PI * f * t) * 0.62 +
          Math.sin(2 * Math.PI * f * 2 * t) * 0.14 * Math.exp(-t * 1.4) +
          Math.sin(2 * Math.PI * f * 3 * t) * 0.05 * Math.exp(-t * 2.5);
        rhL += tone * (0.5 - pan * 0.5);
        rhR += tone * (0.5 + pan * 0.5);
      }

      // Warm analog bass pulse (2 notes per chord)
      const bassPhase = t % 2.0;
      const bassEnv = Math.min(1, bassPhase / 0.012) * Math.exp(-bassPhase * 1.15);
      const bassSig =
        (Math.sin(2 * Math.PI * ch.bass * t) * 0.78 +
          Math.sin(2 * Math.PI * ch.bass * 2 * t) * 0.22) *
        bassEnv *
        0.24;

      const idx = sStart + i;
      mixL[idx] += rhL * env * tremolo * 0.11 + bassSig;
      mixR[idx] += rhR * env * tremolo * 0.11 + bassSig;
    }
  }

  // Add subtle vintage drums (kick, soft rim/snare, hi-hat groove)
  let rng = 1337;
  const rand = () => {
    rng = (rng * 16807) % 2147483647;
    return (rng / 2147483647) * 2 - 1;
  };

  const beatSec = 0.5; // 120 BPM
  for (let beat = 0; beat < durationSec / beatSec; beat++) {
    const startIdx = Math.floor(beat * beatSec * sr);
    const step = beat % 8;

    // Kick on 0, 3, 4
    if (step === 0 || step === 3 || step === 4) {
      const kickLen = Math.floor(0.22 * sr);
      for (let i = 0; i < kickLen && startIdx + i < total; i++) {
        const t = i / sr;
        const freq = 48 + 95 * Math.exp(-t * 36);
        const env = Math.exp(-t * 13);
        const val = Math.sin(2 * Math.PI * freq * t) * env * 0.28;
        mixL[startIdx + i] += val;
        mixR[startIdx + i] += val;
      }
    }

    // Soft brushed snare on 2, 6
    if (step === 2 || step === 6) {
      const snLen = Math.floor(0.16 * sr);
      let lp = 0;
      for (let i = 0; i < snLen && startIdx + i < total; i++) {
        const t = i / sr;
        const env = Math.exp(-t * 22);
        const body = Math.sin(2 * Math.PI * 195 * t) * Math.exp(-t * 30) * 0.12;
        lp = lp * 0.68 + rand() * 0.32;
        const val = (lp * 0.14 * env + body);
        mixL[startIdx + i] += val * 0.96;
        mixR[startIdx + i] += val * 1.04;
      }
    }

    // Brushed hi-hat on every eighth
    const hhLen = Math.floor(0.055 * sr);
    let prev = 0;
    for (let i = 0; i < hhLen && startIdx + i < total; i++) {
      const t = i / sr;
      const n = rand();
      const hp = n - prev;
      prev = n;
      const env = Math.exp(-t * 58);
      const val = hp * env * 0.032;
      mixL[startIdx + i] += val * 0.85;
      mixR[startIdx + i] += val * 1.15;
    }
  }

  // 2. Render Analog Mastered Version from Mix:
  //    - Gentle Pultec-style low-end body & 10kHz air shelf
  //    - Subtle mid-side stereo widening (+22% side)
  //    - Warm analog tape/tube soft saturation + mastering glue limiting (~+5.8 dB loudness lift)
  const masterL = new Float32Array(total);
  const masterR = new Float32Array(total);

  let lowL = 0, lowR = 0;
  let prevL = 0, prevR = 0;

  for (let i = 0; i < total; i++) {
    const xL = mixL[i];
    const xR = mixR[i];

    // Gentle low-shelf warmth (~90Hz)
    lowL += (xL - lowL) * 0.015;
    lowR += (xR - lowR) * 0.015;

    // Subtle high-frequency air sheen
    const airL = xL - prevL;
    const airR = xR - prevR;
    prevL = xL;
    prevR = xR;

    let eqL = xL + lowL * 0.24 + airL * 0.34;
    let eqR = xR + lowR * 0.24 + airR * 0.34;

    // Mid-Side stereo enhancement (subtle mastering width)
    const mid = (eqL + eqR) * 0.5;
    const side = (eqL - eqR) * 0.5 * 1.28;
    eqL = mid + side;
    eqR = mid - side;

    // Analog mastering drive + smooth tanh tape/limiter ceiling (-0.8 dBFS)
    const drive = 2.35;
    masterL[i] = Math.tanh(eqL * drive) * 0.91;
    masterR[i] = Math.tanh(eqR * drive) * 0.91;
  }

  return {
    mixBlob: encodeStereoWav16(mixL, mixR, sr),
    masterBlob: encodeStereoWav16(masterL, masterR, sr),
    mixFileName: 'Midnight_Walnut_RawMix_16bit_44k.wav',
    masterFileName: 'Midnight_Walnut_AnalogMaster_16bit_44k.wav',
  };
}
