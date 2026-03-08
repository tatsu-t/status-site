'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled error:', error);
  }, [error]);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: '#0a0a0a',
      color: '#fff',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>エラーが発生しました</h1>
        <p style={{ color: '#a1a1aa', marginBottom: 24, fontSize: 14 }}>
          {error.message || '予期しないエラーが発生しました'}
        </p>
        <button
          onClick={reset}
          style={{
            padding: '10px 24px',
            background: '#27272a',
            color: '#fff',
            border: '1px solid #3f3f46',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          再試行
        </button>
      </div>
    </div>
  );
}
