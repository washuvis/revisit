import React from 'react';
import type { TutorialPageDef, TutorialPageProps, ZoomMode } from './types';
import { Callout } from './components/Callout';
import { ExampleFrame } from './components/ExampleFrame';

// If you have actual images, import them; otherwise keep placeholders.
// import peakBig from './assets/peak_big.png';
// import tinyFull from './assets/peak_tiny_full.png';
// import tinyZoomed from './assets/peak_tiny_zoomed.png';

function ZoomHowItWorks({ mode }: { mode: ZoomMode }) {
  // Keep wording parallel across conditions for fairness.
  switch (mode) {
    case 'scroll':
      return (
        <>
          <p>You will zoom using your scroll wheel or trackpad.</p>
          <ul>
            <li>Scroll up to zoom in</li>
            <li>Scroll down to zoom out</li>
            <li>Zoom happens around your cursor</li>
            <li>Drag to pan left/right</li>
          </ul>
        </>
      );
    case 'rangeBrush':
      return (
        <>
          <p>You will zoom by selecting a time range.</p>
          <ul>
            <li>Click and drag to select a region</li>
            <li>Release to zoom into that region</li>
            <li>Adjust the selection to refine or zoom back out</li>
            <li>Drag to pan left/right</li>
          </ul>
        </>
      );
    case 'boxZoom':
      return (
        <>
          <p>You will zoom by drawing a box over the region you want to inspect.</p>
          <ul>
            <li>Click and drag to draw a box</li>
            <li>Release to zoom into that area</li>
            <li>Use the zoom-out action to step back out (not a full reset)</li>
            <li>Drag to pan left/right</li>
          </ul>
        </>
      );
    case 'clickToZoom':
      return (
        <>
          <p>You will zoom using mouse clicks.</p>
          <ul>
            <li>Click to zoom in one step at that location</li>
            <li>Use the zoom-out action to zoom out one step</li>
            <li>Drag to pan left/right</li>
          </ul>
        </>
      );
    case 'magnifier':
      return (
        <>
          <p>You will zoom using a magnifying lens.</p>
          <ul>
            <li>Turn the lens on to inspect a small area in detail</li>
            <li>Move the lens over the chart to examine tiny bumps</li>
            <li>Adjust lens magnification step by step as needed</li>
            <li>When ready, tag the peak’s start, top, and end</li>
          </ul>
        </>
      );
    default:
      return null;
  }
}

