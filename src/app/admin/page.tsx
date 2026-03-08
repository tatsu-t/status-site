'use client';

import { useState, useCallback, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface ServiceAuth {
  user: string;
  pass: string;
}

interface ServiceConfig {
  id: string;
  name: string;
  type: 'ping' | 'docker' | 'group' | 'external' | 'systemctl' | 'agent-push';
  target: string;
  auth?: ServiceAuth;
  group: string;
  icon: string;
  docker_watch?: string;
  systemd_watch?: string;
}

interface AppConfig {
  title: string;
  description: string;
  services: ServiceConfig[];
  group_order?: string[];
}

interface PendingAgent {
  token: string;
  hostname: string;
  ip: string;
  cpu_percent: number;
  memory_percent: number;
  disk_percent: number;
  registered_at: string;
}

const EMPTY_SERVICE: Omit<ServiceConfig, 'id'> = {
  name: '', type: 'ping', target: '', group: '', icon: 'bi-server',
};

const SERVICE_TYPES = ['ping', 'docker', 'group', 'external', 'systemctl', 'agent-push', 'web', 'tcp'] as const;
const NEW_SERVICE_TYPES = ['ping', 'external', 'docker', 'group', 'systemctl', 'web', 'tcp'] as const;

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: '#000',
  border: '1px solid #333',
  borderRadius: 4,
  color: '#e5e5e5',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
};

function useFetchConfig(router: ReturnType<typeof useRouter>) {
  const [config, setConfig] = useState<AppConfig | null>(null);

  const fetchConfig = useCallback(async () => {
    const res = await fetch('/api/admin/services');
    if (res.status === 401) { router.push('/login'); return; }
    const data = await res.json();
    setConfig(data);
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/services')
      .then(res => {
        if (res.status === 401) { router.push('/login'); return null; }
        return res.json();
      })
      .then(data => { if (data && !cancelled) setConfig(data); });
    return () => { cancelled = true; };
  }, [router]);

  return { config, fetchConfig };
}

type PairState = 'idle' | 'generating' | 'waiting' | 'found' | 'confirming' | 'done';

