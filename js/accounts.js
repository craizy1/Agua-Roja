/* ==========================================================================
   PRODUCER ACCOUNTS, HYBRID AUTH (LOCAL INDEXEDDB <-> SUPABASE CLOUD)
   & PUBLIC SHAREABLE PROFILE ENGINE (?u=handle) — AGUJA ROJA
   ========================================================================== */

import {
  saveAccount,
  getAllAccounts,
  deleteAccount,
  saveSetting,
  getSetting,
  migrateOrphanTracks,
} from './db.js';
import { isCloudConfigured } from './config.js';
import {
  cloudGetSession,
  cloudSignUp,
  cloudSignIn,
  cloudSignOut,
  cloudFetchProfileById,
  cloudFetchProfileByHandle,
  cloudFetchAllProfiles,
  cloudUpdateProfile,
} from './cloud-backend.js';
import { blobToCompressedDataUrl } from './cover-art.js';

export const DEFAULT_ACCOUNT_TEMPLATE = {
  id: 'acc_default_aguja_roja',
  handle: 'agujaroja',
  studioName: 'Aguja Roja',
  displayName: 'Ingeniero de Máster',
  role: 'Productor · Mezcla & Mastering',
  heroTitle: 'Calidez analógica justo antes del límite.',
  heroLead:
    'Escucha beats, mezclas y másters sin pérdida (.WAV) con alternancia A/B instantánea, igualación LUFS y medidores Pro.',
  bio1:
    'Cada producción, mezcla y máster merece traducirse con honestidad y carácter en cualquier sistema: desde un tornamesa de alta fidelidad hasta clubes y plataformas de streaming.',
  bio2:
    'Combino criterio musical, monitoreo calibrado y estética analógica para ofrecer resultados competitivos sin sacrificar la dinámica ni la emoción original.',
  specialties: 'Beats & Producción, Mezcla Estéreo, Mastering Analógico, Vinilo & Cassette',
  location: 'Ubicación editable en tu perfil · Sesiones Remotas',
  email: 'contacto@agujaroja.audio',
  turnaround: '24 – 48 horas hábiles',
  revisions: 'Hasta 2 rondas de ajuste incluidas',
  instagram: '',
  spotify: '',
  website: '',
  avatarDataUrl: '',
  pinHash: '',
  createdAt: 1,
};

