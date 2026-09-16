import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Sparkles,
  UserPlus,
  FileJson,
  ExternalLink,
  Shield,
  Database,
  RefreshCw,
} from 'lucide-react';
import { db, getDashboardStats } from '../db';
import type { UserRecord, FilterCategory } from '../types';
import { StatsCards } from './components/StatsCards';
import { FilterTabs } from './components/FilterTabs';
import { WhitelistQuickAdd } from './components/WhitelistQuickAdd';
import { UserTable } from './components/UserTable';
import { UserModal } from './components/UserModal';
import { ImportExportModal } from './components/ImportExportModal';
import { SyncModal } from './components/SyncModal';

export const Dashboard: React.FC = () => {
  const [currentFilter, setCurrentFilter] = useState<FilterCategory>('all');
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [userToEdit, setUserToEdit] = useState<UserRecord | null>(null);
  const [importExportModalOpen, setImportExportModalOpen] = useState(false);
  const [syncModalOpen, setSyncModalOpen] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('sync') === 'true') {
      setSyncModalOpen(true);
    }
  }, []);

  // Live query for all users in database
  const users = useLiveQuery(() => db.users.toArray(), [], []);

  // Live query for overall dashboard metrics
  const stats = useLiveQuery(
    () => getDashboardStats(),
    [],
    {
      total: 0,
      iFollow: 0,
      followsMe: 0,
      notFollowingBack: 0,
      fans: 0,
      everFollowed: 0,
      protectedCount: 0,
    }
  );

  const handleOpenNewUserModal = () => {
    setUserToEdit(null);
    setUserModalOpen(true);
  };

  const handleEditUser = (user: UserRecord) => {
    setUserToEdit(user);
    setUserModalOpen(true);
  };

  const handleOpenInstagram = () => {
    window.open('https://www.instagram.com/', '_blank');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16">
      {/* Top Navbar */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 flex items-center justify-center text-white shadow-md shadow-rose-200">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-slate-900">
                  InstaHub
                </h1>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md bg-purple-100 text-purple-700">
                  Followers Manager
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Gerenciamento inteligente de seguidores e histórico local
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setSyncModalOpen(true)}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-gradient-to-r from-purple-600 via-rose-600 to-amber-500 hover:from-purple-700 hover:via-rose-700 hover:to-amber-600 rounded-xl shadow-sm shadow-rose-200 transition flex items-center gap-1.5 cursor-pointer"
              title="Sincronizar Seguidores e Quem Eu Sigo diretamente da API do Instagram"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Sincronizar API</span>
            </button>

            <button
              onClick={() => setImportExportModalOpen(true)}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition flex items-center gap-1.5 cursor-pointer"
            >
              <FileJson className="w-4 h-4 text-purple-600" />
              <span className="hidden sm:inline">Backup / JSON</span>
            </button>

            <button
              onClick={handleOpenNewUserModal}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-sm shadow-purple-200 transition flex items-center gap-1.5 cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              <span>Novo Usuário</span>
            </button>

            <button
              onClick={handleOpenInstagram}
              title="Ir para o Instagram"
              className="px-3 py-2 text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-xl transition flex items-center gap-1 cursor-pointer"
            >
              <span className="hidden md:inline">Instagram</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        {/* Whitelist Quick Add Widget */}
        <WhitelistQuickAdd />

        {/* Dynamic Metric Cards */}
        <StatsCards
          stats={stats}
          currentFilter={currentFilter}
          onSelectFilter={(cat) => setCurrentFilter(cat)}
        />

        {/* Filter Navigation Tabs */}
        <FilterTabs
          currentFilter={currentFilter}
          onSelectFilter={(cat) => setCurrentFilter(cat)}
          stats={stats}
        />

        {/* User Data Table */}
        <UserTable
          users={users}
          currentFilter={currentFilter}
          onEditUser={handleEditUser}
        />
      </main>

      {/* Modals */}
      <UserModal
        isOpen={userModalOpen}
        userToEdit={userToEdit}
        onClose={() => {
          setUserModalOpen(false);
          setUserToEdit(null);
        }}
      />

      <ImportExportModal
        isOpen={importExportModalOpen}
        onClose={() => setImportExportModalOpen(false)}
      />

      <SyncModal
        isOpen={syncModalOpen}
        onClose={() => setSyncModalOpen(false)}
      />
    </div>
  );
};