function PairWizard({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [pairState, setPairState] = useState<PairState>('generating');
  const [pairToken, setPairToken] = useState('');
  const [installCommand, setInstallCommand] = useState('');
  const [pendingAgent, setPendingAgent] = useState<PendingAgent | null>(null);
  const [newName, setNewName] = useState('');
  const [newGroup, setNewGroup] = useState('Remote Agents');
  const [newIcon, setNewIcon] = useState('bi-server');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch('/api/admin/pair', { method: 'POST' });
      if (!res.ok) { setError('Failed to generate token'); return; }
      const data = await res.json();
      if (cancelled) return;
      setPairToken(data.token);
      setInstallCommand(data.command);
      setPairState('waiting');
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (pairState !== 'waiting' && pairState !== 'found') return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/admin/pair');
        const data = await res.json();
        const agent = data.agents.find((a: PendingAgent) => a.token === pairToken);
        if (agent) {
          setPendingAgent(agent);
          setPairState('found');
          setNewName(agent.hostname);
        }
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [pairState, pairToken]);

  async function handleConfirm() {
    if (!pendingAgent) return;
    setPairState('confirming');
    const res = await fetch('/api/admin/pair/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: pendingAgent.token,
        name: newName,
        group: newGroup,
        icon: newIcon,
      }),
    });
    if (res.ok) {
      setPairState('done');
      onDone();
      setTimeout(onClose, 800);
    } else {
      setError('Failed to confirm device');
      setPairState('found');
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(installCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16,
    }}>
      <div style={{
        background: '#111', border: '1px solid #1e1e1e', borderRadius: 6,
        padding: 24, width: '100%', maxWidth: 520,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#e5e5e5', margin: 0 }}>Add Device</h2>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#555', fontSize: 18, cursor: 'pointer',
          }}>✓</button>
        </div>

        {error && <p style={{ color: '#ef4444', fontSize: 12, marginBottom: 12 }}>{error}</p>}

        {pairState === 'generating' && (
          <p style={{ color: '#555', fontSize: 13 }}>Generating pairing token...</p>
        )}

        {(pairState === 'waiting' || pairState === 'found') && (
          <>
            <p style={{ color: '#888', fontSize: 13, margin: '0 0 8px 0' }}>
              1. Run this command on your server:
            </p>
            <div style={{ position: 'relative', marginBottom: 16 }}>
              <pre style={{
                background: '#000', border: '1px solid #333', borderRadius: 4,
                padding: '10px 40px 10px 10px', margin: 0, fontSize: 11, color: '#4ade80',
                whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.5,
              }}>{installCommand}</pre>
              <button onClick={handleCopy} style={{
                position: 'absolute', top: 6, right: 6,
                background: '#1e1e1e', border: '1px solid #333', borderRadius: 3,
                color: copied ? '#4ade80' : '#888', fontSize: 12, cursor: 'pointer',
                padding: '2px 6px',
              }}>{copied ? '✓' : 'Copy'}</button>
            </div>
          </>
        )}

        {pairState === 'waiting' && (
          <p style={{ color: '#888', fontSize: 13 }}>
            2. Waiting for device...{' '}
            <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>...</span>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </p>
        )}

        {(pairState === 'found' || pairState === 'confirming') && pendingAgent && (
          <>
            <div style={{
              background: '#0a1a0a', border: '1px solid #166534', borderRadius: 4,
              padding: 12, marginBottom: 16,
            }}>
              <p style={{ color: '#4ade80', fontSize: 13, margin: '0 0 4px 0' }}>
                ✓ Found: {pendingAgent.hostname} ({pendingAgent.ip})
              </p>
              <p style={{ color: '#888', fontSize: 11, margin: 0 }}>
                CPU: {pendingAgent.cpu_percent}% · RAM: {pendingAgent.memory_percent}% · Disk: {pendingAgent.disk_percent}%
              </p>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>Name</label>
              <input value={newName} onChange={e => setNewName(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>Group</label>
                <input value={newGroup} onChange={e => setNewGroup(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>Icon</label>
                <input value={newIcon} onChange={e => setNewIcon(e.target.value)} style={inputStyle} />
              </div>
            </div>

            <button
              onClick={handleConfirm}
              disabled={pairState === 'confirming' || !newName}
              style={{
                width: '100%', padding: '10px 0', background: '#4ade80', color: '#000',
                border: 'none', borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                opacity: pairState === 'confirming' ? 0.5 : 1,
              }}
            >
              {pairState === 'confirming' ? 'Adding...' : 'Add Device'}
            </button>
          </>
        )}

        {pairState === 'done' && (
          <p style={{ color: '#4ade80', fontSize: 13 }}>✓ Device added successfully!</p>
        )}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [editing, setEditing] = useState<ServiceConfig | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [authUser, setAuthUser] = useState('');
  const [authPass, setAuthPass] = useState('');
  // docker_watch and systemd_watch are stored directly on the editing object
  const [agentServiceId, setAgentServiceId] = useState('');
  const [agentItemName, setAgentItemName] = useState('');
  const [availableContainers, setAvailableContainers] = useState<string[]>([]);
  const [dockerGroupSpecs, setDockerGroupSpecs] = useState('');
  const [dgContainerMap, setDgContainerMap] = useState<Record<string, string[]>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showPairWizard, setShowPairWizard] = useState(false);
  const router = useRouter();
  const { config, fetchConfig } = useFetchConfig(router);
  const [error, setError] = useState<string | null>(null);

  const showError = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 5000);
  };

  const fetchContainersRef = useCallback((agentId: string) => {
    const controller = new AbortController();
    fetch(`/api/agent-docker-list?agentId=${agentId}`, { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error('Failed'); return r.json(); })
      .then(d => setAvailableContainers(d.containers || []))
      .catch(() => setAvailableContainers([]));
    return controller;
  }, []);

  useEffect(() => {
    if (editing?.type === 'group') return;
    if (!['docker', 'systemctl'].includes(editing?.type ?? '') || !agentServiceId) return;
    const controller = fetchContainersRef(agentServiceId);
    return () => controller.abort();
  }, [editing?.type, agentServiceId, fetchContainersRef]);

  useEffect(() => {
    if (editing?.type !== 'group' || !config) return;
    const agents = config.services.filter(s => s.type === 'agent-push');
    const controllers: AbortController[] = [];
    const map: Record<string, string[]> = {};
    let done = 0;
    agents.forEach(a => {
      const controller = new AbortController();
      controllers.push(controller);
      fetch(`/api/agent-docker-list?agentId=${a.id}`, { signal: controller.signal })
        .then(r => { if (!r.ok) throw new Error('Failed'); return r.json(); })
        .then(d => { map[a.id] = d.containers || []; })
        .catch(() => {})
        .finally(() => { done++; if (done === agents.length) setDgContainerMap({...map}); });
    });
    return () => controllers.forEach(c => c.abort());
  }, [editing?.type, config]);

  function openAdd() {
    setEditing({ id: '', ...EMPTY_SERVICE });
    setAuthUser(''); setAuthPass('');
    setAgentServiceId(''); setAgentItemName(''); setAvailableContainers([]); setDockerGroupSpecs(''); setDgContainerMap({});
    setIsNew(true); setShowForm(true);
  }

  function openEdit(svc: ServiceConfig) {
    setEditing({ ...svc });
    setAuthUser(svc.auth?.user || '');
    setAuthPass(svc.auth?.pass || '');
    if (svc.type === 'group' && svc.target.startsWith('agent:')) {
      const raw = svc.target.slice(6);
      const lines = raw.split(';').map(s => s.trim()).filter(Boolean).join('\n');
      setDockerGroupSpecs(lines);
      setAgentServiceId(''); setAgentItemName('');
    } else if ((svc.type === 'docker' || svc.type === 'systemctl') && svc.target.startsWith('agent:')) {
      const parts = svc.target.split(':');
      setAgentServiceId(parts[1] || '');
      setAgentItemName(parts.slice(2).join(':') || '');
    } else {
      setAgentServiceId('');
      setAgentItemName('');
      setDockerGroupSpecs('');
    }
    setIsNew(false); setShowForm(true);
  }

  function closeForm() {
    setShowForm(false); setEditing(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    try {
      const svc = { ...editing };
      if (svc.type === 'group' && dockerGroupSpecs.trim()) {
        const specs = dockerGroupSpecs.split('\n').map(s => s.trim()).filter(Boolean).join(';');
        svc.target = 'agent:' + specs;
      }
      if (authUser || authPass) {
        svc.auth = { user: authUser, pass: authPass };
      } else {
        delete svc.auth;
      }
      if (!svc.docker_watch) delete svc.docker_watch;
      if (!svc.systemd_watch) delete svc.systemd_watch;
      const method = isNew ? 'POST' : 'PUT';
      const res = await fetch('/api/admin/services', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(svc),
      });
      if (!res.ok) throw new Error(`Failed to ${isNew ? 'add' : 'update'} service`);
      closeForm();
      fetchConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to save service');
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/admin/services?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete service');
      setDeleteConfirm(null);
      fetchConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to delete service');
    }
  }

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to logout');
    }
  }

  async function moveService(id: string, direction: 'up' | 'down') {
    try {
      const res = await fetch('/api/admin/services', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, direction }),
      });
      if (!res.ok) throw new Error('Failed to move service');
      fetchConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to move service');
    }
  }

  const groupNames = (() => {
    const seen = new Set<string>();
    const names: string[] = [];
    const order = config?.group_order || [];
    order.forEach(g => { seen.add(g); names.push(g); });
    config?.services.forEach(s => {
      if (!seen.has(s.group)) { seen.add(s.group); names.push(s.group); }
    });
    return names;
  })();

  async function moveGroup(groupName: string, direction: 'up' | 'down') {
    const idx = groupNames.indexOf(groupName);
    if (idx === -1) return;
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= groupNames.length) return;
    const arr = [...groupNames];
    [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
    try {
      const res = await fetch('/api/admin/group-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_order: arr }),
      });
      if (!res.ok) throw new Error('Failed to reorder groups');
      fetchConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to reorder groups');
    }
  }

  if (!config) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <span style={{ color: '#555', fontSize: 14 }}>Loading...</span>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#080808' }}><div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px' }}>
      {error && (
        <div style={{ background: '#dc2626', color: 'white', padding: '8px 16px', borderRadius: 8, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
      )}
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, color: '#e5e5e5', margin: 0 }}>Services</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link
            href="/"
            style={{
              padding: '6px 12px', fontSize: 12, color: '#e5e5e5', textDecoration: 'none',
              background: '#1e1e1e', borderRadius: 4,
            }}
          >
            ← Status
          </Link>
          <button
            onClick={handleLogout}
            style={{
              padding: '6px 12px', fontSize: 12, color: '#ef4444', background: 'transparent',
              border: '1px solid #333', borderRadius: 4, cursor: 'pointer',
            }}
          >
            Logout
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => setShowPairWizard(true)}
          style={{
            padding: '8px 16px', fontSize: 13, fontWeight: 500,
            background: '#4ade80', color: '#000', border: 'none', borderRadius: 4, cursor: 'pointer',
          }}
        >
          + Add Device
        </button>
        <button
          onClick={openAdd}
          style={{
            padding: '8px 16px', fontSize: 13, fontWeight: 500,
            background: '#1e1e1e', color: '#e5e5e5', border: '1px solid #333', borderRadius: 4, cursor: 'pointer',
          }}
        >
          + Add Service
        </button>
      </div>

      {config.services.length === 0 && (
        <p style={{ color: '#555', fontSize: 13 }}>No services configured.</p>
      )}

      {/* Service list */}
      <div style={{ borderTop: '1px solid #1e1e1e' }}>
        {config.services.map((svc, idx) => (
          <div
            key={svc.id}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 0', borderBottom: '1px solid #1e1e1e',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <span style={{ color: '#e5e5e5', fontSize: 14 }}>{svc.name}</span>
              <span style={{ marginLeft: 8, fontSize: 11, color: '#555' }}>{svc.type} · {svc.group}</span>
              <div style={{ fontSize: 11, color: '#333', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400 }}>
                {svc.target}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
              <button
                onClick={() => moveService(svc.id, 'up')}
                disabled={idx === 0}
                style={{
                  background: 'none', border: 'none', color: '#555',
                  cursor: idx === 0 ? 'not-allowed' : 'pointer',
                  padding: '2px 4px', fontSize: 12,
                }}
                title="Move up"
              >{'▲'}</button>
              <button
                onClick={() => moveService(svc.id, 'down')}
                disabled={idx === config.services.length - 1}
                style={{
                  background: 'none', border: 'none', color: '#555',
                  cursor: idx === config.services.length - 1 ? 'not-allowed' : 'pointer',
                  padding: '2px 4px', fontSize: 12,
                }}
                title="Move down"
              >{'▼'}</button>
              <button
                onClick={() => openEdit(svc)}
                style={{
                  fontSize: 12, color: '#555', background: 'none', border: 'none', cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Edit
              </button>
              {deleteConfirm === svc.id ? (
                <>
                  <button
                    onClick={() => handleDelete(svc.id)}
                    style={{ fontSize: 12, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(null)}
                    style={{ fontSize: 12, color: '#555', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setDeleteConfirm(svc.id)}
                  style={{
                    fontSize: 12, color: '#555', background: 'none', border: 'none', cursor: 'pointer',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#555')}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>


      {/* Group Order */}
      <div style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#e5e5e5', margin: '0 0 12px 0' }}>Group Order</h2>
        <div style={{ borderTop: '1px solid #1e1e1e' }}>
          {groupNames.map((g, idx) => (
            <div
              key={g}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 0', borderBottom: '1px solid #1e1e1e',
              }}
            >
              <span style={{ color: '#e5e5e5', fontSize: 14 }}>{g}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => moveGroup(g, 'up')}
                  disabled={idx === 0}
                  style={{
                    background: 'none', border: 'none', color: '#555',
                    cursor: idx === 0 ? 'not-allowed' : 'pointer',
                    padding: '2px 4px', fontSize: 12,
                  }}
                  title="Move up"
                >{'▲'}</button>
                <button
                  onClick={() => moveGroup(g, 'down')}
                  disabled={idx === groupNames.length - 1}
                  style={{
                    background: 'none', border: 'none', color: '#555',
                    cursor: idx === groupNames.length - 1 ? 'not-allowed' : 'pointer',
                    padding: '2px 4px', fontSize: 12,
                  }}
                  title="Move down"
                >{'▼'}</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Edit/Add Form */}
      {showForm && editing && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16,
          }}
        >
          <form
            onSubmit={handleSubmit}
            style={{
              background: '#111111', border: '1px solid #1e1e1e', borderRadius: 6,
              padding: 24, width: '100%', maxWidth: 480,
            }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#e5e5e5', margin: '0 0 16px 0' }}>
              {isNew ? 'Add Service' : 'Edit Service'}
            </h2>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>Name</label>
              <input required value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} style={inputStyle} />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>Type</label>
              <select
                value={editing.type}
                onChange={e => setEditing({ ...editing, type: e.target.value as ServiceConfig['type'] })}
                style={{ ...inputStyle, appearance: 'auto' }}
              >
                {(isNew ? NEW_SERVICE_TYPES : SERVICE_TYPES).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {editing.type !== 'agent-push' && (
              (editing.type === 'group' && (isNew || editing.target.startsWith('agent:'))) ? (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>Agent + Container/Service Specs (one per line)</label>
                <textarea
                  required
                  value={dockerGroupSpecs}
                  onChange={e => setDockerGroupSpecs(e.target.value)}
                  style={{ ...inputStyle, minHeight: 70, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
                  placeholder={'docker:agentId:mc-server,mc-frpc\nsystemd:agentId:nginx,status-agent'}
                />
                {config && config.services.filter(s => s.type === 'agent-push').length > 0 && (
                  <details style={{ marginTop: 6 }}>
                    <summary style={{ fontSize: 11, color: '#555', cursor: 'pointer' }}>Available agents &amp; containers</summary>
                    <div style={{ fontSize: 11, marginTop: 4, padding: '4px 0' }}>
                      {config.services.filter(s => s.type === 'agent-push').map(a => (
                        <div key={a.id} style={{ marginBottom: 4 }}>
                          <span style={{ color: '#888' }}>{a.name}</span>{' '}
                          <code
                            style={{ color: '#8b5cf6', fontSize: 10, background: '#1a1a2e', padding: '1px 4px', borderRadius: 3, cursor: 'pointer' }}
                            title="Click to insert agentId:containers into textarea"
                            onClick={() => {
                              const line = `docker:${a.id}:`;
                              setDockerGroupSpecs(prev => prev ? `${prev}\n${line}` : line);
                            }}
                          >{a.id}</code>
                          {dgContainerMap[a.id] && dgContainerMap[a.id].length > 0 ? (
                            <span style={{ color: '#22c55e', marginLeft: 6 }}>{dgContainerMap[a.id].join(', ')}</span>
                          ) : (
                            <span style={{ color: '#555', marginLeft: 6 }}>no containers</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
              ) : (['docker', 'systemctl'].includes(editing.type) && (isNew || editing.target.startsWith('agent:'))) ? (
              <div style={{ marginBottom: 12 }}>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>Agent Server</label>
                  <select
                    value={agentServiceId}
                    onChange={e => {
                      const v = e.target.value;
                      setAgentServiceId(v);
                      setEditing({ ...editing, target: 'agent:' + v + ':' + agentItemName });
                    }}
                    style={{ ...inputStyle, appearance: 'auto' }}
                  >
                    <option value="">Select agent...</option>
                    {config.services.filter(s => s.type === 'agent-push').map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>
                    {editing.type === 'docker' ? 'Container Name' : 'Service Name'}
                  </label>
                  <input
                    required
                    value={agentItemName}
                    onChange={e => {
                      const v = e.target.value;
                      setAgentItemName(v);
                      setEditing({ ...editing, target: 'agent:' + agentServiceId + ':' + v });
                    }}
                    style={inputStyle}
                    placeholder={editing.type === 'docker' ? 'nginx' : 'nginx.service'}
                    list={editing.type === 'docker' && availableContainers.length > 0 ? 'container-suggestions' : undefined}
                  />
                  {editing.type === 'docker' && availableContainers.length > 0 && (
                    <datalist id="container-suggestions">
                      {availableContainers.map(c => <option key={c} value={c} />)}
                    </datalist>
                  )}
                  {editing.type === 'docker' && availableContainers.length > 0 && (
                    <div style={{ fontSize: 11, marginTop: 4 }}>
                      <span style={{ color: '#555' }}>Available: </span>
                      {availableContainers.map((c, i) => (
                        <span key={c}>
                          {i > 0 && ', '}
                          <span style={{ color: '#22c55e' }}>{c}</span>
                        </span>
                      ))}
                      {agentItemName && !availableContainers.includes(agentItemName) && (
                        <span style={{ color: '#f59e0b', marginLeft: 8 }}>⚠ not found on agent</span>
                      )}
                    </div>
                  )}
                  {editing.type === 'docker' && availableContainers.length === 0 && agentServiceId && (
                    <span style={{ fontSize: 11, color: '#555', marginTop: 4, display: 'block' }}>No container data yet (set docker_watch on agent first, or agent not running docker)</span>
                  )}
                </div>
              </div>
              ) : !['docker', 'group', 'systemctl'].includes(editing.type) || !isNew ? (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>Target</label>
                <input required value={editing.target} onChange={e => setEditing({ ...editing, target: e.target.value })} style={inputStyle} />
              </div>
              ) : null
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>Group</label>
                <input required value={editing.group} onChange={e => setEditing({ ...editing, group: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>Icon</label>
                <input value={editing.icon} onChange={e => setEditing({ ...editing, icon: e.target.value })} style={inputStyle} placeholder="bi-server" />
              </div>
            </div>

            {!['docker', 'group', 'systemctl', 'agent-push', 'tcp'].includes(editing?.type ?? '') && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>Auth User</label>
                <input value={authUser} onChange={e => setAuthUser(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>Auth Pass</label>
                <input type="password" value={authPass} onChange={e => setAuthPass(e.target.value)} style={inputStyle} />
              </div>
            </div>
            )}

            {editing?.type === 'agent-push' && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>Agent Monitoring (optional)</div>
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>Docker Containers <span style={{color:'#444'}}>(comma-separated)</span></label>
                <input value={editing?.docker_watch || ''} onChange={e => setEditing(prev => prev ? { ...prev, docker_watch: e.target.value } : prev)} style={inputStyle} placeholder="nginx,redis,postgres" />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>Systemd Services <span style={{color:'#444'}}>(comma-separated)</span></label>
                <input value={editing?.systemd_watch || ''} onChange={e => setEditing(prev => prev ? { ...prev, systemd_watch: e.target.value } : prev)} style={inputStyle} placeholder="nginx,postgresql,docker" />
              </div>
            </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="submit"
                style={{
                  flex: 1, padding: '10px 0', background: '#e5e5e5', color: '#000',
                  border: 'none', borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                {isNew ? 'Add' : 'Save'}
              </button>
              <button
                type="button"
                onClick={closeForm}
                style={{
                  flex: 1, padding: '10px 0', background: '#1e1e1e', color: '#e5e5e5',
                  border: 'none', borderRadius: 4, fontSize: 13, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Pair Wizard */}
      {showPairWizard && (
        <PairWizard
          onClose={() => setShowPairWizard(false)}
          onDone={fetchConfig}
        />
      )}
    </div>
  </div>
  );
}