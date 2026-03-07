'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.push('/admin');
      } else if (res.status === 429) {
        setError('Too many attempts, try again later');
      } else {
        setError('Invalid password');
      }
    } catch {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <form
        onSubmit={handleSubmit}
        style={{
          background: '#111111',
          border: '1px solid #1e1e1e',
          borderRadius: 6,
          padding: 32,
          width: '100%',
          maxWidth: 340,
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 600, color: '#e5e5e5', margin: '0 0 4px 0', textAlign: 'center' }}>
          Status
        </h1>
        <p style={{ fontSize: 12, color: '#555', margin: '0 0 24px 0', textAlign: 'center' }}>Admin Access</p>

        {error && (
          <p style={{ color: '#ef4444', fontSize: 13, textAlign: 'center', margin: '0 0 16px 0' }}>{error}</p>
        )}

        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          style={{
            width: '100%',
            padding: '10px 12px',
            background: '#000000',
            border: '1px solid #333',
            borderRadius: 4,
            color: '#e5e5e5',
            fontSize: 14,
            outline: 'none',
            boxSizing: 'border-box',
            marginBottom: 12,
          }}
          onFocus={e => (e.currentTarget.style.borderColor = '#555')}
          onBlur={e => (e.currentTarget.style.borderColor = '#333')}
        />

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            padding: '10px 0',
            background: '#e5e5e5',
            color: '#000000',
            border: 'none',
            borderRadius: 4,
            fontSize: 13,
            fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.5 : 1,
          }}
        >
          {loading ? 'Logging in...' : 'Login'}
        </button>

        <Link
          href="/"
          style={{
            display: 'block',
            textAlign: 'center',
            marginTop: 16,
            fontSize: 11,
            color: '#555',
            textDecoration: 'none',
          }}
        >
          ← Back
        </Link>
      </form>
    </div>
  );
}
