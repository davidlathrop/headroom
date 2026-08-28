import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { loadFont as loadDisplay } from "@remotion/google-fonts/BricolageGrotesque";
import { loadFont as loadSans } from "@remotion/google-fonts/IBMPlexSans";
import { loadFont as loadMono } from "@remotion/google-fonts/IBMPlexMono";

const display = loadDisplay("normal", { weights: ["700"], subsets: ["latin"] }).fontFamily;
const sans = loadSans("normal", { weights: ["400", "500"], subsets: ["latin"] }).fontFamily;
const mono = loadMono("normal", { weights: ["400"], subsets: ["latin"] }).fontFamily;

// The app's own palette, so the video and the product read as one thing.
const C = {
  bg: "#f6f8f7",
  surface: "#ffffff",
  ink: "#16211d",
  muted: "#5e6e68",
  rule: "#d6deda",
  accent: "#0e6b54",
  accentSoft: "#e1f0ea",
};

export const FPS = 30;
const INTRO = 3 * FPS;
const SCENE = 5 * FPS;
const OUTRO = 4 * FPS;
const XFADE = 20;
const ease = Easing.bezier(0.16, 1, 0.3, 1);

interface Scene {
  file: string;
  eyebrow: string;
  headline: string;
  sub: string;
  /** Slow camera move: how far (px, at 1x) the screen drifts up over the scene, revealing more of it. */
  drift: number;
}

const SCENES: Scene[] = [
  {
    file: "01-home.png",
    eyebrow: "This month",
    headline: "Three numbers, honest by construction.",
    sub: "Income, spent, headroom — transfers excluded, refunds netted, gaps flagged.",
    drift: 120,
  },
  {
    file: "02-import.png",
    eyebrow: "Import",
    headline: "Import any bank file. Nothing counts twice.",
    sub: "Duplicates are caught before a row is saved; look-alikes go to review.",
    drift: 60,
  },
  {
    file: "03-transactions.png",
    eyebrow: "Transactions",
    headline: "Categorize inline. Teach it once.",
    sub: "Tick “always” and it becomes a rule. Flag one-offs as outliers.",
    drift: 140,
  },
  {
    file: "04-months.png",
    eyebrow: "Months",
    headline: "Every month at a glance.",
    sub: "Fixed vs variable, saved, and what you kept — with or without outliers.",
    drift: 80,
  },
  {
    file: "05-budget.png",
    eyebrow: "Budgets",
    headline: "Budgets that watch categories.",
    sub: "Targets optional. Any month, any period, against everything you spent.",
    drift: 260,
  },
  {
    file: "06-forecast.png",
    eyebrow: "Forecast",
    headline: "What your money can do next.",
    sub: "Detected paychecks and bills, a 60-day cash curve, and safe to spend.",
    drift: 160,
  },
  {
    file: "07-trends.png",
    eyebrow: "Trends",
    headline: "The picture over time.",
    sub: "Click anything to zoom in. Outliers stay out of the way.",
    drift: 200,
  },
  {
    file: "08-accounts.png",
    eyebrow: "Accounts",
    headline: "Reconciled to the bank, always.",
    sub: "Statement balances, import coverage, and what each payment counts as.",
    drift: 100,
  },
];

export const TOTAL_FRAMES =
  INTRO + SCENES.length * SCENE + OUTRO - (SCENES.length + 1) * XFADE;

const Wordmark: React.FC<{ size: number }> = ({ size }) => (
  <span style={{ fontFamily: display, fontWeight: 700, fontSize: size, letterSpacing: "-0.02em", color: C.ink }}>
    Head<span style={{ color: C.accent }}>room</span>
  </span>
);

