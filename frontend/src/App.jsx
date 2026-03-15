import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

/* ═══════════════════════════════════════════
   AGENT / COLOR CONFIG (professional palette)
   ═══════════════════════════════════════════ */
const AGENT_COLORS = {
  'UCB1':       '#3b82f6',
  'UCB-V':      '#8b5cf6',
  'OCO-OGD':    '#f97316',
  'FixedTimer': '#94a3b8',
  'Random':     '#ef4444',
};

const ARM_LABELS = ['20s', '35s', '50s', '65s', '80s'];

/* ═══════════════════════════════════════════
   TRAFFIC LIGHT VISUALIZER
   ═══════════════════════════════════════════ */
function TrafficLightVisualizer({ step, hourlyVolumes }) {
  const hour = step % 24;
  const volume = hourlyVolumes ? hourlyVolumes[hour] : 0;
  const cycle = step % 3; // 0=green, 1=yellow, 2=red

  const phaseText = cycle === 0 ? 'GREEN' : cycle === 1 ? 'YELLOW' : 'RED';
  const phaseColor = cycle === 0 ? '#22c55e' : cycle === 1 ? '#eab308' : '#ef4444';

  return (
    <div className="card">
      <div className="card-title"><span className="icon">🚦</span> Intersection Status</div>
      <div className="traffic-intersection">
        <div className="signal-pole">
          <div className={`signal-light ${cycle === 2 ? 'red-on' : ''}`}></div>
          <div className={`signal-light ${cycle === 1 ? 'yellow-on' : ''}`}></div>
          <div className={`signal-light ${cycle === 0 ? 'green-on' : ''}`}></div>
        </div>
        <div className="intersection-info">
          <div className="phase-label" style={{ color: phaseColor }}>
            ● {phaseText}
          </div>
          <div className="vehicle-count">
            Traffic Volume: <span>{Math.round(volume)}</span> veh/hr
          </div>
          <div className="step-label">
            Step {step} — Hour {hour}:00
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   UCB STATE TABLE
   ═══════════════════════════════════════════ */
function UCBStateTable({ ucbState, agentKey }) {
  if (!ucbState || !ucbState[agentKey]) return null;
  const arms = ucbState[agentKey];

  return (
    <div className="ucb-table-wrap">
      <table className="ucb-table">
        <thead>
          <tr>
            <th>Arm</th>
            <th>Green</th>
            <th>Pulls</th>
            <th>Mean Reward</th>
            {agentKey === 'UCB-V' && <th>Variance</th>}
            <th>Bonus</th>
            <th>UCB Value</th>
          </tr>
        </thead>
        <tbody>
          {arms.map((a) => (
            <tr key={a.arm}>
              <td>{a.arm}</td>
              <td>{a.green}s</td>
              <td>
                <span className="heatmap-cell">{a.count}</span>
              </td>
              <td>{a.mean_reward?.toFixed(4) ?? '—'}</td>
              {agentKey === 'UCB-V' && <td>{a.variance?.toFixed(4) ?? '—'}</td>}
              <td style={{ color: '#f97316' }}>{a.bonus === Infinity ? '∞' : a.bonus?.toFixed(4)}</td>
              <td style={{ color: '#3b82f6', fontWeight: 600 }}>{a.ucb === Infinity ? '∞' : a.ucb?.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ═══════════════════════════════════════════
   CUMULATIVE REGRET CHART
   ═══════════════════════════════════════════ */
function RegretChart({ agents }) {
  const data = buildTimeSeriesData(agents, 'regret_history');
  return (
    <div className="card span-2">
      <div className="card-title"><span className="icon">📈</span> Cumulative Regret</div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="t" stroke="#94a3b8" tick={{ fontSize: 11 }} />
          <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontFamily: 'Inter' }} />
          <Legend wrapperStyle={{ fontFamily: 'Inter', fontSize: 12 }} />
          {Object.keys(AGENT_COLORS).map(name => (
            <Line key={name} type="monotone" dataKey={name} stroke={AGENT_COLORS[name]}
                  dot={false} strokeWidth={2} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ═══════════════════════════════════════════
   AVERAGE DELAY CHART
   ═══════════════════════════════════════════ */
function DelayChart({ agents }) {
  const data = buildTimeSeriesData(agents, 'delay_history');
  return (
    <div className="card span-2">
      <div className="card-title"><span className="icon">⏱️</span> Average Delay</div>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="t" stroke="#94a3b8" tick={{ fontSize: 11 }} />
          <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontFamily: 'Inter' }} />
          <Legend wrapperStyle={{ fontFamily: 'Inter', fontSize: 12 }} />
          {Object.keys(AGENT_COLORS).map(name => (
            <Area key={name} type="monotone" dataKey={name} stroke={AGENT_COLORS[name]}
                  fill={AGENT_COLORS[name] + '22'} strokeWidth={2} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ═══════════════════════════════════════════
   PERFORMANCE RANKING
   ═══════════════════════════════════════════ */
function PerformanceRanking({ agents, metric, label }) {
  if (!agents) return null;
  const items = Object.entries(agents)
    .map(([name, data]) => ({ name, value: metric === 'regret' ? data.cumulative_regret : data.average_delay }))
    .sort((a, b) => a.value - b.value);
  const maxVal = Math.max(...items.map(i => i.value), 1);
  const gradients = [
    'linear-gradient(90deg, #22c55e, #3b82f6)',
    'linear-gradient(90deg, #3b82f6, #8b5cf6)',
    'linear-gradient(90deg, #8b5cf6, #f97316)',
    'linear-gradient(90deg, #f97316, #ef4444)',
    'linear-gradient(90deg, #ef4444, #94a3b8)',
  ];

  return (
    <div className="card">
      <div className="card-title"><span className="icon">🏆</span> {label}</div>
      <div className="ranking-list">
        {items.map((item, i) => (
          <div className="ranking-item" key={item.name}>
            <span className="rank">#{i + 1}</span>
            <span className="name">{item.name}</span>
            <div className="bar-track">
              <div className="bar-fill"
                   style={{ width: `${(item.value / maxVal) * 100}%`, background: gradients[i] }}>
              </div>
            </div>
            <span className="bar-value">{item.value.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   ARM SELECTION BAR CHART
   ═══════════════════════════════════════════ */
function ArmSelectionChart({ agents }) {
  if (!agents) return null;
  const ucb1 = agents['UCB1'];
  const ucbv = agents['UCB-V'];
  if (!ucb1 || !ucbv) return null;

  const data = ARM_LABELS.map((label, i) => ({
    arm: label,
    'UCB1': ucb1.arm_counts[i],
    'UCB-V': ucbv.arm_counts[i],
  }));

  return (
    <div className="card">
      <div className="card-title"><span className="icon">📊</span> Arm Selection — UCB1 vs UCB-V</div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="arm" stroke="#94a3b8" tick={{ fontSize: 11 }} />
          <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontFamily: 'Inter' }} />
          <Legend wrapperStyle={{ fontFamily: 'Inter', fontSize: 12 }} />
          <Bar dataKey="UCB1" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          <Bar dataKey="UCB-V" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ═══════════════════════════════════════════
   FORMULA DISPLAY
   ═══════════════════════════════════════════ */
function FormulaDisplay() {
  return (
    <div className="card span-3">
      <div className="card-title"><span className="icon">📐</span> Algorithm Formulas</div>
      <div className="formula-grid">
        <div className="formula-box">
          <div className="formula-name">UCB1</div>
          <div className="formula-text">
            a_t = argmax [ μ̂_a + C · √( ln(t) / n_a ) ]
            <br /><br />
            C = exploration parameter
            <br />
            μ̂_a = empirical mean reward of arm a
          </div>
        </div>
        <div className="formula-box">
          <div className="formula-name">UCB-V (Variance-aware)</div>
          <div className="formula-text">
            a_t = argmax [ μ̂_a + √( 2σ̂² · ln(t) / n_a ) + 3b · ln(t) / n_a ]
            <br /><br />
            σ̂² = empirical variance
            <br />
            b = range parameter
          </div>
        </div>
        <div className="formula-box">
          <div className="formula-name">OCO — Online Gradient Descent</div>
          <div className="formula-text">
            x_(t+1) = Π_X [ x_t − η_t · g_t ]
            <br /><br />
            η_t = C / √t (learning rate)
            <br />
            Π_X = projection onto simplex
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   CONTROL PANEL
   ═══════════════════════════════════════════ */
function ControlPanel({ onReset, onStep, onLiveRun, onPause, onRunFull, isRunning, stepN, setStepN, totalT, setTotalT }) {
  return (
    <div className="control-panel">
      <button className="btn danger" onClick={onReset} id="btn-reset">⟲ Reset</button>

      <div className="input-group">
        <label>Steps:</label>
        <input type="number" min={1} max={500} value={stepN} onChange={e => setStepN(Number(e.target.value) || 1)} id="input-steps" />
      </div>
      <button className="btn primary" onClick={onStep} id="btn-step">▶ Step ×N</button>

      {!isRunning ? (
        <button className="btn orange" onClick={onLiveRun} id="btn-live">⚡ Live Run</button>
      ) : (
        <button className="btn danger" onClick={onPause} id="btn-pause">⏸ Pause</button>
      )}

      <div className="input-group">
        <label>Total T:</label>
        <input type="number" min={1} max={10000} value={totalT} onChange={e => setTotalT(Number(e.target.value) || 500)} id="input-T" />
      </div>
      <button className="btn primary" onClick={onRunFull} id="btn-run-full">🚀 Run Full</button>
    </div>
  );
}

/* ═══════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════ */
function buildTimeSeriesData(agents, key) {
  if (!agents) return [];
  const names = Object.keys(agents);
  const maxLen = Math.max(...names.map(n => (agents[n][key] || []).length), 0);
  const step = maxLen > 500 ? Math.ceil(maxLen / 500) : 1;
  const data = [];
  for (let i = 0; i < maxLen; i += step) {
    const point = { t: i + 1 };
    for (const n of names) {
      const arr = agents[n][key] || [];
      point[n] = arr[i] ?? null;
    }
    data.push(point);
  }
  return data;
}

/* ═══════════════════════════════════════════
   APP ROOT
   ═══════════════════════════════════════════ */
export default function App() {
  const [agents, setAgents] = useState(null);
  const [ucbState, setUcbState] = useState(null);
  const [config, setConfig] = useState(null);
  const [step, setStep] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [stepN, setStepN] = useState(10);
  const [totalT, setTotalT] = useState(500);
  const intervalRef = useRef(null);

  // Fetch config on mount
  useEffect(() => {
    axios.get('/api/config').then(r => setConfig(r.data)).catch(() => {});
    axios.get('/api/summary').then(r => {
      setAgents(r.data.agents);
      setStep(r.data.t);
    }).catch(() => {});
  }, []);

  const fetchState = useCallback(async () => {
    try {
      const [summ, ucb] = await Promise.all([
        axios.get('/api/summary'),
        axios.get('/api/ucb_state'),
      ]);
      setAgents(summ.data.agents);
      setStep(summ.data.t);
      setUcbState(ucb.data);
    } catch (e) { /* ignore */ }
  }, []);

  const handleReset = async () => {
    setIsRunning(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
    await axios.post('/api/reset');
    setAgents(null);
    setUcbState(null);
    setStep(0);
  };

  const handleStep = async () => {
    await axios.post('/api/step', { n_steps: stepN });
    fetchState();
  };

  const handleLiveRun = () => {
    setIsRunning(true);
    intervalRef.current = setInterval(async () => {
      await axios.post('/api/step', { n_steps: 5 });
      fetchState();
    }, 400);
  };

  const handlePause = () => {
    setIsRunning(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
  };

  const handleRunFull = async () => {
    setIsRunning(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
    await axios.post('/api/run_full', { T: totalT });
    fetchState();
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  return (
    <div className="app-wrapper">
      {/* Header */}
      <header className="app-header">
        <h1>Traffic Signal Optimizer</h1>
        <p className="subtitle">Multi-Armed Bandit & Online Convex Optimization Dashboard</p>
        <div className="regret-guarantee">Regret Guarantee: O(log T) for UCB algorithms</div>
      </header>

      {/* Controls */}
      <ControlPanel
        onReset={handleReset}
        onStep={handleStep}
        onLiveRun={handleLiveRun}
        onPause={handlePause}
        onRunFull={handleRunFull}
        isRunning={isRunning}
        stepN={stepN}
        setStepN={setStepN}
        totalT={totalT}
        setTotalT={setTotalT}
      />

      {/* Status */}
      <div className="status-bar">
        {isRunning ? <span className="live">● LIVE — Running simulation…</span> : `Total steps: ${step}`}
      </div>

      {/* Dashboard */}
      <div className="dashboard-grid">
        {/* Row 1: Traffic light + UCB tables */}
        <TrafficLightVisualizer step={step} hourlyVolumes={config?.hourly_volumes} />
        <div className="card span-2">
          <div className="card-title"><span className="icon">🎯</span> UCB1 Arm State</div>
          <UCBStateTable ucbState={ucbState} agentKey="UCB1" />
          <div style={{ marginTop: 20 }}>
            <div className="card-title"><span className="icon">🎲</span> UCB-V Arm State</div>
            <UCBStateTable ucbState={ucbState} agentKey="UCB-V" />
          </div>
        </div>

        {/* Row 2: Regret chart + ranking */}
        <RegretChart agents={agents} />
        <PerformanceRanking agents={agents} metric="regret" label="Ranking by Regret (lower = better)" />

        {/* Row 3: Delay chart + ranking */}
        <DelayChart agents={agents} />
        <PerformanceRanking agents={agents} metric="delay" label="Ranking by Avg Delay (lower = better)" />

        {/* Row 4: Arm selection + Formulas */}
        <ArmSelectionChart agents={agents} />
        <FormulaDisplay />
      </div>
    </div>
  );
}
