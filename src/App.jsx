import { useState, useEffect, useRef, useCallback } from "react";

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
const FIRST_MIDI = 21;
const LAST_MIDI = 108;
const BLACK_INDICES = new Set([1, 3, 6, 8, 10]);

function noteName(midi) {
  return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}
function isBlack(midi) {
  return BLACK_INDICES.has(midi % 12);
}

// Pre-compute keyboard layout
const KEYS = [];
const WHITE_KEYS = [];
let wIdx = 0;
for (let m = FIRST_MIDI; m <= LAST_MIDI; m++) {
  if (!isBlack(m)) {
    KEYS.push({ midi: m, black: false, whiteIndex: wIdx });
    WHITE_KEYS.push({ midi: m, whiteIndex: wIdx });
    wIdx++;
  } else {
    KEYS.push({ midi: m, black: true });
  }
}
const TOTAL_WHITE = wIdx;

// Black key positions: find preceding white key index
const BLACK_KEYS = KEYS.filter((k) => k.black).map((k) => {
  const prevWhite = WHITE_KEYS.find((w) => w.midi === k.midi - 1);
  const nextWhite = WHITE_KEYS.find((w) => w.midi === k.midi + 1);
  const pwi = prevWhite
    ? prevWhite.whiteIndex
    : nextWhite
      ? nextWhite.whiteIndex - 1
      : 0;
  return { ...k, leftIndex: pwi };
});