export const tutorialPages: TutorialPageDef[] = [
  {
    id: 'welcome',
    title: 'What You’ll Be Doing',
    label: 'Welcome',
    render: () => (
      <>
        <p>
          You will look at a line chart and mark important
          <b> peaks </b>
          in the line.
        </p>
        <p>Your job is to find bumps and mark:</p>
        <ul>
          <li>where the bump starts</li>
          <li>its highest point</li>
          <li>where it ends</li>
        </ul>
        <Callout>
          <b>Tip: </b>
          Accuracy matters more than speed.
        </Callout>
      </>
    ),
  },

  {
    id: 'what-is-a-peak',
    title: 'What Is a “Peak”?',
    label: 'Peak',
    render: () => (
      <>
        <p>
          A
          <b> peak </b>
          is a place where the line goes
          <b> up </b>
          , reaches a
          <b> high point </b>
          , and comes
          {' '}
          <b> back down. </b>
        </p>

        <ExampleFrame title="Think: hill shape">
          <ol style={{ marginTop: 0 }}>
            <li>
              <b>Start</b>
              : where the line begins to rise
            </li>
            <li>
              <b>Top</b>
              : the highest point
            </li>
            <li>
              <b>End</b>
              : where the line returns back down
            </li>
          </ol>
          {/* Replace with an image or an inline SVG later */}
          <div style={{ height: 180, borderRadius: 12, border: '1px dashed rgba(0,0,0,0.25)' }}>
            <div style={{ padding: 12, opacity: 0.8 }}>Example graphic goes here</div>
          </div>
        </ExampleFrame>
      </>
    ),
  },

  {
    id: 'big-vs-tiny',
    title: 'Big and Tiny Peaks',
    label: 'Tiny',
    render: () => (
      <>
        <p>Some peaks are big and obvious. Others are small and subtle.</p>
        <p>Small peaks can be easy to miss unless you zoom in.</p>

        <ExampleFrame title="Why zoom helps">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
            }}
          >
            <div
              style={{
                borderRadius: 12,
                border: '1px dashed rgba(0,0,0,0.25)',
                height: 180,
                padding: 12,
              }}
            >
              Full view (tiny bump is hard to see)
              {/* <img src={tinyFull} style={{ width: '100%' }} /> */}
            </div>
            <div
              style={{
                borderRadius: 12,
                border: '1px dashed rgba(0,0,0,0.25)',
                height: 180,
                padding: 12,
              }}
            >
              Zoomed-in view (tiny bump becomes clear)
              {/* <img src={tinyZoomed} style={{ width: '100%' }} /> */}
            </div>
          </div>
        </ExampleFrame>
      </>
    ),
  },

  {
    id: 'how-to-tag',
    title: 'How to Tag a Peak',
    label: 'Tag',
    render: () => (
      <>
        <p>When you find a peak, you will tag three points:</p>
        <ul>
          <li>
            <b>Start </b>
            — where it begins to rise
          </li>
          <li>
            <b>Top </b>
            — the highest point
          </li>
          <li>
            <b>End </b>
            — where it comes back down
          </li>
        </ul>

        <Callout>
          You can adjust tags if they’re not quite right. You can also delete a peak and try again.
        </Callout>

        <ExampleFrame title="Tagging demo">
          <div
            style={{
              height: 220,
              borderRadius: 12,
              border: '1px dashed rgba(0,0,0,0.25)',
              padding: 12,
            }}
          >
            Animation or interactive demo goes here
          </div>
        </ExampleFrame>
      </>
    ),
  },

  {
    id: 'zoom-how',
    title: 'Your Zoom Tool',
    label: 'Zoom',
    render: ({ ctx }: TutorialPageProps) => (
      <>
        <ZoomHowItWorks mode={ctx.zoomMode} />
        <Callout>
          <b>Reminder: </b>
          Use zoom when peaks are small. Zoom out when you want more context.
        </Callout>
        <ExampleFrame title="Zoom example">
          <div
            style={{
              height: 220,
              borderRadius: 12,
              border: '1px dashed rgba(0,0,0,0.25)',
              padding: 12,
            }}
          >
            Condition-specific zoom illustration goes here
          </div>
        </ExampleFrame>
      </>
    ),
  },

  {
    id: 'practice',
    title: 'Practice Round',
    label: 'Practice',
    // Gate: require practice completion before continuing
    canContinue: (ctx) => {
      const ok = !!ctx.practice?.completed;
      return ok ? { ok: true } : { ok: false, reason: 'Please tag at least one peak to continue.' };
    },
    render: ({ setCtx }: TutorialPageProps) => (
      <>
        <p>
          Now try it yourself. This practice does
          <b> not </b>
          count toward your results.
        </p>
        <ol>
          <li>Zoom to inspect the line</li>
          <li>Find a peak</li>
          <li>Tag its start, top, and end</li>
        </ol>

        <ExampleFrame title="Practice chart">
          <div
            style={{
              height: 360,
              borderRadius: 12,
              border: '1px dashed rgba(0,0,0,0.25)',
              padding: 12,
            }}
          >
            {/* Swap this placeholder with your real ChromatogramView in practice mode */}
            <p
              style={{
                marginTop: 0,
                opacity: 0.8,
              }}
            >
              Insert ChromatogramView here in a special practice stimulus.
            </p>

            <button
              type="button"
              onClick={() => setCtx((prev) => ({ ...prev, practice: { ...(prev.practice ?? {}), completed: true, peaksTagged: 1 } }))}
              style={{
                padding: '10px 12px',
              }}
            >
              (Dev) Mark practice complete
            </button>
          </div>
        </ExampleFrame>

        <Callout>
          If you make a mistake, adjust your tags or delete the peak and try again.
        </Callout>
      </>
    ),
  },

  {
    id: 'final-reminders',
    title: 'Before You Begin',
    label: 'Start',
    render: () => (
      <>
        <ul>
          <li>Some peaks are very small — zoom when needed</li>
          <li>You can adjust or delete tags</li>
          <li>Accuracy matters more than speed</li>
        </ul>
        <Callout>
          When you’re ready, click
          <b> Start Study.</b>
        </Callout>
      </>
    ),
  },
];
