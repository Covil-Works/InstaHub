import React, { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ExternalLink,
  Shield,
  UserCheck,
  Users,
  Keyboard,
  Eye,
  Sliders,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { getDashboardStats } from '../db';
import { getExtensionSettings, saveExtensionSettings } from '../utils/storage';
import type { ExtensionSettings } from '../types';

export const Popup: React.FC = () => {
  const [settings, setSettings] = useState<ExtensionSettings>({
    flagsEnabled: true,
    keyboardNavEnabled: true,
  });
  const [loading, setLoading] = useState(true);

  // Live query for database statistics
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

  useEffect(() => {
    getExtensionSettings().then((s) => {
      setSettings(s);
      setLoading(false);
    });
  }, []);

  const handleToggleFlags = async () => {
    const updated = await saveExtensionSettings({
      flagsEnabled: !settings.flagsEnabled,
    });
    setSettings(updated);
  };

  const handleToggleKeyboard = async () => {
    const updated = await saveExtensionSettings({
      keyboardNavEnabled: !settings.keyboardNavEnabled,
    });
    setSettings(updated);
  };

  const handleOpenDashboard = () => {
    const url = chrome?.runtime?.getURL
      ? chrome.runtime.getURL('dashboard.html')
      : 'dashboard.html';

    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url });
    } else {
      window.open(url, '_blank');
    }
  };

  const handleOpenSync = () => {
    const url = chrome?.runtime?.getURL
      ? chrome.runtime.getURL('dashboard.html?sync=true')
      : 'dashboard.html?sync=true';

    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url });
    } else {
      window.open(url, '_blank');
    }
  };

  const handleOpenInstagram = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url: 'https://www.instagram.com/' });
    } else {
      window.open('https://www.instagram.com/', '_blank');
    }
  };

  return (
    <div className="w-[360px] bg-slate-50 text-slate-800 p-4 font-sans select-none">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-200">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 flex items-center justify-center text-white shadow-sm shadow-rose-200">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-900 leading-tight">
              InstaHub
            </h1>
            <p className="text-[11px] text-slate-500 font-medium">Followers Manager</p>
          </div>
        </div>

        <button
          onClick={handleOpenInstagram}
          title="Abrir Instagram"
          className="text-xs text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 px-2.5 py-1 rounded-full font-medium transition flex items-center gap-1"
        >
          <span>Instagram</span>
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-2 gap-2 my-3.5">
        <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-xs flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <div className="text-lg font-bold text-slate-900 leading-none">{stats.total}</div>
            <div className="text-[11px] text-slate-500 font-medium mt-0.5">Na sua base</div>
          </div>
        </div>

        <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-xs flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-purple-50 text-purple-600">
            <Shield className="w-4 h-4" />
          </div>
          <div>
            <div className="text-lg font-bold text-slate-900 leading-none">
              {stats.protectedCount}
            </div>
            <div className="text-[11px] text-slate-500 font-medium mt-0.5">Protegidos</div>
          </div>
        </div>

        <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-xs flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
            <UserCheck className="w-4 h-4" />
          </div>
          <div>
            <div className="text-lg font-bold text-slate-900 leading-none">{stats.iFollow}</div>
            <div className="text-[11px] text-slate-500 font-medium mt-0.5">Eu sigo</div>
          </div>
        </div>

        <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-xs flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <div className="text-lg font-bold text-slate-900 leading-none">{stats.followsMe}</div>
            <div className="text-[11px] text-slate-500 font-medium mt-0.5">Me segue</div>
          </div>
        </div>
      </div>

      {/* Feature Toggles */}
      <div className="space-y-2 mb-4">
        {/* Flags Toggle */}
        <div className="bg-white p-3 rounded-xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-lg ${settings.flagsEnabled ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-400'}`}>
              <Eye className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-900">Flags no Instagram</div>
              <div className="text-[11px] text-slate-500">Exibir selos nos perfis</div>
            </div>
          </div>

          <button
            onClick={handleToggleFlags}
            type="button"
            className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors duration-200 ease-in-out cursor-pointer ${
              settings.flagsEnabled ? 'bg-gradient-to-r from-rose-500 to-purple-600 justify-end' : 'bg-slate-200 justify-start'
            }`}
          >
            <div className="bg-white w-4 h-4 rounded-full shadow-sm" />
          </button>
        </div>

        {/* Keyboard Nav Toggle */}
        <div className="bg-white p-3 rounded-xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-lg ${settings.keyboardNavEnabled ? 'bg-purple-50 text-purple-600' : 'bg-slate-100 text-slate-400'}`}>
              <Keyboard className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-900">Navegação por Teclado</div>
              <div className="text-[11px] text-slate-500">Atalhos (↑, ↓, Enter) em listas</div>
            </div>
          </div>

          <button
            onClick={handleToggleKeyboard}
            type="button"
            className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors duration-200 ease-in-out cursor-pointer ${
              settings.keyboardNavEnabled ? 'bg-gradient-to-r from-purple-500 to-indigo-600 justify-end' : 'bg-slate-200 justify-start'
            }`}
          >
            <div className="bg-white w-4 h-4 rounded-full shadow-sm" />
          </button>
        </div>
      </div>

      {/* Sync Button */}
      <button
        onClick={handleOpenSync}
        className="w-full mb-2 bg-white hover:bg-slate-100 text-slate-800 border border-slate-200/90 font-semibold text-xs py-2 px-3 rounded-xl shadow-2xs flex items-center justify-center gap-2 transition cursor-pointer"
      >
        <RefreshCw className="w-3.5 h-3.5 text-rose-500" />
        <span>Sincronizar Seguidores (API)</span>
      </button>

      {/* Main Action Button */}
      <button
        onClick={handleOpenDashboard}
        className="w-full bg-gradient-to-r from-purple-600 via-rose-600 to-amber-500 hover:from-purple-700 hover:via-rose-700 hover:to-amber-600 text-white font-semibold text-sm py-2.5 px-4 rounded-xl shadow-md shadow-rose-200 flex items-center justify-center gap-2 transition active:scale-[0.98] cursor-pointer"
      >
        <Sliders className="w-4 h-4" />
        <span>Abrir Dashboard Completo</span>
      </button>

      {/* Footer Info */}
      <div className="mt-3 text-center">
        <p className="text-[10px] text-slate-400">
          Dados salvos localmente com Dexie.js (IndexedDB)
        </p>
      </div>
    </div>
  );
};
