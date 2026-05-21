import { useState, useEffect, useRef, useCallback } from "react";

// ── Audio engine (lives outside React) ──────────────────────────
class MetronomeEngine {
  constructor() {
    this.audioCtx = null;
    this.bpm = 60;
    this.isPlaying = false;
    this.currentBeat = 0;
    this.nextBeatTime = 0;
    this.lookahead = 25;
    this.scheduleAheadTime = 0.1;
    this.timerID = null;
    this.onBeat = null;
    this.beatTimes = [];
    this.syncOffset = 0;
    this.startPerfTime = 0;
    this.syncInterval = null;
  }

  init() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.audioCtx.state === "suspended") this.audioCtx.resume();
  }

  // Recalculate the offset between performance.now() and audioCtx.currentTime
  // to prevent drift over long sessions
  recalcSync() {
    if (!this.audioCtx) return;
    this.syncOffset = performance.now() - this.audioCtx.currentTime * 1000;
  }

  scheduleBeat(beatIndex, time) {
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    osc.connect(gain);
    gain.connect(this.audioCtx.destination);

    if (beatIndex === 0) {
      osc.frequency.value = 1000;
      gain.gain.value = 0.5;
    } else {
      osc.frequency.value = 700;
      gain.gain.value = 0.25;
    }

    osc.start(time);
    osc.stop(time + 0.03);

    const perfTime = this.syncOffset + time * 1000;
    this.beatTimes.push({ beat: beatIndex, time: perfTime, audioTime: time });
    if (this.beatTimes.length > 16) this.beatTimes = this.beatTimes.slice(-16);
  }

  scheduler() {
    while (
      this.nextBeatTime <
      this.audioCtx.currentTime + this.scheduleAheadTime
    ) {
      this.scheduleBeat(this.currentBeat, this.nextBeatTime);

      const perfTime = this.syncOffset + this.nextBeatTime * 1000;
      const beat = this.currentBeat;

      const delay = Math.max(0, perfTime - performance.now());
      setTimeout(() => {
        if (this.onBeat) this.onBeat(beat, perfTime);
      }, delay);

      const secondsPerBeat = 60.0 / this.bpm;
      this.nextBeatTime += secondsPerBeat;
      this.currentBeat = (this.currentBeat + 1) % 4;
    }
    this.timerID = setTimeout(() => this.scheduler(), this.lookahead);
  }

  start() {
    this.init();
    this.recalcSync();
    this.currentBeat = 0;
    this.nextBeatTime = this.audioCtx.currentTime + 0.05;
    this.startPerfTime = this.syncOffset + this.nextBeatTime * 1000;
    this.beatTimes = [];
    this.isPlaying = true;
    this.scheduler();
    // Re-sync clocks every 10 seconds to prevent drift
    this.syncInterval = setInterval(() => this.recalcSync(), 10000);
  }

  stop() {
    this.isPlaying = false;
    if (this.timerID) clearTimeout(this.timerID);
    if (this.syncInterval) clearInterval(this.syncInterval);
    this.timerID = null;
    this.syncInterval = null;
    this.beatTimes = [];
    this.startPerfTime = 0;
  }

  getNearestBeat(hitTime) {
    if (!this.isPlaying || !this.startPerfTime) return null;
    const msPerBeat = 60000 / this.bpm;
    const elapsed = hitTime - this.startPerfTime;
    const beatIndex = Math.round(elapsed / msPerBeat);
    const nearestBeatTime = this.startPerfTime + beatIndex * msPerBeat;
    const offset = hitTime - nearestBeatTime;
    const beat = ((beatIndex % 4) + 4) % 4;
    return { beat, time: nearestBeatTime, offset };
  }
}

// ── MIDI manager ────────────────────────────────────────────────
class MIDIManager {
  constructor() {
    this.access = null;
    this.selectedInput = null;
    this.onNoteOn = null;
    this.status = "disconnected";
    this.inputs = [];
    this.lastHitTime = 0;
    this.onStatusChange = null;
  }

