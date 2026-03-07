'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface DockerContainer {
  name: string;
  running: boolean;
  status: string;
}

interface SystemdService {
  name: string;
  active: boolean;
  status: string;
}

interface ServiceStatus {
  id: string;
  name: string;
  is_up: boolean;
  status: 'up' | 'down' | 'unstable';
  group: string;
  is_disabled: boolean;
  response_time_ms: number;
  failure_count: number;
  icon: string;
  type: string;
  details?: {
    docker_containers?: DockerContainer[];
    systemd_services?: SystemdService[];
    [key: string]: unknown;
  };
}

interface StatusResponse {
  services: ServiceStatus[];
  checked_at: string;
  server_name?: string;
  group_order?: string[];
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'up' ? '#22c55e' : status === 'unstable' ? '#f59e0b' : '#ef4444';
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: color,
        flexShrink: 0,
        animation: status === 'up' ? 'pulse-dot 2s ease-in-out infinite' : 'none',
      }}
    />
  );
}


interface HourBucket {
  hour: string;
  up: number;
  unstable: number;
  down: number;
  total: number;
}

function UptimeBars({ buckets }: { buckets: HourBucket[] }) {
  const slots = 90;
  const now = new Date();

  const hours = Array.from({ length: slots }, (_, i) => {
    const d = new Date(now);
    d.setHours(d.getHours() - (slots - 1 - i), 0, 0, 0);
    return d.toISOString().slice(0, 13);
  });

  const allBuckets = buckets.filter(b => b.total > 0);
  const totalChecks = allBuckets.reduce((s, b) => s + b.total, 0);
  const upChecks = allBuckets.reduce((s, b) => s + b.up, 0);
  const uptimeVal = totalChecks > 0 ? ((upChecks / totalChecks) * 100).toFixed(2) : '';

  const bucketMap = new Map(buckets.map(b => [b.hour, b]));

  return (
    <div style={{ marginTop: '6px' }}>
      <div style={{ display: 'flex', gap: '1.5px', alignItems: 'flex-end', height: '20px' }}>
        {hours.map(hour => {
          const b = bucketMap.get(hour);
          let color = '#2a2a2a';
          if (b && b.total > 0) {
            const upRate = b.up / b.total;
            const downRate = b.down / b.total;
            if (downRate > 0.5) color = '#ef4444';
            else if (downRate > 0.1 || upRate < 0.9) color = '#f59e0b';
            else color = '#22c55e';
          }
          const label = b ? `${hour}:00 \u2014 ${b.up}/${b.total} up` : `${hour}:00 \u2014 no data`;
          return (
            <div
              key={hour}
              title={label}
              style={{
                flex: 1,
                height: '100%',
                backgroundColor: color,
                borderRadius: '1px',
                transition: 'opacity 0.1s',
                cursor: 'default',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2px', fontSize: '10px', color: '#444' }}>
        <span>90 hours ago</span>
        <span style={{ color: !uptimeVal ? '#444' : parseFloat(uptimeVal) >= 99 ? '#22c55e' : '#f59e0b' }}>
          {!uptimeVal ? 'No data' : `${uptimeVal}% uptime`}
        </span>
        <span>now</span>
      </div>
    </div>
  );
}

function ServiceRow({ service, buckets }: { service: ServiceStatus; buckets: HourBucket[] }) {
  const statusColor =
    service.status === 'up' ? '#22c55e' : service.status === 'unstable' ? '#f59e0b' : '#ef4444';
  return (
    <div
      style={{
        padding: '12px 16px',
        background: '#111111',
        border: '1px solid #1e1e1e',
        borderRadius: 6,
        transition: 'border-color 0.15s',
        cursor: 'default',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = '#333')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = '#1e1e1e')}
    >
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <StatusDot status={service.status} />
      <span style={{ color: '#e5e5e5', fontSize: 14, whiteSpace: 'nowrap' }}>
        {service.name}
      </span>
      <span style={{ flex: 1, borderBottom: '1px solid #1e1e1e', height: 1, margin: '0 4px' }} />
      <span style={{ color: statusColor, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>
        {service.status}
      </span>
      <span style={{ color: '#555', fontSize: 12, whiteSpace: 'nowrap' }}>
        {service.response_time_ms}ms
      </span>
    </div>
    <UptimeBars buckets={buckets} />
    {service.details?.docker_containers && service.details.docker_containers.length > 0 && (
      <div style={{ marginTop: 6, paddingLeft: 20 }}>
        {service.details.docker_containers.map((c: DockerContainer) => (
          <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0', fontSize: 12 }}>
            <span style={{
              display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
              backgroundColor: c.running ? '#22c55e' : '#ef4444',
            }} />
            <span style={{ color: '#888' }}>{c.name}</span>
            <span style={{ flex: 1, borderBottom: '1px solid #1a1a1a', height: 1, margin: '0 4px' }} />
            <span style={{ color: c.running ? '#22c55e' : '#ef4444', fontSize: 11 }}>{c.status}</span>
          </div>
        ))}
      </div>
    )}
    {service.details?.systemd_services && service.details.systemd_services.length > 0 && (
      <div style={{ marginTop: 6, paddingLeft: 20 }}>
        {service.details.systemd_services.map((s: SystemdService) => (
          <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0', fontSize: 12 }}>
            <span style={{
              display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
              backgroundColor: s.active ? '#22c55e' : '#ef4444',
            }} />
            <span style={{ color: '#888' }}>{s.name}</span>
            <span style={{ flex: 1, borderBottom: '1px solid #1a1a1a', height: 1, margin: '0 4px' }} />
            <span style={{ color: s.active ? '#22c55e' : '#ef4444', fontSize: 11 }}>{s.status}</span>
          </div>
        ))}
      </div>
    )}
    </div>
  );
}



export default function Dashboard() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [history, setHistory] = useState<Record<string, HourBucket[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(30);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
      setLastRefresh(new Date());
      setCountdown(30);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const refresh = setInterval(fetchStatus, 30000);
    const tick = setInterval(() => setCountdown(c => (c > 0 ? c - 1 : 0)), 1000);
    return () => { clearInterval(refresh); clearInterval(tick); };
  }, [fetchStatus]);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch('/api/history', { cache: 'no-store' });
        if (res.ok) setHistory(await res.json());
      } catch {}
    };
    fetchHistory();
    const interval = setInterval(fetchHistory, 60000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <span style={{ color: '#555', fontSize: 14 }}>Loading...</span>
      </div>
    );
  }

  const services = data?.services || [];
  const unsortedGroups = new Map<string, ServiceStatus[]>();
  services.forEach(s => {
    if (s.group === 'hidden') return;
    const list = unsortedGroups.get(s.group) || [];
    list.push(s);
    unsortedGroups.set(s.group, list);
  });
  const groupOrder = data?.group_order || [];
  const groups = new Map<string, ServiceStatus[]>();
  groupOrder.forEach(g => {
    if (unsortedGroups.has(g)) {
      groups.set(g, unsortedGroups.get(g)!);
      unsortedGroups.delete(g);
    }
  });
  unsortedGroups.forEach((v, k) => groups.set(k, v));

  const upCount = services.filter(s => s.status === 'up').length;
  const total = services.length;
  const allUp = services.every(s => s.status === 'up');

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, color: '#e5e5e5', margin: 0 }}>Status</h1>
        <span style={{ fontSize: 12, color: '#555' }}>
          {upCount}/{total} up
          {lastRefresh && <> · {lastRefresh.toLocaleTimeString()}</>}
        </span>
      </div>

      {/* Overall status */}
      <div
        style={{
          padding: '10px 16px',
          background: '#111111',
          border: '1px solid #1e1e1e',
          borderLeft: `3px solid ${allUp ? '#22c55e' : '#f59e0b'}`,
          borderRadius: 6,
          marginBottom: 32,
          fontSize: 13,
          color: allUp ? '#22c55e' : '#f59e0b',
        }}
      >
        {allUp ? 'All systems operational' : `${total - upCount} service(s) degraded`}
      </div>

      {/* Groups */}
      {Array.from(groups.entries()).map(([groupName, groupServices]) => (
        <div key={groupName} style={{ marginBottom: 28 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: '#555',
              marginBottom: 8,
              paddingBottom: 6,
              borderBottom: '1px solid #1e1e1e',
            }}
          >
            {groupName}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {groupServices.map(s => (
              <ServiceRow key={s.name} service={s} buckets={history[s.id] || []} />
            ))}
          </div>
        </div>
      ))}

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 32,
          fontSize: 11,
          color: '#555',
        }}
      >
        <span>{countdown > 0 ? `Refresh in ${countdown}s` : 'Refreshing...'}</span>
        <Link href="/login" style={{ color: '#333', textDecoration: 'none' }}>
          {data?.server_name || 'admin'}
        </Link>
      </div>

      {error && (
        <div style={{ marginTop: 12, fontSize: 12, color: '#ef4444' }}>
          Error: {error}
        </div>
      )}
    </div>
  );
}