const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const up = (delay: number) =>
    interpolate(frame, [delay, delay + 0.8 * fps], [40, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: ease,
    });
  const show = (delay: number) =>
    interpolate(frame, [delay, delay + 0.6 * fps], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: ease,
    });
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          position: "absolute",
          width: 1400,
          height: 1400,
          borderRadius: 700,
          background: C.accentSoft,
          opacity: interpolate(frame, [0, fps], [0, 0.7], { extrapolateRight: "clamp" }),
          scale: String(interpolate(frame, [0, 3 * fps], [0.8, 1.05])),
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 28 }}>
        <div style={{ opacity: show(0), translate: `0px ${up(0)}px` }}>
          <Wordmark size={168} />
        </div>
        <div
          style={{
            fontFamily: sans,
            fontSize: 52,
            color: C.muted,
            opacity: show(12),
            translate: `0px ${up(12)}px`,
          }}
        >
          What came in, what went out, what’s left.
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Screen: React.FC<{ scene: Scene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = (delay: number) => ({
    opacity: interpolate(frame, [delay, delay + 0.6 * fps], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: ease,
    }),
    translate: `0px ${interpolate(frame, [delay, delay + 0.8 * fps], [28, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: ease,
    })}px`,
  });
  // The whole scene, transitions included, is one slow move: a touch of zoom and a drift upward.
  const zoom = interpolate(frame, [0, SCENE], [1, 1.04], { extrapolateRight: "clamp" });
  const drift = interpolate(frame, [0, SCENE], [0, -scene.drift], {
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });
  const windowY = interpolate(frame, [0, 0.9 * fps], [60, 0], {
    extrapolateRight: "clamp",
    easing: ease,
  });
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <div
        style={{
          position: "absolute",
          left: 120,
          top: 88,
          width: 1680,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div
          style={{
            ...enter(0),
            fontFamily: mono,
            fontSize: 26,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: C.accent,
          }}
        >
          {scene.eyebrow}
        </div>
        <div
          style={{
            ...enter(4),
            fontFamily: display,
            fontWeight: 700,
            fontSize: 72,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            color: C.ink,
          }}
        >
          {scene.headline}
        </div>
        <div style={{ ...enter(10), fontFamily: sans, fontSize: 36, color: C.muted, lineHeight: 1.35 }}>
          {scene.sub}
        </div>
      </div>
      {/* Browser-style window; its bottom runs off the frame on purpose. */}
      <div
        style={{
          position: "absolute",
          left: 120,
          top: 330,
          width: 1680,
          height: 1000,
          translate: `0px ${windowY}px`,
          borderRadius: 18,
          overflow: "hidden",
          background: C.surface,
          border: `1px solid ${C.rule}`,
          boxShadow: "0 30px 80px -30px rgba(22, 33, 29, 0.45), 0 2px 0 rgba(22,33,29,0.04)",
        }}
      >
        <div
          style={{
            height: 44,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 18px",
            borderBottom: `1px solid ${C.rule}`,
            background: "#eef2f0",
          }}
        >
          {["#e06a6a", "#e0913f", "#43c59b"].map((c) => (
            <span key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c, opacity: 0.8 }} />
          ))}
          <span
            style={{
              marginLeft: 14,
              fontFamily: mono,
              fontSize: 15,
              color: C.muted,
              background: C.surface,
              border: `1px solid ${C.rule}`,
              borderRadius: 6,
              padding: "3px 12px",
            }}
          >
            localhost:3000
          </span>
        </div>
        <div style={{ position: "relative", overflow: "hidden", height: 956 }}>
          <Img
            src={staticFile(`screens/${scene.file}`)}
            style={{
              width: 1680,
              height: 945,
              display: "block",
              transformOrigin: "50% 0%",
              scale: String(zoom),
              translate: `0px ${drift}px`,
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const show = (delay: number) =>
    interpolate(frame, [delay, delay + 0.7 * fps], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: ease,
    });
  const up = (delay: number) =>
    interpolate(frame, [delay, delay + 0.8 * fps], [30, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: ease,
    });
  return (
    <AbsoluteFill style={{ backgroundColor: C.ink, alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 36, maxWidth: 1500 }}>
        <div
          style={{
            fontFamily: display,
            fontWeight: 700,
            fontSize: 84,
            textAlign: "center",
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            color: C.bg,
            opacity: show(0),
            translate: `0px ${up(0)}px`,
          }}
        >
          Local-first.
          <br />
          Your data never leaves this machine.
        </div>
        <div
          style={{
            fontFamily: sans,
            fontSize: 40,
            color: "#93a59e",
            opacity: show(14),
            translate: `0px ${up(14)}px`,
          }}
        >
          Import a file. Headroom does the rest.
        </div>
        <div
          style={{
            marginTop: 30,
            fontFamily: mono,
            fontSize: 32,
            color: "#43c59b",
            opacity: show(26),
            translate: `0px ${up(26)}px`,
          }}
        >
          github.com/davidlathrop/headroom
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const HeadroomDemo: React.FC = () => {
  const xfade = (
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: XFADE })} />
  );
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={INTRO}>
        <Intro />
      </TransitionSeries.Sequence>
      {SCENES.flatMap((scene, i) => [
        React.cloneElement(xfade, { key: `t${i}` }),
        <TransitionSeries.Sequence key={scene.file} durationInFrames={SCENE}>
          <Screen scene={scene} />
        </TransitionSeries.Sequence>,
      ])}
      {React.cloneElement(xfade, { key: "t-out" })}
      <TransitionSeries.Sequence durationInFrames={OUTRO}>
        <Outro />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