  async init() {
    if (!navigator.requestMIDIAccess) {
      this.status = "unsupported";
      return;
    }
    try {
      this.access = await navigator.requestMIDIAccess();
      this.refreshInputs();
      this.access.onstatechange = () => {
        this.refreshInputs();
        if (this.onStatusChange) this.onStatusChange();
      };
    } catch {
      this.status = "error";
    }
  }

  refreshInputs() {
    this.inputs = [];
    if (!this.access) return;
    for (const input of this.access.inputs.values()) {
      this.inputs.push(input);
    }
    if (this.inputs.length > 0 && !this.selectedInput) {
      this.selectInput(this.inputs[0].id);
    }
    if (this.inputs.length === 0) {
      this.status = "disconnected";
      this.selectedInput = null;
    }
  }

  selectInput(id) {
    if (this.selectedInput) this.selectedInput.onmidimessage = null;
    const input = this.inputs.find((i) => i.id === id);
    if (!input) return;
    this.selectedInput = input;
    this.status = "connected";
    input.onmidimessage = (e) => this.handleMessage(e);
  }

  handleMessage(event) {
    const [status, note, velocity] = event.data;
    if ((status & 0xf0) === 0x90 && velocity > 0) {
      // Use the hardware-provided timestamp, NOT performance.now().
      // event.timeStamp is a DOMHighResTimeStamp from the MIDI driver
      // representing when the hardware actually received the event,
      // not when the JS callback happened to fire.
      const hitTime = event.timeStamp;

      // Debounce: ignore hits within 30ms (same clock domain)
      if (hitTime - this.lastHitTime < 30) return;
      this.lastHitTime = hitTime;

      if (this.onNoteOn) this.onNoteOn(hitTime, note, velocity);
    }
  }
}

// ── Singletons ──────────────────────────────────────────────────
const engine = new MetronomeEngine();
const midi = new MIDIManager();