export default function MidiPiano() {
  const [activeNotes, setActiveNotes] = useState(new Map());
  const [status, setStatus] = useState("initializing");
  const [deviceName, setDeviceName] = useState("");
  const [showLabels, setShowLabels] = useState(false);
  const [lastVelocity, setLastVelocity] = useState(0);
  const activeRef = useRef(new Map());
  const scrollRef = useRef(null);

  const handleNoteOn = useCallback((midi, velocity) => {
    activeRef.current = new Map(activeRef.current).set(midi, velocity);
    setActiveNotes(new Map(activeRef.current));
    setLastVelocity(velocity);
  }, []);

  const handleNoteOff = useCallback((midi) => {
    const next = new Map(activeRef.current);
    next.delete(midi);
    activeRef.current = next;
    setActiveNotes(new Map(next));
    if (next.size === 0) setLastVelocity(0);
  }, []);

  // MIDI setup
  useEffect(() => {
    if (!navigator.requestMIDIAccess) {
      setStatus("unsupported");
      return;
    }

    navigator
      .requestMIDIAccess({ sysex: false })
      .then((access) => {
        const connectInputs = () => {
          let found = false;
          access.inputs.forEach((input) => {
            input.onmidimessage = (event) => {
              const [st, note, vel] = event.data;
              const cmd = st & 0xf0;
              if (cmd === 0x90 && vel > 0) handleNoteOn(note, vel);
              else if (cmd === 0x80 || (cmd === 0x90 && vel === 0))
                handleNoteOff(note);
            };
            found = true;
            setDeviceName(input.name || "Unknown device");
          });
          setStatus(found ? "connected" : "waiting");
          if (!found) setDeviceName("");
        };

        connectInputs();
        access.onstatechange = connectInputs;
      })
      .catch(() => setStatus("error"));
  }, [handleNoteOn, handleNoteOff]);

  // Scroll to middle on mount
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
    }
  }, []);

  const activeArr = [...activeNotes.entries()];
  const lastNote =
    activeArr.length > 0 ? activeArr[activeArr.length - 1] : null;

  const WK = 26;
  const BK_W = 16;
  const WK_H = 200;
  const BK_H = 125;
  const totalW = TOTAL_WHITE * WK;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#08080a",
        color: "#e8e6e3",
        fontFamily: "'Courier New', monospace",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=IBM+Plex+Mono:wght@300;400;500&display=swap');

        @keyframes pulser {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        @keyframes pillPop {
          from { transform: scale(0.7); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      `}</style>

      {/* Header */}
      <div
        style={{
          width: "100%",
          padding: "24px 32px 0",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          fontFamily: "'IBM Plex Mono', monospace",
        }}
      >
        <div
          style={{
            fontFamily: "'DM Serif Display', serif",
            fontSize: 26,
            letterSpacing: -0.5,
          }}
        >
          midi<span style={{ color: "#c44835" }}>.</span>keys
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              justifyContent: "flex-end",
              fontSize: 10,
              letterSpacing: 1.8,
              textTransform: "uppercase",
              color: "#6b6a6f",
              fontFamily: "'IBM Plex Mono', monospace",
              fontWeight: 300,
            }}
          >
            <span>
              {status === "connected"
                ? "Connected"
                : status === "waiting"
                  ? "No device found"
                  : status === "unsupported"
                    ? "Not supported"
                    : status === "error"
                      ? "MIDI error"
                      : "Initializing"}
            </span>
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background:
                  status === "connected"
                    ? "#34d399"
                    : status === "waiting"
                      ? "#fbbf24"
                      : "#444",
                boxShadow:
                  status === "connected"
                    ? "0 0 8px rgba(52,211,153,0.5)"
                    : status === "waiting"
                      ? "0 0 6px rgba(251,191,36,0.3)"
                      : "none",
                animation:
                  status === "waiting"
                    ? "pulser 1.5s ease-in-out infinite"
                    : "none",
              }}
            />
          </div>
          {deviceName && (
            <div
              style={{
                fontSize: 10,
                color: "#555",
                marginTop: 4,
                fontFamily: "'IBM Plex Mono', monospace",
                fontWeight: 300,
              }}
            >
              {deviceName}
            </div>
          )}
        </div>
      </div>

      {/* Current note display */}
      <div style={{ marginTop: 28, textAlign: "center", minHeight: 90 }}>
        <div
          style={{
            fontFamily: "'DM Serif Display', serif",
            fontSize: 60,
            lineHeight: 1,
            color: lastNote ? "#c44835" : "#e8e6e3",
            textShadow: lastNote ? "0 0 30px rgba(196,72,53,0.35)" : "none",
            transition: "color 0.08s, text-shadow 0.08s",
          }}
        >
          {lastNote ? noteName(lastNote[0]) : "—"}
        </div>
        <div
          style={{
            fontSize: 10,
            color: "#6b6a6f",
            letterSpacing: 2,
            textTransform: "uppercase",
            marginTop: 6,
            fontFamily: "'IBM Plex Mono', monospace",
            fontWeight: 300,
          }}
        >
          {lastNote
            ? `MIDI ${lastNote[0]} · Vel ${lastNote[1]} · ${activeNotes.size} note${activeNotes.size > 1 ? "s" : ""}`
            : "Waiting for input"}
        </div>
      </div>

      {/* Active notes pills */}
      <div
        style={{
          marginTop: 12,
          display: "flex",
          gap: 5,
          flexWrap: "wrap",
          justifyContent: "center",
          minHeight: 22,
          padding: "0 20px",
        }}
      >
        {activeArr.map(([midi]) => (
          <span
            key={midi}
            style={{
              padding: "3px 10px",
              background: "rgba(196,72,53,0.1)",
              border: "1px solid rgba(196,72,53,0.25)",
              borderRadius: 20,
              fontSize: 10,
              color: "#c44835",
              letterSpacing: 0.5,
              fontFamily: "'IBM Plex Mono', monospace",
              fontWeight: 400,
              animation: "pillPop 0.1s ease-out",
            }}
          >
            {noteName(midi)}
          </span>
        ))}
      </div>

      {/* Piano */}
      <div
        ref={scrollRef}
        style={{
          marginTop: 24,
          width: "100%",
          overflowX: "auto",
          overflowY: "hidden",
          padding: "0 16px 32px",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            position: "relative",
            width: totalW,
            height: WK_H + 10,
            flexShrink: 0,
            background: "#111114",
            borderRadius: "0 0 6px 6px",
            paddingTop: 8,
            boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
          }}
        >
          {/* White keys */}
          {WHITE_KEYS.map(({ midi, whiteIndex }) => {
            const isActive = activeNotes.has(midi);
            const isC = midi % 12 === 0;
            return (
              <div
                key={midi}
                onMouseDown={() => handleNoteOn(midi, 100)}
                onMouseUp={() => handleNoteOff(midi)}
                onMouseLeave={() => handleNoteOff(midi)}
                style={{
                  position: "absolute",
                  left: whiteIndex * WK,
                  top: 8,
                  width: WK - 1,
                  height: WK_H,
                  background: isActive ? "#c44835" : "#f0ede8",
                  border: `1px solid ${isActive ? "#c44835" : "#d0cbc3"}`,
                  borderTop: "none",
                  borderRadius: "0 0 4px 4px",
                  cursor: "pointer",
                  zIndex: 1,
                  transition: "background 0.05s",
                  boxShadow: isActive
                    ? "0 0 18px rgba(196,72,53,0.35)"
                    : "none",
                }}
              >
                {(showLabels || isC || isActive) && (
                  <span
                    style={{
                      position: "absolute",
                      bottom: 7,
                      left: "50%",
                      transform: "translateX(-50%)",
                      fontSize: 7,
                      color: isActive ? "#fff" : "#aaa",
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontWeight: 300,
                      pointerEvents: "none",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {noteName(midi)}
                  </span>
                )}
              </div>
            );
          })}

          {/* Black keys */}
          {BLACK_KEYS.map(({ midi, leftIndex }) => {
            const isActive = activeNotes.has(midi);
            return (
              <div
                key={midi}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  handleNoteOn(midi, 100);
                }}
                onMouseUp={(e) => {
                  e.stopPropagation();
                  handleNoteOff(midi);
                }}
                onMouseLeave={(e) => {
                  e.stopPropagation();
                  handleNoteOff(midi);
                }}
                style={{
                  position: "absolute",
                  left: (leftIndex + 1) * WK - BK_W / 2 - 1,
                  top: 8,
                  width: BK_W,
                  height: BK_H,
                  background: isActive ? "#e05a45" : "#1a1a1f",
                  borderRadius: "0 0 3px 3px",
                  zIndex: 2,
                  cursor: "pointer",
                  transition: "background 0.05s",
                  boxShadow: isActive
                    ? "0 0 14px rgba(196,72,53,0.4)"
                    : "0 2px 4px rgba(0,0,0,0.5), inset 0 -2px 3px rgba(0,0,0,0.3)",
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Controls */}
      <button
        onClick={() => setShowLabels(!showLabels)}
        style={{
          fontSize: 10,
          color: "#6b6a6f",
          cursor: "pointer",
          textTransform: "uppercase",
          letterSpacing: 1.5,
          fontWeight: 300,
          background: "none",
          border: "1px solid #1e1e24",
          padding: "6px 14px",
          borderRadius: 4,
          fontFamily: "'IBM Plex Mono', monospace",
          transition: "border-color 0.2s, color 0.2s",
        }}
        onMouseEnter={(e) => {
          e.target.style.borderColor = "#6b6a6f";
          e.target.style.color = "#e8e6e3";
        }}
        onMouseLeave={(e) => {
          e.target.style.borderColor = "#1e1e24";
          e.target.style.color = "#6b6a6f";
        }}
      >
        {showLabels ? "Hide note names" : "Show note names"}
      </button>

      {/* Velocity bar */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          width: "100%",
          height: 3,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${(lastVelocity / 127) * 100}%`,
            background: "#c44835",
            boxShadow: "0 0 10px rgba(196,72,53,0.35)",
            transition: "width 0.08s ease-out",
          }}
        />
      </div>

      {/* Instructions */}
      {status !== "connected" && (
        <div
          style={{
            marginTop: 20,
            padding: "14px 22px",
            background: "#111114",
            border: "1px solid #1e1e24",
            borderRadius: 8,
            fontSize: 11,
            color: "#6b6a6f",
            fontWeight: 300,
            lineHeight: 1.8,
            maxWidth: 460,
            textAlign: "center",
            fontFamily: "'IBM Plex Mono', monospace",
            marginBottom: 32,
          }}
        >
          {status === "unsupported" ? (
            <>
              <span style={{ color: "#e8e6e3", fontWeight: 400 }}>
                Web MIDI not supported.
              </span>
              <br />
              Use Chrome or Edge.
            </>
          ) : (
            <>
              <span style={{ color: "#e8e6e3", fontWeight: 400 }}>
                Connect your MIDI controller
              </span>{" "}
              via USB.
              <br />
              Chrome or Edge required for Web MIDI API.
              <br />
              You can also click keys to test.
            </>
          )}
        </div>
      )}
    </div>
  );
}
