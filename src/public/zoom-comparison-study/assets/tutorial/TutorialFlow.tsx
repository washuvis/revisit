import React, { useCallback, useMemo, useState } from 'react';
import type { TutorialContext, TutorialPageDef } from './types';
import { TutorialLayout } from './components/TutorialLayout';

export function TutorialFlow({
  initialContext,
  pages,
  onDone,
}: {
  initialContext: TutorialContext;
  pages: TutorialPageDef[];
  onDone: (ctx: TutorialContext) => void;
}) {
  const [ctx, setCtxState] = useState<TutorialContext>(initialContext);
  const setCtx = useCallback((updater: (prev: TutorialContext) => TutorialContext) => {
    setCtxState((prev) => updater(prev));
  }, []);

  const visiblePages = useMemo(
    () => pages.filter((p) => (p.when ? p.when(ctx) : true)),
    [pages, ctx],
  );

  const [idx, setIdx] = useState(0);
  const page = visiblePages[idx];

  const nav = useMemo(
    () => ({
      next: () => setIdx((i) => Math.min(i + 1, visiblePages.length - 1)),
      back: () => setIdx((i) => Math.max(i - 1, 0)),
      goTo: (id: string) => {
        const j = visiblePages.findIndex((p) => p.id === id);
        if (j >= 0) setIdx(j);
      },
    }),
    [visiblePages],
  );

  const canContinue = useMemo(() => {
    if (!page?.canContinue) return { ok: true as const };
    return page.canContinue(ctx);
  }, [page, ctx]);

  const handleNext = () => {
    // optional logging
    ctx.onLogEvent?.({
      type: 'tutorial_next', pageId: page.id, t: performance.now(), zoomMode: ctx.zoomMode,
    });

    // final page => done
    if (idx === visiblePages.length - 1) {
      ctx.onLogEvent?.({ type: 'tutorial_done', t: performance.now(), zoomMode: ctx.zoomMode });
      onDone(ctx);
      return;
    }
    nav.next();
  };

  const handleBack = () => {
    ctx.onLogEvent?.({
      type: 'tutorial_back', pageId: page.id, t: performance.now(), zoomMode: ctx.zoomMode,
    });
    nav.back();
  };

  if (!page) return null;

  return (
    <TutorialLayout
      title={page.title}
      onBack={handleBack}
      onNext={handleNext}
      backDisabled={idx === 0}
      nextDisabled={!canContinue.ok}
      nextLabel={idx === visiblePages.length - 1 ? 'Start Study' : 'Continue'}
      footerNote={!canContinue.ok ? canContinue.reason : undefined}
      progress={{ index: idx, total: visiblePages.length }}
    >
      {page.render({ ctx, nav, setCtx })}
    </TutorialLayout>
  );
}