// ── Helpers ─────────────────────────────────────────────────────
const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];
function noteName(n) {
  return `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
}

// ── React app ───────────────────────────────────────────────────
export default function SmartMetronome() {
  const [bpm, setBpm] = useState(80);
  const [playing, setPlaying] = useState(false);
  const [activeBeat, setActiveBeat] = useState(-1);
  const [midiStatus, setMidiStatus] = useState("disconnected");
  const [midiInputs, setMidiInputs] = useState([]);
  const [tolerance, setTolerance] = useState(25);
  const [lastOffset, setLastOffset] = useState(null);
  const [lastClass, setLastClass] = useState(null);
  const [lastNote, setLastNote] = useState(null);
  const [flash, setFlash] = useState(null); // "good" | "off"
  const [stats, setStats] = useState({
    total: 0,
    onTime: 0,
    avgOffset: 0,
    streak: 0,
    best: 0,
  });
  const [hits, setHits] = useState([]);
  const tapTimesRef = useRef([]);
  const statsRef = useRef({
    total: 0,
    onTime: 0,
    sumOffset: 0,
    streak: 0,
    best: 0,
  });

  // Init MIDI
  useEffect(() => {
    midi.onStatusChange = () => {
      setMidiStatus(midi.status);
      setMidiInputs([...midi.inputs]);
    };
    midi.init().then(() => {
      setMidiStatus(midi.status);
      setMidiInputs([...midi.inputs]);
    });
  }, []);

  // Wire beat callback
  useEffect(() => {
    engine.onBeat = (beat) => setActiveBeat(beat);
  }, []);

  // Wire MIDI hit callback
  useEffect(() => {
    midi.onNoteOn = (hitTime, note, velocity) => {
      if (!engine.isPlaying) return;
      const result = engine.getNearestBeat(hitTime);
      if (!result) return;

      const offset = result.offset;
      let cls = "ontime";
      if (offset < -tolerance) cls = "early";
      else if (offset > tolerance) cls = "late";

      const s = statsRef.current;
      s.total++;
      s.sumOffset += offset;
      if (cls === "ontime") {
        s.onTime++;
        s.streak++;
        if (s.streak > s.best) s.best = s.streak;
      } else {
        s.streak = 0;
      }

      setLastOffset(Math.round(offset));
      setLastClass(cls);
      setLastNote(noteName(note));
      setFlash(cls === "ontime" ? "good" : "off");
      setTimeout(() => setFlash(null), 150);

      setStats({
        total: s.total,
        onTime: s.onTime,
        avgOffset: Math.round(s.sumOffset / s.total),
        streak: s.streak,
        best: s.best,
      });
      setHits((prev) => [
        ...prev.slice(-39),
        { offset: Math.round(offset), cls },
      ]);
    };
  }, [tolerance]);

  const togglePlay = useCallback(() => {
    if (playing) {
      engine.stop();
      setPlaying(false);
      setActiveBeat(-1);
    } else {
      engine.bpm = bpm;
      engine.start();
      setPlaying(true);
    }
  }, [playing, bpm]);

  const handleBpmChange = (val) => {
    const v = Math.max(20, Math.min(300, val));
    setBpm(v);
    engine.bpm = v;
  };

  const handleTap = () => {
    const now = performance.now();
    const taps = tapTimesRef.current;
    if (taps.length > 0 && now - taps[taps.length - 1] > 2000) {
      tapTimesRef.current = [];
    }
    tapTimesRef.current.push(now);
    if (tapTimesRef.current.length > 6)
      tapTimesRef.current = tapTimesRef.current.slice(-6);
    if (tapTimesRef.current.length >= 2) {
      const intervals = [];
      for (let i = 1; i < tapTimesRef.current.length; i++) {
        intervals.push(tapTimesRef.current[i] - tapTimesRef.current[i - 1]);
      }
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      handleBpmChange(Math.round(60000 / avg));
    }
  };

  const resetSession = () => {
    statsRef.current = {
      total: 0,
      onTime: 0,
      sumOffset: 0,
      streak: 0,
      best: 0,
    };
    setStats({ total: 0, onTime: 0, avgOffset: 0, streak: 0, best: 0 });
    setHits([]);
    setLastOffset(null);
    setLastClass(null);
    setLastNote(null);
  };

  const accuracy =
    stats.total > 0 ? ((stats.onTime / stats.total) * 100).toFixed(0) : "—";
  const gaugePos =
    lastOffset !== null ? Math.max(-1, Math.min(1, lastOffset / 60)) : 0;

  return (
    <div style={S.root}>
      {/* Subtle flash overlay */}
      {flash && (
        <div
          style={{
            ...S.flashOverlay,
            backgroundColor:
              flash === "good"
                ? "rgba(74,222,128,0.06)"
                : "rgba(251,191,36,0.06)",
          }}
        />
      )}

      {/* Header */}
      <div style={S.header}>
        <div style={S.titleRow}>
          <span style={S.logo}>⏱</span>
          <span style={S.title}>Smart Metronome</span>
        </div>
        <div style={S.midiRow}>
          <div
            style={{
              ...S.midiDot,
              backgroundColor:
                midiStatus === "connected"
                  ? "#4ade80"
                  : midiStatus === "unsupported"
                    ? "#f87171"
                    : "#525252",
              boxShadow:
                midiStatus === "connected" ? "0 0 8px #4ade80" : "none",
            }}
          />
          <span
            style={{
              ...S.midiLabel,
              color: midiStatus === "connected" ? "#4ade80" : "#737373",
            }}
          >
            {midiStatus === "connected"
              ? midi.selectedInput?.name || "MIDI Connected"
              : midiStatus === "unsupported"
                ? "MIDI Not Supported"
                : "No MIDI Device"}
          </span>
        </div>
      </div>

      {/* BPM Control */}
      <div style={S.tempoSection}>
        <button style={S.tempoBtn} onClick={() => handleBpmChange(bpm - 5)}>
          −5
        </button>
        <button
          style={S.tempoBtnSmall}
          onClick={() => handleBpmChange(bpm - 1)}
        >
          −
        </button>
        <div style={S.bpmDisplay}>
          <input
            type="number"
            value={bpm}
            onChange={(e) => handleBpmChange(parseInt(e.target.value) || 80)}
            style={S.bpmInput}
          />
          <span style={S.bpmUnit}>BPM</span>
        </div>
        <button
          style={S.tempoBtnSmall}
          onClick={() => handleBpmChange(bpm + 1)}
        >
          +
        </button>
        <button style={S.tempoBtn} onClick={() => handleBpmChange(bpm + 5)}>
          +5
        </button>
      </div>

      {/* Tap tempo */}
      <button style={S.tapBtn} onClick={handleTap}>
        TAP TEMPO
      </button>

      {/* Beat dots */}
      <div style={S.beatRow}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              ...S.beatDot,
              ...(activeBeat === i
                ? {
                    backgroundColor: i === 0 ? "#f87171" : "#e2e8f0",
                    transform: "scale(1.2)",
                    boxShadow: `0 0 20px ${i === 0 ? "#f87171" : "#e2e8f0"}`,
                  }
                : {}),
            }}
          >
            <span
              style={{
                ...S.beatNum,
                color:
                  activeBeat === i
                    ? i === 0
                      ? "#1c1917"
                      : "#1c1917"
                    : "#525252",
              }}
            >
              {i + 1}
            </span>
          </div>
        ))}
      </div>

      {/* Play/Stop */}
      <button
        style={{ ...S.playBtn, ...(playing ? S.playBtnStop : {}) }}
        onClick={togglePlay}
      >
        {playing ? "■  Stop" : "▶  Play"}
      </button>

      {/* Timing gauge */}
      <div style={S.gaugeSection}>
        <div style={S.gaugeLabelRow}>
          <span style={S.gaugeSideLabel}>Early</span>
          <span style={S.gaugeCenterLabel}>
            {lastNote && lastOffset !== null
              ? `${lastNote}  ${lastOffset > 0 ? "+" : ""}${lastOffset}ms`
              : "Play a note…"}
          </span>
          <span style={S.gaugeSideLabel}>Late</span>
        </div>
        <div style={S.gaugeTrack}>
          {/* Tolerance zone */}
          <div
            style={{
              ...S.toleranceZone,
              left: `${50 - (tolerance / 60) * 50}%`,
              width: `${(tolerance / 60) * 100}%`,
            }}
          />
          {/* Center tick */}
          <div style={S.gaugeTick} />
          {/* Needle */}
          {lastOffset !== null && (
            <div
              style={{
                ...S.gaugeNeedle,
                left: `${50 + gaugePos * 50}%`,
                backgroundColor: lastClass === "ontime" ? "#4ade80" : "#fbbf24",
                boxShadow: `0 0 12px ${lastClass === "ontime" ? "#4ade80" : "#fbbf24"}`,
              }}
            />
          )}
        </div>
        <div
          style={{
            ...S.verdictText,
            color:
              lastClass === "ontime"
                ? "#4ade80"
                : lastClass
                  ? "#fbbf24"
                  : "#525252",
          }}
        >
          {lastClass === "ontime"
            ? "✓ On Time"
            : lastClass === "early"
              ? "← Early"
              : lastClass === "late"
                ? "→ Late"
                : ""}
        </div>
      </div>

      {/* Hit history */}
      {hits.length > 0 && (
        <div style={S.historySection}>
          <span style={S.sectionLabel}>History</span>
          <div style={S.historyStrip}>
            {hits.map((h, i) => (
              <div
                key={i}
                style={{
                  ...S.historyBar,
                  height: `${Math.min(100, (Math.abs(h.offset) / 50) * 100)}%`,
                  backgroundColor: h.cls === "ontime" ? "#4ade80" : "#fbbf24",
                  opacity: 0.35 + (i / hits.length) * 0.65,
                  alignSelf: h.offset >= 0 ? "flex-start" : "flex-end",
                }}
                title={`${h.offset > 0 ? "+" : ""}${h.offset}ms`}
              />
            ))}
          </div>
          <div style={S.historyAxis}>
            <span style={{ fontSize: 9, color: "#525252" }}>Late ↑</span>
            <span style={{ fontSize: 9, color: "#525252" }}>↓ Early</span>
          </div>
        </div>
      )}

      {/* Stats */}
      <div style={S.statsRow}>
        <Stat
          label="Accuracy"
          value={accuracy === "—" ? "—" : `${accuracy}%`}
        />
        <Stat
          label="Avg Offset"
          value={
            stats.total > 0
              ? `${stats.avgOffset > 0 ? "+" : ""}${stats.avgOffset}ms`
              : "—"
          }
        />
        <Stat label="Streak" value={stats.streak} accent />
        <Stat label="Best" value={stats.best} />
      </div>

      {/* Tolerance slider */}
      <div style={S.toleranceRow}>
        <span style={S.toleranceLabel}>Tolerance</span>
        <input
          type="range"
          min={5}
          max={50}
          value={tolerance}
          onChange={(e) => setTolerance(parseInt(e.target.value))}
          style={S.slider}
        />
        <span style={S.toleranceValue}>±{tolerance}ms</span>
      </div>

      {/* Reset */}
      <button style={S.resetBtn} onClick={resetSession}>
        Reset Session
      </button>

      {/* Footer note */}
      <div style={S.footer}>
        Uses Web MIDI hardware timestamps for accurate hit detection
      </div>
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div style={S.statBox}>
      <div style={{ ...S.statValue, ...(accent ? { color: "#4ade80" } : {}) }}>
        {value}
      </div>
      <div style={S.statLabel}>{label}</div>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────
const S = {
  root: {
    position: "relative",
    maxWidth: 480,
    margin: "0 auto",
    padding: "28px 24px 20px",
    fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
    backgroundColor: "#0c0a09",
    color: "#e7e5e4",
    minHeight: "100vh",
    boxSizing: "border-box",
    overflow: "hidden",
  },
  flashOverlay: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    transition: "background-color 0.15s",
    zIndex: 0,
  },
  header: {
    marginBottom: 28,
    position: "relative",
    zIndex: 1,
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 6,
  },
  logo: { fontSize: 22 },
  title: {
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: "#a8a29e",
  },
  midiRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginLeft: 32,
  },
  midiDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  midiLabel: {
    fontSize: 11,
    letterSpacing: 0.5,
    fontFamily: "inherit",
  },

  // Tempo
  tempoSection: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 12,
    position: "relative",
    zIndex: 1,
  },
  tempoBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    border: "1px solid #292524",
    backgroundColor: "#1c1917",
    color: "#a8a29e",
    fontSize: 14,
    fontFamily: "inherit",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  tempoBtnSmall: {
    width: 36,
    height: 36,
    borderRadius: 8,
    border: "1px solid #292524",
    backgroundColor: "#1c1917",
    color: "#78716c",
    fontSize: 16,
    fontFamily: "inherit",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  bpmDisplay: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    minWidth: 100,
  },
  bpmInput: {
    width: 90,
    textAlign: "center",
    fontSize: 48,
    fontWeight: 200,
    fontFamily: "inherit",
    color: "#e7e5e4",
    backgroundColor: "transparent",
    border: "none",
    outline: "none",
    lineHeight: 1,
    MozAppearance: "textfield",
  },
  bpmUnit: {
    fontSize: 10,
    color: "#78716c",
    letterSpacing: 3,
    textTransform: "uppercase",
    marginTop: -2,
  },
  tapBtn: {
    display: "block",
    margin: "0 auto 24px",
    padding: "8px 28px",
    borderRadius: 20,
    border: "1px solid #292524",
    backgroundColor: "#1c1917",
    color: "#a8a29e",
    fontSize: 11,
    fontFamily: "inherit",
    letterSpacing: 2,
    textTransform: "uppercase",
    cursor: "pointer",
    position: "relative",
    zIndex: 1,
  },

  // Beats
  beatRow: {
    display: "flex",
    justifyContent: "center",
    gap: 16,
    marginBottom: 24,
    position: "relative",
    zIndex: 1,
  },
  beatDot: {
    width: 52,
    height: 52,
    borderRadius: "50%",
    backgroundColor: "#1c1917",
    border: "1px solid #292524",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.08s ease-out",
  },
  beatNum: {
    fontSize: 16,
    fontWeight: 600,
    fontFamily: "inherit",
  },

  // Play
  playBtn: {
    display: "block",
    width: "100%",
    padding: "16px 0",
    borderRadius: 14,
    border: "1px solid #292524",
    backgroundColor: "#1c1917",
    color: "#e7e5e4",
    fontSize: 15,
    fontFamily: "inherit",
    fontWeight: 600,
    letterSpacing: 3,
    cursor: "pointer",
    marginBottom: 28,
    position: "relative",
    zIndex: 1,
    transition: "all 0.15s",
  },
  playBtnStop: {
    backgroundColor: "#1c1917",
    borderColor: "#f87171",
    color: "#f87171",
  },

  // Gauge
  gaugeSection: {
    marginBottom: 24,
    position: "relative",
    zIndex: 1,
  },
  gaugeLabelRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 8,
  },
  gaugeSideLabel: {
    fontSize: 10,
    color: "#525252",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  gaugeCenterLabel: {
    fontSize: 13,
    color: "#a8a29e",
    fontFamily: "inherit",
  },
  gaugeTrack: {
    position: "relative",
    height: 28,
    backgroundColor: "#1c1917",
    borderRadius: 14,
    border: "1px solid #292524",
    overflow: "hidden",
  },
  toleranceZone: {
    position: "absolute",
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(74,222,128,0.06)",
    borderRadius: 14,
  },
  gaugeTick: {
    position: "absolute",
    left: "50%",
    top: 4,
    bottom: 4,
    width: 1,
    backgroundColor: "#525252",
    transform: "translateX(-50%)",
  },
  gaugeNeedle: {
    position: "absolute",
    top: 4,
    bottom: 4,
    width: 6,
    borderRadius: 3,
    transform: "translateX(-50%)",
    transition: "left 0.08s ease-out",
  },
  verdictText: {
    textAlign: "center",
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: 1,
    marginTop: 6,
    height: 16,
    fontFamily: "inherit",
  },

  // History
  historySection: {
    marginBottom: 24,
    position: "relative",
    zIndex: 1,
  },
  sectionLabel: {
    fontSize: 10,
    color: "#525252",
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: 6,
    display: "block",
  },
  historyStrip: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    height: 40,
    backgroundColor: "#1c1917",
    borderRadius: 8,
    padding: "0 6px",
    border: "1px solid #292524",
  },
  historyBar: {
    flex: 1,
    minWidth: 3,
    borderRadius: 2,
    transition: "height 0.15s",
  },
  historyAxis: {
    display: "flex",
    justifyContent: "space-between",
    marginTop: 2,
    padding: "0 6px",
  },

  // Stats
  statsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 8,
    marginBottom: 24,
    position: "relative",
    zIndex: 1,
  },
  statBox: {
    backgroundColor: "#1c1917",
    border: "1px solid #292524",
    borderRadius: 10,
    padding: "12px 8px 10px",
    textAlign: "center",
  },
  statValue: {
    fontSize: 20,
    fontWeight: 300,
    color: "#e7e5e4",
    fontFamily: "inherit",
    lineHeight: 1.2,
  },
  statLabel: {
    fontSize: 9,
    color: "#525252",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginTop: 4,
    fontFamily: "inherit",
  },

  // Tolerance
  toleranceRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
    position: "relative",
    zIndex: 1,
  },
  toleranceLabel: {
    fontSize: 10,
    color: "#525252",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    flexShrink: 0,
  },
  slider: {
    flex: 1,
    accentColor: "#4ade80",
    height: 4,
  },
  toleranceValue: {
    fontSize: 12,
    color: "#a8a29e",
    fontFamily: "inherit",
    minWidth: 50,
    textAlign: "right",
  },

  // Reset
  resetBtn: {
    display: "block",
    width: "100%",
    padding: "10px 0",
    borderRadius: 10,
    border: "1px solid #292524",
    backgroundColor: "transparent",
    color: "#78716c",
    fontSize: 11,
    fontFamily: "inherit",
    letterSpacing: 2,
    textTransform: "uppercase",
    cursor: "pointer",
    marginBottom: 20,
    position: "relative",
    zIndex: 1,
  },

  // Footer
  footer: {
    textAlign: "center",
    fontSize: 10,
    color: "#3f3f46",
    letterSpacing: 0.5,
    position: "relative",
    zIndex: 1,
  },
};
