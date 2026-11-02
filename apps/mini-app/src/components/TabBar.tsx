import { go, nav, type Tab } from '../lib/router';
import { useStore } from '../lib/store';
import { IconHear, IconHome, IconUser, IconWave } from './Icons';

const TABS: { id: Tab; label: string; Icon: typeof IconHome }[] = [
  { id: 'home', label: 'Главная', Icon: IconHome },
  { id: 'wave', label: 'Резонанс', Icon: IconWave },
  { id: 'hear', label: 'Слух', Icon: IconHear },
  { id: 'profile', label: 'Профиль', Icon: IconUser },
];

export function TabBar() {
  const tab = useStore(nav, (s) => s.tab);
  const depth = useStore(nav, (s) => s.stack.length);
  return (
    <nav className="tabbar" role="tablist" aria-label="Разделы">
      {TABS.map(({ id, label, Icon }) => (
        <button key={id} type="button" role="tab" className="tab" aria-selected={tab === id && depth === 0} onClick={() => go.tab(id)}>
          <Icon />
          {label}
        </button>
      ))}
    </nav>
  );
}