const $ = (id) => document.getElementById(id);

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeUrl(raw, prefix = 'https://') {
  const v = (raw || '').trim();
  if (!v) return '';
  if (/^(javascript|data|vbscript):/i.test(v)) return '';
  if (/^https?:\/\//i.test(v)) return v;
  return prefix + v.replace(/^@/, '');
}

async function hashPin(pin) {
  const clean = (pin || '').trim();
  if (!clean) return '';
  if (crypto?.subtle) {
    const buf = new TextEncoder().encode(`aguja-roja:${clean}`);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return btoa(clean);
}

export function buildMonogramAvatar(name = 'AR') {
  const parts = String(name || 'AR').trim().split(/\s+/).filter(Boolean);
  const initials =
    parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : String(name || 'AR').slice(0, 2).toUpperCase();

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
    <defs>
      <radialGradient id="g" cx="35%" cy="30%" r="75%">
        <stop offset="0%" stop-color="#3a271a"/>
        <stop offset="100%" stop-color="#17100b"/>
      </radialGradient>
    </defs>
    <rect width="160" height="160" fill="url(#g)"/>
    <circle cx="80" cy="80" r="68" fill="none" stroke="#d4953f" stroke-opacity="0.45" stroke-width="2"/>
    <circle cx="80" cy="80" r="56" fill="none" stroke="#e04332" stroke-opacity="0.35" stroke-width="1.2"/>
    <text x="80" y="92" text-anchor="middle" fill="#f3e8d4" font-family="Georgia, serif" font-size="52" font-weight="600" letter-spacing="2">${initials}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function buildPublicProfileUrl(handle) {
  const url = new URL(window.location.href);
  url.searchParams.set('u', handle || 'agujaroja');
  url.hash = '';
  return url.toString();
}

export function renderActiveAccount(acc) {
  if (!acc) return;
  const avatarSrc = acc.avatarDataUrl || buildMonogramAvatar(acc.displayName || acc.studioName);

  $('brandStudioName').textContent = acc.studioName || 'Aguja Roja';
  $('brandEngineerRole').textContent = `${acc.displayName} · ${acc.role}`;
  $('headerAccountAvatar').src = avatarSrc;
  $('headerAccountName').textContent = `@${acc.handle}`;
  document.title = `${acc.studioName} — ${acc.displayName} | Portafolio de Audio A/B`;

  $('heroTitle').textContent = acc.heroTitle;
  $('heroLead').textContent = acc.heroLead;

  $('publicProfileAvatar').src = avatarSrc;
  $('publicProfileAvatar').alt = `Foto de perfil de ${acc.displayName}`;
  $('publicProfileName').textContent = acc.displayName;
  $('publicProfileHandle').textContent = `@${acc.handle}`;
  $('publicProfileRole').textContent = acc.role;
  $('bioPara1').textContent = acc.bio1;
  $('bioPara2').textContent = acc.bio2;

  const tagsBox = $('publicSpecialtiesList');
  tagsBox.innerHTML = '';
  String(acc.specialties || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((tag) => {
      const span = document.createElement('span');
      span.className = 'specialty-pill';
      span.textContent = tag;
      tagsBox.appendChild(span);
    });

  const socialsBox = $('publicSocialLinks');
  socialsBox.innerHTML = '';
  [
    { label: 'Instagram', url: acc.instagram ? normalizeUrl(acc.instagram, 'https://instagram.com/') : '' },
    { label: 'Créditos / Spotify', url: acc.spotify ? normalizeUrl(acc.spotify, 'https://') : '' },
    { label: 'Sitio Web', url: acc.website ? normalizeUrl(acc.website, 'https://') : '' },
  ]
    .filter((l) => l.url)
    .forEach((item) => {
      const a = document.createElement('a');
      a.href = item.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.className = 'social-pill-link';
      a.textContent = item.label;
      socialsBox.appendChild(a);
    });

  $('plaqueLocation').textContent = acc.location;
  $('plaqueTurnaround').textContent = acc.turnaround;
  $('plaqueRevisions').textContent = acc.revisions;
  $('contactEmailDisplay').textContent = acc.email;
  $('contactEmailDisplay').href = `mailto:${acc.email}`;
  $('contactLocationDisplay').textContent = acc.location;
  $('footerStudioName').textContent = `${acc.studioName} — ${acc.displayName}`;

  $('editorAvatarPreview').src = avatarSrc;
  $('profStudioName').value = acc.studioName || '';
  $('profDisplayName').value = acc.displayName || '';
  $('profHandle').value = acc.handle || '';
  $('profRole').value = acc.role || '';
  $('profHeroTitle').value = acc.heroTitle || '';
  $('profHeroLead').value = acc.heroLead || '';
  $('profBio1').value = acc.bio1 || '';
  $('profBio2').value = acc.bio2 || '';
  $('profSpecialties').value = acc.specialties || '';
  $('profLocation').value = acc.location || '';
  $('profEmail').value = acc.email || '';
  $('profTurnaround').value = acc.turnaround || '';
  $('profRevisions').value = acc.revisions || '';
  $('profInstagram').value = acc.instagram || '';
  $('profSpotify').value = acc.spotify || '';
  $('profWebsite').value = acc.website || '';
}

function updateCloudBadgeUI(state) {
  const chip = $('cloudModeChip');
  const cloudAuthBox = $('cloudLoginBox');
  const signOutBtn = $('cloudSignOutBtn');
  const pinLabel = $('newAccPinLabel');

  if (isCloudConfigured()) {
    chip.textContent = state.cloudUser ? 'Nube Pública · Conectado' : 'Nube Pública · Visitante';
    chip.classList.add('is-cloud');
    cloudAuthBox.hidden = false;
    signOutBtn.hidden = !state.cloudUser;
    if (pinLabel) pinLabel.textContent = 'Contraseña de cuenta (mín. 6 caracteres)';
  } else {
    chip.textContent = 'Modo Local · IndexedDB';
    chip.classList.remove('is-cloud');
    cloudAuthBox.hidden = true;
    signOutBtn.hidden = true;
    if (pinLabel) pinLabel.textContent = 'PIN de acceso local (opcional)';
  }
}

export async function initAccounts(state, showToast, onAccountChanged, onForceMode) {
  const urlHandle = new URLSearchParams(window.location.search).get('u')?.trim().toLowerCase() || '';
  state.cloudUser = null;
  state.pendingAvatarDataUrl = null;
  state.newAccountAvatarDataUrl = '';

  if (isCloudConfigured()) {
    try {
      const session = await cloudGetSession();
      if (session?.user) {
        state.cloudUser = await cloudFetchProfileById(session.user.id);
      }
      state.accounts = await cloudFetchAllProfiles();

      if (urlHandle) {
        const target = await cloudFetchProfileByHandle(urlHandle);
        if (target) {
          state.activeAccount = target;
          if (!state.cloudUser || state.cloudUser.id !== target.id) {
            onForceMode('client');
          }
        }
      }
      if (!state.activeAccount) {
        state.activeAccount = state.cloudUser || state.accounts[0] || { ...DEFAULT_ACCOUNT_TEMPLATE };
      }
    } catch (err) {
      console.error(err);
      showToast(`Error conectando con Supabase: ${err.message}`, 'error');
      state.activeAccount = { ...DEFAULT_ACCOUNT_TEMPLATE };
      state.accounts = [state.activeAccount];
    }
  } else {
    let accounts = await getAllAccounts();
    if (accounts.length === 0) {
      const legacy = await getSetting('portfolioProfile', null);
      const seed = {
        ...DEFAULT_ACCOUNT_TEMPLATE,
        ...(legacy
          ? {
              displayName: legacy.engineerName || DEFAULT_ACCOUNT_TEMPLATE.displayName,
              bio1: legacy.bio1 || DEFAULT_ACCOUNT_TEMPLATE.bio1,
              bio2: legacy.bio2 || DEFAULT_ACCOUNT_TEMPLATE.bio2,
              location: legacy.location || DEFAULT_ACCOUNT_TEMPLATE.location,
              email: legacy.email || DEFAULT_ACCOUNT_TEMPLATE.email,
              turnaround: legacy.turnaround || DEFAULT_ACCOUNT_TEMPLATE.turnaround,
            }
          : {}),
      };
      await saveAccount(seed);
      accounts = [seed];
    }

    await migrateOrphanTracks(accounts[0].id);
    state.accounts = accounts;

    if (urlHandle) {
      const byHandle = accounts.find((a) => a.handle === urlHandle);
      if (byHandle) {
        state.activeAccount = byHandle;
        await saveSetting('activeAccountId', byHandle.id);
      }
    }
    if (!state.activeAccount) {
      const savedActiveId = await getSetting('activeAccountId', accounts[0].id);
      state.activeAccount = accounts.find((a) => a.id === savedActiveId) || accounts[0];
    }
  }

  updateCloudBadgeUI(state);
  renderActiveAccount(state.activeAccount);
  renderAccountsList(state, showToast, onAccountChanged);
  bindAccountControls(state, showToast, onAccountChanged, onForceMode);
}

function renderAccountsList(state, showToast, onAccountChanged) {
  const listEl = $('accountsListContainer');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (state.accounts.length === 0) {
    listEl.innerHTML =
      '<p style="color:var(--text-secondary); font-size:0.86rem;">Aún no hay cuentas registradas. Crea la primera en la pestaña "+ Crear Cuenta".</p>';
    return;
  }

  state.accounts.forEach((acc) => {
    const isCurrent = acc.id === state.activeAccount?.id;
    const card = document.createElement('div');
    card.className = `account-item ${isCurrent ? 'is-active' : ''}`;
    const avatarSrc = acc.avatarDataUrl || buildMonogramAvatar(acc.displayName);

    card.innerHTML = `
      <img class="account-mini-avatar" src="${avatarSrc}" alt="${escapeHtml(acc.displayName)}" />
      <div class="account-item-info">
        <strong>${escapeHtml(acc.displayName)}</strong>
        <span>@${escapeHtml(acc.handle)} · ${escapeHtml(acc.studioName)}${acc.pinHash ? ' · PIN activo' : ''}</span>
      </div>
      <div class="account-item-actions">
        ${
          isCurrent
            ? '<span class="account-active-tag">Activa</span>'
            : '<button type="button" class="btn btn-ghost btn-sm" data-switch-acc>Ver perfil</button>'
        }
        ${
          !isCloudConfigured() && state.accounts.length > 1
            ? '<button type="button" class="btn btn-danger btn-sm" data-del-acc title="Eliminar cuenta">Borrar</button>'
            : ''
        }
      </div>
    `;

    const switchBtn = card.querySelector('[data-switch-acc]');
    if (switchBtn) {
      switchBtn.addEventListener('click', async () => {
        if (!isCloudConfigured() && acc.pinHash) {
          const entered = prompt(`Ingresa el PIN de acceso para @${acc.handle}:`);
          if (entered === null) return;
          if ((await hashPin(entered)) !== acc.pinHash) {
            showToast('PIN incorrecto. No se cambió de cuenta.', 'error');
            return;
          }
        }
        state.activeAccount = acc;
        state.pendingAvatarDataUrl = null;
        if (!isCloudConfigured()) {
          await saveSetting('activeAccountId', acc.id);
        }
        renderActiveAccount(acc);
        renderAccountsList(state, showToast, onAccountChanged);
        await onAccountChanged(acc);
        showToast(`Perfil activo: ${acc.displayName} (@${acc.handle}).`, 'success');
      });
    }

    const delBtn = card.querySelector('[data-del-acc]');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        if (!confirm(`¿Eliminar la cuenta local "${acc.displayName}" (@${acc.handle})?`)) return;
        await deleteAccount(acc.id);
        state.accounts = await getAllAccounts();
        if (state.activeAccount.id === acc.id) {
          state.activeAccount = state.accounts[0];
          await saveSetting('activeAccountId', state.activeAccount.id);
          renderActiveAccount(state.activeAccount);
          await onAccountChanged(state.activeAccount);
        }
        renderAccountsList(state, showToast, onAccountChanged);
        showToast('Cuenta eliminada.', 'info');
      });
    }

    listEl.appendChild(card);
  });
}

function bindAccountControls(state, showToast, onAccountChanged, onForceMode) {
  const setAccountTab = (tab) => {
    $('tabEditProfileBtn').classList.toggle('is-active', tab === 'profile');
    $('tabSwitchAccountBtn').classList.toggle('is-active', tab === 'switch');
    $('tabCreateAccountBtn').classList.toggle('is-active', tab === 'create');
    $('profileEditTab').hidden = tab !== 'profile';
    $('accountSwitchTab').hidden = tab !== 'switch';
    $('accountCreateTab').hidden = tab !== 'create';
  };

  const openDrawer = (tab = 'profile') => {
    const panel = $('profileEditorPanel');
    panel.hidden = false;
    setAccountTab(tab);
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  $('headerAccountBtn').addEventListener('click', () => {
    const panel = $('profileEditorPanel');
    if (!panel.hidden && !$('accountSwitchTab').hidden) panel.hidden = true;
    else openDrawer('switch');
  });

  $('toggleProfileEditBtn').addEventListener('click', () => {
    const panel = $('profileEditorPanel');
    if (!panel.hidden && !$('profileEditTab').hidden) panel.hidden = true;
    else openDrawer('profile');
  });

  $('editPublicProfileBtn').addEventListener('click', () => openDrawer('profile'));
  $('closeProfileDrawerBtn').addEventListener('click', () => { $('profileEditorPanel').hidden = true; });
  $('tabEditProfileBtn').addEventListener('click', () => setAccountTab('profile'));
  $('tabSwitchAccountBtn').addEventListener('click', () => setAccountTab('switch'));
  $('tabCreateAccountBtn').addEventListener('click', () => setAccountTab('create'));

  // Copy Shareable Public Link (?u=handle)
  $('copyPublicLinkBtn').addEventListener('click', async () => {
    const handle = state.activeAccount?.handle || 'agujaroja';
    const url = buildPublicProfileUrl(handle);
    try {
      await navigator.clipboard.writeText(url);
      showToast(`Enlace público copiado: ?u=${handle}`, 'success');
    } catch {
      prompt('Copia tu enlace público:', url);
    }
  });

  // Cloud Sign-In & Sign-Out (active when Supabase keys are configured in js/config.js)
  $('cloudLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isCloudConfigured()) return;
    try {
      const profile = await cloudSignIn({
        email: $('cloudLoginEmail').value.trim(),
        password: $('cloudLoginPassword').value,
      });
      state.cloudUser = profile;
      state.activeAccount = profile;
      state.accounts = await cloudFetchAllProfiles();
      updateCloudBadgeUI(state);
      renderActiveAccount(profile);
      renderAccountsList(state, showToast, onAccountChanged);
      await onAccountChanged(profile);
      onForceMode('editor');
      $('cloudLoginForm').reset();
      showToast(`Sesión iniciada en la nube como @${profile.handle}.`, 'success');
    } catch (err) {
      showToast(`Error al iniciar sesión: ${err.message}`, 'error');
    }
  });

  $('cloudSignOutBtn').addEventListener('click', async () => {
    await cloudSignOut();
    state.cloudUser = null;
    updateCloudBadgeUI(state);
    onForceMode('client');
    showToast('Sesión cerrada.', 'info');
  });

  // Avatar Upload (Active Account)
  $('profAvatarInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await blobToCompressedDataUrl(file, 400);
      state.pendingAvatarDataUrl = dataUrl;
      $('editorAvatarPreview').src = dataUrl;
      showToast('Foto lista. Pulsa "Guardar perfil público" para aplicarla.', 'info');
    } catch (err) {
      showToast(`No se pudo procesar la foto: ${err.message}`, 'error');
    }
  });

  $('removeAvatarBtn').addEventListener('click', () => {
    state.pendingAvatarDataUrl = '';
    $('editorAvatarPreview').src = buildMonogramAvatar($('profDisplayName').value || 'AR');
    showToast('Se usará el retrato monograma al guardar.', 'info');
  });

  // Save Customized Public Profile (Local or Cloud)
  $('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const cur = state.activeAccount;
    const rawHandle = $('profHandle').value.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '') || cur.handle;

    if (state.accounts.some((a) => a.handle === rawHandle && a.id !== cur.id)) {
      showToast(`El usuario @${rawHandle} ya está en uso.`, 'error');
      return;
    }

    const updated = {
      ...cur,
      studioName: $('profStudioName').value.trim() || 'Aguja Roja',
      displayName: $('profDisplayName').value.trim() || cur.displayName,
      handle: rawHandle,
      role: $('profRole').value.trim() || cur.role,
      heroTitle: $('profHeroTitle').value.trim() || cur.heroTitle,
      heroLead: $('profHeroLead').value.trim() || cur.heroLead,
      bio1: $('profBio1').value.trim() || cur.bio1,
      bio2: $('profBio2').value.trim() || cur.bio2,
      specialties: $('profSpecialties').value.trim(),
      location: $('profLocation').value.trim(),
      email: $('profEmail').value.trim() || cur.email,
      turnaround: $('profTurnaround').value.trim() || cur.turnaround,
      revisions: $('profRevisions').value.trim() || cur.revisions,
      instagram: $('profInstagram').value.trim(),
      spotify: $('profSpotify').value.trim(),
      website: $('profWebsite').value.trim(),
      avatarDataUrl: state.pendingAvatarDataUrl !== null ? state.pendingAvatarDataUrl : cur.avatarDataUrl,
    };

    try {
      let saved;
      if (isCloudConfigured()) {
        if (!state.cloudUser || state.cloudUser.id !== cur.id) {
          throw new Error('Inicia sesión como dueño de este perfil para editarlo en la nube.');
        }
        saved = await cloudUpdateProfile(updated, state.pendingAvatarDataUrl);
        state.cloudUser = saved;
        state.accounts = await cloudFetchAllProfiles();
      } else {
        await saveAccount(updated);
        saved = updated;
        state.accounts = await getAllAccounts();
      }

      state.activeAccount = saved;
      state.pendingAvatarDataUrl = null;
      renderActiveAccount(saved);
      renderAccountsList(state, showToast, onAccountChanged);
      $('profileEditorPanel').hidden = true;
      showToast('Perfil público guardado correctamente.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Create New Producer Account
  $('newAccAvatarPreview').src = buildMonogramAvatar('NP');
  $('newAccAvatarInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      state.newAccountAvatarDataUrl = await blobToCompressedDataUrl(file, 400);
      $('newAccAvatarPreview').src = state.newAccountAvatarDataUrl;
    } catch (err) {
      showToast(`Error leyendo imagen: ${err.message}`, 'error');
    }
  });

  $('createAccountForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const displayName = $('newAccName').value.trim();
    const handle = $('newAccHandle').value.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    const studioName = $('newAccStudio').value.trim() || 'Aguja Roja';
    const role = $('newAccRole').value.trim() || 'Productor · Mezcla & Mastering';
    const email = $('newAccEmail').value.trim() || 'contacto@agujaroja.audio';
    const secret = $('newAccPin').value.trim();

    if (!displayName || !handle) {
      showToast('Ingresa tu nombre y un usuario (@handle) válido.', 'error');
      return;
    }
    if (state.accounts.some((a) => a.handle === handle)) {
      showToast(`El usuario @${handle} ya existe. Elige otro.`, 'error');
      return;
    }

    try {
      let created;
      if (isCloudConfigured()) {
        if (secret.length < 6) {
          throw new Error('En Modo Nube necesitas una contraseña de al menos 6 caracteres.');
        }
        created = await cloudSignUp({
          email,
          password: secret,
          displayName,
          handle,
          studioName,
          role,
          avatarDataUrl: state.newAccountAvatarDataUrl,
        });
        state.cloudUser = created;
        state.accounts = await cloudFetchAllProfiles();
      } else {
        created = {
          ...DEFAULT_ACCOUNT_TEMPLATE,
          id: `acc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          handle,
          displayName,
          studioName,
          role,
          email,
          avatarDataUrl: state.newAccountAvatarDataUrl || '',
          pinHash: await hashPin(secret),
          createdAt: Date.now(),
        };
        await saveAccount(created);
        state.accounts = await getAllAccounts();
        await saveSetting('activeAccountId', created.id);
      }

      state.activeAccount = created;
      state.newAccountAvatarDataUrl = '';
      $('createAccountForm').reset();
      $('newAccAvatarPreview').src = buildMonogramAvatar('NP');

      updateCloudBadgeUI(state);
      renderActiveAccount(created);
      renderAccountsList(state, showToast, onAccountChanged);
      await onAccountChanged(created);
      setAccountTab('profile');
      showToast(`Cuenta creada para ${displayName} (@${handle}). Su librería de pistas ya está aislada.`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Contact Form
  $('contactForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('contactName').value.trim();
    const email = $('contactEmail').value.trim();
    const service = $('contactService').value;
    const tracksCount = $('contactTracks').value;
    const msg = $('contactMessage').value.trim();

    const targetEmail = state.activeAccount?.email || DEFAULT_ACCOUNT_TEMPLATE.email;
    const subject = encodeURIComponent(`[${state.activeAccount?.studioName || 'Aguja Roja'}] ${service} — ${name}`);
    const body = encodeURIComponent(
      `Nombre: ${name}\nCorreo: ${email}\nServicio: ${service}\nTracks: ${tracksCount}\n\nDetalles del proyecto:\n${msg}`
    );

    $('contactFeedback').textContent =
      'Solicitud preparada. Se abrirá tu cliente de correo o puedes escribir directamente al email del estudio.';
    window.location.href = `mailto:${targetEmail}?subject=${subject}&body=${body}`;
    showToast('Solicitud de cotización lista para enviar.', 'success');
  });
}
