import React from 'react';

export function ExampleFrame({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        marginTop: 14,
        borderRadius: 14,
        border: '1px solid rgba(0,0,0,0.15)',
        overflow: 'hidden',
      }}
    >
      {title && (
        <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(0,0,0,0.1)', fontWeight: 600 }}>
          {title}
        </div>
      )}
      <div style={{ padding: 12 }}>{children}</div>
    </div>
  );
}
