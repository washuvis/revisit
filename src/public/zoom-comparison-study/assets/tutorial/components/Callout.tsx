import React from 'react';

export function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        borderRadius: 12,
        border: '1px solid rgba(0,0,0,0.15)',
        background: 'rgba(0,0,0,0.03)',
      }}
    >
      {children}
    </div>
  );
}
