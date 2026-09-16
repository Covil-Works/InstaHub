import React, { useState, useEffect } from 'react';
import { X, UserPlus, Save, Shield, UserCheck, Users, History, FileText } from 'lucide-react';
import type { UserRecord } from '../../types';
import { normalizeUsername, db } from '../../db';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  userToEdit?: UserRecord | null;
  onSaved?: () => void;
}

export const UserModal: React.FC<UserModalProps> = ({
  isOpen,
  onClose,
  userToEdit,
  onSaved,
}) => {
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [iFollow, setIFollow] = useState(false);
  const [followsMe, setFollowsMe] = useState(false);
  const [everFollowed, setEverFollowed] = useState(false);
  const [isProtected, setIsProtected] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const isEditing = Boolean(userToEdit);

  useEffect(() => {
    if (userToEdit) {
      setUsername(userToEdit.username);
      setName(userToEdit.name || '');
      setIFollow(Boolean(userToEdit.iFollow));
      setFollowsMe(Boolean(userToEdit.followsMe));
      setEverFollowed(Boolean(userToEdit.everFollowed));
      setIsProtected(Boolean(userToEdit.protected));
      setNotes(userToEdit.notes || '');
    } else {
      setUsername('');
      setName('');
      setIFollow(false);
      setFollowsMe(false);
      setEverFollowed(false);
      setIsProtected(false);
      setNotes('');
    }
    setError('');
  }, [userToEdit, isOpen]);

  if (!isOpen) return null;

  const handleIFollowChange = (checked: boolean) => {
    setIFollow(checked);
    // Business rule: If you follow someone, everFollowed must be true
    if (checked) {
      setEverFollowed(true);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUsername = normalizeUsername(username);

    if (!cleanUsername) {
      setError('Por favor, informe um @username válido.');
      return;
    }

    try {
      const record: UserRecord = {
        username: cleanUsername,
        name: name.trim() || cleanUsername,
        iFollow,
        followsMe,
        everFollowed: iFollow ? true : everFollowed,
        protected: isProtected,
        notes: notes.trim() || undefined,
        updatedAt: Date.now(),
      };

      await db.users.put(record);

      if (onSaved) onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Erro ao salvar usuário.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-purple-100 text-purple-600">
              {isEditing ? <Save className="w-5 h-5" /> : <UserPlus className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {isEditing ? 'Editar Usuário' : 'Novo Usuário'}
              </h2>
              <p className="text-xs text-slate-500">
                {isEditing
                  ? 'Atualize as informações e relações do perfil'
                  : 'Cadastre manualmente um perfil na sua base'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSave} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl font-medium">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Username (@usuario) *
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-slate-400 text-xs font-semibold">
                @
              </span>
              <input
                type="text"
                required
                disabled={isEditing}
                placeholder="arthurhenrique"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full pl-7 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-slate-50 disabled:text-slate-500 font-mono text-slate-800"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Nome de Exibição
            </label>
            <input
              type="text"
              placeholder="Arthur Henrique"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-800"
            />
          </div>

          {/* Relationship Status Toggles */}
          <div className="pt-2 border-t border-slate-100 space-y-2.5">
            <span className="block text-xs font-semibold text-slate-700">
              Relação com a Conta
            </span>

            {/* Eu sigo */}
            <label className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200/80 cursor-pointer hover:bg-slate-100/70 transition">
              <div className="flex items-center gap-2 text-xs">
                <UserCheck className="w-4 h-4 text-emerald-600" />
                <div>
                  <span className="font-semibold text-slate-800">Eu sigo</span>
                  <p className="text-[11px] text-slate-500">Atualmente sigo esse usuário</p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={iFollow}
                onChange={(e) => handleIFollowChange(e.target.checked)}
                className="w-4 h-4 text-purple-600 rounded border-slate-300 focus:ring-purple-500"
              />
            </label>

            {/* Me segue */}
            <label className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200/80 cursor-pointer hover:bg-slate-100/70 transition">
              <div className="flex items-center gap-2 text-xs">
                <Users className="w-4 h-4 text-blue-600" />
                <div>
                  <span className="font-semibold text-slate-800">Me segue</span>
                  <p className="text-[11px] text-slate-500">Esse perfil segue minha conta</p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={followsMe}
                onChange={(e) => setFollowsMe(e.target.checked)}
                className="w-4 h-4 text-purple-600 rounded border-slate-300 focus:ring-purple-500"
              />
            </label>

            {/* Já segui */}
            <label className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200/80 cursor-pointer hover:bg-slate-100/70 transition">
              <div className="flex items-center gap-2 text-xs">
                <History className="w-4 h-4 text-indigo-600" />
                <div>
                  <span className="font-semibold text-slate-800">Já segui</span>
                  <p className="text-[11px] text-slate-500">Já segui anteriormente (histórico)</p>
                </div>
              </div>
              <input
                type="checkbox"
                disabled={iFollow} // Se Eu sigo é true, já segui é obrigatoriamente true
                checked={iFollow ? true : everFollowed}
                onChange={(e) => setEverFollowed(e.target.checked)}
                className="w-4 h-4 text-purple-600 rounded border-slate-300 focus:ring-purple-500 disabled:opacity-60"
              />
            </label>

            {/* Protegido / Whitelist */}
            <label className="flex items-center justify-between p-2.5 bg-purple-50/50 rounded-xl border border-purple-200/80 cursor-pointer hover:bg-purple-100/40 transition">
              <div className="flex items-center gap-2 text-xs">
                <Shield className="w-4 h-4 text-purple-600" />
                <div>
                  <span className="font-semibold text-purple-950">Protegido (Whitelist)</span>
                  <p className="text-[11px] text-purple-700">Imune a recomendações de unfollow</p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={isProtected}
                onChange={(e) => setIsProtected(e.target.checked)}
                className="w-4 h-4 text-purple-600 rounded border-purple-300 focus:ring-purple-500"
              />
            </label>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-slate-400" />
              <span>Notas / Observações</span>
            </label>
            <textarea
              rows={2}
              placeholder="Ex: Colega de trabalho, conhecido da faculdade..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-800 resize-none"
            />
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-sm shadow-purple-200 transition cursor-pointer flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isEditing ? 'Atualizar Perfil' : 'Salvar Perfil'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
