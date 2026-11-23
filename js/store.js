/* ==========================================================================
   HYBRID DATA STORE — LOCAL INDEXEDDB <-> PUBLIC CLOUD (SUPABASE)
   Unifies track CRUD and audio source resolution across Local and Cloud modes.
   ========================================================================== */

import { isCloudConfigured } from './config.js';
import {
  saveTrack as idbSaveTrack,
  updateTrackMeta as idbUpdateTrackMeta,
  getTracksByOwner as idbGetTracksByOwner,
  getTrackAudioBlobs as idbGetTrackAudioBlobs,
  deleteTrack as idbDeleteTrack,
} from './db.js';
import {
  cloudGetTracksByOwner,
  cloudSaveTrack,
  cloudUpdateTrackMeta,
  cloudDeleteTrack,
} from './cloud-backend.js';

export function isCloudMode() {
  return isCloudConfigured();
}

export async function listTracksForOwner(ownerAccountId) {
  if (!ownerAccountId) return [];
  if (isCloudMode()) {
    return cloudGetTracksByOwner(ownerAccountId);
  }
  return idbGetTracksByOwner(ownerAccountId);
}

export async function saveTrackHybrid(trackMeta, fileA, fileB) {
  if (isCloudMode()) {
    return cloudSaveTrack(trackMeta, fileA, fileB);
  }
  return idbSaveTrack(trackMeta, fileA, fileB);
}

export async function updateTrackMetaHybrid(trackMeta) {
  if (isCloudMode()) {
    return cloudUpdateTrackMeta(trackMeta);
  }
  return idbUpdateTrackMeta(trackMeta);
}

export async function deleteTrackHybrid(trackMeta) {
  if (isCloudMode()) {
    return cloudDeleteTrack(trackMeta);
  }
  return idbDeleteTrack(trackMeta.id);
}

/**
 * Resolve audio sources for MasteringAudioEngine.loadTrack():
 * - In Cloud Mode: returns remote HTTPS URLs from Supabase Storage.
 * - In Local Mode: returns lossless WAV Blobs from IndexedDB.
 */
export async function getTrackAudioSourcesHybrid(track) {
  if (isCloudMode() && track.masterAudioUrl) {
    return {
      sourceA: track.trackMode === 'beat' ? null : track.mixAudioUrl || null,
      sourceB: track.masterAudioUrl,
    };
  }
  const { mixBlob, masterBlob } = await idbGetTrackAudioBlobs(track.id);
  return {
    sourceA: track.trackMode === 'beat' ? null : mixBlob,
    sourceB: masterBlob,
  };
}
