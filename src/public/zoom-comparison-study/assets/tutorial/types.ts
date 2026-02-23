export type ZoomMode = 'scroll' | 'clickToZoom' | 'magnifier' | 'boxZoom' | 'rangeBrush';

export type LogEvent = {
  type: string;
  t: number;
  [key: string]: unknown;
};

export type TutorialContext = {
  participantId?: string;
  trialId?: string;
  stimulusId?: string;
  zoomMode: ZoomMode;

  onLogEvent?: (evt: LogEvent) => void;

  // practice completion flags, etc.
  practice?: {
    completed?: boolean;
    peaksTagged?: number;
  };
};

export type TutorialNav = {
  next: () => void;
  back: () => void;
  goTo: (id: string) => void;
};

export type TutorialPageProps = {
  ctx: TutorialContext;
  nav: TutorialNav;
  setCtx: (updater: (prev: TutorialContext) => TutorialContext) => void;
};

export type TutorialPageDef = {
  id: string;
  title: string;
  // optional short label for nav UI
  label?: string;

  // If provided, page renders only when predicate returns true
  when?: (ctx: TutorialContext) => boolean;

  // Optional: block navigation until condition met
  canContinue?: (ctx: TutorialContext) => { ok: boolean; reason?: string };

  render: (props: TutorialPageProps) => React.ReactNode;
};
