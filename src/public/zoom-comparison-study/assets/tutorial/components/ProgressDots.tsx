import React from 'react';

export function ProgressDots({ index, total }: { index: number; total: number }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            border: '1px solid rgba(0,0,0,0.35)',
            background: i === index ? 'rgba(0,0,0,0.75)' : 'transparent',
          }}
        />
      ))}
    </div>
  );
}
