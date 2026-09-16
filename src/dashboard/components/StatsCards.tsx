import React from 'react';
import {
  Users,
  UserCheck,
  UserX,
  Heart,
  History,
  Shield,
  Layers,
} from 'lucide-react';
import type { DashboardStats } from '../../db';
import type { FilterCategory } from '../../types';

interface StatsCardsProps {
  stats: DashboardStats;
  currentFilter: FilterCategory;
  onSelectFilter: (category: FilterCategory) => void;
}

export const StatsCards: React.FC<StatsCardsProps> = ({
  stats,
  currentFilter,
  onSelectFilter,
}) => {
  const cards: {
    key: FilterCategory;
    title: string;
    count: number;
    description: string;
    icon: React.ElementType;
    color: string;
    bgColor: string;
    borderColor: string;
  }[] = [
    {
      key: 'all',
      title: 'Total na Base',
      count: stats.total,
      description: 'Todos os contatos registrados',
      icon: Layers,
      color: 'text-slate-700',
      bgColor: 'bg-slate-50',
      borderColor: 'border-slate-200',
    },
    {
      key: 'iFollow',
      title: 'Eu Sigo',
      count: stats.iFollow,
      description: 'Perfis que sigo atualmente',
      icon: UserCheck,
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-50/50',
      borderColor: 'border-emerald-200',
    },
    {
      key: 'followsMe',
      title: 'Me Seguem',
      count: stats.followsMe,
      description: 'Perfis que me seguem',
      icon: Users,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50/50',
      borderColor: 'border-blue-200',
    },
    {
      key: 'notFollowingBack',
      title: 'Não Me Seguem de Volta',
      count: stats.notFollowingBack,
      description: 'Eu sigo, mas não sou seguido',
      icon: UserX,
      color: 'text-amber-600',
      bgColor: 'bg-amber-50/50',
      borderColor: 'border-amber-200',
    },
    {
      key: 'fans',
      title: 'Fãs (Não Sigo de Volta)',
      count: stats.fans,
      description: 'Me seguem, mas eu não sigo',
      icon: Heart,
      color: 'text-rose-600',
      bgColor: 'bg-rose-50/50',
      borderColor: 'border-rose-200',
    },
    {
      key: 'everFollowed',
      title: 'Já Segui Anteriormente',
      count: stats.everFollowed,
      description: 'Histórico mantido após unfollow',
      icon: History,
      color: 'text-indigo-600',
      bgColor: 'bg-indigo-50/50',
      borderColor: 'border-indigo-200',
    },
    {
      key: 'protected',
      title: 'Protegidos (Whitelist)',
      count: stats.protectedCount,
      description: 'Perfis na lista de proteção',
      icon: Shield,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50/50',
      borderColor: 'border-purple-200',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
      {cards.map((card) => {
        const Icon = card.icon;
        const isSelected = currentFilter === card.key;

        return (
          <button
            key={card.key}
            onClick={() => onSelectFilter(card.key)}
            className={`text-left p-3.5 rounded-2xl border transition-all duration-200 cursor-pointer flex flex-col justify-between ${
              isSelected
                ? 'ring-2 ring-purple-600 border-purple-500 shadow-md bg-white'
                : 'bg-white hover:bg-slate-50/80 border-slate-200/90 hover:border-slate-300 shadow-xs'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-500 truncate">
                {card.title}
              </span>
              <div className={`p-1.5 rounded-lg ${card.bgColor} ${card.color}`}>
                <Icon className="w-3.5 h-3.5" />
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900 tracking-tight">
                {card.count}
              </div>
              <div className="text-[11px] text-slate-400 truncate mt-0.5">
                {card.description}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
};
