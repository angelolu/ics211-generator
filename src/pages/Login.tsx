import * as Label from '@radix-ui/react-label';
import { KeyRound, Loader2, LogIn, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { verifyTokenAndGetContext } from '../api/d4h';

export function Login() {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const savedToken = localStorage.getItem('d4h_token');
    const skipLogin = localStorage.getItem('d4h_skip_login');
    if (savedToken || skipLogin === 'true') {
      if (savedToken) setToken(savedToken);
      navigate('/dashboard');
    }
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) { setError('Please enter a valid token'); return; }
    setIsLoading(true);
    setError('');
    try {
      localStorage.setItem('d4h_token', token.trim());
      const context = await verifyTokenAndGetContext();
      localStorage.setItem('d4h_context_id', context.contextId.toString());
      localStorage.setItem('d4h_team_title', context.title);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to authenticate');
      localStorage.removeItem('d4h_token');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        background: 'linear-gradient(145deg, #020e22 0%, #061B44 50%, #033530 100%)',
      }}
    >
      {/* Ambient glow orbs */}
      <div
        style={{
          position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden',
          zIndex: 0,
        }}
      >
        <div style={{
          position: 'absolute', top: '15%', left: '20%',
          width: 400, height: 400, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(220,195,148,0.08) 0%, transparent 70%)',
        }} />
        <div style={{
          position: 'absolute', bottom: '20%', right: '15%',
          width: 300, height: 300, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(4,78,68,0.18) 0%, transparent 70%)',
        }} />
      </div>

      <div
        className="glass-card animate-slide-up"
        style={{ maxWidth: 420, width: '100%', padding: 40, position: 'relative', zIndex: 1 }}
      >
        {/* Logo / brand */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{
            width: 64, height: 64, borderRadius: 18,
            background: 'linear-gradient(145deg, #0d2d66, #061B44)',
            border: '1.5px solid rgba(220,195,148,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px',
            boxShadow: '0 8px 32px rgba(6,27,68,0.5), 0 0 0 6px rgba(220,195,148,0.08)',
          }}>
            <KeyRound size={28} color="white" strokeWidth={2} />
          </div>
          <h1 style={{
            fontSize: '1.75rem', fontWeight: 800, color: 'white',
            letterSpacing: '-0.02em', marginBottom: 6,
          }}>
            ICS-211 Roster Generator
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.5)' }}>
            Generate rosters from D4H
          </p>
        </div>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <Label.Root
              htmlFor="token"
              style={{
                display: 'block', fontSize: '0.8125rem', fontWeight: 600,
                color: 'rgba(255,255,255,0.7)', marginBottom: 8, letterSpacing: '0.01em',
              }}
            >
              Personal Access Token
            </Label.Root>
            <input
              id="token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="input input-dark"
              placeholder="Enter your D4H token…"
              autoComplete="current-password"
            />
            {error && (
              <div style={{
                marginTop: 8, display: 'flex', alignItems: 'center', gap: 6,
                fontSize: '0.8125rem', color: '#f87171',
              }}>
                <span>⚠</span> {error}
              </div>
            )}
            <div style={{ marginTop: 8, textAlign: 'right' }}>
              <a 
                href="https://myaccount.us.d4h.com/tokens" 
                target="_blank" 
                rel="noreferrer"
                style={{ fontSize: '0.8125rem', color: 'rgba(220,195,148,0.9)', textDecoration: 'none' }}
                onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
              >
                Get a personal access token
              </a>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              type="submit"
              disabled={isLoading}
              className="btn btn-primary btn-lg"
              style={{ width: '100%', fontWeight: 700, letterSpacing: '0.01em' }}
            >
              {isLoading
                ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                : <><LogIn size={18} /> Connect to D4H</>
              }
            </button>
            
            <button
              type="button"
              onClick={() => {
                localStorage.setItem('d4h_skip_login', 'true');
                navigate('/dashboard');
              }}
              className="btn btn-secondary btn-lg"
              style={{ width: '100%', fontWeight: 700, letterSpacing: '0.01em', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: 'white' }}
            >
              Skip & Use Locally
            </button>
          </div>
        </form>

        <div style={{
          marginTop: 28, display: 'flex', alignItems: 'flex-start', gap: 10,
          padding: '14px 16px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 10,
        }}>
          <ShieldCheck size={16} style={{ color: 'rgba(255,255,255,0.35)', flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.35)', lineHeight: 1.5 }}>
            Your token is stored only in your browser and sent exclusively to the official D4H API.
          </p>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
