import React, { useState } from 'react';
import { Calendar, Settings as SettingsIcon, Mic, HelpCircle, Sparkles } from 'lucide-react';
import logoImg from '../public/icon.png';
import Dashboard from './pages/Dashboard';
import Recording from './pages/Recording';
import Detail from './pages/Detail';
import Settings from './pages/Settings';
import { RecordingProvider } from './context/RecordingContext';
import FloatingRecordingBar from './components/FloatingRecordingBar';

export default function App() {
  const [page, setPage] = useState('dashboard'); // 'dashboard' | 'recording' | 'detail' | 'settings'
  const [selectedMeetingId, setSelectedMeetingId] = useState(null);
  const [appName, setAppName] = useState('MeetingScribe');

  React.useEffect(() => {
    fetch('http://localhost:3001/api/settings')
      .then(res => res.json())
      .then(data => {
        if (data.app_name) {
          setAppName(data.app_name);
          document.title = data.app_name;
        }
      })
      .catch(err => console.error('Error fetching app name:', err));
  }, []);

  const handleSelectMeeting = (id, status) => {
    setSelectedMeetingId(id);
    if (status === 'recording' || status === 'draft') {
      setPage('recording');
    } else {
      setPage('detail');
    }
  };

  const handleCreateNew = (id) => {
    setSelectedMeetingId(id);
    setPage('recording');
  };

  const handleRecordingUploaded = (id) => {
    setSelectedMeetingId(id);
    setPage('detail');
  };

  const renderContent = () => {
    switch (page) {
      case 'dashboard':
        return (
          <Dashboard
            onSelectMeeting={handleSelectMeeting}
            onCreateNew={handleCreateNew}
          />
        );
      case 'recording':
        return (
          <Recording
            meetingId={selectedMeetingId}
            onBack={() => setPage('dashboard')}
            onRecordingUploaded={handleRecordingUploaded}
          />
        );
      case 'detail':
        return (
          <Detail
            meetingId={selectedMeetingId}
            onBack={() => setPage('dashboard')}
            onStartRecording={() => setPage('recording')}
          />
        );
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard onSelectMeeting={handleSelectMeeting} onCreateNew={handleCreateNew} />;
    }
  };

  return (
    <RecordingProvider>
      <div className="flex min-h-screen bg-[#0A0A0B] text-[#F3F4F6] font-sans antialiased relative">
        {/* Side Navigation Bar */}
        <aside className="w-64 bg-[#111113] border-r border-white/5 flex flex-col justify-between shrink-0 hidden md:flex">
          <div className="p-6 space-y-8">
            {/* Logo / Brand */}
            <div className="flex items-center gap-3 select-none">
              <img src={logoImg} alt="Logo" className="h-10 w-10 rounded-2xl border border-white/10 shadow-md shadow-indigo-500/20 object-cover" />
              <div>
                <div className="font-bold text-sm text-white tracking-wide">{appName}</div>
                <div className="text-[10px] font-mono text-indigo-400 uppercase tracking-widest font-semibold">Local-First</div>
              </div>
            </div>

            {/* Nav Links */}
            <nav className="space-y-1.5">
              <button
                onClick={() => setPage('dashboard')}
                className={`w-full flex items-center gap-3 px-4 py-3 text-xs font-semibold rounded-xl border transition ${
                  page === 'dashboard' || page === 'recording' || page === 'detail'
                    ? 'bg-indigo-600/10 text-indigo-400 border-indigo-500/15'
                    : 'text-gray-500 hover:text-white border-transparent'
                } cursor-pointer`}
              >
                <Calendar size={15} />
                Meetings
              </button>
              <button
                onClick={() => setPage('settings')}
                className={`w-full flex items-center gap-3 px-4 py-3 text-xs font-semibold rounded-xl border transition ${
                  page === 'settings'
                    ? 'bg-indigo-600/10 text-indigo-400 border-indigo-500/15'
                    : 'text-gray-500 hover:text-white border-transparent'
                } cursor-pointer`}
              >
                <SettingsIcon size={15} />
                Settings
              </button>
            </nav>
          </div>

          {/* Footer info in sidebar */}
          <div className="p-6 border-t border-white/5 space-y-4">
            <div className="flex items-center gap-2 text-[10px] text-gray-500 font-mono">
              <Sparkles size={11} className="text-indigo-400" />
              Gemini AI Powered
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Mobile Navigation Header */}
          <header className="md:hidden bg-[#111113] border-b border-white/5 px-6 py-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <img src="/icon.png" alt="Logo" className="h-8 w-8 rounded-xl border border-white/10 shadow-sm" />
              <span className="font-bold text-sm text-white">{appName}</span>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setPage('dashboard')}
                className={`p-2 rounded-lg border text-xs font-medium ${
                  page === 'dashboard' || page === 'recording' || page === 'detail'
                    ? 'bg-indigo-600/10 text-indigo-400 border-indigo-500/15'
                    : 'text-gray-500 border-transparent'
                }`}
              >
                Meetings
              </button>
              <button
                onClick={() => setPage('settings')}
                className={`p-2 rounded-lg border text-xs font-medium ${
                  page === 'settings'
                    ? 'bg-indigo-600/10 text-indigo-400 border-indigo-500/15'
                    : 'text-gray-500 border-transparent'
                }`}
              >
                Settings
              </button>
            </div>
          </header>

          {/* Dynamic content */}
          <main className="flex-1 p-6 md:p-10 overflow-y-auto bg-gradient-to-b from-[#0F0F11] to-[#0A0A0B]">
            {renderContent()}
          </main>
        </div>

        {/* Floating recording status widget when recording is active */}
        <FloatingRecordingBar
          onOpenRecordingPage={() => setPage('recording')}
          onFinishRecording={handleRecordingUploaded}
        />
      </div>
    </RecordingProvider>
  );
}
