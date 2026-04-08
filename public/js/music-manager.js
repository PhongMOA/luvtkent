/**
 * Music Learning Materials Manager
 * UkuTabs-style Chord Viewer
 */
const MusicManager = {
  materials: [],
  
  // Chord reader state
  _scrollInterval: null,
  _scrollSpeed: 0,
  _transposeLevel: 0,
  _instrument: 'guitar',
  _chordColor: '#8b5cf6', // Using primary accent color
  _currentContent: '',
  _currentParsedLines: [],

  // All chord names for detection
  NOTES_SHARP: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
  NOTES_FLAT:  ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'],

  // Map enharmonic equivalents
  NOTE_MAP: {
    'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
    'E': 4, 'Fb': 4, 'E#': 5, 'F': 5, 'F#': 6, 'Gb': 6,
    'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10,
    'B': 11, 'Cb': 11, 'B#': 0
  },

  // Common chord fingering data for guitar (6 strings, EADGBE)
  // Format: [frets] where -1 = muted, 0 = open. startFret = first fret position
  CHORD_SHAPES: {
    'C':    { frets: [-1, 3, 2, 0, 1, 0], startFret: 1 },
    'Cm':   { frets: [-1, 3, 5, 5, 4, 3], startFret: 3 },
    'C7':   { frets: [-1, 3, 2, 3, 1, 0], startFret: 1 },
    'Cmaj7':{ frets: [-1, 3, 2, 0, 0, 0], startFret: 1 },
    'Cm7':  { frets: [-1, 3, 5, 3, 4, 3], startFret: 3 },
    'D':    { frets: [-1, -1, 0, 2, 3, 2], startFret: 1 },
    'Dm':   { frets: [-1, -1, 0, 2, 3, 1], startFret: 1 },
    'D7':   { frets: [-1, -1, 0, 2, 1, 2], startFret: 1 },
    'Dm7':  { frets: [-1, -1, 0, 2, 1, 1], startFret: 1 },
    'E':    { frets: [0, 2, 2, 1, 0, 0], startFret: 1 },
    'Em':   { frets: [0, 2, 2, 0, 0, 0], startFret: 1 },
    'E7':   { frets: [0, 2, 0, 1, 0, 0], startFret: 1 },
    'Em7':  { frets: [0, 2, 0, 0, 0, 0], startFret: 1 },
    'F':    { frets: [1, 3, 3, 2, 1, 1], startFret: 1 },
    'Fm':   { frets: [1, 3, 3, 1, 1, 1], startFret: 1 },
    'F7':   { frets: [1, 3, 1, 2, 1, 1], startFret: 1 },
    'Fmaj7':{ frets: [-1, -1, 3, 2, 1, 0], startFret: 1 },
    'G':    { frets: [3, 2, 0, 0, 0, 3], startFret: 1 },
    'Gm':   { frets: [3, 5, 5, 3, 3, 3], startFret: 3 },
    'G7':   { frets: [3, 2, 0, 0, 0, 1], startFret: 1 },
    'Gmaj7':{ frets: [3, 2, 0, 0, 0, 2], startFret: 1 },
    'A':    { frets: [-1, 0, 2, 2, 2, 0], startFret: 1 },
    'Am':   { frets: [-1, 0, 2, 2, 1, 0], startFret: 1 },
    'A7':   { frets: [-1, 0, 2, 0, 2, 0], startFret: 1 },
    'Am7':  { frets: [-1, 0, 2, 0, 1, 0], startFret: 1 },
    'B':    { frets: [-1, 2, 4, 4, 4, 2], startFret: 2 },
    'Bm':   { frets: [-1, 2, 4, 4, 3, 2], startFret: 2 },
    'B7':   { frets: [-1, 2, 1, 2, 0, 2], startFret: 1 },
    'Bb':   { frets: [-1, 1, 3, 3, 3, 1], startFret: 1 },
    'Bbm':  { frets: [-1, 1, 3, 3, 2, 1], startFret: 1 },
    'Db':   { frets: [-1, 4, 3, 1, 2, 1], startFret: 1 },
    'Eb':   { frets: [-1, -1, 1, 3, 4, 3], startFret: 1 },
    'Ab':   { frets: [4, 6, 6, 5, 4, 4], startFret: 4 },
    'C#m':  { frets: [-1, 4, 6, 6, 5, 4], startFret: 4 },
    'F#m':  { frets: [2, 4, 4, 2, 2, 2], startFret: 2 },
    'G#m':  { frets: [4, 6, 6, 4, 4, 4], startFret: 4 },
    'Dsus2':{ frets: [-1, -1, 0, 2, 3, 0], startFret: 1 },
    'Dsus4':{ frets: [-1, -1, 0, 2, 3, 3], startFret: 1 },
    'Asus2':{ frets: [-1, 0, 2, 2, 0, 0], startFret: 1 },
    'Asus4':{ frets: [-1, 0, 2, 2, 3, 0], startFret: 1 },
    'Esus4':{ frets: [0, 2, 2, 2, 0, 0], startFret: 1 },
    'F#':   { frets: [2, 4, 4, 3, 2, 2], startFret: 2 },
    'C#':   { frets: [-1, 4, 6, 6, 6, 4], startFret: 4 },
    'G#':   { frets: [4, 6, 6, 5, 4, 4], startFret: 4 },
    'D#m':  { frets: [-1, 6, 8, 8, 7, 6], startFret: 6 },
  },

  UKULELE_CHORD_SHAPES: {
    'C':    { frets: [0, 0, 0, 3], startFret: 1 },
    'Cm':   { frets: [0, 3, 3, 3], startFret: 1 },
    'C7':   { frets: [0, 0, 0, 1], startFret: 1 },
    'Cmaj7':{ frets: [0, 0, 0, 2], startFret: 1 },
    'Cm7':  { frets: [3, 3, 3, 3], startFret: 1 },
    'D':    { frets: [2, 2, 2, 0], startFret: 1 },
    'Dm':   { frets: [2, 2, 1, 0], startFret: 1 },
    'D7':   { frets: [2, 2, 2, 3], startFret: 1 },
    'Dm7':  { frets: [2, 2, 1, 3], startFret: 1 },
    'E':    { frets: [4, 4, 4, 2], startFret: 2 },
    'Em':   { frets: [0, 4, 3, 2], startFret: 1 },
    'E7':   { frets: [1, 2, 0, 2], startFret: 1 },
    'Em7':  { frets: [0, 2, 0, 2], startFret: 1 },
    'F':    { frets: [2, 0, 1, 0], startFret: 1 },
    'Fm':   { frets: [1, 0, 1, 3], startFret: 1 },
    'F7':   { frets: [2, 3, 1, 0], startFret: 1 },
    'Fmaj7':{ frets: [2, 4, 1, 0], startFret: 1 },
    'G':    { frets: [0, 2, 3, 2], startFret: 1 },
    'Gm':   { frets: [0, 2, 3, 1], startFret: 1 },
    'G7':   { frets: [0, 2, 1, 2], startFret: 1 },
    'Gmaj7':{ frets: [0, 2, 2, 2], startFret: 1 },
    'A':    { frets: [2, 1, 0, 0], startFret: 1 },
    'Am':   { frets: [2, 0, 0, 0], startFret: 1 },
    'A7':   { frets: [0, 1, 0, 0], startFret: 1 },
    'Am7':  { frets: [0, 0, 0, 0], startFret: 1 },
    'B':    { frets: [4, 3, 2, 2], startFret: 1 },
    'Bm':   { frets: [4, 2, 2, 2], startFret: 1 },
    'B7':   { frets: [2, 3, 2, 2], startFret: 1 },
    'Bb':   { frets: [3, 2, 1, 1], startFret: 1 },
    'Bbm':  { frets: [3, 1, 1, 1], startFret: 1 },
    'Db':   { frets: [1, 1, 1, 4], startFret: 1 },
    'Eb':   { frets: [0, 3, 3, 1], startFret: 1 },
    'Ab':   { frets: [5, 3, 4, 3], startFret: 3 },
    'C#m':  { frets: [1, 4, 4, 4], startFret: 1 },
    'F#m':  { frets: [2, 1, 2, 0], startFret: 1 },
    'G#m':  { frets: [4, 3, 4, 2], startFret: 1 },
    'Dsus2':{ frets: [2, 2, 0, 0], startFret: 1 },
    'Dsus4':{ frets: [0, 2, 3, 0], startFret: 1 },
    'Asus2':{ frets: [2, 4, 0, 0], startFret: 1 },
    'Asus4':{ frets: [2, 2, 0, 0], startFret: 1 },
    'Esus4':{ frets: [2, 4, 5, 2], startFret: 1 },
    'F#':   { frets: [3, 1, 2, 1], startFret: 1 },
    'C#':   { frets: [1, 1, 1, 4], startFret: 1 },
    'G#':   { frets: [5, 3, 4, 3], startFret: 3 },
    'D#m':  { frets: [3, 3, 2, 1], startFret: 1 }
  },

  // Section header patterns
  SECTION_PATTERN: /^(Intro|Verse|Chorus|Pre[- ]?Chorus|Bridge|Outro|Interlude|Solo|Instrumental|Ref|Hook|Coda|Tab|Riff)\s*\d*\s*:?\s*$/i,

  async init() {
    this.bindEvents();
    await this.loadMusicList();
  },

  bindEvents() {
    // Type selector toggle
    document.getElementById('music-type').addEventListener('change', (e) => {
      const type = e.target.value;
      const urlGroup = document.getElementById('music-url-group');
      const contentGroup = document.getElementById('music-content-group');
      
      if (type === 'text') {
        urlGroup.classList.add('hidden');
        contentGroup.classList.remove('hidden');
        document.getElementById('music-url').required = false;
      } else {
        urlGroup.classList.remove('hidden');
        contentGroup.classList.add('hidden');
      }
    });

    // Add form
    document.getElementById('music-add-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const title = document.getElementById('music-title').value.trim();
      const url = document.getElementById('music-url').value.trim();
      const content = document.getElementById('music-content').value;
      const type = document.getElementById('music-type').value;
      const note = document.getElementById('music-note').value.trim();

      if (!title) {
        App.showToast('Vui lòng nhập tên tài liệu', 'warning');
        return;
      }

      if (type === 'text' && !content.trim()) {
        App.showToast('Vui lòng nhập nội dung hợp âm/text', 'warning');
        return;
      }

      const id = 'music_' + Date.now();
      const newMaterial = {
        id,
        title,
        url: type === 'text' ? '' : url,
        content: type === 'text' ? content : '',
        type,
        note,
      };

      try {
        await window.appDB.saveMusic(newMaterial);
        App.showToast('Đã lưu tài liệu thành công', 'success');
        
        // Reset form
        e.target.reset();
        
        // Reload list
        await this.loadMusicList();
      } catch (err) {
        App.showToast('Lỗi khi lưu tài liệu', 'error');
        console.error(err);
      }
    });

    // Close reader overlay
    const overlay = document.getElementById('music-reader-overlay');
    if (overlay) {
      document.getElementById('music-reader-close').addEventListener('click', () => {
        this.closeReader();
      });
      // Esc key
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !overlay.classList.contains('hidden')) {
          this.closeReader();
        }
      });
      
      // Accordion toggle
      const accordionBtn = document.getElementById('chord-accordion-toggle');
      if (accordionBtn) {
        accordionBtn.addEventListener('click', () => {
          const content = document.getElementById('chord-accordion-content');
          const icon = document.getElementById('chord-accordion-icon');
          content.classList.toggle('collapsed');
          if (content.classList.contains('collapsed')) {
            icon.classList.add('rotate-180');
          } else {
            icon.classList.remove('rotate-180');
          }
        });
      }
    }

    // Chord toolbar events
    this.bindChordToolbar();
  },

  bindChordToolbar() {
    // Instrument select
    document.getElementById('inst-guitar')?.addEventListener('click', () => {
      this._instrument = 'guitar';
      document.getElementById('inst-guitar').classList.add('active');
      document.getElementById('inst-ukulele').classList.remove('active');
      this.renderChordContent(this._currentContent);
    });
    document.getElementById('inst-ukulele')?.addEventListener('click', () => {
      this._instrument = 'ukulele';
      document.getElementById('inst-ukulele').classList.add('active');
      document.getElementById('inst-guitar').classList.remove('active');
      this.renderChordContent(this._currentContent);
    });

    // Autoscroll speed buttons
    document.querySelectorAll('.chord-speed-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.setAutoScrollSpeed(parseInt(btn.dataset.speed));
      });
    });

    // Transpose
    document.getElementById('transpose-down').addEventListener('click', () => {
      this._transposeLevel--;
      this.applyTranspose();
    });
    document.getElementById('transpose-up').addEventListener('click', () => {
      this._transposeLevel++;
      this.applyTranspose();
    });

    // Color picker
    document.getElementById('chord-color-picker').addEventListener('input', (e) => {
      this._chordColor = e.target.value;
      this.applyChordColor();
    });

    // Text size slider
    document.getElementById('chord-text-size').addEventListener('input', (e) => {
      const size = e.target.value;
      document.getElementById('chord-content-wrapper').style.fontSize = size + 'px';
    });

    // Line height slider
    document.getElementById('chord-line-height').addEventListener('input', (e) => {
      const h = e.target.value;
      document.querySelectorAll('.lyric-line').forEach(el => {
        el.style.lineHeight = (h / 10) + '';
      });
    });

    // Reset button
    document.getElementById('chord-reset').addEventListener('click', () => {
      this._transposeLevel = 0;
      this._instrument = 'guitar';
      this._chordColor = '#8b5cf6';
      this._scrollSpeed = 0;
      this.stopAutoScroll();

      document.getElementById('inst-guitar')?.classList.add('active');
      document.getElementById('inst-ukulele')?.classList.remove('active');
      document.getElementById('chord-color-picker').value = '#8b5cf6';
      document.getElementById('chord-text-size').value = 16;
      document.getElementById('chord-line-height').value = 22;
      document.getElementById('transpose-value').textContent = '0';
      document.getElementById('chord-content-wrapper').style.fontSize = '16px';
      document.querySelectorAll('.lyric-line').forEach(el => el.style.lineHeight = '');

      // Re-render
      this.renderChordContent(this._currentContent);
      this.updateSpeedButtons();
    });
  },

  closeReader() {
    const overlay = document.getElementById('music-reader-overlay');
    overlay.classList.add('hidden');
    this.stopAutoScroll();
    document.getElementById('music-reader-content').innerHTML = '';
    document.getElementById('chord-content-wrapper').innerHTML = '';
    document.getElementById('chord-diagrams-bar').innerHTML = '';
    this._transposeLevel = 0;
    document.getElementById('transpose-value').textContent = '0';
  },

  // ===== AUTOSCROLL =====
  setAutoScrollSpeed(speed) {
    this._scrollSpeed = speed;
    this.updateSpeedButtons();
    this.stopAutoScroll();

    if (speed > 0) {
      const body = document.getElementById('chord-reader-body');
      const interval = [0, 80, 50, 30, 18, 10][speed]; // ms between scrolls
      this._scrollInterval = setInterval(() => {
        body.scrollTop += 1;
      }, interval);
    }
  },

  stopAutoScroll() {
    if (this._scrollInterval) {
      clearInterval(this._scrollInterval);
      this._scrollInterval = null;
    }
  },

  updateSpeedButtons() {
    document.querySelectorAll('.chord-speed-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.speed) === this._scrollSpeed);
    });
  },

  // ===== TRANSPOSE =====
  transposeChord(chord, semitones) {
    if (semitones === 0) return chord;

    // Parse the chord: root note + quality
    const match = chord.match(/^([A-G][#b]?)(.*)/);
    if (!match) return chord;

    const root = match[1];
    const quality = match[2];

    const noteIndex = this.NOTE_MAP[root];
    if (noteIndex === undefined) return chord;

    let newIndex = ((noteIndex + semitones) % 12 + 12) % 12;
    
    // Use sharps for positive transpose, flats for negative
    const useFlats = chord.includes('b') || semitones < 0;
    const newRoot = useFlats ? this.NOTES_FLAT[newIndex] : this.NOTES_SHARP[newIndex];

    return newRoot + quality;
  },

  applyTranspose() {
    document.getElementById('transpose-value').textContent = this._transposeLevel;
    this.renderChordContent(this._currentContent);
  },

  applyChordColor() {
    document.querySelectorAll('.chord-name').forEach(el => {
      el.style.color = this._chordColor;
    });
  },

  // ===== CHORD DETECTION =====
  // Check if a line is a chord-only line (no lyrics, mostly chords and spaces)
  isChordLine(line) {
    if (!line.trim()) return false;
    // Split by whitespace
    const tokens = line.trim().split(/\s+/);
    if (tokens.length === 0) return false;
    
    // Each token should match a chord pattern
    const chordRegex = /^[A-G][#b]?(maj|min|dim|aug|sus|add|M|m)?\d{0,2}(\/[A-G][#b]?)?$/;
    const chordCount = tokens.filter(t => chordRegex.test(t)).length;
    
    // At least 60% of tokens are chords and at least one chord
    return chordCount > 0 && (chordCount / tokens.length) >= 0.5;
  },

  // Detect if content uses ChordPro format [Chord]
  isChordProFormat(content) {
    const lines = content.split('\n');
    let bracketChordCount = 0;
    for (const line of lines) {
      const matches = line.match(/\[[A-G][#b]?[^\]]*\]/g);
      if (matches) bracketChordCount += matches.length;
    }
    return bracketChordCount >= 3;
  },

  // Parse ChordPro format: [Am]This is [G]a line
  parseChordPro(content) {
    const lines = content.split('\n');
    const result = [];

    for (const line of lines) {
      const trimmed = line.trim();
      
      // Section header
      if (this.SECTION_PATTERN.test(trimmed)) {
        result.push({ type: 'section', text: trimmed });
        continue;
      }

      // Empty line
      if (!trimmed) {
        result.push({ type: 'empty' });
        continue;
      }

      // Check for ChordPro brackets
      if (/\[[A-G][#b]?[^\]]*\]/.test(line)) {
        const chordPositions = [];
        let lyric = '';
        let pos = 0;
        const regex = /\[([^\]]+)\]/g;
        let match;
        let lastIndex = 0;

        while ((match = regex.exec(line)) !== null) {
          const textBefore = line.slice(lastIndex, match.index);
          lyric += textBefore;
          chordPositions.push({ chord: match[1], position: lyric.length });
          lastIndex = match.index + match[0].length;
        }
        lyric += line.slice(lastIndex);

        result.push({ type: 'chord-lyric', chords: chordPositions, lyric });
      } else {
        // Plain text line
        result.push({ type: 'text', text: line });
      }
    }

    return result;
  },

  // Parse plain text format (chord lines above lyric lines)
  parsePlainText(content) {
    const lines = content.split('\n');
    const result = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // Section header
      if (this.SECTION_PATTERN.test(trimmed)) {
        result.push({ type: 'section', text: trimmed });
        i++;
        continue;
      }

      // Empty line
      if (!trimmed) {
        result.push({ type: 'empty' });
        i++;
        continue;
      }

      // Check if this is a chord line
      if (this.isChordLine(line)) {
        // Try to pair with next lyric line
        const chordLine = line;
        const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
        const nextIsSectionOrEmpty = !nextLine.trim() || this.SECTION_PATTERN.test(nextLine.trim());
        const nextIsChordLine = this.isChordLine(nextLine);

        if (nextIsChordLine || nextIsSectionOrEmpty || i + 1 >= lines.length) {
          // Chord-only line (no lyrics below)
          const chords = this.extractChordsWithPositions(chordLine);
          result.push({ type: 'chord-lyric', chords, lyric: '' });
          i++;
        } else {
          // Pair chord line with lyric line
          const chords = this.extractChordsWithPositions(chordLine);
          result.push({ type: 'chord-lyric', chords, lyric: nextLine });
          i += 2;
        }
      } else {
        // Plain text (lyric without chords, or other text)
        result.push({ type: 'text', text: line });
        i++;
      }
    }

    return result;
  },

  extractChordsWithPositions(chordLine) {
    const chords = [];
    const regex = /([A-G][#b]?(?:maj|min|dim|aug|sus|add|M|m)?\d*(?:\/[A-G][#b]?)?)/g;
    let match;
    while ((match = regex.exec(chordLine)) !== null) {
      chords.push({ chord: match[1], position: match.index });
    }
    return chords;
  },

  // ===== RENDER CHORD CONTENT =====
  renderChordContent(content) {
    this._currentContent = content;
    
    const isChordPro = this.isChordProFormat(content);
    const parsed = isChordPro ? this.parseChordPro(content) : this.parsePlainText(content);
    this._currentParsedLines = parsed;

    const wrapper = document.getElementById('chord-content-wrapper');
    let html = '';
    const uniqueChords = new Set();

    for (const item of parsed) {
      if (item.type === 'section') {
        html += `<div class="chord-section-header">${this.escapeHtml(item.text)}</div>\n`;
      } else if (item.type === 'empty') {
        html += `<div class="chord-empty-line"></div>\n`;
      } else if (item.type === 'chord-lyric') {
        // Build chord line
        const chords = item.chords || [];
        const lyric = item.lyric || '';

        // Collect unique chords
        chords.forEach(c => {
          const transposed = this.transposeChord(c.chord, this._transposeLevel);
          // Normalize: get base chord name for diagram lookup
          const baseMatch = transposed.match(/^([A-G][#b]?(?:maj|min|dim|aug|sus|add|M|m)?\d*)/);
          if (baseMatch) uniqueChords.add(baseMatch[1]);
        });

        // Build chord display line with proper positioning
        let chordHtml = this.buildChordLine(chords, lyric.length);
        let lyricHtml = this.escapeHtml(lyric);

        html += `<div class="chord-line-pair">`;
        if (chordHtml) {
          html += `<div class="chord-line">${chordHtml}</div>`;
        }
        if (lyric.trim()) {
          html += `<div class="lyric-line">${lyricHtml}</div>`;
        }
        html += `</div>\n`;
      } else if (item.type === 'text') {
        html += `<div class="lyric-line">${this.escapeHtml(item.text)}</div>\n`;
      }
    }

    wrapper.innerHTML = html;
    this.applyChordColor();

    // Render chord diagrams
    this.renderChordDiagrams([...uniqueChords]);
  },

  buildChordLine(chords, lyricLength) {
    if (chords.length === 0) return '';

    const maxPos = Math.max(lyricLength, ...chords.map(c => c.position + c.chord.length)) + 2;
    const buffer = new Array(maxPos).fill(' ');
    let resultParts = [];

    // Sort by position
    const sorted = [...chords].sort((a, b) => a.position - b.position);

    // Build the line character by character, inserting chord spans
    let outputHtml = '';
    let currentPos = 0;

    for (const c of sorted) {
      const transposed = this.transposeChord(c.chord, this._transposeLevel);
      // Add spaces before this chord
      if (c.position > currentPos) {
        const spaces = c.position - currentPos;
        outputHtml += ' '.repeat(spaces);
      }
      outputHtml += `<span class="chord-name" style="color:${this._chordColor}">${this.escapeHtml(transposed)}</span>`;
      currentPos = c.position + transposed.length;
    }

    return outputHtml;
  },

  // ===== CHORD DIAGRAMS (SVG) =====
  renderChordDiagrams(chordNames) {
    const container = document.getElementById('chord-diagrams-bar');
    if (!chordNames || chordNames.length === 0) {
      container.innerHTML = '';
      return;
    }

    let html = '';
    for (const name of chordNames) {
      const shape = this.getChordShape(name);
      if (shape) {
        html += `<div class="chord-diagram-box">
          <div class="chord-diagram-name">${this.escapeHtml(name)}</div>
          ${this.generateChordSVG(shape, name)}
        </div>`;
      } else {
        // No shape data - show name only
        html += `<div class="chord-diagram-box">
          <div class="chord-diagram-name">${this.escapeHtml(name)}</div>
          <div style="width:60px;height:70px;display:flex;align-items:center;justify-content:center;font-size:11px;color:#999;">N/A</div>
        </div>`;
      }
    }
    container.innerHTML = html;
  },

  getChordShape(name) {
    const SHAPES = this._instrument === 'ukulele' ? this.UKULELE_CHORD_SHAPES : this.CHORD_SHAPES;
    if (SHAPES[name]) return SHAPES[name];
    
    // Try simplifying: removing numbers/extensions, extract base root and suffix
    const baseMatch = name.match(/^([A-G][#b]?)(.*)$/);
    if (baseMatch) {
      const root = baseMatch[1];
      const suffix = baseMatch[2];
      
      // Determine if minor or major base
      const baseSuffix = (suffix.startsWith('m') && suffix !== 'maj' && suffix !== 'maj7') ? 'm' : '';

      // Try exact root with simplified suffix
      if (SHAPES[root + baseSuffix]) {
        return SHAPES[root + baseSuffix];
      }

      // Try enharmonic equivalent (e.g. A# -> Bb)
      const targetVal = this.NOTE_MAP[root];
      if (targetVal !== undefined) {
        for (const [note, val] of Object.entries(this.NOTE_MAP)) {
          if (val === targetVal && note !== root) {
            // Try exact suffix with new root
            if (SHAPES[note + suffix]) {
              return SHAPES[note + suffix];
            }
            // Try simplified suffix with new root
            if (SHAPES[note + baseSuffix]) {
              return SHAPES[note + baseSuffix];
            }
          }
        }
      }
    }
    
    return null;
  },

  generateChordSVG(shape, name) {
    const { frets, startFret } = shape;
    const numStrings = this._instrument === 'ukulele' ? 4 : 6;
    const numFrets = 4;
    const w = 60, h = 70;
    const padLeft = 12, padRight = 8, padTop = 10, padBottom = 4;
    const gridW = w - padLeft - padRight;
    const gridH = h - padTop - padBottom;
    const strSpacing = gridW / (numStrings - 1);
    const fretSpacing = gridH / numFrets;

    let svg = `<svg class="chord-diagram-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
    
    // Nut (thick bar at top) if starting at fret 1
    if (startFret <= 1) {
      svg += `<rect x="${padLeft}" y="${padTop}" width="${gridW}" height="3" fill="#e8e8f0" rx="1"/>`;
    } else {
      // Show fret number
      svg += `<text x="${padLeft - 4}" y="${padTop + fretSpacing/2 + 4}" font-size="8" fill="var(--text-secondary)" text-anchor="end" font-family="Inter, sans-serif" font-weight="700">${startFret}</text>`;
      svg += `<rect x="${padLeft}" y="${padTop}" width="${gridW}" height="1.5" fill="rgba(255,255,255,0.4)"/>`;
    }

    // Horizontal fret lines
    for (let i = 1; i <= numFrets; i++) {
      const y = padTop + i * fretSpacing;
      svg += `<line x1="${padLeft}" y1="${y}" x2="${padLeft + gridW}" y2="${y}" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>`;
    }

    // Vertical string lines
    for (let i = 0; i < numStrings; i++) {
      const x = padLeft + i * strSpacing;
      svg += `<line x1="${x}" y1="${padTop}" x2="${x}" y2="${padTop + gridH}" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>`;
    }

    // Finger dots & mute/open markers
    for (let i = 0; i < numStrings; i++) {
      const x = padLeft + i * strSpacing;
      const fret = frets[i];

      if (fret === -1) {
        // Muted X
        svg += `<text x="${x}" y="${padTop - 2}" font-size="8" fill="var(--danger, #ef4444)" text-anchor="middle" font-family="sans-serif" font-weight="700">×</text>`;
      } else if (fret === 0) {
        // Open circle
        svg += `<circle cx="${x}" cy="${padTop - 4}" r="3" fill="none" stroke="#e8e8f0" stroke-width="1.2"/>`;
      } else {
        // Filled dot at fret position
        const relFret = fret - (startFret > 1 ? startFret - 1 : 0);
        const y = padTop + (relFret - 0.5) * fretSpacing;
        svg += `<circle cx="${x}" cy="${y}" r="4" fill="var(--accent-primary, #8b5cf6)"/>`;
      }
    }

    svg += `</svg>`;
    return svg;
  },

  // ===== OPEN MATERIAL =====
  openMaterial(id) {
    const mat = this.materials.find(m => m.id === id);
    if (!mat || (!mat.url && !mat.content)) return;

    const overlay = document.getElementById('music-reader-overlay');
    const chordBody = document.getElementById('chord-reader-body');
    const iframeContent = document.getElementById('music-reader-content');
    const toolbar = document.getElementById('chord-toolbar');
    const diagramsBar = document.getElementById('chord-diagrams-bar');
    
    document.getElementById('music-reader-title').textContent = mat.title;
    const externalBtn = document.getElementById('music-reader-external');

    // Reset state
    this._transposeLevel = 0;
    this._scrollSpeed = 0;
    this.stopAutoScroll();
    document.getElementById('transpose-value').textContent = '0';
    this.updateSpeedButtons();

    if (mat.type === 'text') {
      // Show chord reader mode
      externalBtn.style.display = 'none';
      chordBody.classList.remove('hidden');
      iframeContent.classList.add('hidden');
      toolbar.classList.remove('hidden');
      diagramsBar.classList.remove('hidden');

      this.renderChordContent(mat.content);
    } else {
      // Show iframe mode (video/pdf/link)
      externalBtn.style.display = 'flex';
      externalBtn.href = mat.url;
      chordBody.classList.add('hidden');
      toolbar.classList.add('hidden');
      diagramsBar.classList.add('hidden');
      iframeContent.classList.remove('hidden');

      let iframeSrc = mat.url;

      // Convert youtube links to embed
      const ytMatch = mat.url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
      if (ytMatch && ytMatch[1]) {
        iframeSrc = `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1`;
      } 
      // Convert Google Drive view/edit to preview
      else if (mat.url.includes('drive.google.com') && mat.url.includes('/view')) {
        iframeSrc = mat.url.replace(/\/view.*$/, '/preview');
      }

      iframeContent.innerHTML = `
        <iframe 
          src="${iframeSrc}" 
          style="width: 100%; height: 100%; border: none; border-radius: 8px; background: white;"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowfullscreen>
        </iframe>
      `;
    }

    overlay.classList.remove('hidden');
  },

  // ===== HELPERS =====
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  // ===== LOAD / RENDER LIST =====
  async loadMusicList() {
    const listEl = document.getElementById('music-list');
    const emptyEl = document.getElementById('music-empty');

    try {
      this.materials = await window.appDB.getAllMusic();

      if (this.materials.length === 0) {
        listEl.innerHTML = '';
        emptyEl.classList.remove('hidden');
        return;
      }

      emptyEl.classList.add('hidden');

      const getTypeIcon = (type) => {
        switch(type) {
          case 'video': return 'smart_display';
          case 'pdf': return 'picture_as_pdf';
          case 'text': return 'description';
          default: return 'insert_drive_file';
        }
      };

      const getTypeLabel = (type) => {
        switch(type) {
          case 'video': return 'Video';
          case 'pdf': return 'PDF';
          case 'text': return 'Hợp âm';
          default: return 'Link';
        }
      };

      listEl.innerHTML = this.materials.map(mat => `
        <div class="card glass-card" style="padding: 16px; display: flex; flex-direction: column; gap: 8px;">
          <div style="display: flex; align-items: flex-start; justify-content: space-between;">
            <div style="display: flex; gap: 8px; align-items: center;">
              <span class="material-icons-round" style="color: var(--primary-color)">${getTypeIcon(mat.type)}</span>
              <h4 style="margin: 0; font-size: 16px; word-break: break-word;">${mat.title}</h4>
            </div>
            <button class="btn btn-sm btn-danger music-delete-btn" data-id="${mat.id}" style="padding: 4px; min-width: unset;">
              <span class="material-icons-round" style="font-size: 16px;">delete</span>
            </button>
          </div>
          
          <div style="display: flex; gap: 8px; align-items: center;">
            <span class="badge badge-secondary" style="font-size: 11px;">${getTypeLabel(mat.type)}</span>
            <span style="font-size: 12px; color: var(--text-secondary);">
              ${new Date(mat.addedAt).toLocaleDateString('vi-VN')}
            </span>
          </div>
          
          ${mat.note ? `<p style="font-size: 13px; opacity: 0.9; margin: 4px 0; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">${mat.note}</p>` : ''}
          
          <div style="margin-top: auto; padding-top: 10px;">
            ${(mat.url || mat.content) ? 
              `<button class="btn btn-secondary btn-sm music-open-btn" data-id="${mat.id}" style="width: 100%; justify-content: center;">
                <span class="material-icons-round" style="font-size: 16px;">${mat.type === 'text' ? 'music_note' : 'smart_display'}</span>
                ${mat.type === 'text' ? 'Mở Hợp âm' : 'Mở tài liệu'}
              </button>` 
              : '<span style="font-size: 12px; color: #888; font-style: italic;">Không có nội dung/đường dẫn</span>'
            }
          </div>
        </div>
      `).join('');

      // Bind events
      listEl.querySelectorAll('.music-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => this.deleteMusic(btn.dataset.id));
      });

      listEl.querySelectorAll('.music-open-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          this.openMaterial(btn.dataset.id);
        });
      });

    } catch (err) {
      console.error('Lỗi khi tải danh sách tài liệu', err);
    }
  },

  async deleteMusic(id) {
    const mat = this.materials.find(m => m.id === id);
    if (!mat) return;

    App.confirm(`Bạn có chắc muốn xóa tài liệu "${mat.title}"?`, async () => {
      try {
        await window.appDB.deleteMusic(id);
        App.showToast('Đã xóa tài liệu', 'info');
        await this.loadMusicList();
      } catch (err) {
        App.showToast('Lỗi khi xóa', 'error');
        console.error(err);
      }
    });
  }
};
