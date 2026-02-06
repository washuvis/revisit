import React from 'react';
import { TutorialFlow } from './tutorial/TutorialFlow';
import { tutorialPages } from './tutorial/tutorialPages';
import type { ZoomMode } from './tutorial/types';

type RevisitComponentProps = {
  parameters: {
    zoomMode: ZoomMode;
  };
  onLogEvent?: (evt: Record<string, unknown>) => void;
  onAdvance?: () => void;
};

export default function TutorialEntry(props: RevisitComponentProps) {
  const { zoomMode } = props.parameters;

  return (
    <TutorialFlow
      initialContext={{
        zoomMode,
        onLogEvent: props.onLogEvent,
        practice: { completed: false, peaksTagged: 0 },
      }}
      pages={tutorialPages}
      onDone={() => {
        props.onAdvance?.();
      }}
    />
  );
}
