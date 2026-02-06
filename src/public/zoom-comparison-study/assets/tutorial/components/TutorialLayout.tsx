import React from 'react';
import { ProgressDots } from './ProgressDots';

export function TutorialLayout({
  title,
  children,
  onBack,
  onNext,
  backDisabled,
  nextDisabled,
  nextLabel = 'Continue',
  footerNote,
  progress,
}: {
  title: string;
  children: React.ReactNode;
  onBack: () => void;
  onNext: () => void;
  backDisabled?: boolean;
  nextDisabled?: boolean;
  nextLabel?: string;
  footerNote?: string;
  progress?: { index: number; total: number };
}) {
  return (
    <div
      style={{
        maxWidth: 920,
        margin: '0 auto',
        padding: 24,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 28 }}>{title}</h1>
        {progress && <ProgressDots index={progress.index} total={progress.total} />}
      </div>

      <div style={{ marginTop: 16 }}>{children}</div>

      <div
        style={{
          marginTop: 24,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <button type="button" onClick={onBack} disabled={backDisabled} style={{ padding: '10px 14px' }}>
          Back
        </button>

        <div style={{ flex: 1 }} />

        {footerNote && <div style={{ opacity: 0.8, fontSize: 13 }}>{footerNote}</div>}

        <button type="button" onClick={onNext} disabled={nextDisabled} style={{ padding: '10px 14px' }}>
          {nextLabel}
        </button>
      </div>
    </div>
  );
}
