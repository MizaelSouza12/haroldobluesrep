'use strict';
/*
 * Repertórios para músicos — edição sem login.
 * O GitHub Pages é somente leitura. Este editor grava no localStorage
 * deste navegador, por playlist e música; NÃO sincroniza aparelhos.
 */
(function () {
  const source = document.body.dataset.source;
  const category = document.body.dataset.category;
  const slug = document.body.dataset.slug;
  const storageKey = 'repHaroldo_musicianFields_v1:' + slug;
  const mainKeysStorage = 'repHaroldo_playlistkeys_v1';
  const $ = id => document.getElementById(id);
  const state = {};
  let mainKeys = {};
  let canStore = true;

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      canStore = false;
      return fallback;
    }
  }

  const storedFields = readJSON(storageKey, {});
  if (storedFields && typeof storedFields === 'object' && !Array.isArray(storedFields)) {
    Object.assign(state, storedFields);
  }
  mainKeys = readJSON(mainKeysStorage, {});

  function stableSongId(title, artist) {
    const str = String((title || '') + '|' + (artist || '')).toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return 'SB' + (h >>> 0).toString(36);
  }

  function savedField(s) {
    const id = stableSongId(s.title, s.artist);
    const value = state[id];
    const initialKey = mainKeys && mainKeys[category] && mainKeys[category][id];
    return {
      id,
      key: value && typeof value.key === 'string'
        ? value.key : String(initialKey !== undefined ? initialKey : (s.key || '')),
      note: value && typeof value.note === 'string' ? value.note : ''
    };
  }

  function setStatus(message, isError) {
    const e = $('saveStatus');
    e.textContent = message;
    e.classList.toggle('error', !!isError);
  }

  function save(id, key, note) {
    try {
      // Releia antes de gravar: duas abas podem editar músicas diferentes.
      // Nunca sobrescreva a edição mais recente da outra aba com o snapshot antigo.
      const newest = readJSON(storageKey, {});
      const merged = newest && typeof newest === 'object' && !Array.isArray(newest)
        ? newest : {};
      merged[id] = { key, note };
      localStorage.setItem(storageKey, JSON.stringify(merged));
      Object.assign(state, merged);
      // Sincroniza o tom com a tela de preparo quando tudo é aberto
      // no MESMO navegador/origem. Não publica no GitHub.
      if (category === 'A' || category === 'J') {
        const current = readJSON(mainKeysStorage, {});
        if (!current[category] || typeof current[category] !== 'object') current[category] = {};
        current[category][id] = key;
        localStorage.setItem(mainKeysStorage, JSON.stringify(current));
      }
      setStatus('✓ Salvo neste navegador', false);
    } catch (err) {
      canStore = false;
      setStatus('Não foi possível salvar. Verifique o armazenamento do navegador.', true);
    }
  }

  function add(parent, className, value, tagName) {
    const e = document.createElement(tagName || 'div');
    e.className = className;
    e.textContent = value;
    parent.appendChild(e);
    return e;
  }

  async function load() {
    const res = await fetch('./' + source, { cache: 'no-store' });
    if (!res.ok) throw new Error('Não foi possível carregar a playlist.');
    const data = await res.json();
    if (!data || !Array.isArray(data.songs) || data.songs.length > 1000) {
      throw new Error('Dados da playlist inválidos.');
    }

    const title = data.name || 'Repertório';
    $('title').textContent = title;
    $('meta').textContent = data.songs.length + (data.songs.length === 1 ? ' música' : ' músicas');
    document.title = title + ' — Repertório';
    $('list').textContent = '';

    const rows = [];
    data.songs.forEach((song, i) => {
      const fields = savedField(song);
      const row = document.createElement('article');
      row.className = 'song';
      add(row, 'num', String(i + 1).padStart(2, '0'));

      const info = document.createElement('div');
      info.className = 'songInfo';
      add(info, 'title', String(song.title || 'Sem título'));
      add(info, 'artist', String(song.artist || ''));
      row.appendChild(info);

      const keyWrap = document.createElement('label');
      keyWrap.className = 'keyWrap';
      add(keyWrap, 'fieldLabel', 'Tom / Nota', 'span');
      const keyInput = document.createElement('input');
      keyInput.className = 'keyInput';
      keyInput.type = 'text';
      keyInput.maxLength = 40;
      keyInput.value = fields.key;
      keyInput.placeholder = 'Ex.: G#m';
      keyInput.autocomplete = 'off';
      keyInput.spellcheck = false;
      keyInput.setAttribute('aria-label', 'Tom ou nota de ' + song.title);
      keyWrap.appendChild(keyInput);
      add(keyWrap, 'printKey', fields.key || '—');
      row.appendChild(keyWrap);

      const noteWrap = document.createElement('label');
      noteWrap.className = 'noteWrap';
      add(noteWrap, 'fieldLabel', 'Anotação da música', 'span');
      const noteInput = document.createElement('textarea');
      noteInput.className = 'noteInput';
      noteInput.rows = 2;
      noteInput.maxLength = 2000;
      noteInput.placeholder = 'Escreva observações, entradas ou orientações…';
      noteInput.value = fields.note;
      noteInput.setAttribute('aria-label', 'Anotação de ' + song.title);
      noteWrap.appendChild(noteInput);
      const printNote = add(noteWrap, 'printNote', fields.note);
      row.appendChild(noteWrap);

      const persist = () => {
        save(fields.id, keyInput.value, noteInput.value);
        row.querySelector('.printKey').textContent = keyInput.value || '—';
        printNote.textContent = noteInput.value;
      };
      keyInput.addEventListener('input', persist);
      noteInput.addEventListener('input', persist);
      $('list').appendChild(row);
      rows.push({ song, keyInput, noteInput });
    });

    $('copyBtn').onclick = async () => {
      const lines = ['REPERTÓRIO - ' + title, ''];
      rows.forEach(({ song, keyInput, noteInput }, i) => {
        lines.push(String(i + 1).padStart(2, '0') + '. ' + song.title + ' - ' +
          song.artist + ' - ' + (keyInput.value.trim() || '___'));
        if (noteInput.value.trim()) lines.push('    Anotação: ' + noteInput.value.trim());
      });
      const text = lines.join('\n');
      try {
        await navigator.clipboard.writeText(text);
        alert('Lista copiada com os tons e anotações deste navegador.');
      } catch (err) {
        prompt('Copie a lista:', text);
      }
    };
    $('printBtn').onclick = () => window.print();

    setStatus(canStore ? '✓ Edição disponível — salvamento local' :
      'Armazenamento indisponível neste navegador.', !canStore);
  }

  load().catch(err => {
    $('error').style.display = 'block';
    $('error').textContent = err.message || 'Erro ao carregar a playlist.';
    $('meta').textContent = 'Erro';
    $('saveStatus').textContent = 'Playlist indisponível';
  });
})();