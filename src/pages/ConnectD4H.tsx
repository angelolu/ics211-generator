import { AlertCircle, CheckCircle2, ExternalLink, Loader2, LogIn, LogOut, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import d4hLogo from '../assets/d4h_tech_orange.png';
import { getD4HErrorMessage, verifyTokenAndGetContext } from '../api/d4h';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export function ConnectD4H() {
  useDocumentTitle('Connect to D4H');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [currentTeam, setCurrentTeam] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const savedToken = localStorage.getItem('d4h_token');
    const teamTitle = localStorage.getItem('d4h_team_title');
    if (savedToken) {
      setToken(savedToken);
      if (teamTitle) {
        setCurrentTeam(teamTitle);
      }
    }
  }, []);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) {
      setError('Please enter a valid token');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      localStorage.setItem('d4h_token', token.trim());
      const context = await verifyTokenAndGetContext();
      localStorage.setItem('d4h_context_id', context.contextId.toString());
      localStorage.setItem('d4h_team_title', context.title);
      localStorage.removeItem('d4h_skip_login');
      setIsExiting(true);
      setTimeout(() => {
        navigate('/dashboard');
      }, 650);
    } catch (err: any) {
      setError(getD4HErrorMessage(err, 'Failed to authenticate with D4H'));
      localStorage.removeItem('d4h_token');
      localStorage.removeItem('d4h_context_id');
      localStorage.removeItem('d4h_team_title');
      setIsLoading(false);
    }
  };

  const handleReturnToDashboard = () => {
    setIsExiting(true);
    setTimeout(() => {
      navigate('/dashboard');
    }, 650);
  };

  const handleDisconnect = () => {
    ['d4h_token', 'd4h_context_id', 'd4h_team_title', 'd4h_member_id', 'd4h_member_name', 'd4h_team_subdomain'].forEach((k) => localStorage.removeItem(k));
    setToken('');
    setCurrentTeam(null);
  };

  return (
    <div className="connect-d4h-wrapper">
      {/* Expanding/shrinking wipe overlay between header and fullscreen */}
      <div className={`menu-wipe-overlay ${isExiting ? 'exiting' : ''}`} />

      {/* Ambient background glow gradient */}
      <div className={`ambient-glow-container ${isExiting ? 'exiting' : ''}`}>
        <div className="glow-orb glow-orb-1" />
        <div className="glow-orb glow-orb-2" />
      </div>

      {/* Main Centered White Wizard Card */}
      <div className={`wizard-card-container ${isExiting ? 'exiting' : ''}`}>
        {/* Top line: Title on left, D4H logo on right */}
        <div className="wizard-header">
          <div className="wizard-header-left">
            <h1 className="wizard-title">Connect to D4H</h1>
            <p className="wizard-subtitle">Connect to D4H to sync activities, events, and team rosters.</p>
          </div>
          <div className="wizard-header-right">
            <img src={d4hLogo} alt="D4H Logo" className="d4h-logo-img" />
          </div>
        </div>

        {/* Optional Connected Organization status banner */}
        {currentTeam && (
          <div className="connected-status-banner">
            <div className="connected-status-text">
              <CheckCircle2 size={16} className="text-emerald-600" />
              <span>
                Currently connected to <strong className="text-slate-900">{currentTeam}</strong>
              </span>
            </div>
            <button type="button" onClick={handleDisconnect} className="disconnect-link-btn">
              <LogOut size={13} /> Disconnect
            </button>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="wizard-error-banner">
            <AlertCircle size={18} className="wizard-error-icon" />
            <div className="wizard-error-text">{error}</div>
          </div>
        )}

        {/* Wizard Steps Form */}
        <form onSubmit={handleConnect} className="wizard-form">
          <div className="wizard-steps-list">
            {/* Step 1 */}
            <div className="wizard-step-item">
              <div className="step-badge">1</div>
              <div className="step-content">
                <div className="step-header-row">
                  <div className="step-instruction">
                    Open the <strong>D4H Personal Access Tokens</strong> page
                  </div>
                  <a
                    href="https://myaccount.us.d4h.com/tokens"
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-secondary btn-sm open-tokens-btn"
                  >
                    <ExternalLink size={13} />
                    Open Tokens Page
                  </a>
                </div>
              </div>
            </div>

            {/* Step 2 */}
            <div className="wizard-step-item">
              <div className="step-badge">2</div>
              <div className="step-content">
                <div className="step-instruction">
                  Press <strong>Create Token</strong> and give access to &ldquo;Personnel &amp; Training, Equipment Management and Incident Reporting&rdquo;
                </div>
              </div>
            </div>

            {/* Step 3 */}
            <div className="wizard-step-item">
              <div className="step-badge">3</div>
              <div className="step-content">
                <label htmlFor="token" className="step-instruction step-label">
                  Paste the token shown on the page below
                </label>
                <div className="token-input-wrapper">
                  <input
                    id="token"
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className="input token-text-input"
                    placeholder=""
                    autoComplete="current-password"
                    autoFocus
                  />
                </div>
                <p className="token-note">
                  <ShieldCheck size={14} className="shield-icon" />
                  Your token is stored in your browser and used to connect to D4H.
                </p>
              </div>
            </div>
          </div>

          {/* Bottom Action Buttons */}
          <div className="wizard-actions-bar">
            <button
              type="button"
              onClick={handleReturnToDashboard}
              className="btn btn-secondary outline-dashboard-btn"
            >
              Return to Dashboard
            </button>

            <button
              type="submit"
              disabled={!token.trim() || isLoading}
              className="btn btn-primary connect-submit-btn"
            >
              {isLoading ? (
                <>
                  <Loader2 size={16} className="btn-spinner" />
                  Connecting…
                </>
              ) : (
                <>
                  <LogIn size={16} />
                  {currentTeam ? 'Update Connection' : 'Connect'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      <style>{`
        /* ── Fullscreen Page Wrapper ── */
        .connect-d4h-wrapper {
          min-height: 100vh;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px 16px;
          overflow: hidden;
          background-color: var(--slate-1);
        }

        /* ── Top-Down Growing / Shrinking Menu Wipe Animation ── */
        .menu-wipe-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(160deg, #020e22 0%, #061B44 50%, #033530 100%);
          transform-origin: top;
          animation: menuBarWipe 0.65s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          z-index: 0;
        }

        .menu-wipe-overlay.exiting {
          animation: menuBarWipeUp 0.45s cubic-bezier(0.16, 1, 0.3, 1) 0.18s forwards;
        }

        @keyframes menuBarWipe {
          0% {
            transform: scaleY(0.06);
            opacity: 0.95;
          }
          100% {
            transform: scaleY(1);
            opacity: 1;
          }
        }

        @keyframes menuBarWipeUp {
          0% {
            transform: scaleY(1);
            opacity: 1;
          }
          100% {
            transform: scaleY(0.06);
            opacity: 0.95;
          }
        }

        /* ── Ambient Glowing Orbs ── */
        .ambient-glow-container {
          position: fixed;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
          z-index: 1;
          animation: bgGradientFade 0.9s ease-out forwards;
        }

        .ambient-glow-container.exiting {
          animation: bgGradientFadeOut 0.25s ease-in forwards;
        }

        @keyframes bgGradientFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes bgGradientFadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }

        .glow-orb {
          position: absolute;
          border-radius: 50%;
        }

        .glow-orb-1 {
          top: 10%;
          left: 15%;
          width: 450px;
          height: 450px;
          background: radial-gradient(circle, rgba(220, 195, 148, 0.12) 0%, transparent 70%);
        }

        .glow-orb-2 {
          bottom: 15%;
          right: 12%;
          width: 380px;
          height: 380px;
          background: radial-gradient(circle, rgba(4, 78, 68, 0.25) 0%, transparent 70%);
        }

        /* ── Main Centered Light Container Card ── */
        .wizard-card-container {
          position: relative;
          z-index: 2;
          width: 100%;
          max-width: 680px;
          background: #ffffff;
          border-radius: 18px;
          padding: 36px 40px;
          box-shadow: 0 25px 65px -10px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.15);
          animation: cardEntrance 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both;
        }

        .wizard-card-container.exiting {
          animation: cardExit 0.28s cubic-bezier(0.4, 0, 1, 1) forwards;
        }

        @keyframes cardEntrance {
          0% {
            opacity: 0;
            transform: translateY(24px) scale(0.97);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes cardExit {
          0% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          100% {
            opacity: 0;
            transform: translateY(-14px) scale(0.97);
          }
        }

        /* ── Header Row (Title on left, Logo on right) ── */
        .wizard-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          padding-bottom: 20px;
          border-bottom: 1px solid var(--slate-3);
        }

        .wizard-header-left {
          flex: 1;
          min-width: 0;
        }

        .wizard-title {
          font-size: 1.5rem;
          font-weight: 800;
          color: var(--slate-12);
          letter-spacing: -0.02em;
          line-height: 1.2;
          margin: 0;
        }

        .wizard-subtitle {
          font-size: 0.875rem;
          color: var(--slate-10);
          margin-top: 6px;
          line-height: 1.4;
        }

        .wizard-header-right {
          flex-shrink: 0;
          display: flex;
          align-items: center;
        }

        .d4h-logo-img {
          height: 36px;
          width: auto;
          max-width: 130px;
          object-fit: contain;
        }

        /* ── Connected Status Banner ── */
        .connected-status-banner {
          margin-top: 20px;
          padding: 10px 14px;
          background: #ecfdf5;
          border: 1px solid #a7f3d0;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .connected-status-text {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.875rem;
          color: #065f46;
        }

        .disconnect-link-btn {
          background: transparent;
          border: none;
          color: #dc2626;
          font-size: 0.8125rem;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 6px;
          transition: background 0.15s;
        }

        .disconnect-link-btn:hover {
          background: #fee2e2;
        }

        /* ── Error Banner ── */
        .wizard-error-banner {
          margin-top: 20px;
          padding: 12px 14px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 8px;
          display: flex;
          align-items: flex-start;
          gap: 10px;
        }

        .wizard-error-icon {
          color: #ef4444;
          flex-shrink: 0;
          margin-top: 2px;
        }

        .wizard-error-text {
          font-size: 0.875rem;
          color: #991b1b;
          line-height: 1.45;
        }

        /* ── Wizard Steps ── */
        .wizard-form {
          margin-top: 24px;
        }

        .wizard-steps-list {
          display: flex;
          flex-direction: column;
          gap: 22px;
        }

        .wizard-step-item {
          display: flex;
          align-items: flex-start;
          gap: 16px;
        }

        .step-badge {
          width: 26px;
          height: 26px;
          border-radius: 50%;
          background: var(--navy-9);
          color: #ffffff;
          font-weight: 700;
          font-size: 0.8125rem;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          box-shadow: 0 2px 6px rgba(6, 27, 68, 0.25);
          margin-top: 1px;
        }

        .step-content {
          flex: 1;
          min-width: 0;
        }

        .step-header-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }

        .step-instruction {
          font-size: 0.875rem;
          color: var(--slate-12);
          line-height: 1.5;
        }

        .step-instruction strong {
          color: var(--slate-12);
          font-weight: 700;
        }

        .step-label {
          display: block;
          cursor: pointer;
        }

        .open-tokens-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-weight: 600;
          font-size: 0.8125rem;
          padding: 6px 12px;
          text-decoration: none;
          border-radius: 7px;
          white-space: nowrap;
        }

        .scope-callout {
          margin-top: 8px;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: var(--navy-1);
          border: 1px solid var(--navy-3);
          border-radius: 8px;
        }

        .scope-icon {
          color: var(--navy-8);
          flex-shrink: 0;
        }

        .scope-text {
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--navy-9);
          letter-spacing: -0.01em;
        }

        .token-input-wrapper {
          margin-top: 8px;
        }

        .token-text-input {
          font-size: 0.9375rem;
          padding: 10px 14px;
          border-radius: 8px;
          border: 1.5px solid var(--slate-4);
          background: #ffffff;
          color: var(--slate-12);
          transition: border-color 0.15s, box-shadow 0.15s;
        }

        .token-text-input:focus {
          border-color: var(--navy-7);
          box-shadow: 0 0 0 3px rgba(26, 68, 128, 0.15);
        }

        .token-note {
          font-size: 0.75rem;
          color: var(--slate-9);
          margin-top: 8px;
          display: flex;
          align-items: center;
          gap: 6px;
          line-height: 1.4;
        }

        .shield-icon {
          color: var(--slate-8);
          flex-shrink: 0;
        }

        /* ── Actions Bar ── */
        .wizard-actions-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          margin-top: 30px;
          padding-top: 22px;
          border-top: 1px solid var(--slate-3);
        }

        .outline-dashboard-btn {
          font-weight: 600;
          font-size: 0.875rem;
          padding: 9px 18px;
          border-radius: 8px;
          border: 1.5px solid var(--slate-4);
          background: #ffffff;
          color: var(--slate-11);
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: all 0.15s;
        }

        .outline-dashboard-btn:hover {
          background: var(--slate-2);
          color: var(--slate-12);
          border-color: var(--slate-5);
        }

        .connect-submit-btn {
          font-weight: 600;
          font-size: 0.875rem;
          padding: 9px 24px;
          border-radius: 8px;
          background: var(--navy-9);
          color: #ffffff;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border: none;
          box-shadow: 0 2px 8px rgba(6, 27, 68, 0.3);
          transition: all 0.15s;
        }

        .connect-submit-btn:hover:not(:disabled) {
          background: var(--navy-8);
          color: var(--gold-5);
          box-shadow: 0 4px 12px rgba(6, 27, 68, 0.4);
        }

        .connect-submit-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
          box-shadow: none;
        }

        .btn-spinner {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        /* ── Responsive Mobile ── */
        @media (max-width: 640px) {
          .wizard-card-container {
            padding: 24px 20px;
          }
          .wizard-title {
            font-size: 1.4rem;
          }
          .d4h-logo-img {
            height: 30px;
          }
          .wizard-actions-bar {
            flex-direction: column-reverse;
            gap: 10px;
          }
          .outline-dashboard-btn, .connect-submit-btn {
            width: 100%;
            justify-content: center;
          }
        }
      `}</style>
    </div>
  );
}
