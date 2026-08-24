import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

const ConnectD4H = lazy(() => import('./pages/ConnectD4H').then((module) => ({ default: module.ConnectD4H })));
const Dashboard = lazy(() => import('./pages/Dashboard').then((module) => ({ default: module.Dashboard })));
const ExerciseDetails = lazy(() => import('./pages/ExerciseDetails').then((module) => ({ default: module.ExerciseDetails })));

function PageLoader() {
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400">
      <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-3" />
      <span className="text-sm font-medium">Loading...</span>
    </div>
  );
}

function App() {
  return (
    <Router basename={import.meta.env.BASE_URL}>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/connect-d4h" element={<ConnectD4H />} />
          <Route path="/connectd4h" element={<Navigate to="/connect-d4h" replace />} />
          <Route path="/login" element={<Navigate to="/connect-d4h" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/exercise/:id" element={<ExerciseDetails />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Router>
  );
}

export default App;

