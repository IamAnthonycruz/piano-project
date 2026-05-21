import { useState, useRef, useEffect } from "react";

const MIN_BPM = 20;
const MAX_BPM = 280;
const MIN_BEATS = 2;
const MAX_BEATS = 12;

// Drift-compensated timer, ported from musicandcode/Metronome (timer.js).
// A naive setInterval accumulates timing error; here we track the time each
// tick was *expected* to fire and shorten the next timeout by the measured
// drift, so the metronome stays locked to the tempo over long sessions.
function createTimer(callback, interval) {
  let expected = 0;
  let timeout = null;

  const round = () => {
    const drift = Date.now() - expected;
    callback();
    expected += interval;
    timeout = setTimeout(round, Math.max(0, interval - drift));
  };

  return {
    start() {
      expected = Date.now() + interval;
      callback(); // fire the first beat immediately
      timeout = setTimeout(round, interval);
    },
    stop() {
      clearTimeout(timeout);
    },
  };
}

// Standard tempo markings — handy reference while practicing.
function tempoLabel(bpm) {
  if (bpm < 40) return "Grave";
  if (bpm < 60) return "Largo";
  if (bpm < 66) return "Larghetto";
  if (bpm < 76) return "Adagio";
  if (bpm < 108) return "Andante";
  if (bpm < 120) return "Moderato";
  if (bpm < 168) return "Allegro";
  if (bpm < 200) return "Presto";
  return "Prestissimo";
}

// Synthesize a short click with the Web Audio API. The accented downbeat gets a
// higher pitch and a touch more volume; the fast exponential gain fade keeps it
// sounding like a "tick" instead of a popping beep.
function playClick(audioCtx, isAccent) {
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = "square";
  osc.frequency.value = isAccent ? 1000 : 800;

  gain.gain.setValueAtTime(isAccent ? 0.5 : 0.3, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.05);
}

export default function Metronome() {
  const [bpm, setBpm] = useState(120);
  const [beatsPerMeasure, setBeatsPerMeasure] = useState(4);
  const [running, setRunning] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(-1);

  const audioCtxRef = useRef(null);
  const beatCountRef = useRef(0);
  // Keep the latest beats-per-measure readable inside the timer callback
  // without restarting the timer when it changes mid-play.
  const beatsRef = useRef(beatsPerMeasure);
  useEffect(() => {
    beatsRef.current = beatsPerMeasure;
  }, [beatsPerMeasure]);

  // (Re)start the scheduler whenever play state or tempo changes. Time signature
  // changes are picked up via beatsRef, so they don't force a restart.
  useEffect(() => {
    if (!running) return;

    beatCountRef.current = 0;
    const interval = (60 / bpm) * 1000; // ms per beat

    const timer = createTimer(() => {
      const beat = beatCountRef.current % beatsRef.current;
      setCurrentBeat(beat);
      if (audioCtxRef.current) playClick(audioCtxRef.current, beat === 0);
      beatCountRef.current += 1;
    }, interval);

    timer.start();
    return () => timer.stop();
  }, [running, bpm]);

  // Release the audio context when the component unmounts.
  useEffect(() => {
    return () => {
      if (audioCtxRef.current) audioCtxRef.current.close();
    };
  }, []);

  const toggle = () => {
    if (!running) {
      // The AudioContext must be created/resumed from a user gesture (browser
      // autoplay policy), so we do it here on the first Start press.
      if (!audioCtxRef.current) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        audioCtxRef.current = new Ctx();
      }
      if (audioCtxRef.current.state === "suspended") {
        audioCtxRef.current.resume();
      }
    }
    setRunning((r) => !r);
  };

  const clampBpm = (v) => Math.min(MAX_BPM, Math.max(MIN_BPM, v));

  const btnStyle = {
    width: 34,
    height: 34,
    fontSize: 18,
    color: "#e8e6e3",
    background: "#1a1a1f",
    border: "1px solid #1e1e24",
    borderRadius: 6,
    cursor: "pointer",
    fontFamily: "'IBM Plex Mono', monospace",
    lineHeight: 1,
  };

  const labelStyle = {
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: "#6b6a6f",
    fontFamily: "'IBM Plex Mono', monospace",
    fontWeight: 300,
  };

  return (
    <div
      style={{
        marginTop: 20,
        padding: "20px 24px",
        background: "#111114",
        border: "1px solid #1e1e24",
        borderRadius: 8,
        width: "min(460px, calc(100% - 32px))",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
        fontFamily: "'IBM Plex Mono', monospace",
      }}
    >
      <div style={labelStyle}>Metronome</div>

      {/* BPM display */}
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontFamily: "'DM Serif Display', serif",
            fontSize: 48,
            lineHeight: 1,
            color: "#e8e6e3",
          }}
        >
          {bpm}
          <span style={{ fontSize: 14, color: "#6b6a6f", marginLeft: 6 }}>
            BPM
          </span>
        </div>
        <div style={{ ...labelStyle, marginTop: 6, color: "#c44835" }}>
          {tempoLabel(bpm)}
        </div>
      </div>

      {/* Beat indicator dots */}
      <div style={{ display: "flex", gap: 8, minHeight: 14 }}>
        {Array.from({ length: beatsPerMeasure }).map((_, i) => {
          const on = running && currentBeat === i;
          const accent = i === 0;
          return (
            <div
              key={i}
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: on
                  ? accent
                    ? "#e05a45"
                    : "#c44835"
                  : "#1e1e24",
                border: accent ? "1px solid #c44835" : "1px solid #1e1e24",
                boxShadow: on ? "0 0 10px rgba(196,72,53,0.6)" : "none",
                transition: "background 0.05s, box-shadow 0.05s",
              }}
            />
          );
        })}
      </div>

      {/* BPM controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
        <button style={btnStyle} onClick={() => setBpm((b) => clampBpm(b - 1))}>
          −
        </button>
        <input
          type="range"
          min={MIN_BPM}
          max={MAX_BPM}
          value={bpm}
          onChange={(e) => setBpm(clampBpm(Number(e.target.value)))}
          style={{ flex: 1, accentColor: "#c44835", cursor: "pointer" }}
        />
        <button style={btnStyle} onClick={() => setBpm((b) => clampBpm(b + 1))}>
          +
        </button>
      </div>

      {/* Time signature + start/stop */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            style={btnStyle}
            onClick={() =>
              setBeatsPerMeasure((n) => Math.max(MIN_BEATS, n - 1))
            }
          >
            −
          </button>
          <div style={{ textAlign: "center", minWidth: 54 }}>
            <div style={{ fontSize: 18, color: "#e8e6e3" }}>
              {beatsPerMeasure}/4
            </div>
            <div style={labelStyle}>Meter</div>
          </div>
          <button
            style={btnStyle}
            onClick={() =>
              setBeatsPerMeasure((n) => Math.min(MAX_BEATS, n + 1))
            }
          >
            +
          </button>
        </div>

        <button
          onClick={toggle}
          style={{
            padding: "10px 28px",
            fontSize: 12,
            letterSpacing: 2,
            textTransform: "uppercase",
            fontWeight: 400,
            color: running ? "#e8e6e3" : "#08080a",
            background: running ? "transparent" : "#c44835",
            border: `1px solid #c44835`,
            borderRadius: 6,
            cursor: "pointer",
            fontFamily: "'IBM Plex Mono', monospace",
            transition: "background 0.2s, color 0.2s",
          }}
        >
          {running ? "Stop" : "Start"}
        </button>
      </div>
    </div>
  );
}
