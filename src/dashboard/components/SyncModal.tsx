import React, { useState, useEffect, useRef } from 'react';
import {
  RefreshCw,
  X,
  AlertCircle,
  CheckCircle2,
  Users,
  UserCheck,
  UserX,
  ExternalLink,
  Shield,
  Clock,
  StopCircle,
  Sparkles,
} from 'lucide-react';
import type { SyncMode, InstagramSessionInfo, InstagramSyncSummary } from '../../types';
import { getInstagramSession, fetchFullList, type ApiUserItem } from '../../utils/instagramApi';
import { syncInstagramUsers } from '../../db';

interface SyncModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SyncModal: React.FC<SyncModalProps> = ({ isOpen, onClose }) => {
  const [session, setSession] = useState<InstagramSessionInfo | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [syncMode, setSyncMode] = useState<SyncMode>('both');

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressPhase, setProgressPhase] = useState<'idle' | 'following' | 'followers' | 'saving'>('idle');
  const [followingCount, setFollowingCount] = useState(0);
  const [followersCount, setFollowersCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [summary, setSummary] = useState<InstagramSyncSummary | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
      setSummary(null);
      setSyncing(false);
      setProgressPhase('idle');
      setFollowingCount(0);
      setFollowersCount(0);
      checkSession();
    }
  }, [isOpen]);

  const checkSession = async () => {
    setCheckingSession(true);
    setErrorMsg(null);
    const s = await getInstagramSession();
    setSession(s);
    setCheckingSession(false);
  };

  const handleOpenInstagram = () => {
    window.open('https://www.instagram.com/', '_blank');
  };

  const handleStopSync = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setProgressMsg('Interrompendo e salvando perfis carregados até o momento...');
    }
  };

  const handleStartSync = async () => {
    if (!session || !session.userId) {
      setErrorMsg('Não foi possível identificar a sessão ativa do Instagram.');
      return;
    }

    setSyncing(true);
    setErrorMsg(null);
    setSummary(null);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    let fetchedFollowing: ApiUserItem[] = [];
    let fetchedFollowers: ApiUserItem[] = [];

    try {
      // 1. Fetch following if mode is 'both' or 'following'
      if (syncMode === 'both' || syncMode === 'following') {
        setProgressPhase('following');
        setProgressMsg('Iniciando busca dos perfis que você segue...');

        fetchedFollowing = await fetchFullList(
          'following',
          session.userId,
          session.csrfToken,
          (prog) => {
            setFollowingCount(prog.currentCount);
            setProgressMsg(prog.message);
          },
          abortController.signal
        );

        setFollowingCount(fetchedFollowing.length);
      }

      // 2. Fetch followers if mode is 'both' or 'followers' and not aborted
      if ((syncMode === 'both' || syncMode === 'followers') && !abortController.signal.aborted) {
        setProgressPhase('followers');
        setProgressMsg('Iniciando busca dos seus seguidores...');

        fetchedFollowers = await fetchFullList(
          'followers',
          session.userId,
          session.csrfToken,
          (prog) => {
            setFollowersCount(prog.currentCount);
            setProgressMsg(prog.message);
          },
          abortController.signal
        );

        setFollowersCount(fetchedFollowers.length);
      }

      // 3. Commit to database
      setProgressPhase('saving');
      setProgressMsg('Processando dados e atualizando o banco local com histórico preservado...');

      const syncResult = await syncInstagramUsers({
        following: fetchedFollowing,
        followers: fetchedFollowers,
        mode: syncMode,
      });

      setSummary(syncResult);
    } catch (err: any) {
      console.error('[InstaHub Sync] Erro na sincronização:', err);
      if (err?.message === 'RATE_LIMIT') {
        setErrorMsg(
          'O Instagram limitou temporariamente as requisições (Rate Limit). Aguarde alguns minutos antes de tentar novamente. Se algum perfil foi carregado, tente salvar.'
        );
      } else if (err?.message === 'UNAUTHORIZED') {
        setErrorMsg(
          'Sessão expirada no Instagram. Faça login novamente em instagram.com e recarregue.'
        );
      } else {
        setErrorMsg(`Erro durante a sincronização: ${err?.message || 'Falha de conexão com a API'}`);
      }
    } finally {
      setSyncing(false);
      abortControllerRef.current = null;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-rose-50/50 via-purple-50/50 to-amber-50/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 flex items-center justify-center text-white shadow-sm shadow-rose-200">
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Sincronizar com Instagram</h2>
              <p className="text-xs text-slate-500">API Web Oficial do Instagram</p>
            </div>
          </div>
          {!syncing && (
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Summary View */}
          {summary ? (
            <div className="space-y-4">
              <div className="text-center py-2">
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center mb-2">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-slate-900">Sincronização Concluída!</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Sua base local foi atualizada e os dados de seguidores/seguindo estão sincronizados.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80">
                  <div className="text-[11px] font-medium text-slate-500">Total na Base</div>
                  <div className="text-xl font-bold text-slate-900 mt-0.5">{summary.totalInDatabase}</div>
                </div>

                <div className="bg-emerald-50/80 p-3 rounded-xl border border-emerald-200/80">
                  <div className="text-[11px] font-medium text-emerald-700">Novos Adicionados</div>
                  <div className="text-xl font-bold text-emerald-800 mt-0.5">+{summary.addedCount}</div>
                </div>

                <div className="bg-purple-50/80 p-3 rounded-xl border border-purple-200/80">
                  <div className="text-[11px] font-medium text-purple-700">Quem Você Segue</div>
                  <div className="text-xl font-bold text-purple-800 mt-0.5">{summary.followingCount}</div>
                </div>

                <div className="bg-blue-50/80 p-3 rounded-xl border border-blue-200/80">
                  <div className="text-[11px] font-medium text-blue-700">Seus Seguidores</div>
                  <div className="text-xl font-bold text-blue-800 mt-0.5">{summary.followersCount}</div>
                </div>
              </div>

              {summary.unfollowedMeCount > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-center gap-2">
                  <UserX className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    <strong>{summary.unfollowedMeCount}</strong> perfil(s) deixaram de te seguir desde a última checagem!
                  </span>
                </div>
              )}

              <div className="pt-2 flex justify-end">
                <button
                  onClick={onClose}
                  className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs py-2.5 px-4 rounded-xl transition cursor-pointer shadow-sm shadow-purple-200"
                >
                  Concluir e Ver no Dashboard
                </button>
              </div>
            </div>
          ) : syncing ? (
            /* In Progress View */
            <div className="space-y-4 py-2">
              <div className="text-center space-y-1">
                <div className="inline-flex items-center justify-center p-3 bg-rose-50 rounded-2xl text-rose-600 mb-1">
                  <RefreshCw className="w-6 h-6 animate-spin" />
                </div>
                <h3 className="text-sm font-bold text-slate-900">
                  {progressPhase === 'following'
                    ? 'Buscando quem você segue...'
                    : progressPhase === 'followers'
                    ? 'Buscando seus seguidores...'
                    : 'Processando e salvando...'}
                </h3>
                <p className="text-xs text-slate-500 font-medium px-4">{progressMsg}</p>
              </div>

              {/* Progress Counters */}
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200/60">
                  <span className="text-[11px] text-slate-400 block font-medium">Seguindo</span>
                  <span className="text-lg font-bold text-purple-600">{followingCount}</span>
                </div>
                <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200/60">
                  <span className="text-[11px] text-slate-400 block font-medium">Seguidores</span>
                  <span className="text-lg font-bold text-blue-600">{followersCount}</span>
                </div>
              </div>

              {/* Animated Progress Bar */}
              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden relative">
                <div className="bg-gradient-to-r from-amber-500 via-rose-500 to-purple-600 h-full w-full animate-pulse" />
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 text-[11px] text-slate-500 flex items-start gap-2">
                <Clock className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <span>
                  Para proteger sua conta do Instagram contra bloqueios, as requisições são espaçadas de forma segura.
                </span>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleStopSync}
                  className="w-full py-2.5 px-4 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold text-xs flex items-center justify-center gap-2 transition cursor-pointer"
                >
                  <StopCircle className="w-4 h-4 text-rose-500" />
                  <span>Interromper e Salvar Carregados</span>
                </button>
              </div>
            </div>
          ) : (
            /* Setup / Configuration View */
            <div className="space-y-4">
              {/* Session Status Card */}
              {checkingSession ? (
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-500 flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-purple-600" />
                  <span>Verificando sessão conectada ao Instagram...</span>
                </div>
              ) : session?.isLoggedIn ? (
                <div className="p-3 bg-emerald-50/80 rounded-xl border border-emerald-200/80 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <div>
                      <div className="text-xs font-semibold text-emerald-900">
                        Sessão Ativa Detectada
                      </div>
                      <div className="text-[11px] text-emerald-700">
                        ID de Usuário: <span className="font-mono">{session.userId}</span>
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] bg-emerald-200/70 text-emerald-800 font-bold px-2 py-0.5 rounded-md uppercase">
                    Conectado
                  </span>
                </div>
              ) : (
                <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-200 space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-semibold text-amber-900">
                        Nenhuma sessão ativa detectada
                      </div>
                      <p className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
                        Para sincronizar seus seguidores, é necessário estar conectado à sua conta no Instagram neste navegador.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={handleOpenInstagram}
                      className="px-3 py-1.5 bg-white hover:bg-amber-100/60 text-amber-900 border border-amber-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <span>Abrir Instagram e Fazer Login</span>
                      <ExternalLink className="w-3 h-3 text-amber-700" />
                    </button>
                    <button
                      onClick={checkSession}
                      className="px-3 py-1.5 text-xs font-medium text-amber-800 hover:text-amber-900 underline transition cursor-pointer"
                    >
                      Já fiz login, verificar novamente
                    </button>
                  </div>
                </div>
              )}

              {/* Mode Selection */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-700">O que você deseja sincronizar?</label>
                <div className="grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    onClick={() => setSyncMode('both')}
                    className={`p-3 rounded-xl border text-left transition flex items-center justify-between cursor-pointer ${
                      syncMode === 'both'
                        ? 'border-purple-500 bg-purple-50/50 text-purple-950 ring-1 ring-purple-500'
                        : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-bold flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-rose-500" />
                        <span>Seguidores e Quem Eu Sigo (Recomendado)</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Atualiza quem segue você e quem você segue, identificando não-seguidores e fãs.
                      </div>
                    </div>
                    <div
                      className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                        syncMode === 'both' ? 'border-purple-600 bg-purple-600 text-white' : 'border-slate-300'
                      }`}
                    >
                      {syncMode === 'both' && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSyncMode('following')}
                    className={`p-3 rounded-xl border text-left transition flex items-center justify-between cursor-pointer ${
                      syncMode === 'following'
                        ? 'border-purple-500 bg-purple-50/50 text-purple-950 ring-1 ring-purple-500'
                        : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-bold flex items-center gap-1.5">
                        <UserCheck className="w-3.5 h-3.5 text-purple-600" />
                        <span>Apenas Quem Eu Sigo (Seguindo)</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Atualiza a lista de perfis que você segue atualmente.
                      </div>
                    </div>
                    <div
                      className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                        syncMode === 'following' ? 'border-purple-600 bg-purple-600 text-white' : 'border-slate-300'
                      }`}
                    >
                      {syncMode === 'following' && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSyncMode('followers')}
                    className={`p-3 rounded-xl border text-left transition flex items-center justify-between cursor-pointer ${
                      syncMode === 'followers'
                        ? 'border-purple-500 bg-purple-50/50 text-purple-950 ring-1 ring-purple-500'
                        : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-bold flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-blue-600" />
                        <span>Apenas Quem Me Segue (Seguidores)</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Atualiza a lista de pessoas que seguem seu perfil.
                      </div>
                    </div>
                    <div
                      className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                        syncMode === 'followers' ? 'border-purple-600 bg-purple-600 text-white' : 'border-slate-300'
                      }`}
                    >
                      {syncMode === 'followers' && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                    </div>
                  </button>
                </div>
              </div>

              {/* Privacy Notice */}
              <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl text-[11px] text-slate-500 space-y-1">
                <div className="font-semibold text-slate-700 flex items-center gap-1">
                  <Shield className="w-3.5 h-3.5 text-purple-600" />
                  <span>Privacidade e Segurança</span>
                </div>
                <p>
                  A sincronização busca <strong>apenas o @username e nome público</strong> para gerenciar seus seguidores. Nenhuma informação privada (como biografia, telefone, e-mails ou posts) é extraída ou exportada.
                </p>
              </div>

              {errorMsg && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                >
                  Cancelar
                </button>

                <button
                  type="button"
                  disabled={!session?.isLoggedIn || checkingSession}
                  onClick={handleStartSync}
                  className="px-5 py-2.5 text-xs font-semibold text-white bg-gradient-to-r from-purple-600 via-rose-600 to-amber-500 hover:from-purple-700 hover:via-rose-700 hover:to-amber-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-md shadow-rose-200 transition flex items-center gap-2 cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Iniciar Sincronização</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
