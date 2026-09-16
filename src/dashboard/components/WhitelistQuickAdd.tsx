import React, { useState } from 'react';
import { ShieldPlus, Check, AlertCircle } from 'lucide-react';
import { toggleUserProtected, normalizeUsername } from '../../db';

interface WhitelistQuickAddProps {
  onSuccess?: () => void;
}

export const WhitelistQuickAdd: React.FC<WhitelistQuickAddProps> = ({ onSuccess }) => {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = input.trim();
    if (!raw) return;

    setStatus('loading');
    setMessage('');

    try {
      // Split by comma, space or newline to allow adding multiple usernames at once
      const rawUsernames = raw
        .split(/[\s,;]+/)
        .map((u) => normalizeUsername(u))
        .filter(Boolean);

      if (rawUsernames.length === 0) {
        setStatus('error');
        setMessage('Por favor, informe ao menos um @username válido.');
        return;
      }

      for (const username of rawUsernames) {
        await toggleUserProtected(username);
      }

      setStatus('success');
      setMessage(`${rawUsernames.length} perfil(is) atualizado(s) na whitelist.`);
      setInput('');
      if (onSuccess) onSuccess();

      setTimeout(() => {
        setStatus('idle');
        setMessage('');
      }, 3000);
    } catch (err: any) {
      setStatus('error');
      setMessage(err?.message || 'Erro ao adicionar à whitelist.');
    }
  };

  return (
    <div className="bg-gradient-to-r from-purple-50 via-fuchsia-50 to-pink-50 p-4 rounded-2xl border border-purple-100 shadow-xs mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-purple-600 text-white flex items-center justify-center shadow-xs">
            <ShieldPlus className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-purple-950">
              Adicionar à Whitelist (Protegidos)
            </h3>
            <p className="text-xs text-purple-700">
              Digite um ou mais perfis (ex: <span className="font-mono">@arthur, @amigo</span>) para proteger contra unfollow.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            type="text"
            placeholder="@username..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={status === 'loading'}
            className="px-3.5 py-2 text-xs bg-white rounded-xl border border-purple-200 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent w-48 sm:w-64 placeholder:text-slate-400 text-slate-800"
          />
          <button
            type="submit"
            disabled={status === 'loading' || !input.trim()}
            className="px-4 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer"
          >
            <ShieldPlus className="w-3.5 h-3.5" />
            <span>Proteger</span>
          </button>
        </form>
      </div>

      {status === 'success' && (
        <div className="mt-2.5 flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-100/70 px-3 py-1.5 rounded-lg">
          <Check className="w-3.5 h-3.5" />
          <span>{message}</span>
        </div>
      )}

      {status === 'error' && (
        <div className="mt-2.5 flex items-center gap-1.5 text-xs font-medium text-rose-700 bg-rose-100/70 px-3 py-1.5 rounded-lg">
          <AlertCircle className="w-3.5 h-3.5" />
          <span>{message}</span>
        </div>
      )}
    </div>
  );
};
