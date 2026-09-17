import React, { useState } from 'react';
import {
  ShieldCheck,
  ShieldOff,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  FileJson,
  Sparkles,
  Zap,
  ArrowRight,
  Shield,
  Users,
  Database,
  X,
} from 'lucide-react';
import {
  protectAllCurrentFollowing,
  removeAllProtected,
  clearDatabase,
  type DashboardStats,
} from '../../db';

interface QuickActionsProps {
  stats: DashboardStats;
  onOpenBackup: () => void;
  onOpenSync: () => void;
}

interface ConfirmModalState {
  isOpen: boolean;
  type: 'protect_all' | 'remove_all_protected' | 'clear_database';
  title: string;
  description: string;
  confirmText: string;
  danger?: boolean;
}

export const QuickActions: React.FC<QuickActionsProps> = ({
  stats,
  onOpenBackup,
  onOpenSync,
}) => {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);
  const [clearConfirmationText, setClearConfirmationText] = useState('');

  const handleOpenConfirm = (
    type: 'protect_all' | 'remove_all_protected' | 'clear_database'
  ) => {
    setFeedback(null);
    setClearConfirmationText('');

    if (type === 'protect_all') {
      setConfirmModal({
        isOpen: true,
        type,
        title: 'Adicionar Todos os Seguindo aos Protegidos?',
        description: `Esta ação marcará como protegidos (whitelist) todos os perfis com status "Eu Sigo" na sua base (${stats.iFollow} perfis). Usuários protegidos ficam imunes a ações acidentais de unfollow por teclado.`,
        confirmText: 'Sim, Proteger Todos',
      });
    } else if (type === 'remove_all_protected') {
      setConfirmModal({
        isOpen: true,
        type,
        title: 'Remover Todos os Protegidos?',
        description: `Esta ação removerá a marcação de proteção de todos os ${stats.protectedCount} perfis da sua base. Nenhum perfil será excluído da base e você não deixará de seguir ninguém no Instagram.`,
        confirmText: 'Sim, Remover Proteções',
        danger: true,
      });
    } else if (type === 'clear_database') {
      setConfirmModal({
        isOpen: true,
        type,
        title: 'ATENÇÃO: Limpar Toda a Base de Dados?',
        description: `Esta ação apagará permanentemente todos os ${stats.total} perfis, anotações e históricos salvos localmente no InstaHub. Recomendamos fortemente exportar um backup JSON antes de continuar.`,
        confirmText: 'Sim, Apagar Tudo',
        danger: true,
      });
    }
  };

  const handleExecuteAction = async () => {
    if (!confirmModal) return;
    const actionType = confirmModal.type;
    setLoadingAction(actionType);
    setConfirmModal(null);

    try {
      if (actionType === 'protect_all') {
        const res = await protectAllCurrentFollowing();
        setFeedback({
          type: 'success',
          message:
            res.modifiedCount > 0
              ? `Pronto! ${res.modifiedCount} perfil(is) que você segue foram adicionados à lista de protegidos.`
              : 'Todos os perfis que você segue atualmente já estão protegidos na whitelist!',
        });
      } else if (actionType === 'remove_all_protected') {
        const res = await removeAllProtected();
        setFeedback({
          type: 'success',
          message:
            res.modifiedCount > 0
              ? `Concluído! A proteção foi removida de ${res.modifiedCount} perfil(is).`
              : 'Não havia nenhum perfil marcado como protegido na base.',
        });
      } else if (actionType === 'clear_database') {
        await clearDatabase();
        setFeedback({
          type: 'success',
          message:
            'A base de dados do InstaHub foi completamente limpa. Todos os registros locais foram apagados.',
        });
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: `Erro ao executar ação: ${err?.message || 'Falha desconhecida'}`,
      });
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-purple-900 via-indigo-900 to-slate-900 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden">
        <div className="absolute right-0 top-0 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/20 border border-purple-400/30 text-purple-200 text-xs font-semibold">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>Painel de Ações Rápidas & Manutenção</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
              Automações em Lote e Controle da Base
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl">
              Gerencie sua whitelist de forma massiva, aplique proteções com um clique
              e faça a manutenção da integridade do banco de dados local do InstaHub.
            </p>
          </div>

          {/* Quick Stats Pill */}
          <div className="flex items-center gap-3 bg-white/10 backdrop-blur-md px-4 py-3 rounded-xl border border-white/15 self-start md:self-auto shrink-0">
            <div className="text-center px-2">
              <div className="text-xs text-slate-300">Protegidos</div>
              <div className="text-lg font-bold text-amber-300 flex items-center justify-center gap-1">
                <Shield className="w-4 h-4" />
                <span>{stats.protectedCount}</span>
              </div>
            </div>
            <div className="h-8 w-px bg-white/20" />
            <div className="text-center px-2">
              <div className="text-xs text-slate-300">Eu Sigo</div>
              <div className="text-lg font-bold text-purple-300 flex items-center justify-center gap-1">
                <Users className="w-4 h-4" />
                <span>{stats.iFollow}</span>
              </div>
            </div>
            <div className="h-8 w-px bg-white/20" />
            <div className="text-center px-2">
              <div className="text-xs text-slate-300">Total no Banco</div>
              <div className="text-lg font-bold text-emerald-300 flex items-center justify-center gap-1">
                <Database className="w-4 h-4" />
                <span>{stats.total}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Feedback Toast */}
      {feedback && (
        <div
          className={`flex items-start justify-between gap-3 p-4 rounded-xl border transition-all animate-in fade-in slide-in-from-top-2 duration-200 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-3">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
            )}
            <span className="text-sm font-medium">{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Action Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* Card 1: Proteger todos os que eu sigo */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="w-12 h-12 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center shadow-xs">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <span className="text-[11px] uppercase tracking-wider font-bold px-2.5 py-1 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                Whitelist Massiva
              </span>
            </div>

            <div>
              <h3 className="text-base font-bold text-slate-900 group-hover:text-purple-700 transition">
                Proteger Todos que Eu Sigo
              </h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Adiciona à lista de protegidos todos os perfis com status{' '}
                <strong className="text-slate-700 font-semibold">"Eu Sigo"</strong> ({stats.iFollow}{' '}
                perfis). Usuários protegidos ficam imunes à tecla Enter durante a navegação rápida.
              </p>
            </div>
          </div>

          <div className="pt-5 mt-4 border-t border-slate-100 flex flex-col gap-2.5">
            <button
              onClick={() => handleOpenConfirm('protect_all')}
              disabled={loadingAction === 'protect_all' || stats.iFollow === 0}
              className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-purple-200 transition flex items-center justify-center gap-2 cursor-pointer"
            >
              {loadingAction === 'protect_all' ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <ShieldCheck className="w-4 h-4" />
              )}
              <span>Proteger Todos que Sigo ({stats.iFollow})</span>
            </button>
          </div>
        </div>

        {/* Card 2: Remover todos os protegidos */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shadow-xs">
                <ShieldOff className="w-6 h-6" />
              </div>
              <span className="text-[11px] uppercase tracking-wider font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                Limpeza de Whitelist
              </span>
            </div>

            <div>
              <h3 className="text-base font-bold text-slate-900 group-hover:text-amber-700 transition">
                Remover Todos os Protegidos
              </h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Desativa o selo de proteção de todos os perfis da base de dados ({stats.protectedCount}{' '}
                perfis). Nenhum dado será excluído e você continuará seguindo normalmente.
              </p>
            </div>
          </div>

          <div className="pt-5 mt-4 border-t border-slate-100 flex flex-col gap-2.5">
            <button
              onClick={() => handleOpenConfirm('remove_all_protected')}
              disabled={loadingAction === 'remove_all_protected' || stats.protectedCount === 0}
              className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300/80 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2 cursor-pointer"
            >
              {loadingAction === 'remove_all_protected' ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <ShieldOff className="w-4 h-4" />
              )}
              <span>Remover Todas as Proteções ({stats.protectedCount})</span>
            </button>
          </div>
        </div>

        {/* Card 3: Limpar a base de dados */}
        <div className="bg-white rounded-2xl p-6 border border-rose-200/80 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group relative overflow-hidden">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="w-12 h-12 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shadow-xs">
                <Trash2 className="w-6 h-6" />
              </div>
              <span className="text-[11px] uppercase tracking-wider font-bold px-2.5 py-1 rounded-full bg-rose-100 text-rose-800 border border-rose-300">
                Zona de Perigo
              </span>
            </div>

            <div>
              <h3 className="text-base font-bold text-slate-900 group-hover:text-rose-700 transition flex items-center gap-1.5">
                <span>Limpar a Base de Dados</span>
              </h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Apaga permanentemente todos os{' '}
                <strong className="text-slate-700 font-semibold">{stats.total} perfis</strong> e
                históricos registrados localmente no InstaHub. Esta ação é irreversível.
              </p>
            </div>
          </div>

          <div className="pt-5 mt-4 border-t border-slate-100 flex flex-col gap-2.5">
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>Precisa salvar antes?</span>
              <button
                onClick={onOpenBackup}
                className="text-purple-600 hover:text-purple-800 font-semibold underline cursor-pointer"
              >
                Fazer Backup JSON
              </button>
            </div>

            <button
              onClick={() => handleOpenConfirm('clear_database')}
              disabled={loadingAction === 'clear_database' || stats.total === 0}
              className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-rose-200 transition flex items-center justify-center gap-2 cursor-pointer"
            >
              {loadingAction === 'clear_database' ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              <span>Limpar Toda a Base ({stats.total})</span>
            </button>
          </div>
        </div>

        {/* Card 4: Sincronização direta com Instagram API */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-purple-600 to-rose-500 text-white flex items-center justify-center shadow-xs">
                <RefreshCw className="w-6 h-6" />
              </div>
              <span className="text-[11px] uppercase tracking-wider font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                API Oficial
              </span>
            </div>

            <div>
              <h3 className="text-base font-bold text-slate-900 group-hover:text-purple-700 transition">
                Sincronizar com Instagram API
              </h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Obtém sua lista oficial de Seguidores e Quem Eu Sigo diretamente da API web do
                Instagram, atualizando histórico de quem deixou de te seguir.
              </p>
            </div>
          </div>

          <div className="pt-5 mt-4 border-t border-slate-100 flex flex-col gap-2.5">
            <button
              onClick={onOpenSync}
              className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4 text-purple-600" />
              <span>Abrir Sincronizador de API</span>
            </button>
          </div>
        </div>

        {/* Card 5: Backup e Restauração de Dados */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shadow-xs">
                <FileJson className="w-6 h-6" />
              </div>
              <span className="text-[11px] uppercase tracking-wider font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                Segurança
              </span>
            </div>

            <div>
              <h3 className="text-base font-bold text-slate-900 group-hover:text-blue-700 transition">
                Exportar / Importar Backup JSON
              </h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Salve cópias de segurança de toda a sua base de dados ou restaure arquivos JSON de
                outras contas ou navegadores com total integridade.
              </p>
            </div>
          </div>

          <div className="pt-5 mt-4 border-t border-slate-100 flex flex-col gap-2.5">
            <button
              onClick={onOpenBackup}
              className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <FileJson className="w-4 h-4 text-blue-600" />
              <span>Gerenciar Backup JSON</span>
            </button>
          </div>
        </div>

        {/* Card 6: Próximas Funcionalidades (Extensível) */}
        <div className="bg-slate-50/70 rounded-2xl p-6 border-2 border-dashed border-slate-300 flex flex-col justify-between group">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="w-12 h-12 rounded-xl bg-slate-200/70 text-slate-600 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-amber-500" />
              </div>
              <span className="text-[11px] uppercase tracking-wider font-bold px-2.5 py-1 rounded-full bg-slate-200 text-slate-600">
                Em Breve
              </span>
            </div>

            <div>
              <h3 className="text-base font-bold text-slate-800">
                Mais Automações & Filtros
              </h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Novas ações rápidas como exportação em CSV, limpeza inteligente de contas inativas e
                rotulagem personalizada de seguidores serão integradas aqui.
              </p>
            </div>
          </div>

          <div className="pt-5 mt-4 border-t border-slate-200/80 flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Mais opções no futuro</span>
            <ArrowRight className="w-4 h-4 text-slate-400" />
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {confirmModal && confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3.5">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  confirmModal.danger
                    ? 'bg-rose-100 text-rose-600'
                    : 'bg-purple-100 text-purple-600'
                }`}
              >
                {confirmModal.danger ? (
                  <AlertTriangle className="w-5 h-5" />
                ) : (
                  <ShieldCheck className="w-5 h-5" />
                )}
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {confirmModal.title}
                </h3>
                <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                  {confirmModal.description}
                </p>
              </div>
            </div>

            {confirmModal.type === 'clear_database' && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-900 space-y-2">
                <div className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>Confirmação de Segurança:</span>
                </div>
                <p>
                  Para prosseguir, digite <strong className="font-bold">LIMPAR</strong> abaixo:
                </p>
                <input
                  type="text"
                  value={clearConfirmationText}
                  onChange={(e) => setClearConfirmationText(e.target.value.toUpperCase())}
                  placeholder="Digite LIMPAR para autorizar"
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-rose-300 bg-white font-mono uppercase focus:outline-hidden focus:ring-2 focus:ring-rose-500"
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleExecuteAction}
                disabled={
                  confirmModal.type === 'clear_database' &&
                  clearConfirmationText !== 'LIMPAR'
                }
                className={`px-4 py-2 rounded-xl text-xs font-semibold text-white transition shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  confirmModal.danger
                    ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-200'
                    : 'bg-purple-600 hover:bg-purple-700 shadow-purple-200'
                }`}
              >
                {confirmModal.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
